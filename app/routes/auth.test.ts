import { afterAll, expect, test, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { createPgliteDb } from "../pglite.server";
import { CookieJar } from "../test/cookie-jar";
import { formPost, get, run } from "../test/routes";

// Env for this file comes from vitest.config.mts: E2E_TEST_MODE=true, fake
// secrets, and SIGNUP_EMAILS=seed@example.com.

const { getDb, capture } = vi.hoisted(() => ({
  getDb: vi.fn<() => Promise<PrismaClient>>(),
  capture: { lines: [] as Record<string, unknown>[] },
}));
vi.mock("../db.server", () => ({ getDb }));
vi.mock("../logger.server", async (importOriginal) => {
  const original = await importOriginal<typeof import("../logger.server")>();
  return {
    ...original,
    logger: original.createLogger({
      write: (line: string) => capture.lines.push(JSON.parse(line)),
    }),
  };
});

const events = (event: string) =>
  capture.lines.filter((line) => line.event === event);

// The auth module reads the database when it first loads, so connect it
// before the route modules are imported below.
const db = await createPgliteDb();
getDb.mockResolvedValue(db);

afterAll(async () => {
  await db.$disconnect();
});

const E2E_SECRET = { "x-e2e-secret": "test-only-e2e-capture-secret" };

const authRoute = await import("./auth.$provider.$action");
const login = await import("./login");
const logout = await import("./logout");
const profile = await import("./profile");
const capturedEmail = await import("./e2e.captured-email");

function params(path: string) {
  const [, , provider, action] = new URL(
    path,
    "http://localhost",
  ).pathname.split("/");
  return { provider, action };
}

async function auth(request: Request) {
  const path = new URL(request.url).pathname;
  const handler =
    request.method === "GET" ? authRoute.loader : authRoute.action;
  return (await run(handler, request, params(path))) as Response;
}

// Requests a sign-in email from /login?redirectTo=..., as the login form does.
async function requestEmail(
  jar: CookieJar,
  email: string,
  redirectTo?: string,
) {
  const loginPath = redirectTo
    ? `/login?redirectTo=${encodeURIComponent(redirectTo)}`
    : "/login";
  const response = await auth(
    formPost(
      "/auth/email/initiate",
      { email, ...(redirectTo && { redirectTo }) },
      { cookie: jar.header(), referer: loginPath },
    ),
  );
  jar.store(response);
  return response;
}

async function readCapturedEmail(email: string) {
  return (await run(
    capturedEmail.loader,
    get(`/e2e/captured-email?email=${encodeURIComponent(email)}`, E2E_SECRET),
  )) as Response;
}

// Opens the captured magic link and presses "Confirm sign-in".
async function followMagicLink(jar: CookieJar, magicLink: string) {
  const link = new URL(magicLink);
  const confirmPage = await auth(
    get(link.pathname + link.search, { cookie: jar.header() }),
  );
  expect(confirmPage.status).toBe(200);
  const html = await confirmPage.text();
  const action = html
    .match(/<form method="post" action="([^"]*)"/)![1]
    .replaceAll("&amp;", "&");
  const response = await auth(
    formPost(
      `/auth/email/verify${action}`,
      {
        challenge: link.searchParams.get("challenge")!,
        key: link.searchParams.get("key")!,
      },
      { cookie: jar.header(), referer: link.pathname + link.search },
    ),
  );
  jar.store(response);
  return response;
}

// An existing account, so the gate allows it; each test uses its own address
// to stay under the library's per-recipient rate limit.
async function member(email: string) {
  await db.user.create({ data: { email } });
  return email;
}

async function signIn(email: string, redirectTo?: string) {
  const jar = new CookieJar();
  await requestEmail(jar, email, redirectTo);
  const { magicLink } = await (await readCapturedEmail(email)).json();
  const response = await followMagicLink(jar, magicLink);
  return { jar, response };
}

