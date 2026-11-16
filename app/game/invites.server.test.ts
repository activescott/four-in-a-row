import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { CaptureMailer } from "../mail/mailer.server";
import { SEND_LIMITS } from "../mail/send-limits.server";
import { createPgliteDb } from "../pglite.server";
import { failingDb, recordDbCalls } from "../test/db-calls";
import { logCapture } from "../test/routes";

const log = vi.hoisted(() => ({
  capture: undefined as unknown as ReturnType<typeof logCapture>,
}));
vi.mock("../logger.server", async (importOriginal) => {
  const original = await importOriginal<typeof import("../logger.server")>();
  const { logCapture } = await import("../test/routes");
  log.capture = logCapture();
  return {
    ...original,
    logger: original.createLogger(log.capture.destination),
  };
});

const {
  acceptInvite,
  createInvite,
  hashToken,
  inviteByToken,
  INVITE_TTL_MS,
  MAX_PENDING_INVITES,
} = await import("./invites.server");

const db: PrismaClient = await createPgliteDb();
const mailer = new CaptureMailer();
const APP_URL = "https://four-in-a-row.example";

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(() => {
  mailer.clear();
  log.capture.lines.length = 0;
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // A failed test must not leave sends behind for the next one to count.
  await db.emailSend.deleteMany();
});

let seq = 0;
async function user(name: string) {
  return db.user.create({ data: { email: `${name}-${++seq}@example.com` } });
}
const address = (name: string) => `${name}-${++seq}@example.com`;

function invite(
  inviter: { id: string; email: string },
  email: string,
  via: PrismaClient = db,
  ip: string | null = `198.51.100.${++seq % 250}`,
  shouldPrune?: () => boolean,
) {
  return createInvite(via, mailer, {
    inviterId: inviter.id,
    inviterEmail: inviter.email,
    email,
    appUrl: APP_URL,
    ip,
    shouldPrune,
  });
}

function tokenFrom(email: string) {
  const link = mailer.last(email, "invite")!.link;
  return link.slice(`${APP_URL}/invite/`.length);
}

test("an invite starts an INVITED game with the inviter to move, and emails a 7-day link", async () => {
  const alice = await user("alice");
  const bob = address("bob");
  const before = Date.now();

  const result = await invite(alice, bob.toUpperCase());

  expect(result).toEqual({ ok: true, gameId: expect.any(String) });
  if (!result.ok) return;
  const game = await db.game.findUniqueOrThrow({
    where: { id: result.gameId },
    include: { invite: true },
  });
  expect(game).toMatchObject({
    status: "INVITED",
    playerOneId: alice.id,
    playerTwoId: null,
    nextPlayerId: alice.id,
  });
  // The address is stored and emailed lower-cased.
  expect(game.invite).toMatchObject({
    inviterId: alice.id,
    email: bob,
    acceptedAt: null,
  });
  const expires = game.invite!.expiresAt.getTime();
  expect(expires).toBeGreaterThanOrEqual(before + INVITE_TTL_MS);
  expect(expires).toBeLessThanOrEqual(Date.now() + INVITE_TTL_MS);

  const mail = mailer.last(bob, "invite");
  expect(mail?.link).toMatch(
    new RegExp(`^${APP_URL}/invite/[A-Za-z0-9_-]{43}$`),
  );
  // Only a hash of the token is stored.
  const token = tokenFrom(bob);
  expect(game.invite!.tokenHash).toBe(hashToken(token));
  expect(game.invite!.tokenHash).not.toContain(token);

  expect(log.capture.events("email.invite.sent")).toEqual([
    expect.objectContaining({
      gameId: game.id,
      inviteId: game.invite!.id,
      inviterId: alice.id,
    }),
  ]);
  expect(JSON.stringify(log.capture.lines)).not.toContain(bob);
});

test("each invite gets its own random token", async () => {
  const alice = await user("alice");
  const [bob, carol] = [address("bob"), address("carol")];
  await invite(alice, bob);
  await invite(alice, carol);
  expect(tokenFrom(carol)).not.toBe(tokenFrom(bob));
});

test("an address that isn't an email, or the inviter's own, is refused and nothing is sent", async () => {
  const alice = await user("alice");
  const games = await db.game.count();

  for (const email of ["", "bob", "bob@", "@example.com", "a b@example.com"]) {
    expect(await invite(alice, email)).toEqual({
      ok: false,
      error: "invalid_email",
    });
  }
  expect(await invite(alice, alice.email.toUpperCase())).toEqual({
    ok: false,
    error: "self",
  });
  expect(await db.game.count()).toBe(games);
  expect(log.capture.events("email.invite.sent")).toEqual([]);
});

