import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { CaptureMailer } from "../mail/mailer.server";
import { createPgliteDb } from "../pglite.server";
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

afterEach(() => {
  vi.useRealTimers();
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
) {
  return createInvite(via, mailer, {
    inviterId: inviter.id,
    inviterEmail: inviter.email,
    email,
    appUrl: APP_URL,
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
  const bob = address("bob");
  await invite(alice, bob);
  const first = tokenFrom(bob);
  await invite(alice, bob);
  expect(tokenFrom(bob)).not.toBe(first);
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

test("inviting an address with an account and one without looks the same, and reads no user", async () => {
  const alice = await user("alice");
  const member = await user("member");
  const stranger = address("stranger");

  // Every model call the invite makes, by model name.
  const models: string[] = [];
  const watched = db.$extends({
    query: {
      $allModels: {
        $allOperations({ model, args, query }) {
          models.push(model);
          return query(args);
        },
      },
    },
  }) as unknown as PrismaClient;

  const forMember = await invite(alice, member.email, watched);
  const forStranger = await invite(alice, stranger, watched);

  expect(models).not.toContain("User");
  expect(forMember).toEqual({ ok: true, gameId: expect.any(String) });
  expect(forStranger).toEqual({ ok: true, gameId: expect.any(String) });
  const memberMail = mailer.last(member.email, "invite")!;
  const strangerMail = mailer.last(stranger, "invite")!;
  expect(memberMail.subject).toBe(strangerMail.subject);
  expect(memberMail.text.replace(memberMail.link, "")).toBe(
    strangerMail.text.replace(strangerMail.link, ""),
  );
  expect(
    log.capture.events("email.invite.sent").map((line) => Object.keys(line)),
  ).toEqual([
    expect.arrayContaining(["gameId", "inviteId", "inviterId"]),
    expect.arrayContaining(["gameId", "inviteId", "inviterId"]),
  ]);
  expect(JSON.stringify(log.capture.lines)).not.toContain(member.id);
});

test("a failed send undoes the game and reports it, so the cap isn't used up", async () => {
  const alice = await user("alice");
  const failing = { send: async () => false };
  const games = await db.game.count({ where: { playerOneId: alice.id } });

  const result = await createInvite(db, failing, {
    inviterId: alice.id,
    inviterEmail: alice.email,
    email: address("bob"),
    appUrl: APP_URL,
  });

  expect(result).toEqual({ ok: false, error: "not_sent" });
  expect(await db.game.count({ where: { playerOneId: alice.id } })).toBe(games);
  expect(log.capture.events("email.invite.failed")).toHaveLength(1);
});

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