test("an allowed address signs in by email link end to end and lands on redirectTo", async () => {
  const loginData = await run(
    login.loader,
    get("/login?redirectTo=%2Fprofile"),
  );
  expect(loginData).toMatchObject({ redirectTo: "/profile" });

  const jar = new CookieJar();
  const sent = await requestEmail(jar, "seed@example.com", "/profile");
  expect(sent.status).toBe(302);
  expect(new URL(sent.headers.get("location")!).searchParams.get("sent")).toBe(
    "1",
  );

  const captured = await readCapturedEmail("seed@example.com");
  expect(captured.status).toBe(200);
  const { magicLink, code } = await captured.json();
  expect(magicLink).toContain("/auth/email/verify?");
  expect(code).toMatch(/^\d{6}$/);

  const signedIn = await followMagicLink(jar, magicLink);
  expect(signedIn.status).toBe(302);
  expect(signedIn.headers.get("location")).toBe("/profile");

  const page = await run(
    profile.loader,
    get("/profile", { cookie: jar.header() }),
  );
  expect(page).toMatchObject({ email: "seed@example.com" });

  const user = await db.user.findUniqueOrThrow({
    where: { email: "seed@example.com" },
  });
  expect(events("auth.signin.succeeded")).toContainEqual(
    expect.objectContaining({ userId: user.id, provider: "email" }),
  );
});

test("an address the gate does not allow is refused and no mail is sent", async () => {
  const jar = new CookieJar();

  const response = await requestEmail(jar, "stranger@example.com", "/profile");

  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/login?error=NOT_INVITED");
  expect((await readCapturedEmail("stranger@example.com")).status).toBe(404);
  expect(
    await db.user.count({ where: { email: "stranger@example.com" } }),
  ).toBe(0);

  const page = await run(login.loader, get("/login?error=NOT_INVITED"));
  expect(page).toMatchObject({
    errorCode: "NOT_INVITED",
    error: expect.stringMatching(/invite/i),
  });
});

test("an existing account can sign in again although it is not in SIGNUP_EMAILS", async () => {
  const { response } = await signIn(await member("member@example.com"));

  expect(response.status).toBe(302);
  expect(response.headers.get("set-cookie")).toBeTruthy();
});

test("a wrong code is refused and logs auth.signin.failed", async () => {
  const email = await member("wrong-code@example.com");
  const jar = new CookieJar();
  await requestEmail(jar, email);
  const { code } = await (await readCapturedEmail(email)).json();
  const wrong = code === "000000" ? "111111" : "000000";

  const response = await auth(
    formPost(
      "/auth/email/verify",
      { code: wrong },
      { cookie: jar.header(), referer: "/login" },
    ),
  );

  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toMatch(
    /^\/login\?error=INVALID_CREDENTIALS/,
  );
  expect(events("auth.signin.failed")).toContainEqual(
    expect.objectContaining({ provider: "email", code: "INVALID_CREDENTIALS" }),
  );
});

test("logout clears the session", async () => {
  const email = await member("logout@example.com");
  const { jar } = await signIn(email, "/profile");
  expect(
    await run(profile.loader, get("/profile", { cookie: jar.header() })),
  ).toMatchObject({
    email,
  });

  const response = (await run(
    logout.action,
    formPost("/logout", {}, { cookie: jar.header(), referer: "/profile" }),
  )) as Response;
  jar.store(response);

  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/login");
  const after = (await run(
    profile.loader,
    get("/profile", { cookie: jar.header() }),
  )) as Response;
  expect(after.status).toBe(302);
  expect(after.headers.get("location")).toBe("/login?redirectTo=%2Fprofile");
});

test("requireAuth redirects to /login with redirectTo when signed out", async () => {
  const response = (await run(
    profile.loader,
    get("/profile?tab=passkeys"),
  )) as Response;

  expect(response).toBeInstanceOf(Response);
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(
    `/login?redirectTo=${encodeURIComponent("/profile?tab=passkeys")}`,
  );
});

test("/login sends a signed-in user on to redirectTo", async () => {
  const { jar } = await signIn(await member("returning@example.com"));

  const response = (await run(
    login.loader,
    get("/login?redirectTo=%2Fprofile", { cookie: jar.header() }),
  )) as Response;

  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/profile");
});

test("/e2e/captured-email needs the shared secret even in test mode", async () => {
  const response = (await run(
    capturedEmail.loader,
    get("/e2e/captured-email?email=seed%40example.com", {
      "x-e2e-secret": "wrong",
    }),
  )) as Response;

  expect(response.status).toBe(404);
});

test("no log line carries an email address", () => {
  expect(capture.lines.length).toBeGreaterThan(0);
  expect(JSON.stringify(capture.lines)).not.toMatch(/@example\.com/);
});