test(`a player can have at most ${5} pending invites; the next is refused and logged`, async () => {
  expect(MAX_PENDING_INVITES).toBe(5);
  const alice = await user("alice");
  for (let i = 0; i < MAX_PENDING_INVITES; i++) {
    expect((await invite(alice, address("friend"))).ok).toBe(true);
  }
  const over = address("one-too-many");

  expect(await invite(alice, over)).toEqual({ ok: false, error: "capped" });
  expect(mailer.last(over, "invite")).toBeNull();
  expect(await db.invite.count({ where: { inviterId: alice.id } })).toBe(5);
  expect(log.capture.events("invite.capped")).toEqual([
    expect.objectContaining({
      inviterId: alice.id,
      pending: MAX_PENDING_INVITES,
    }),
  ]);

  // Another player's cap is their own.
  expect((await invite(await user("carol"), address("dave"))).ok).toBe(true);
});

test("a second pending invite to the same address is refused and nothing is sent", async () => {
  const alice = await user("alice");
  const bob = address("Bob");
  const first = await invite(alice, bob);
  expect(first.ok).toBe(true);

  expect(await invite(alice, bob.toUpperCase())).toEqual({
    ok: false,
    error: "already_invited",
    gameId: first.ok && first.gameId,
  });
  expect(mailer.count(bob, "invite")).toBe(1);
  expect(await db.invite.count({ where: { inviterId: alice.id } })).toBe(1);

  // Someone else may still invite that address.
  expect((await invite(await user("carol"), bob)).ok).toBe(true);
});

test("accepted and expired invites don't count toward the cap", async () => {
  const alice = await user("alice");
  const accepted = await user("accepted");
  await invite(alice, accepted.email);
  const first = await db.invite.findFirstOrThrow({
    where: { email: accepted.email },
  });
  await acceptInvite(db, {
    gameId: first.gameId,
    userId: accepted.id,
    userEmail: accepted.email,
  });
  for (let i = 0; i < MAX_PENDING_INVITES - 1; i++) {
    await invite(alice, address("friend"));
  }
  expect((await invite(alice, address("fifth"))).ok).toBe(true);
  expect((await invite(alice, address("sixth"))).ok).toBe(false);

  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + INVITE_TTL_MS + 1);
  expect((await invite(alice, address("after-expiry"))).ok).toBe(true);
});

test("inviting an address with an account and one without looks the same, and does the same work", async () => {
  const alice = await user("alice");
  const member = await user("member");
  const stranger = address("stranger");

  // The prune is a random extra statement; leave it out of the comparison.
  const never = () => false;
  const recorded = recordDbCalls(db);
  const forMember = await invite(
    alice,
    member.email,
    recorded.db,
    undefined,
    never,
  );
  const memberCalls = recorded.calls.splice(0);
  const forStranger = await invite(
    alice,
    stranger,
    recorded.db,
    undefined,
    never,
  );

  // The send limits look the address up (an account is exempt from the IP
  // and site-wide caps), for every address alike.
  expect(memberCalls).toContain("Invite.create");
  expect(memberCalls).toContain("User.findUnique");
  // ...and run the same counts, the cross-IP daily one included.
  expect(memberCalls.join("\n")).toContain("bucket_day");
  expect(recorded.calls).toEqual(memberCalls);
  expect(forMember).toEqual({ ok: true, gameId: expect.any(String) });
  expect(forStranger).toEqual({ ok: true, gameId: expect.any(String) });
  const memberMail = mailer.last(member.email, "invite")!;
  const strangerMail = mailer.last(stranger, "invite")!;
  expect(memberMail.subject).toBe(strangerMail.subject);
  expect(memberMail.text.replace(memberMail.link, "")).toBe(
    strangerMail.text.replace(strangerMail.link, ""),
  );
  await vi.waitFor(() =>
    expect(log.capture.events("email.invite.sent")).toHaveLength(2),
  );
  expect(
    log.capture.events("email.invite.sent").map((line) => Object.keys(line)),
  ).toEqual([
    expect.arrayContaining(["gameId", "inviteId", "inviterId"]),
    expect.arrayContaining(["gameId", "inviteId", "inviterId"]),
  ]);
  expect(JSON.stringify(log.capture.lines)).not.toContain(member.id);
});

