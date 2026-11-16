import type {
  EmailProviderConfig,
  EmailTransport,
} from "@activescott/auth-provider-email";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { createLogger } from "../logger.server";
import { SEND_LIMITS } from "../mail/send-limits.server";
import { createPgliteDb } from "../pglite.server";
import { logCapture } from "../test/routes";
import { withClientIp } from "./client-ip.server";
import { createSignupGate } from "./signup-gate.server";

let db: PrismaClient;

beforeAll(async () => {
  db = await createPgliteDb();
});

afterAll(async () => {
  await db.$disconnect();
});

function gate() {
  const capture = logCapture();
  const logger = createLogger(capture.destination);
  const signup = createSignupGate({ db, logger });
  const inner = {
    sendMagicLink: vi.fn<EmailTransport["sendMagicLink"]>(async () => true),
  };
  return {
    gate: signup.gate,
    transport: signup.transport(inner),
    inner,
    capture,
  };
}

const request = new Request("http://localhost/auth/email/initiate", {
  method: "POST",
});
const attempt = (identifier: string) => ({
  provider: "email",
  identifier,
  mode: "signin" as const,
  request,
});

const CONFIG = {} as EmailProviderConfig;
const LINK = "http://localhost/auth/email/verify?challenge=c&key=k";

// The sign-in email for this address from this client: true for every
// address, and whether the inner transport was asked to send it.
async function signInMail(
  signup: ReturnType<typeof gate>,
  email: string,
  ip: string | null = "198.51.100.1",
) {
  const ask = () =>
    signup.transport.sendMagicLink(email, LINK, CONFIG, { code: "123456" });
  const answer = await (ip === null ? ask() : withClientIp(ip, ask));
  return {
    answer,
    sent:
      signup.inner.sendMagicLink.mock.calls.filter(([to]) => to === email)
        .length > 0,
  };
}

const mailsTo = (signup: ReturnType<typeof gate>, email: string) =>
  signup.inner.sendMagicLink.mock.calls.filter(([to]) => to === email).length;

// Rows as if `count` mails had gone out, `ageMs` ago.
async function sentBefore(
  count: number,
  {
    address,
    kind = "signin",
    ip = "198.51.100.1",
    ageMs = 60_000,
  }: { address: string; kind?: string; ip?: string | null; ageMs?: number },
) {
  await db.emailSend.createMany({
    data: Array.from({ length: count }, () => ({
      address,
      kind,
      ip,
      createdAt: new Date(Date.now() - ageMs),
    })),
  });
}

// #58: anyone may sign up, so a never-seen address is sent a sign-in email.
test("sends to an address that has no account, no invite and no SIGNUP_EMAILS place", async () => {
  expect(await signInMail(gate(), "brand-new@example.com")).toEqual({
    answer: true,
    sent: true,
  });
});

// #43: a refused address must not get a different answer, or a stranger
// could learn which addresses have an account.
test("the gate lets every initiate through, a stranger's too", async () => {
  expect(await gate().gate.onInitiate(attempt("stranger@example.com"))).toBe(
    "allow",
  );
});

test("sends to an address that already has an account", async () => {
  await db.user.create({
    data: { email: "member@example.com", approvedAt: new Date() },
  });

  expect(await signInMail(gate(), "member@example.com")).toEqual({
    answer: true,
    sent: true,
  });
});

test("an address with an expired invite is sent a sign-in email too", async () => {
  const inviter = await db.user.create({
    data: { email: "inviter3@example.com" },
  });
  const game = await db.game.create({
    data: { playerOneId: inviter.id, status: "INVITED" },
  });
  await db.invite.create({
    data: {
      gameId: game.id,
      inviterId: inviter.id,
      email: "expired@example.com",
      tokenHash: "hash-expired",
      expiresAt: new Date(Date.now() - 1),
    },
  });

  expect(await signInMail(gate(), "expired@example.com")).toEqual({
    answer: true,
    sent: true,
  });
});

