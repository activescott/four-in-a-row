import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { createPgliteDb } from "../pglite.server";
import { CookieJar } from "../test/cookie-jar";
import { get, jsonPost, ORIGIN, run } from "../test/routes";
import { SoftAuthenticator } from "../test/soft-authenticator";

const getDb = vi.hoisted(() => vi.fn<() => Promise<PrismaClient>>());
vi.mock("../db.server", () => ({ getDb }));

let db: PrismaClient;

beforeAll(async () => {
  db = await createPgliteDb();
  getDb.mockResolvedValue(db);
});

afterAll(async () => {
  await db.$disconnect();
});

const { auth } = await import("../auth.server");
const authRoute = await import("./auth.$provider.$action");
const profile = await import("./profile");

async function passkeyCall(jar: CookieJar, action: string, body: unknown = {}) {
  const response = (await run(
    authRoute.action,
    jsonPost(`/auth/passkey/${action}`, body, jar.header()),
    { provider: "passkey", action },
  )) as Response;
  jar.store(response);
  return response;
}

// A signed-in session for a user who signed up by email, as after a magic link.
async function signedInJar(email: string) {
  const user = await db.user.create({ data: { email } });
  const identity = await auth.getStores().identityStore.create({
    userId: user.id,
    provider: "email",
    identifier: email,
    providerState: {},
  });
  const jar = new CookieJar();
  jar.store(
    new Response(null, {
      headers: {
        "set-cookie": await auth.createSessionCookie({ id: user.id }, identity),
      },
    }),
  );
  return { user, jar };
}

test("a signed-in user enrols a passkey, then signs in with it after signing out", async () => {
  const { user, jar } = await signedInJar("passkey@example.com");
  const authenticator = new SoftAuthenticator(ORIGIN, "localhost");

  const options = await passkeyCall(jar, "register-options");
  expect(options.status).toBe(200);
  const registration = await passkeyCall(
    jar,
    "register-verify",
    authenticator.register(await options.json()),
  );
  expect(registration.status).toBe(200);
  expect(await registration.json()).toMatchObject({
    verified: true,
    credentialId: authenticator.id,
  });

  const page = await run(
    profile.loader,
    get("/profile", { cookie: jar.header() }),
  );
  expect(page).toMatchObject({
    passkeys: [{ credentialId: authenticator.id }],
  });

  const signedOut = new CookieJar();
  const signInOptions = await passkeyCall(signedOut, "authenticate-options");
  expect(signInOptions.status).toBe(200);
  const signIn = await passkeyCall(
    signedOut,
    "authenticate-verify",
    authenticator.authenticate(await signInOptions.json()),
  );
  expect(signIn.status).toBe(200);
  expect(await signIn.json()).toMatchObject({
    verified: true,
    user: { id: user.id },
  });

  const after = await run(
    profile.loader,
    get("/profile", { cookie: signedOut.header() }),
  );
  expect(after).toMatchObject({ email: "passkey@example.com" });
});

test("passkey enrolment needs a session", async () => {
  const response = await passkeyCall(new CookieJar(), "register-options");

  expect(response.status).toBe(401);
});

test("a passkey the server does not know is refused", async () => {
  const jar = new CookieJar();
  const stranger = new SoftAuthenticator(ORIGIN, "localhost");
  const options = await passkeyCall(jar, "authenticate-options");

  const response = await passkeyCall(
    jar,
    "authenticate-verify",
    stranger.authenticate(await options.json()),
  );

  expect(response.status).toBe(401);
});
