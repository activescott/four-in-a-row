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
  expect(html).toMatch(/<a [^>]*href="\/profile"[^>]*>Profile<\/a>/);
  expect(html).toMatch(/<form[^>]*action="\/logout"/);
  expect(html).toMatch(/<button[^>]*>Sign out<\/button>/);
  expect(html).not.toMatch(/>Sign in</);
  expect(html).not.toContain("Your games");
});

test("the menu button's name contains the text it shows", () => {
  const summary = header("alice@example.com")
    .match(/<summary[^>]*>([\s\S]*?)<\/summary>/)![1]!
    .replace(/<svg[\s\S]*?<\/svg>/, ""); // the chevron is decoration
  // Nothing visible is hidden from the accessible name.
  expect(summary).not.toContain("aria-hidden");
  expect(summary).toContain(">A<");
  expect(summary).toContain(">Account<");
});

test("the account trigger shows the avatar, an Account label and a chevron, 44px wide", () => {
  const summary = header("alice@example.com").match(
    /<summary[^>]*>([\s\S]*?)<\/summary>/,
  )![1]!;
  expect(summary).toMatch(/size-11/);
  expect(summary).toMatch(/<svg/);
  // The label is shown on every width, not only from sm up.
  expect(summary).not.toMatch(/class="hidden[^"]*"[^>]*>Account</);
  expect(summary).not.toContain("alice@example.com");
});

test("the menu's email is wide enough not to break mid-word", () => {
  const html = header("alice@example.com");
  const email = html.match(/<p[^>]*>alice@example\.com<\/p>/)![0];
  expect(email).not.toContain("break-all");
  expect(html).toMatch(/min-w-\[16rem\][^"]*max-w-\[calc\(100vw-1rem\)\]/);
});

test("the header sits in the same container as the page content", () => {
  const html = header("alice@example.com");
  expect(html).toMatch(/<header[^>]*><div class="[^"]*max-w-md[^"]* px-4/);
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
  expect(html).toContain("[color-scheme:light]");
  expect(html).toContain('<span aria-hidden="true">←</span> Your games</a>');
});

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

test("each sign-in method is a stacked card at every width (the column is never wider than 28rem), with a full-width 44px Remove", () => {
  const html = render("/profile", Profile, profileData);
  const table = html.match(/<table[^>]*>/)![0];
  // Unprefixed: a table does not fit the 28rem column at any viewport.
  expect(table).toMatch(/[\s"]\[&amp;_tr\]:flex[\s"]/);
  expect(table).not.toMatch(/sm:table/);
  expect(table).toMatch(/[\s"]\[&amp;_tr\]:flex-col/);
  expect(table).toMatch(/[\s"]\[&amp;_tr\]:border[\s"]/);
  const remove = html.match(
    /<button[^>]*data-testid="remove-identity"[^>]*>/,
  )![0];
  expect(remove).toMatch(/min-h-11/);
  // Full width inside the table only: passkeys list their Remove in a row.
  expect(table).toMatch(/[\s"]\[&amp;_button\]:w-full/);
  // The library's inline 24px button style is replaced, not kept.
  expect(remove).not.toContain("style=");
});

test("the profile's tap targets are 44px and its grey text is slate-600", () => {
  const html = render("/profile", Profile, profileData);
  const add = html.match(/<button[^>]*data-testid="add-passkey"[^>]*>/)![0];
  expect(add).toMatch(/min-h-11/);
  expect(html).toMatch(/<dt[^>]*text-slate-600/);
  expect(html).toMatch(/<p[^>]*text-slate-600[^>]*>Sign in with Touch ID/);
  expect(html).not.toContain("GrayText");
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
