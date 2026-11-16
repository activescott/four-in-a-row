import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { afterAll, expect, test, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
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

async function signedInCookie() {
  const email = "home-test@example.com";
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

test("a signed-out visitor sees a Sign in link to /login", async () => {
  expect(await run(home.loader, get("/"))).not.toBeInstanceOf(Response);
  const Stub = createRoutesStub([{ path: "/", Component: home.default }]);
  const html = renderToString(<Stub initialEntries={["/"]} />);
  expect(html).toMatch(/<a [^>]*href="\/login"[^>]*>Sign in<\/a>/);
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
    /<a [^>]*class="[^"]*\bfocus-visible:outline-2\b[^"]*\bfocus-visible:outline-offset-2\b[^"]*"[^>]*>Sign in<\/a>/,
  );
  expect(html).toMatch(
    /Sign in<\/a><p class="[^"]*\btext-sm\b[^"]*">We&#x27;ll email you a link or code\. No password needed\.<\/p>/,
  );
});