test("the invite is answered without waiting for the relay", async () => {
  const alice = await user("alice");
  const stuck = { send: () => new Promise<boolean>(() => {}) };

  const result = await Promise.race([
    createInvite(db, stuck, {
      inviterId: alice.id,
      inviterEmail: alice.email,
      email: address("bob"),
      appUrl: APP_URL,
      ip: "198.51.100.251",
    }),
    new Promise((resolve) => setTimeout(resolve, 1_000, "waited")),
  ]);

  expect(result).toEqual({ ok: true, gameId: expect.any(String) });
});

test.each([
  ["refuses", async () => false],
  ["throws", async () => Promise.reject(new Error("relay down"))],
])(
  "a send the relay %s is logged afterwards and undoes the game and invite, so the cap isn't used up",
  async (_, send) => {
    const alice = await user("alice");
    const bob = address("bob");
    const games = await db.game.count({ where: { playerOneId: alice.id } });

    const result = await createInvite(
      db,
      { send },
      {
        inviterId: alice.id,
        inviterEmail: alice.email,
        email: bob,
        appUrl: APP_URL,
        ip: "198.51.100.250",
      },
    );

    // Answered like a sent one, before the relay has said anything.
    expect(result).toEqual({ ok: true, gameId: expect.any(String) });
    await vi.waitFor(async () => {
      expect(await db.game.count({ where: { playerOneId: alice.id } })).toBe(
        games,
      );
    });
    expect(await db.invite.count({ where: { email: bob } })).toBe(0);
    expect(log.capture.events("email.invite.failed")).toHaveLength(1);
    expect(log.capture.events("email.invite.sent")).toHaveLength(0);
    expect(JSON.stringify(log.capture.lines)).not.toContain(bob);
  },
);

async function invited() {
  const alice = await user("alice");
  const bob = await user("bob");
  const result = await invite(alice, bob.email);
  if (!result.ok) throw new Error("invite failed");
  return { alice, bob, gameId: result.gameId, token: tokenFrom(bob.email) };
}

const accept = (gameId: string, as: { id: string; email: string }) =>
  acceptInvite(db, { gameId, userId: as.id, userEmail: as.email });

test("accepting seats the invitee, makes the game ACTIVE and logs invite.accepted", async () => {
  const { alice, bob, gameId } = await invited();

  expect(await accept(gameId, bob)).toEqual({ ok: true, gameId });

  expect(
    await db.game.findUniqueOrThrow({ where: { id: gameId } }),
  ).toMatchObject({
    status: "ACTIVE",
    playerOneId: alice.id,
    playerTwoId: bob.id,
    nextPlayerId: alice.id,
  });
  expect(
    (await db.invite.findUniqueOrThrow({ where: { gameId } })).acceptedAt,
  ).toBeInstanceOf(Date);
  expect(log.capture.events("invite.accepted")).toEqual([
    expect.objectContaining({ gameId, userId: bob.id, inviterId: alice.id }),
  ]);
});

test("if the inviter moved first, accepting hands the turn to the invitee, never to an empty seat", async () => {
  const { alice, bob, gameId } = await invited();
  const { makeMove } = await import("./games.server");
  expect(
    await makeMove(db, {
      gameId,
      userId: alice.id,
      column: 3,
      expectedMoveCount: 0,
    }),
  ).toMatchObject({ ok: true });

  await accept(gameId, bob);

  expect(
    await db.game.findUniqueOrThrow({ where: { id: gameId } }),
  ).toMatchObject({
    status: "ACTIVE",
    moveCount: 1,
    nextPlayerId: bob.id,
  });
});

test("an expired invite can't be accepted, and is logged as invite.expired", async () => {
  const { bob, gameId, token } = await invited();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + INVITE_TTL_MS + 1);

  expect(await accept(gameId, bob)).toEqual({
    ok: false,
    status: 410,
    reason: "expired",
  });
  expect(await inviteByToken(db, token)).toMatchObject({ state: "expired" });
  expect(
    await db.game.findUniqueOrThrow({ where: { id: gameId } }),
  ).toMatchObject({
    status: "INVITED",
    playerTwoId: null,
  });
  expect(log.capture.events("invite.expired")).toContainEqual(
    expect.objectContaining({ gameId }),
  );
});

test("a used invite is single-use: its token reads as used, and accepting again only reopens the game", async () => {
  const { bob, gameId, token } = await invited();
  expect(await inviteByToken(db, token)).toMatchObject({
    state: "pending",
    gameId,
  });

  await accept(gameId, bob);

  expect(await inviteByToken(db, token)).toMatchObject({ state: "used" });
  // The invitee again (a second click): back to the game, nothing changes.
  expect(await accept(gameId, bob)).toEqual({ ok: true, gameId });
  expect(log.capture.events("invite.accepted")).toHaveLength(1);
});

