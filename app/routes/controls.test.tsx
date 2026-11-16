import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { expect, test, vi } from "vitest";
import { classSet, openTag } from "../test/html";
import Games from "./games";
import Invite from "./invite.$key";
import Login from "./login";
import Profile from "./profile";

vi.mock("@activescott/auth-adapter-react-router/client", async (original) => ({
  ...(await original<object>()),
  usePasskeySignIn: () => ({ signIn: () => {}, pending: false, error: null }),
}));

function render(path: string, Component: unknown, loaderData: unknown) {
  const Stub = createRoutesStub([
    { path, Component: Component as never, loader: () => loaderData },
  ]);
  return renderToString(
    <Stub
      initialEntries={[path.replace(":key", "g1")]}
      hydrationData={{ loaderData: { "0": loaderData } }}
    />,
  );
}

// Tailwind's own theme is the source of the colour, so the check measures the
// colour the page gets, not a copy of it.
function themeColour(name: string): [number, number, number] {
  const css = readFileSync("node_modules/tailwindcss/theme.css", "utf8");
  const m = css.match(
    new RegExp(`--color-${name}: oklch\\(([\\d.]+)% ([\\d.]+) ([\\d.]+)\\)`),
  )!;
  const L = Number(m[1]) / 100;
  const C = Number(m[2]);
  const h = (Number(m[3]) * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ];
}
const luminance = ([r, g, b]: number[]) =>
  0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
const srgbToLinear = (hex: string): [number, number, number] => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (v: number) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return [f(c[0]!), f(c[1]!), f(c[2]!)];
};
const ratio = (a: number[], b: number[]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

test("the shared control border is at least 3:1 on the cream page and on white", () => {
  const border = themeColour("slate-500");
  expect(ratio(border, srgbToLinear("#fffbeb"))).toBeGreaterThanOrEqual(3);
  expect(ratio(border, srgbToLinear("#ffffff"))).toBeGreaterThanOrEqual(3);
});

function expectControlBorder(tag: string) {
  const classes = classSet(tag);
  expect(classes).toContain("border-slate-500");
  for (const weak of [
    "border-slate-200",
    "border-slate-300",
    "border-slate-400",
  ]) {
    expect(classes).not.toContain(weak);
  }
}

const loginData = {
  sent: false,
  error: null,
  formToken: "t",
  redirectTo: null,
};
const profileData = {
  email: "alice@example.com",
  memberSince: "2026-01-01T00:00:00.000Z",
  identities: [
    {
      id: "i1",
      provider: "email",
      identifier: "alice@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  passkeys: [],
  linkFlow: { status: "idle" },
  removal: { status: "idle" },
};

test("/login: the email field, the code field and the passkey button share the border", () => {
  const html = render("/login", Login, loginData);
  expectControlBorder(html.match(/<input[^>]*name="email"[^>]*>/)![0]);
  expectControlBorder(openTag(html, "Sign in with a passkey"));
  const sent = render("/login", Login, { ...loginData, sent: true });
  expectControlBorder(sent.match(/<input[^>]*name="code"[^>]*>/)![0]);
});

test("/games: the invite field has the shared border", () => {
  const html = render("/games", Games, { games: [] });
  expectControlBorder(html.match(/<input[^>]*name="email"[^>]*>/)![0]);
});

test("/invite: the code field has the shared border", () => {
  const html = render("/invite/:key", Invite, {
    maskedEmail: "b•••@example.com",
    redirectTo: "/invite/g1",
    sent: true,
    error: null,
    formToken: "t",
  });
  expectControlBorder(html.match(/<input[^>]*name="code"[^>]*>/)![0]);
});

test("/profile: the library's Add and Remove buttons share the border", () => {
  const html = render("/profile", Profile, profileData);
  expectControlBorder(
    html.match(/<button[^>]*data-testid="add-passkey"[^>]*>/)![0],
  );
  expectControlBorder(
    html.match(/<button[^>]*data-testid="remove-identity"[^>]*>/)![0],
  );
});

test("/profile has a way back to Your games, at least 44px tall", () => {
  const html = render("/profile", Profile, profileData);
  const links = html.match(/<a [^>]*href="\/games"[^>]*>Your games<\/a>/g);
  expect(links).toHaveLength(1);
  expect(classSet(links![0]!)).toContain("min-h-11");
});