test("the 4th request for one address within an hour sends nothing, answers the same and logs email.limit address", async () => {
  const signup = gate();
  const answers = [];
  for (let n = 0; n < SEND_LIMITS.addressPerHour + 1; n++) {
    answers.push(await signInMail(signup, "hourly@example.com"));
  }

  expect(answers.map((a) => a.answer)).toEqual([true, true, true, true]);
  expect(mailsTo(signup, "hourly@example.com")).toBe(3);
  expect(signup.capture.events("email.limit")).toMatchObject([
    { reason: "address", kind: "signin" },
  ]);
  expect(JSON.stringify(signup.capture.lines)).not.toContain(
    "hourly@example.com",
  );
});

test("an address is also held to 6 mails a day, whatever the hour", async () => {
  const signup = gate();
  await sentBefore(SEND_LIMITS.addressPerDay, {
    address: "daily@example.com",
    ageMs: 3 * 60 * 60 * 1000,
  });

  expect(await signInMail(signup, "daily@example.com")).toEqual({
    answer: true,
    sent: false,
  });
  expect(signup.capture.events("email.limit")).toMatchObject([
    { reason: "address" },
  ]);
});

test("the address limit ignores case and counts invite and turn mail", async () => {
  const signup = gate();
  await sentBefore(1, { address: "mixed@example.com", kind: "invite" });
  await sentBefore(2, { address: "mixed@example.com", kind: "turn", ip: null });

  expect(await signInMail(signup, "Mixed@Example.com")).toMatchObject({
    sent: false,
  });
});

test("an address whose mail is all older than an hour is sent to again", async () => {
  await sentBefore(SEND_LIMITS.addressPerHour, {
    address: "rested@example.com",
    ageMs: 61 * 60 * 1000,
  });

  expect(await signInMail(gate(), "rested@example.com")).toMatchObject({
    sent: true,
  });
});

test("the 11th mail from one IP to addresses without an account sends nothing and logs email.limit ip", async () => {
  const signup = gate();
  for (let n = 0; n < SEND_LIMITS.ipPerDay; n++) {
    expect(
      await signInMail(signup, `ip-cap-${n}@example.com`, "203.0.113.9"),
    ).toEqual({ answer: true, sent: true });
  }

  expect(
    await signInMail(signup, "ip-cap-x@example.com", "203.0.113.9"),
  ).toEqual({ answer: true, sent: false });
  expect(signup.capture.events("email.limit")).toMatchObject([
    { reason: "ip", kind: "signin" },
  ]);
  // Another client is unaffected.
  expect(
    await signInMail(signup, "ip-cap-y@example.com", "203.0.113.10"),
  ).toMatchObject({ sent: true });
});

test("the IP cap treats an IPv6 /64 as one client", async () => {
  const signup = gate();
  for (let n = 0; n < SEND_LIMITS.ipPerDay; n++) {
    await signInMail(signup, `v6-${n}@example.com`, `2001:db8:1:2::${n + 1}`);
  }

  expect(
    await signInMail(signup, "v6-next@example.com", "2001:db8:1:2:ffff::9"),
  ).toMatchObject({ sent: false });
});

test("the IP cap doesn't count mail to addresses that have an account", async () => {
  const signup = gate();
  await db.user.create({
    data: { email: "ip-member@example.com", approvedAt: new Date() },
  });
  await sentBefore(SEND_LIMITS.ipPerDay, {
    address: "ip-member@example.com",
    ip: "203.0.113.20",
    ageMs: 3 * 60 * 60 * 1000,
  });

  expect(
    await signInMail(signup, "ip-other@example.com", "203.0.113.20"),
  ).toMatchObject({ sent: true });
  // And an account holder is not held to the IP cap either.
  await sentBefore(SEND_LIMITS.ipPerDay, {
    address: "someone@example.com",
    ip: "203.0.113.21",
  });
  expect(
    await signInMail(signup, "ip-member@example.com", "203.0.113.21"),
  ).toMatchObject({ sent: true });
});

