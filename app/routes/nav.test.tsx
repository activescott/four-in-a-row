import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { expect, test, vi } from "vitest";
import { Header } from "../header";
import Login from "./login";
import Profile from "./profile";

const passkeyArgs = vi.hoisted(() => vi.fn());
vi.mock("@activescott/auth-adapter-react-router/client", async (original) => ({
  ...(await original<object>()),
  usePasskeySignIn: (options: unknown) => {
    passkeyArgs(options);
    return { signIn: () => {}, pending: false, error: null };
  },
}));

function render(path: string, Component: unknown, loaderData: unknown) {
  const Stub = createRoutesStub([
    { path, Component: Component as never, loader: () => loaderData },
  ]);
  return renderToString(
    <Stub
      initialEntries={[path]}
      hydrationData={{ loaderData: { "0": loaderData } }}
    />,
  );
}

const header = (email: string | null) =>
  render("/games", () => <Header email={email} />, null);

test("the signed-in header has the title, then an account menu with Profile and Sign out", () => {
  const html = header("alice@example.com");
  expect(html).toMatch(/<a [^>]*href="\/games"[^>]*>Four in a Row<\/a>/);
  expect(html).toMatch(/<details[^>]*>\s*<summary/);
  expect(html).toContain("alice@example.com");
  expect(html).toMatch(/<span[^>]*aria-hidden="true"[^>]*>A<\/span>/);
  expect(html).toMatch(/<a [^>]*href="\/profile"[^>]*>Profile<\/a>/);
  expect(html).toMatch(/<form[^>]*action="\/logout"/);
  expect(html).toMatch(/<button[^>]*>Sign out<\/button>/);
  expect(html).not.toMatch(/>Sign in</);
  expect(html).not.toContain("Your games");
});

test("the signed-out header has a Sign in link and no menu", () => {
  const html = header(null);
  expect(html).toMatch(/<a [^>]*href="\/login"[^>]*>Sign in<\/a>/);
  expect(html).not.toContain("<details");
  expect(html).not.toContain("Sign out");
});

test("the header's tap targets are at least 44px tall", () => {
  for (const html of [header("alice@example.com"), header(null)]) {
    for (const tag of html.match(/<(a|summary|button)\b[^>]*>/g) ?? []) {
      expect(tag).toMatch(/min-h-11/);
    }
  }
});

test("the profile page is light, not dark", () => {
  const html = render("/profile", Profile, {
    email: "alice@example.com",
    memberSince: "2026-01-01T00:00:00.000Z",
    identities: [],
    passkeys: [],
    linkFlow: { status: "idle" },
    removal: { status: "idle" },
  });
  expect(html).not.toMatch(/color-scheme:\s*light dark/i);
  expect(html).not.toMatch(/bg-(slate|gray|zinc|neutral)-(7|8|9)00|bg-black/);
  expect(html).toContain("[color-scheme:light]");
  expect(html).not.toContain("Your games");
});

test("the passkey button defaults to /games and keeps an explicit redirectTo", () => {
  const data = { sent: false, error: null, formToken: "t" };
  render("/login", Login, { ...data, redirectTo: null });
  expect(passkeyArgs).toHaveBeenLastCalledWith(
    expect.objectContaining({ redirectTo: "/games" }),
  );
  render("/login", Login, { ...data, redirectTo: "/invite/g1" });
  expect(passkeyArgs).toHaveBeenLastCalledWith(
    expect.objectContaining({ redirectTo: "/invite/g1" }),
  );
});