test("someone else can't accept an invite: not the inviter, not another account", async () => {
  const { alice, bob, gameId } = await invited();
  const mallory = await user("mallory");

  for (const who of [mallory, alice]) {
    expect(await accept(gameId, who)).toEqual({
      ok: false,
      status: 404,
      reason: "not_found",
    });
  }
  expect(
    await db.game.findUniqueOrThrow({ where: { id: gameId } }),
  ).toMatchObject({
    status: "INVITED",
    playerTwoId: null,
  });

  // Once accepted, a different account still gets 404.
  await accept(gameId, bob);
  expect((await accept(gameId, mallory)).ok).toBe(false);
});

test("an unknown token, or a game with no invite, finds nothing", async () => {
  const bob = await user("bob");
  expect(await inviteByToken(db, "not-a-token")).toBeNull();
  expect(await accept("00000000-0000-4000-8000-000000000000", bob)).toEqual({
    ok: false,
    status: 404,
    reason: "not_found",
  });
});

// #58: invite mail goes through the same send limits as sign-in mail, and a
// refusal answers as a send does (ok), so the form never says which
// addresses are capped or have an account.
const sends = (where: object) => db.emailSend.count({ where });

test("an invite email is recorded as a send to its address, from the inviter's IP", async () => {
  const alice = await user("alice");
  const bob = address("bob");

  await invite(alice, bob.toUpperCase(), db, "203.0.113.7");

  expect(
    await db.emailSend.findMany({ where: { address: bob } }),
  ).toMatchObject([{ kind: "invite", ip: "203.0.113.7" }]);
});

test("an invite to an address already invited twice today is answered ok and sends nothing", async () => {
  const alice = await user("alice");
  const bob = address("bob");
  await db.emailSend.createMany({
    data: Array.from({ length: SEND_LIMITS.invitePerAddressPerDay }, () => ({
      address: bob,
      bucket: bob,
      kind: "invite",
      ip: "198.51.100.1",
      createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
    })),
  });

  const result = await invite(alice, bob);

  expect(result).toEqual({ ok: true, gameId: expect.any(String) });
  expect(mailer.count(bob, "invite")).toBe(0);
  expect(await sends({ address: bob })).toBe(
    SEND_LIMITS.invitePerAddressPerDay,
  );
  expect(log.capture.events("email.limit")).toMatchObject([
    { reason: "address", kind: "invite" },
  ]);
});

test("an invite from an IP that has mailed 10 addresses without an account today is answered ok and sends nothing", async () => {
  const alice = await user("alice");
  await db.emailSend.createMany({
    data: Array.from({ length: 10 }, (_, n) => ({
      address: `ip-capped-${n}-${seq}@example.com`,
      bucket: `ip-capped-${n}-${seq}@example.com`,
      kind: "signin",
      ip: "203.0.113.80",
    })),
  });
  const bob = address("bob");

  expect(await invite(alice, bob, db, "203.0.113.80")).toMatchObject({
    ok: true,
  });
  expect(mailer.count(bob, "invite")).toBe(0);
  expect(log.capture.events("email.limit")).toMatchObject([{ reason: "ip" }]);

  // The same IP can still invite a player who has an account.
  const member = await user("member");
  await db.user.update({
    where: { id: member.id },
    data: { approvedAt: new Date() },
  });
  await invite(alice, member.email, db, "203.0.113.80");
  expect(mailer.count(member.email, "invite")).toBe(1);
});

test("an invite once the site has mailed 100 addresses without an account today is answered ok and sends nothing, and logs an error", async () => {
  const alice = await user("alice");
  await db.emailSend.deleteMany();
  await db.emailSend.createMany({
    data: Array.from({ length: 100 }, (_, n) => ({
      address: `site-capped-${n}@example.com`,
      bucket: `site-capped-${n}@example.com`,
      kind: "invite",
      ip: `192.0.2.${n}`,
    })),
  });
  const bob = address("bob");

  expect(await invite(alice, bob, db, "198.51.100.250")).toMatchObject({
    ok: true,
  });
  expect(mailer.count(bob, "invite")).toBe(0);
  expect(
    log.capture.lines.filter((l) => l.event === "email.limit"),
  ).toMatchObject([{ reason: "global", level: 50 }]);
  await db.emailSend.deleteMany();
});

