import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { CaptureMailer } from "../mail/mailer.server";
import { SEND_LIMITS } from "../mail/send-limits.server";
import { createPgliteDb } from "../pglite.server";
import { failingDb } from "../test/db-calls";
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

const { makeMove } = await import("./games.server");
const { notifyTurn, VIEWING_MS } = await import("./turn-email.server");

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
async function game(status: "ACTIVE" | "INVITED" = "ACTIVE") {
  const one = await db.user.create({
    data: { email: `one-${++seq}@example.com` },
  });
  const two = await db.user.create({
    data: { email: `two-${seq}@example.com` },
  });
  const created = await db.game.create({
    data: {
      playerOneId: one.id,
      playerTwoId: status === "ACTIVE" ? two.id : null,
      status,
      nextPlayerId: one.id,
    },
  });
  return { one, two, gameId: created.id };
}

async function play(gameId: string, userId: string, column: number) {
  const { moveCount } = await db.game.findUniqueOrThrow({
    where: { id: gameId },
  });
  const result = await makeMove(db, {
    gameId,
    userId,
    column,
    expectedMoveCount: moveCount,
  });
  if (!result.ok) throw new Error(result.error);
  return result.moveNumber;
}

const notify = (gameId: string, moveNumber: number, via = mailer) =>
  notifyTurn(db, via, { gameId, moveNumber, appUrl: APP_URL });

test("after a move, the opponent who isn't watching gets one your-turn email", async () => {
  const { one, two, gameId } = await game();
  const moveNumber = await play(gameId, one.id, 3);

  await notify(gameId, moveNumber);

  const mail = mailer.last(two.email, "turn");
  expect(mail).toMatchObject({
    to: two.email,
    link: `${APP_URL}/games/${gameId}`,
    subject: expect.stringContaining(one.email.split("@")[0]!),
  });
  expect(mailer.last(one.email, "turn")).toBeNull();
  expect(log.capture.events("email.turn.sent")).toEqual([
    expect.objectContaining({ gameId, moveNumber, userId: two.id }),
  ]);
  expect(JSON.stringify(log.capture.lines)).not.toContain(two.email);
});

test("at most one email per turn, even if the send is asked for twice", async () => {
  const { one, two, gameId } = await game();
  const moveNumber = await play(gameId, one.id, 3);

  await Promise.all([notify(gameId, moveNumber), notify(gameId, moveNumber)]);
  await notify(gameId, moveNumber);

  expect(mailer.count(two.email, "turn")).toBe(1);
  // The next turn is a new turn.
  const next = await play(gameId, two.id, 4);
  await notify(gameId, next);
  expect(mailer.count(one.email, "turn")).toBe(1);
});

test("no email while the opponent is watching the game", async () => {
  const { one, two, gameId } = await game();
  await db.game.update({
    where: { id: gameId },
    data: { playerTwoSeenAt: new Date(Date.now() - VIEWING_MS + 2_000) },
  });
  const moveNumber = await play(gameId, one.id, 3);

  await notify(gameId, moveNumber);

  expect(mailer.last(two.email, "turn")).toBeNull();
  expect(log.capture.events("email.turn.skipped")).toEqual([
    expect.objectContaining({ gameId, moveNumber, reason: "viewing" }),
  ]);
});

test("an opponent last seen more than 10 s ago is emailed", async () => {
  expect(VIEWING_MS).toBe(10_000);
  const { one, two, gameId } = await game();
  await db.game.update({
    where: { id: gameId },
    data: { playerTwoSeenAt: new Date(Date.now() - VIEWING_MS - 1) },
  });
  const moveNumber = await play(gameId, one.id, 3);

  await notify(gameId, moveNumber);

  expect(mailer.count(two.email, "turn")).toBe(1);
});

test("no email for a move in an INVITED game: the invite email covers it", async () => {
  const { one, gameId } = await game("INVITED");
  const moveNumber = await play(gameId, one.id, 3);

  await notify(gameId, moveNumber);

  expect(log.capture.events("email.turn.sent")).toEqual([]);
  expect(log.capture.events("email.turn.skipped")).toEqual([
    expect.objectContaining({ reason: "not_active" }),
  ]);
});

