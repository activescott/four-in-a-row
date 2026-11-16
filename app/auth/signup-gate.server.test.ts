import type {
  EmailProviderConfig,
  EmailTransport,
} from "@activescott/auth-provider-email";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { createLogger } from "../logger.server";
import { SEND_LIMITS } from "../mail/send-limits.server";
import { createPgliteDb } from "../pglite.server";
import { failingDb, recordDbCalls } from "../test/db-calls";
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

afterEach(async () => {
  vi.restoreAllMocks();
  // A failed test must not leave sends behind for the next one to count.
  await db.emailSend.deleteMany();
});

// Pruning runs on about 1 in 20 sends. Tests that compare the work two sends
// did pin the draw, so both prune or neither does.
const draw = (value: number) => vi.spyOn(Math, "random").mockReturnValue(value);

function gate(via: PrismaClient = db) {
  const capture = logCapture();
  const logger = createLogger(capture.destination);
  const signup = createSignupGate({ db: via, logger });
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

// A client of its own per call, unless a test says which, so the per-IP limit
// doesn't tie the tests together.
let ipSeq = 0;
const nextIp = () => `192.0.2.${++ipSeq % 250}`;

// The sign-in email for this address from this client: true for every
// address, and whether the inner transport was asked to send it.
async function signInMail(
  signup: ReturnType<typeof gate>,
  email: string,
  ip: string | null = nextIp(),
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

// Rows as if `count` mails had gone to as many different addresses from one
// client, so only that client's caps are in play.
async function sentFromClient(
  count: number,
  ip: string,
  { kind = "signin", ageMs = 60_000 }: { kind?: string; ageMs?: number } = {},
) {
  await db.emailSend.createMany({
    data: Array.from({ length: count }, (_, n) => ({
      address: `from-${ip}-${kind}-${n}@example.com`,
      kind,
      ip,
      createdAt: new Date(Date.now() - ageMs),
    })),
  });
}

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

test("the 6th sign-in request for one address within an hour sends nothing, answers the same and logs email.limit address", async () => {
  const signup = gate();
  const answers = [];
  for (let n = 0; n < SEND_LIMITS.signInPerAddressPerHour + 1; n++) {
    answers.push(await signInMail(signup, "hourly@example.com"));
  }

  expect(answers.map((a) => a.answer)).toEqual([
    true,
    true,
    true,
    true,
    true,
    true,
  ]);
  expect(mailsTo(signup, "hourly@example.com")).toBe(5);
  expect(signup.capture.events("email.limit")).toMatchObject([
    { reason: "address", kind: "signin" },
  ]);
  expect(JSON.stringify(signup.capture.lines)).not.toContain(
    "hourly@example.com",
  );
});

test("an address is also held to 10 sign-in mails a day, whatever the hour", async () => {
  const signup = gate();
  await sentBefore(SEND_LIMITS.signInPerAddressPerDay, {
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

test("the sign-in limit ignores case", async () => {
  const signup = gate();
  await sentBefore(SEND_LIMITS.signInPerAddressPerHour, {
    address: "mixed@example.com",
  });

  expect(await signInMail(signup, "Mixed@Example.com")).toMatchObject({
    sent: false,
  });
});

test("invite and turn mail don't use up an address's sign-in quota", async () => {
  const signup = gate();
  await sentBefore(SEND_LIMITS.invitePerAddressPerDay + 3, {
    address: "bystander@example.com",
    kind: "invite",
  });
  await sentBefore(SEND_LIMITS.turnPerAddressPerHour + 3, {
    address: "bystander@example.com",
    kind: "turn",
    ip: null,
  });

  for (let n = 0; n < SEND_LIMITS.signInPerAddressPerHour + 1; n++) {
    await signInMail(signup, "bystander@example.com");
  }

  expect(mailsTo(signup, "bystander@example.com")).toBe(
    SEND_LIMITS.signInPerAddressPerHour,
  );
});

test("a link-your-address email counts in the sign-in quota", async () => {
  const signup = gate();
  await sentBefore(SEND_LIMITS.signInPerAddressPerHour - 1, {
    address: "linker@example.com",
  });

  await signup.transport.sendMagicLink("linker@example.com", LINK, CONFIG, {
    purpose: "link",
  });
  await signup.transport.sendMagicLink("linker@example.com", LINK, CONFIG, {
    purpose: "sign-in",
  });

  expect(mailsTo(signup, "linker@example.com")).toBe(1);
});

test("an address whose sign-in mail is all older than an hour is sent to again", async () => {
  await sentBefore(SEND_LIMITS.signInPerAddressPerHour, {
    address: "rested@example.com",
    ageMs: 61 * 60 * 1000,
  });

  expect(await signInMail(gate(), "rested@example.com")).toMatchObject({
    sent: true,
  });
});

test("one client is held to 30 sign-in requests an hour, whoever they are for, and an account holder is refused too", async () => {
  const signup = gate();
  const ip = "203.0.113.200";
  await db.user.createMany({
    data: Array.from({ length: SEND_LIMITS.signInPerIpPerHour }, (_, n) => ({
      email: `hourly-ip-${n}@example.com`,
      approvedAt: new Date(),
    })),
  });
  await db.emailSend.createMany({
    data: Array.from(
      { length: SEND_LIMITS.signInPerIpPerHour - 1 },
      (_, n) => ({
        address: `hourly-ip-${n}@example.com`,
        kind: "signin",
        ip,
        createdAt: new Date(Date.now() - 60_000),
      }),
    ),
  });

  expect(
    await signInMail(signup, `hourly-ip-${29}@example.com`, ip),
  ).toMatchObject({ sent: true });
  for (const target of ["hourly-ip-0@example.com", "stranger-ip@example.com"]) {
    expect(await signInMail(signup, target, ip)).toEqual({
      answer: true,
      sent: false,
    });
  }
  expect(signup.capture.events("email.limit")).toMatchObject([
    { reason: "ip", kind: "signin" },
    { reason: "ip", kind: "signin" },
  ]);
  // Another client is unaffected.
  expect(
    await signInMail(signup, "hourly-ip-0@example.com", "203.0.113.201"),
  ).toMatchObject({ sent: true });
});

test("the per-client hourly cap forgets sign-ins older than an hour, and doesn't count invite mail", async () => {
  const ip = "203.0.113.202";
  await db.user.create({
    data: { email: "hourly-old@example.com", approvedAt: new Date() },
  });
  await sentFromClient(SEND_LIMITS.signInPerIpPerHour, ip, {
    ageMs: 61 * 60 * 1000,
  });
  await sentFromClient(SEND_LIMITS.signInPerIpPerHour, ip, { kind: "invite" });

  expect(await signInMail(gate(), "hourly-old@example.com", ip)).toMatchObject({
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

test("the IP cap doesn't count mail to addresses that have an account, and doesn't hold one back", async () => {
  const signup = gate();
  for (let n = 0; n < SEND_LIMITS.ipPerDay; n++) {
    const address = `ip-account-${n}@example.com`;
    await db.user.create({ data: { email: address, approvedAt: new Date() } });
    await sentBefore(1, { address, ip: "203.0.113.20" });
  }

  expect(
    await signInMail(signup, "ip-other@example.com", "203.0.113.20"),
  ).toMatchObject({ sent: true });

  // Now the IP is over its cap, but an account holder is still sent mail.
  await db.user.create({
    data: { email: "ip-member@example.com", approvedAt: new Date() },
  });
  for (let n = 0; n < SEND_LIMITS.ipPerDay; n++) {
    await sentBefore(1, {
      address: `ip-stranger-${n}@example.com`,
      ip: "203.0.113.21",
    });
  }
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

test("a refused send is answered like a sent one", async () => {
  const signup = gate();
  await sentBefore(SEND_LIMITS.signInPerAddressPerHour, {
    address: "capped@example.com",
  });

  const refused = await signInMail(signup, "capped@example.com");
  const allowed = await signInMail(signup, "uncapped@example.com");

  expect(refused.answer).toBe(allowed.answer);
});

// The account lookup and the IP and site-wide caps would otherwise show up
// as a difference in how long a request takes (#43).
test.each([0, 0.99])(
  "sent, refused and capped sign-ins make the same DB calls (prune draw %s)",
  async (value) => {
    draw(value);
    await db.emailSend.deleteMany();
    await db.user.createMany({
      skipDuplicates: true,
      data: ["calls-member", "calls-member-capped", "calls-member-ip"].map(
        (name) => ({ email: `${name}@example.com`, approvedAt: new Date() }),
      ),
    });
    await sentBefore(SEND_LIMITS.signInPerAddressPerHour, {
      address: "calls-member-capped@example.com",
    });
    await sentBefore(SEND_LIMITS.signInPerAddressPerHour, {
      address: "calls-address-capped@example.com",
    });
    await sentFromClient(SEND_LIMITS.signInPerIpPerHour, "203.0.113.31");
    await sentBefore(SEND_LIMITS.ipPerDay, {
      address: "calls-someone-else@example.com",
      ip: "203.0.113.32",
    });
    const cases = {
      "sent to a stranger": ["calls-stranger@example.com", "203.0.113.30"],
      "sent to a player": ["calls-member@example.com", "203.0.113.30"],
      "refused by address": [
        "calls-address-capped@example.com",
        "203.0.113.30",
      ],
      "player refused by address": [
        "calls-member-capped@example.com",
        "203.0.113.30",
      ],
      "refused by sign-in IP cap": [
        "calls-member-ip@example.com",
        "203.0.113.31",
      ],
      "refused by IP cap": ["calls-stranger-2@example.com", "203.0.113.32"],
    } as const;

    const perCase: Record<string, string[]> = {};
    for (const [name, [email, ip]] of Object.entries(cases)) {
      const recorded = recordDbCalls(db);
      await signInMail(gate(recorded.db), email, ip);
      perCase[name] = recorded.calls;
    }
    // Fill the site-wide cap, then one more stranger.
    await sentBefore(SEND_LIMITS.globalPerDay, {
      address: "calls-earlier@example.com",
      ip: "192.0.2.1",
    });
    const recorded = recordDbCalls(db);
    await signInMail(
      gate(recorded.db),
      "calls-stranger-3@example.com",
      "203.0.113.33",
    );
    perCase["refused by site cap"] = recorded.calls;

    // Whatever the verdict, the send is looked up, counted and written. A
    // refused one is then rolled back, so it isn't counted.
    expect(perCase["sent to a stranger"]).toEqual(
      expect.arrayContaining(["User.findUnique", "EmailSend.create"]),
    );
    for (const [name, calls] of Object.entries(perCase)) {
      expect({ name, calls }).toEqual({
        name,
        calls: perCase["sent to a stranger"],
      });
    }
    await db.emailSend.deleteMany();
  },
);

test("each send is recorded with its address, kind and client", async () => {
  await signInMail(gate(), "Recorded@Example.com", "198.51.100.5");

  expect(
    await db.emailSend.findMany({ where: { address: "recorded@example.com" } }),
  ).toMatchObject([{ kind: "signin", ip: "198.51.100.5" }]);
});

test("a refused send is not recorded, so it doesn't extend its own block", async () => {
  await sentBefore(SEND_LIMITS.signInPerAddressPerHour, {
    address: "not-recorded@example.com",
  });

  await signInMail(gate(), "not-recorded@example.com");

  expect(
    await db.emailSend.count({
      where: { address: "not-recorded@example.com" },
    }),
  ).toBe(SEND_LIMITS.signInPerAddressPerHour);
});

const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;

test("rows older than 2 days are deleted when the draw says to prune", async () => {
  draw(0);
  await sentBefore(1, { address: "ancient@example.com", ageMs: THREE_DAYS });

  await signInMail(gate(), "prune-me@example.com");

  expect(
    await db.emailSend.count({ where: { address: "ancient@example.com" } }),
  ).toBe(0);
});

test("most sends don't prune: about 1 in 20 do", async () => {
  draw(0.99);
  await sentBefore(1, { address: "ancient-2@example.com", ageMs: THREE_DAYS });

  await signInMail(gate(), "no-prune@example.com");

  expect(
    await db.emailSend.count({ where: { address: "ancient-2@example.com" } }),
  ).toBe(1);
  draw(0.049);
  await signInMail(gate(), "prune-now@example.com");
  expect(
    await db.emailSend.count({ where: { address: "ancient-2@example.com" } }),
  ).toBe(0);
});

test("prune is its own statement and skips rows another transaction holds", async () => {
  draw(0);
  const recorded = recordDbCalls(db);

  await signInMail(gate(recorded.db), "prune-sql@example.com");

  const prune = recorded.calls.filter((call) => /DELETE/i.test(call));
  expect(prune).toHaveLength(1);
  expect(prune[0]).toMatch(/SKIP LOCKED/i);
  expect(recorded.calls.indexOf(prune[0]!)).toBeGreaterThan(
    recorded.calls.findLastIndex((call) => /advisory_xact_lock/.test(call)),
  );
});

test("the client IP key goes in the email.limit log line, the address never does", async () => {
  const signup = gate();
  await sentBefore(SEND_LIMITS.signInPerAddressPerHour, {
    address: "logged@example.com",
  });

  await signInMail(signup, "logged@example.com", "2001:db8:1:2::9");

  expect(signup.capture.events("email.limit")).toEqual([
    expect.objectContaining({
      reason: "address",
      kind: "signin",
      ipKey: "2001:db8:1:2::/64",
    }),
  ]);
  expect(JSON.stringify(signup.capture.lines)).not.toContain("logged@");
});

test("a request with no client IP logs email.limit.no_ip at warn level", async () => {
  const signup = gate();

  await signInMail(signup, "no-ip@example.com", null);
  await signInMail(signup, "with-ip@example.com", "198.51.100.44");

  expect(
    signup.capture.lines.filter((l) => l.event === "email.limit.no_ip"),
  ).toEqual([expect.objectContaining({ level: 40, kind: "signin" })]);
  expect(JSON.stringify(signup.capture.lines)).not.toContain("no-ip@");
});

test("an IPv4-mapped IPv6 address in hex form counts as its IPv4 address", async () => {
  const signup = gate();
  const hex = ["::ffff:102:304", "::ffff:0102:0304", "0:0:0:0:0:ffff:102:304"];
  for (let n = 0; n < SEND_LIMITS.ipPerDay; n++) {
    await signInMail(signup, `mapped-${n}@example.com`, hex[n % hex.length]);
  }

  expect(
    await signInMail(signup, "mapped-next@example.com", "1.2.3.4"),
  ).toMatchObject({ sent: false });
  expect(await db.emailSend.count({ where: { ip: "1.2.3.4" } })).toBe(
    SEND_LIMITS.ipPerDay,
  );
});

// A broken database is a refusal, answered like any other: never a 500 and
// never a different answer.
test("a database error while reserving refuses the send, answers the same and logs at error level", async () => {
  const signup = gate(
    failingDb(
      db,
      ({ model, operation }) => model === "EmailSend" && operation === "create",
    ),
  );
  const normal = await signInMail(gate(), "db-ok@example.com");

  const broken = await signInMail(signup, "db-error@example.com");

  expect(broken).toEqual({ answer: normal.answer, sent: false });
  expect(signup.capture.lines.filter((l) => l.event === "email.limit")).toEqual(
    [expect.objectContaining({ reason: "error", level: 50, kind: "signin" })],
  );
  expect(JSON.stringify(signup.capture.lines)).not.toContain("db-error@");
  expect(
    await db.emailSend.count({ where: { address: "db-error@example.com" } }),
  ).toBe(0);
});

test("a database error while pruning refuses the send too", async () => {
  draw(0);
  const signup = gate(failingDb(db, ({ sql }) => /DELETE/i.test(sql ?? "")));

  expect(await signInMail(signup, "prune-error@example.com")).toEqual({
    answer: true,
    sent: false,
  });
  expect(signup.capture.events("email.limit")).toEqual([
    expect.objectContaining({ reason: "error", level: 50 }),
  ]);
});

test("two requests at once for one address can't both pass the last slot", async () => {
  const signup = gate();
  await sentBefore(SEND_LIMITS.signInPerAddressPerHour - 1, {
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