test("a request with no client IP counts under one shared bucket", async () => {
  const signup = gate();
  await sentBefore(SEND_LIMITS.ipPerDay, {
    address: "unknown-earlier@example.com",
    ip: "unknown",
  });

  expect(await signInMail(signup, "unknown-next@example.com", null)).toEqual({
    answer: true,
    sent: false,
  });
});

test("the 101st mail a day to addresses without an account sends nothing and logs email.limit global at error level", async () => {
  const signup = gate();
  // 100 mails from 100 different clients, so no IP cap is hit.
  await db.emailSend.createMany({
    data: Array.from({ length: SEND_LIMITS.globalPerDay }, (_, n) => ({
      address: `global-earlier-${n}@example.com`,
      kind: "signin",
      ip: `192.0.2.${n}`,
      createdAt: new Date(Date.now() - 60_000),
    })),
  });

  expect(
    await signInMail(signup, "global-next@example.com", "198.51.100.77"),
  ).toEqual({ answer: true, sent: false });
  expect(signup.capture.lines.filter((l) => l.event === "email.limit")).toEqual(
    [expect.objectContaining({ reason: "global", level: 50 })],
  );
  // A player with an account is still sent mail.
  await db.user.create({
    data: { email: "global-member@example.com", approvedAt: new Date() },
  });
  expect(await signInMail(signup, "global-member@example.com")).toMatchObject({
    sent: true,
  });
});

test("the global cap forgets mail older than a day", async () => {
  await db.emailSend.deleteMany();
  await db.emailSend.createMany({
    data: Array.from({ length: SEND_LIMITS.globalPerDay }, (_, n) => ({
      address: `old-${n}@example.com`,
      kind: "signin",
      ip: `192.0.2.${n}`,
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    })),
  });

  expect(await signInMail(gate(), "after-a-day@example.com")).toMatchObject({
    sent: true,
  });
});

test("a refused send is answered like a sent one, with the same work done", async () => {
  const signup = gate();
  await sentBefore(SEND_LIMITS.addressPerHour, {
    address: "capped@example.com",
  });

  const refused = await signInMail(signup, "capped@example.com");
  const allowed = await signInMail(signup, "uncapped@example.com");

  expect(refused.answer).toBe(allowed.answer);
});

test("each send is recorded with its address, kind and client, and rows older than 2 days are deleted on write", async () => {
  await sentBefore(1, {
    address: "ancient@example.com",
    ageMs: 3 * 24 * 60 * 60 * 1000,
  });

  await signInMail(gate(), "Recorded@Example.com", "198.51.100.5");

  expect(
    await db.emailSend.count({ where: { address: "ancient@example.com" } }),
  ).toBe(0);
  expect(
    await db.emailSend.findMany({ where: { address: "recorded@example.com" } }),
  ).toMatchObject([{ kind: "signin", ip: "198.51.100.5" }]);
});

test("two requests at once for one address can't both pass the last slot", async () => {
  const signup = gate();
  await sentBefore(SEND_LIMITS.addressPerHour - 1, {
    address: "racing@example.com",
  });

  await Promise.all(
    Array.from({ length: 5 }, () => signInMail(signup, "racing@example.com")),
  );

  expect(mailsTo(signup, "racing@example.com")).toBe(1);
});

test("never waits for the relay, so a send takes no longer than a refusal", async () => {
  await db.user.create({
    data: { email: "slow-relay@example.com", approvedAt: new Date() },
  });
  const signup = gate();
  signup.inner.sendMagicLink.mockReturnValue(new Promise(() => {}));
  const timeout = new Promise((resolve) =>
    setTimeout(resolve, 1_000, "waited"),
  );

  const answer = await Promise.race([
    signup.transport.sendMagicLink("slow-relay@example.com", LINK, CONFIG),
    timeout,
  ]);

  expect(answer).toBe(true);
  expect(signup.inner.sendMagicLink).toHaveBeenCalledOnce();
});

