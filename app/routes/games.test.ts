import { afterAll, expect, test, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { createPgliteDb } from "../pglite.server";
import { formPost, run } from "../test/routes";

// Invites are a later step (#14), so these tests seed both players and the
// game directly, and sign each player in with a session cookie from Auth.

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
const moves = await import("./games.$id.moves");

type Player = { id: string; email: string; cookie: string };

let seq = 0;
async function player(name: string): Promise<Player> {
  const email = `${name}-${++seq}@example.com`;
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
  return { id: user.id, email, cookie: setCookie.split(";")[0]! };
}

async function activeGame() {
  const one = await player("one");
  const two = await player("two");
  const game = await db.game.create({
    data: {
      playerOneId: one.id,
      playerTwoId: two.id,
      status: "ACTIVE",
      nextPlayerId: one.id,
    },
  });
  return { one, two, game };
}

// Status and body of what a loader or action returned: a thrown or returned
// Response, a data() result, or plain data (200).
async function reply(result: unknown) {
  if (result instanceof Response) {
    const text = await result.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // not JSON
    }
    return { status: result.status, body };
  }
  if (result && typeof result === "object" && "init" in result) {
    const { init, data } = result as {
      init?: { status?: number };
      data: unknown;
    };
    return { status: init?.status ?? 200, body: data };
  }
  return { status: 200, body: result };
}

async function move(
  as: Player,
  gameId: string,
  column: number,
  expectedMoveCount?: number,
) {
  const expected =
    expectedMoveCount ??
    (await db.game.findUnique({ where: { id: gameId } }))?.moveCount ??
    0;
  const path = `/games/${gameId}/moves`;
  return reply(
    await run(
      moves.action,
      formPost(
        path,
        { column: String(column), expectedMoveCount: String(expected) },
        { cookie: as.cookie, referer: `/games/${gameId}` },
      ),
      { id: gameId },
    ),
  );
}

test("a legal move drops the disc to the lowest open row and passes the turn", async () => {
  const { one, two, game } = await activeGame();

  expect(await move(one, game.id, 3)).toMatchObject({ status: 200 });
  expect(await move(two, game.id, 3)).toMatchObject({ status: 200 });

  const after = await db.game.findUniqueOrThrow({
    where: { id: game.id },
    include: { moves: { orderBy: { number: "asc" } } },
  });
  expect(after).toMatchObject({
    status: "ACTIVE",
    moveCount: 2,
    nextPlayerId: one.id,
    winnerId: null,
  });
  expect(after.moves).toMatchObject([
    { number: 1, playerId: one.id, column: 3, row: 0 },
    { number: 2, playerId: two.id, column: 3, row: 1 },
  ]);
});

test("a move out of turn is refused with 409 and changes nothing", async () => {
  const { one, two, game } = await activeGame();

  expect(await move(two, game.id, 0)).toEqual({
    status: 409,
    body: { ok: false, error: "not_your_turn" },
  });
  await move(one, game.id, 0);
  expect(await move(one, game.id, 1)).toMatchObject({ status: 409 });

  expect(await db.move.count({ where: { gameId: game.id } })).toBe(1);
  expect(await db.game.findUnique({ where: { id: game.id } })).toMatchObject({
    moveCount: 1,
    nextPlayerId: two.id,
  });
});

test("a move from a stale board (a double tap) is refused with 409", async () => {
  const { one, two, game } = await activeGame();
  await move(one, game.id, 0);

  expect(await move(two, game.id, 1, 0)).toEqual({
    status: 409,
    body: { ok: false, error: "stale" },
  });
  expect(await db.move.count({ where: { gameId: game.id } })).toBe(1);
});
