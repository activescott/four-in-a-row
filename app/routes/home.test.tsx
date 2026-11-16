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

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
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
  expect(copy).toMatch(/email you when it's your turn/);
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

test("red discs reach 3:1 against the board", () => {
  const html = renderHome();
  const face = html.match(
    /<path[^>]*fill-rule="evenodd"[^>]*fill="(#[0-9a-f]{6})"/,
  )?.[1];
  expect(face).toBeDefined();
  expect(html).toContain('fill="#dc2626"');
  expect(contrast("#dc2626", face!)).toBeGreaterThanOrEqual(3);
  expect(contrast("#fbbf24", face!)).toBeGreaterThanOrEqual(3);
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

test("the home page copy is 20px, balanced, and the sign-in hint is true to /login", async () => {
  const Stub = createRoutesStub([{ path: "/", Component: home.default }]);
  const html = renderToString(<Stub initialEntries={["/"]} />);
  expect(html).toMatch(
    /<p class="[^"]*\btext-xl\b[^"]*\btext-balance\b[^"]*">Take turns with family, from any phone or laptop\.<\/p>/,
  );
  expect(html).toMatch(
    /<a [^>]*class="[^"]*\bfocus-visible:outline-3\b[^"]*\bfocus-visible:outline-offset-2\b[^"]*"[^>]*>Sign in<\/a>/,
  );
  expect(html).toMatch(
    /Sign in<\/a><p class="[^"]*\btext-base\b[^"]*\btext-balance\b[^"]*">We&#x27;ll email you a link or code\. No password needed\.<\/p>/,
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