test("a send that fails in the background is logged as email.signin.failed", async () => {
  await db.user.create({
    data: { email: "relay-down@example.com", approvedAt: new Date() },
  });
  const signup = gate();
  signup.inner.sendMagicLink.mockResolvedValue(false);

  await signup.transport.sendMagicLink("relay-down@example.com", LINK, CONFIG);
  await vi.waitFor(() =>
    expect(signup.capture.events("email.signin.failed")).toHaveLength(1),
  );
  expect(JSON.stringify(signup.capture.lines)).not.toContain(
    "relay-down@example.com",
  );
});

test("onVerified logs auth.signin.succeeded with the user id and allows the session", async () => {
  const { gate: open, capture } = gate();
  const { id } = await db.user.create({
    data: { email: "returning-member@example.com", approvedAt: new Date() },
  });
  const identity = {
    id: "identity-1",
    userId: id,
    provider: "email",
    identifier: "returning-member@example.com",
    providerState: {},
    createdAt: new Date(),
  };

  const decision = await open.onVerified!({
    ...attempt("returning-member@example.com"),
    user: { id },
    identity,
    isNewUser: false,
  });

  expect(decision).toBe("allow");
  expect(capture.events("auth.signin.succeeded")).toMatchObject([
    { userId: id, provider: "email", isNewUser: false },
  ]);
  expect(JSON.stringify(capture.lines)).not.toContain(
    "returning-member@example.com",
  );
});

test("onVerified does not log a sign-in for a link to the signed-in account", async () => {
  const { gate: open, capture } = gate();

  await open.onVerified!({
    ...attempt("member@example.com"),
    mode: "link",
    user: { id: "user-1" },
    identity: {
      id: "identity-2",
      userId: "user-1",
      provider: "email",
      identifier: "member@example.com",
      providerState: {},
      createdAt: new Date(),
    },
    isNewUser: false,
  });

  expect(capture.events("auth.signin.succeeded")).toEqual([]);
});

// What the verify hands onVerified for an address with no identity yet: the
// user store's row (not yet approved) and the identity the library created.
async function verifiedNewUser(email: string) {
  const row = await db.user.upsert({
    where: { email },
    create: { email },
    update: {},
  });
  const identity = await db.identity.create({
    data: { userId: row.id, provider: "email", identifier: email },
  });
  return {
    ...attempt(email),
    user: { id: row.id, metadata: { email } },
    identity: {
      id: identity.id,
      userId: row.id,
      provider: "email",
      identifier: email,
      providerState: {},
      createdAt: identity.createdAt,
    },
    isNewUser: true,
  };
}

test("onVerified approves a new account with no invite and no SIGNUP_EMAILS place, and keeps it", async () => {
  const { gate: open, capture } = gate();
  const input = await verifiedNewUser("fresh-face@example.com");

  expect(await open.onVerified!(input)).toBe("allow");

  const row = await db.user.findUniqueOrThrow({ where: { id: input.user.id } });
  expect(row.approvedAt).toBeInstanceOf(Date);
  expect(capture.events("auth.signin.succeeded")).toMatchObject([
    { userId: input.user.id, isNewUser: true },
  ]);
});

test("onVerified leaves the first-verified time of an approved account alone", async () => {
  const approvedAt = new Date("2026-01-01T00:00:00Z");
  const { id } = await db.user.create({
    data: { email: "old-hand@example.com", approvedAt },
  });
  const input = await verifiedNewUser("old-hand@example.com");

  await gate().gate.onVerified!({ ...input, user: { id }, isNewUser: false });

  expect(
    (await db.user.findUniqueOrThrow({ where: { id } })).approvedAt,
  ).toEqual(approvedAt);
});