test("no email after the winning move", async () => {
  const { one, two, gameId } = await game();
  let last = 0;
  for (let i = 0; i < 7; i++) {
    last = await play(gameId, i % 2 === 0 ? one.id : two.id, i % 2);
  }
  mailer.clear();

  await notify(gameId, last);

  expect(mailer.last(two.email, "turn")).toBeNull();
});

test("a failed send is logged and not retried", async () => {
  const { one, two, gameId } = await game();
  const moveNumber = await play(gameId, one.id, 3);

  await notify(gameId, moveNumber, {
    send: async () => false,
  } as unknown as CaptureMailer);
  await notify(gameId, moveNumber);

  expect(log.capture.events("email.turn.failed")).toEqual([
    expect.objectContaining({ gameId, moveNumber, userId: two.id }),
  ]);
  expect(mailer.last(two.email, "turn")).toBeNull();
});

// #58: turn mail goes only to existing players, so only the per-address
// limit applies to it.
test("a your-turn email is recorded as a send, without a client IP", async () => {
  const { one, two, gameId } = await game();

  await play(gameId, one.id, 0);
  await notifyTurn(db, mailer, { gameId, moveNumber: 1, appUrl: APP_URL });

  expect(
    await db.emailSend.findMany({ where: { address: two.email } }),
  ).toMatchObject([{ kind: "turn", ip: null }]);
});

test("no your-turn email once the address has had 10 turn mails this hour, and email.limit is logged", async () => {
  const { one, two, gameId } = await game();
  await db.emailSend.createMany({
    data: Array.from({ length: SEND_LIMITS.turnPerAddressPerHour }, () => ({
      address: two.email,
      bucket: two.email,
      kind: "turn",
    })),
  });

  await play(gameId, one.id, 0);
  await notifyTurn(db, mailer, { gameId, moveNumber: 1, appUrl: APP_URL });

  expect(mailer.count(two.email, "turn")).toBe(0);
  expect(log.capture.events("email.limit")).toMatchObject([
    { reason: "address", kind: "turn" },
  ]);
});

test("sign-in and invite mail don't use up the turn quota, and turn mail has its own bucket", async () => {
  const { one, two, gameId } = await game();
  await db.emailSend.createMany({
    data: [
      ...Array.from({ length: 6 }, () => ({
        address: two.email,
        bucket: two.email,
        kind: "signin",
        ip: "198.51.100.9",
      })),
      ...Array.from({ length: 3 }, () => ({
        address: two.email,
        bucket: two.email,
        kind: "invite",
        ip: "198.51.100.9",
      })),
    ],
  });

  await play(gameId, one.id, 0);
  await notifyTurn(db, mailer, { gameId, moveNumber: 1, appUrl: APP_URL });

  expect(mailer.count(two.email, "turn")).toBe(1);
  expect(log.capture.events("email.limit")).toEqual([]);
});

test("turn mail has no client IP, so it isn't warned about", async () => {
  const { one, gameId } = await game();

  await play(gameId, one.id, 0);
  await notifyTurn(db, mailer, { gameId, moveNumber: 1, appUrl: APP_URL });

  expect(log.capture.events("email.limit.no_ip")).toEqual([]);
});

test("a database error in the send limits means no your-turn email, logged at error level, and no throw", async () => {
  const { one, two, gameId } = await game();
  const broken = failingDb(
    db,
    ({ model, operation }) => model === "EmailSend" && operation === "create",
  );

  await play(gameId, one.id, 0);
  await expect(
    notifyTurn(broken, mailer, { gameId, moveNumber: 1, appUrl: APP_URL }),
  ).resolves.toBeUndefined();

  expect(mailer.count(two.email, "turn")).toBe(0);
  expect(log.capture.events("email.limit")).toEqual([
    expect.objectContaining({ reason: "error", level: 50, kind: "turn" }),
  ]);
});

test("the IP and site-wide caps don't stop a your-turn email", async () => {
  const { one, two, gameId } = await game();
  await db.emailSend.createMany({
    data: Array.from({ length: 100 }, (_, n) => ({
      address: `turn-site-${n}-${seq}@example.com`,
      bucket: `turn-site-${n}-${seq}@example.com`,
      kind: "signin",
      ip: "203.0.113.90",
    })),
  });

  await play(gameId, one.id, 0);
  await notifyTurn(db, mailer, { gameId, moveNumber: 1, appUrl: APP_URL });

  expect(mailer.count(two.email, "turn")).toBe(1);
  await db.emailSend.deleteMany();
});
