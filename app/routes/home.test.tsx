import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { afterAll, expect, test, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { Header } from "../header";
import { createPgliteDb } from "../pglite.server";
import { get, run } from "../test/routes";

const { getDb } = vi.hoisted(() => ({
  getDb: vi.fn<() => Promise<PrismaClient>>(),
}));
vi.mock("../db.server", () => ({ getDb }));

const db = await createPgliteDb();
getDb.mockResolvedValue(db);
afterAll(async () => {
  await db.$disconnect();
});

const { auth } = await import("../auth.server");
const home = await import("./home");

async function signedInCookie(email = "home-test@example.com") {
  const user = await db.user.create({
    data: {
      email,
      identities: {
        create: { provider: "email", identifier: email, metadata: {} },
      },
    },
    include: { identities: true },
  });
  const identity = user.identities[0]!;
  const setCookie = await auth.createSessionCookie(
    { id: user.id, metadata: { email, createdAt: user.createdAt } },
    {
      id: identity.id,
      userId: user.id,
      provider: "email",
      identifier: email,
      providerState: {},
      createdAt: identity.createdAt,
    },
  );
  return setCookie.split(";")[0]!;
}

function renderHome(path = "/") {
  const Stub = createRoutesStub([{ path: "/", Component: home.default }]);
  return renderToString(<Stub initialEntries={[path]} />);
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

// Tailwind v4 colours are oklch in its theme; convert a token to linear sRGB
// luminance, as the browser shows it.
const theme = readFileSync("node_modules/tailwindcss/theme.css", "utf8");
function token(name: string) {
  const m = theme.match(
    new RegExp(`--color-${name}: oklch\\(([\\d.]+)% ([\\d.]+) ([\\d.]+)\\)`),
  );
  if (!m) throw new Error(`no theme colour ${name}`);
  const L = Number(m[1]) / 100;
  const C = Number(m[2]);
  const h = (Number(m[3]) * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const [r, g, bl] = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, v))) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}
function contrast(a: string, b: string) {
  const [hi, lo] = [token(a), token(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

test("a signed-out visitor is told what the game is, who it is for and that there is nothing to install", async () => {
  expect(await run(home.loader, get("/"))).not.toBeInstanceOf(Response);
  const html = renderHome();
  const copy = text(html);
  expect(html).toMatch(/<h1[^>]*>Four in a Row<\/h1>/);
  expect(copy).toMatch(/family and friends/);
  expect(copy).toMatch(/phone or laptop/);
  expect(copy).toContain("Nothing to install. No password");
  expect(copy).toContain("a link or code");
  expect(copy).toMatch(/email you when it[’']s your turn/);
});

test("it claims nothing the app does not do", () => {
  const copy = text(renderHome());
  expect(copy).not.toMatch(/\bfree\b/i);
  expect(copy).not.toMatch(/\balways\b/i);
});

test("the privacy line is the one on /login", () => {
  const sentence =
    "We use your email only to sign you in and send your game emails. We never share or sell it.";
  const login = readFileSync("app/routes/login.tsx", "utf8").replace(
    /\s+/g,
    " ",
  );
  expect(login).toContain(sentence);
  expect(text(renderHome())).toContain(sentence);
});

test("Nothing to install sits at body size right under the Sign in button", () => {
  const html = renderHome();
  expect(html).toMatch(
    /href="\/login"[^>]*>Sign in<\/a><p class="[^"]*\btext-lg\b[^"]*">Nothing to install\. No password/,
  );
});

test("there is one primary action: Sign in, once more lower down, and none in the header", () => {
  const links = renderHome().match(/<a [^>]*href="\/login"[^>]*>[^<]*<\/a>/g);
  expect(links).toHaveLength(2);
  for (const link of links!) expect(link).toMatch(/>Sign in<\/a>/);
  const Stub = createRoutesStub([
    { path: "/", Component: () => <Header email={null} /> },
  ]);
  const header = renderToString(<Stub initialEntries={["/"]} />);
  expect(header).toMatch(/Four in a Row/);
  expect(header).not.toContain('href="/login"');
});

test("the header lines up with the page's content column", () => {
  const Stub = createRoutesStub([
    { path: "/", Component: () => <Header email={null} /> },
  ]);
  const header = renderToString(<Stub initialEntries={["/"]} />);
  const page = renderHome();
  const width = (html: string, re: RegExp) => html.match(re)?.[1];
  expect(width(header, /<header[^>]*><div class="[^"]*\b(max-w-6xl)\b/)).toBe(
    "max-w-6xl",
  );
  expect(width(page, /<section class="[^"]*\b(max-w-6xl)\b/)).toBe("max-w-6xl");
});

test("the board is an image with an accessible label", () => {
  const html = renderHome();
  expect(html).toMatch(
    /<svg(?=[^>]*role="img")(?=[^>]*aria-label="[^"]*Four in a Row board[^"]*")/,
  );
});

test("the board uses the theme colours, red reaches 3:1 and holes show against the face", () => {
  const html = renderHome();
  expect(html).toContain("fill:var(--color-red-600)");
  expect(html).toContain("fill:var(--color-amber-400)");
  expect(html).toMatch(
    /<path[^>]*fill-rule="evenodd"[^>]*style="fill:var\(--color-blue-950\)"/,
  );
  expect(html).toContain("fill:var(--color-blue-700)");
  expect(contrast("red-600", "blue-950")).toBeGreaterThanOrEqual(3);
  expect(contrast("amber-400", "blue-950")).toBeGreaterThanOrEqual(3);
  // Was 1.21:1 with the old #0f172a hole.
  expect(contrast("blue-700", "blue-950")).toBeGreaterThanOrEqual(2);
});

test("the decorative circles are hidden on phones", () => {
  const html = renderHome();
  expect(html).not.toContain("overflow-x-clip");
  for (const c of ["bg-amber-200", "bg-red-100"])
    expect(html).toMatch(
      new RegExp(
        `<div[^>]*class="(?=[^"]*\\bhidden\\b)(?=[^"]*\\bmd:block\\b)[^"]*\\b${c}\\b`,
      ),
    );
});

test("the old ?concept switch is gone", () => {
  expect(renderHome("/?concept=b")).toBe(renderHome("/"));
});

test("a signed-in visitor is sent to their games", async () => {
  const response = await run(
    home.loader,
    get("/", { cookie: await signedInCookie() }),
  );
  expect(response).toBeInstanceOf(Response);
  const { status, headers } = response as Response;
  expect(status).toBe(302);
  expect(headers.get("location")).toBe("/games");
});

test("the home page subhead is 20px and balanced, and Sign in shows a focus ring", () => {
  const html = renderHome();
  expect(html).toMatch(
    /<p class="[^"]*\btext-xl\b[^"]*\btext-balance\b[^"]*">Drop discs, line up four, win\. Play with family and friends/,
  );
  expect(html).toMatch(
    /<a [^>]*class="[^"]*\bfocus-visible:outline-3\b[^"]*\bfocus-visible:outline-offset-3\b[^"]*"[^>]*>Sign in<\/a>/,
  );
});

test("the root loader gives the header the signed-in email, or null", async () => {
  const root = await import("../root");
  expect(await run(root.loader, get("/"))).toEqual({ email: null });
  const cookie = await signedInCookie("root-test@example.com");
  expect(await run(root.loader, get("/", { cookie }))).toEqual({
    email: "root-test@example.com",
  });
});