test("a refused invite still counts against the inviter's pending cap", async () => {
  const alice = await user("alice");
  const bob = address("bob");
  await db.emailSend.createMany({
    data: Array.from({ length: SEND_LIMITS.invitePerAddressPerDay }, () => ({
      address: bob,
      bucket: bob,
      kind: "invite",
    })),
  });

  await invite(alice, bob);

  expect(
    await db.invite.count({ where: { inviterId: alice.id, email: bob } }),
  ).toBe(1);
});

test("sign-in and turn mail don't use up an address's invite quota, and invites don't use up its sign-in quota", async () => {
  const alice = await user("alice");
  const bob = address("bob");
  await db.emailSend.createMany({
    data: [
      ...Array.from({ length: SEND_LIMITS.signInPerAddressPerHour }, () => ({
        address: bob,
        bucket: bob,
        kind: "signin",
        ip: "198.51.100.2",
      })),
      ...Array.from({ length: SEND_LIMITS.turnPerAddressPerHour }, () => ({
        address: bob,
        bucket: bob,
        kind: "turn",
      })),
    ],
  });

  await invite(alice, bob);

  expect(mailer.count(bob, "invite")).toBe(1);
  expect(log.capture.events("email.limit")).toEqual([]);
});

// An invite is answered the same however the send limits decide, and the
// work it does must be the same too, or the time it takes says which addresses
// have an account (#43).
test.each([true, false])(
  "sent, refused and capped invites make the same DB calls (prune: %s)",
  async (prune) => {
    const shouldPrune = () => prune;
    const alice = await user("alice");
    const member = await user("member");
    await db.user.update({
      where: { id: member.id },
      data: { approvedAt: new Date() },
    });
    await db.emailSend.deleteMany();
    const byAddress = address("by-address");
    await db.emailSend.createMany({
      data: Array.from({ length: SEND_LIMITS.invitePerAddressPerDay }, () => ({
        address: byAddress,
        bucket: byAddress,
        kind: "invite",
        ip: "198.51.100.3",
      })),
    });
    await db.emailSend.createMany({
      data: Array.from({ length: SEND_LIMITS.ipPerDay }, (_, n) => ({
        address: `calls-ip-${n}-${seq}@example.com`,
        bucket: `calls-ip-${n}-${seq}@example.com`,
        kind: "signin",
        ip: "203.0.113.70",
      })),
    });
    const cases: [string, string, string][] = [
      ["sent to a stranger", address("stranger"), "203.0.113.71"],
      ["sent to a player", member.email, "203.0.113.71"],
      ["refused by address", byAddress, "203.0.113.71"],
      ["refused by IP cap", address("by-ip"), "203.0.113.70"],
    ];

    const perCase: Record<string, string[]> = {};
    for (const [name, email, ip] of cases) {
      const recorded = recordDbCalls(db);
      await invite(alice, email, recorded.db, ip, shouldPrune);
      perCase[name] = recorded.calls;
    }
    await db.emailSend.createMany({
      data: Array.from({ length: SEND_LIMITS.globalPerDay }, (_, n) => ({
        address: `calls-site-${n}-${seq}@example.com`,
        bucket: `calls-site-${n}-${seq}@example.com`,
        kind: "invite",
        ip: `192.0.2.${n}`,
      })),
    });
    const recorded = recordDbCalls(db);
    await invite(
      alice,
      address("by-site"),
      recorded.db,
      "203.0.113.72",
      shouldPrune,
    );
    perCase["refused by site cap"] = recorded.calls;

    expect(perCase["sent to a stranger"]).toEqual(
      expect.arrayContaining(["User.findUnique", "EmailSend.create"]),
    );
    for (const [name, calls] of Object.entries(perCase)) {
      expect({ name, calls }).toEqual({
        name,
        calls: perCase["sent to a stranger"],
      });
    }
    expect(
      log.capture.events("email.limit").map((line) => line.reason),
    ).toEqual(["address", "ip", "global"]);
    await db.emailSend.deleteMany();
  },
);

test("a database error in the send limits refuses the invite and answers ok, like any refusal", async () => {
  const alice = await user("alice");
  const bob = address("bob");
  const broken = failingDb(
    db,
    ({ model, operation }) => model === "EmailSend" && operation === "create",
  );

  const result = await invite(alice, bob, broken);

  expect(result).toEqual({ ok: true, gameId: expect.any(String) });
  expect(mailer.count(bob, "invite")).toBe(0);
  expect(log.capture.events("email.limit")).toEqual([
    expect.objectContaining({ reason: "error", level: 50, kind: "invite" }),
  ]);
  expect(JSON.stringify(log.capture.lines)).not.toContain(bob);
});
