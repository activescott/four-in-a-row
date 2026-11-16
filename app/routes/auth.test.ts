import { NodemailerTransport } from "@activescott/auth-provider-email";
import type { SendMailOptions } from "nodemailer";
import { afterAll, expect, test, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { SEND_LIMITS } from "../mail/send-limits.server";
import { createPgliteDb } from "../pglite.server";
import { CookieJar } from "../test/cookie-jar";
import { formPost, get, run } from "../test/routes";

// Env for this file comes from vitest.config.mts: E2E_TEST_MODE=true, fake
// secrets.

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
const games = await import("./games");
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

// An existing, approved account, so the gate allows it; each test uses its
// own address to stay under the library's per-recipient rate limit.
async function member(email: string) {
  await db.user.create({ data: { email, approvedAt: new Date() } });
  return email;
}

async function signIn(email: string, redirectTo?: string) {
  const jar = new CookieJar();
  await requestEmail(jar, email, redirectTo);
  const { magicLink } = await (await readCapturedEmail(email)).json();
  const response = await followMagicLink(jar, magicLink);
  return { jar, response };
}

// Not the default successRedirect (/profile), so a dropped redirectTo fails.
const TARGET = "/games/abc";
const OFF_SITE = ["https://evil.example", "//evil.example"];

test("an allowed address signs in by email link end to end and lands on redirectTo", async () => {
  const loginData = await run(
    login.loader,
    get(`/login?redirectTo=${encodeURIComponent(TARGET)}`),
  );
  expect(loginData).toMatchObject({ redirectTo: TARGET });

  const jar = new CookieJar();
  const sent = await requestEmail(jar, "seed@example.com", TARGET);
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
  expect(signedIn.headers.get("location")).toBe(TARGET);

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

test("the code form's action keeps redirectTo, as login.tsx builds it", async () => {
  const email = await member("code-entry@example.com");
  const jar = new CookieJar();
  await requestEmail(jar, email, TARGET);
  const { code } = await (await readCapturedEmail(email)).json();

  const response = await auth(
    formPost(
      `/auth/email/verify?redirectTo=${encodeURIComponent(TARGET)}`,
      { code },
      { cookie: jar.header(), referer: "/login" },
    ),
  );

  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(TARGET);
});

test.each(OFF_SITE)(
  "an off-site redirectTo %s is refused and sign-in lands on /profile",
  async (target) => {
    const loginData = await run(
      login.loader,
      get(`/login?redirectTo=${encodeURIComponent(target)}`),
    );
    expect(loginData).toMatchObject({ redirectTo: null });

    const email = await member(
      `off-site-${OFF_SITE.indexOf(target)}@example.com`,
    );
    const { jar, response } = await signIn(email, target);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/profile");

    const again = (await run(
      login.loader,
      get(`/login?redirectTo=${encodeURIComponent(target)}`, {
        cookie: jar.header(),
      }),
    )) as Response;
    expect(again.status).toBe(302);
    expect(again.headers.get("location")).toBe("/profile");
  },
);

test("the sign-in email comes from Four in a Row, with its name in the subject once", async () => {
  const { emailConfig } = await import("../auth.server");
  const transport = new NodemailerTransport();
  const sent: SendMailOptions[] = [];
  Object.assign(transport, {
    transporter: {
      sendMail: async (options: SendMailOptions) => sent.push(options),
    },
  });

  await transport.sendMagicLink(
    "b@example.com",
    "http://localhost/l",
    emailConfig,
    {
      code: "123456",
    },
  );

  expect(sent[0]).toMatchObject({
    from: '"Four in a Row" <noreply@example.com>',
    subject: "Sign in to Four in a Row",
  });
});

// #43: the answer must not say whether an address has an account, so a
// capped address gets what any other gets, cookie and all.
const shape = (response: Response) => ({
  status: response.status,
  location: response.headers.get("location"),
  setCookie: response.headers
    .getSetCookie()
    .map((cookie) => cookie.replace(/=[^;]*/, "=<id>")),
});

test("a capped address gets the same answer as one that is sent mail, and no mail", async () => {
  const allowed = await requestEmail(
    new CookieJar(),
    await member("allowed-twin@example.com"),
    "/profile",
  );
  const capped = "capped-address@example.com";
  await db.emailSend.createMany({
    data: Array.from({ length: SEND_LIMITS.signInPerAddressPerHour }, () => ({
      address: capped,
      kind: "signin",
    })),
  });

  const refused = await requestEmail(new CookieJar(), capped, "/profile");

  expect(shape(refused)).toEqual(shape(allowed));
  expect(shape(refused).location).toMatch(/[?&]sent=1/);
  expect((await readCapturedEmail(capped)).status).toBe(404);
  expect(events("email.limit")).toContainEqual(
    expect.objectContaining({ reason: "address" }),
  );
});

test("an address over the IP cap gets the same answer, and no mail", async () => {
  const allowed = await requestEmail(
    new CookieJar(),
    await member("ip-twin@example.com"),
    "/profile",
  );
  await db.emailSend.createMany({
    data: Array.from({ length: 10 }, (_, n) => ({
      address: `ip-earlier-${n}@example.com`,
      kind: "signin",
      ip: "203.0.113.50",
    })),
  });
  const email = "ip-capped@example.com";
  const request = formPost(
    "/auth/email/initiate",
    { email, redirectTo: "/profile" },
    { referer: "/login?redirectTo=%2Fprofile" },
  );
  // Traefik appends the peer it saw; the caller's own claims come first.
  request.headers.set("x-forwarded-for", "10.9.9.9, 203.0.113.50");
  request.headers.set("cf-connecting-ip", "198.51.100.200");

  const refused = await auth(request);

  expect(shape(refused)).toEqual(shape(allowed));
  expect(shape(refused).location).toMatch(/[?&]sent=1/);
  expect((await readCapturedEmail(email)).status).toBe(404);
  expect(events("email.limit")).toContainEqual(
    expect.objectContaining({ reason: "ip" }),
  );
});

test("the site-wide cap stops mail to a never-seen address and logs at error level", async () => {
  await db.emailSend.createMany({
    data: Array.from({ length: 100 }, (_, n) => ({
      address: `site-earlier-${n}@example.com`,
      kind: "signin",
      ip: `192.0.2.${n}`,
    })),
  });
  const email = "site-capped@example.com";

  const refused = await requestEmail(new CookieJar(), email, "/profile");

  expect(refused.headers.get("location")).toMatch(/[?&]sent=1/);
  expect((await readCapturedEmail(email)).status).toBe(404);
  expect(
    capture.lines.filter(
      (l) => l.event === "email.limit" && l.reason === "global",
    ),
  ).toEqual([expect.objectContaining({ level: 50 })]);
  // An existing account is still sent mail.
  const { jar, response } = await signIn(
    await member("global-member@example.com"),
  );
  expect(response.status).toBe(302);
  expect(jar.header()).toContain("session=");
  await db.emailSend.deleteMany({
    where: { address: { startsWith: "site-earlier-" } },
  });
});

test("a request for a host other than APP_URL's is refused and no mail is sent", async () => {
  vi.stubEnv("APP_URL", "http://localhost");
  const email = await member("foreign-host@example.com");
  // The origin gate alone would pass this: Referer matches the request URL.
  const foreign = "http://evil.example";
  const response = await auth(
    new Request(`${foreign}/auth/email/initiate`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
        referer: `${foreign}/login`,
      },
      body: new URLSearchParams({ email }),
    }),
  ).finally(() => vi.unstubAllEnvs());

  expect(response.status).toBe(421);
  expect((await readCapturedEmail(email)).status).toBe(404);
});

test("a fresh cf-connecting-ip on each request does not escape the per-IP limit", async () => {
  // The library allows 3 initiates per IP per minute, so the 4th from the
  // address Traefik saw must be limited whatever the caller claims.
  const before = events("auth.initiate.blocked").length;
  for (const n of [1, 2, 3, 4]) {
    const request = formPost("/auth/email/initiate", {
      email: `spoof-${n}@example.com`,
    });
    request.headers.set("cf-connecting-ip", `198.51.100.${n}`);
    request.headers.set("x-forwarded-for", `203.0.113.${n}, 192.0.2.7`);
    await auth(request);
  }

  expect(events("auth.initiate.blocked").slice(before)).toEqual([
    expect.objectContaining({ reason: "ip_rate_limited" }),
  ]);
});

test("an existing account can sign in again", async () => {
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

// #58: no invite, account or SIGNUP_EMAILS place is needed.
test("a never-seen address gets a sign-in email, signs in with the code and reaches /games as a new account", async () => {
  const email = "newcomer@example.com";
  expect(await db.user.count({ where: { email } })).toBe(0);
  const jar = new CookieJar();

  await requestEmail(jar, email, "/games");
  const { code } = await (await readCapturedEmail(email)).json();
  const response = await auth(
    formPost(
      "/auth/email/verify?redirectTo=%2Fgames",
      { code },
      { cookie: jar.header(), referer: "/login" },
    ),
  );
  jar.store(response);

  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/games");
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  expect(user.approvedAt).toBeInstanceOf(Date);
  const page = await run(games.loader, get("/games", { cookie: jar.header() }));
  expect(page).not.toBeInstanceOf(Response);
  expect(events("auth.signin.succeeded")).toContainEqual(
    expect.objectContaining({ userId: user.id, isNewUser: true }),
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
  expect(response.headers.get("location")).toBe("/");
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
    get(`/login?redirectTo=${encodeURIComponent(TARGET)}`, {
      cookie: jar.header(),
    }),
  )) as Response;

  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(TARGET);
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
