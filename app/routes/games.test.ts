import { afterAll, expect, test, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { createPgliteDb } from "../pglite.server";
import { formPost, get, run } from "../test/routes";

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
const state = await import("./games.$id.state");
const board = await import("./games.$id");
const games = await import("./games");

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

// One stacks column 0, two stacks column 1; one's fourth disc wins.
async function playToWin(one: Player, two: Player, gameId: string) {
  for (let i = 0; i < 7; i++) {
    const result = await move(i % 2 === 0 ? one : two, gameId, i % 2);
    expect(result.status).toBe(200);
  }
}

async function rematch(as: Player, gameId: string) {
  return reply(
    await run(
      games.action,
      formPost(
        "/games",
        { rematchOf: gameId },
        { cookie: as.cookie, referer: "/games" },
      ),
    ),
  );
}

async function readState(as: Player, gameId: string) {
  return reply(
    await run(
      state.loader,
      get(`/games/${gameId}/state`, { cookie: as.cookie }),
      { id: gameId },
    ),
  );
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

test("a move into a full column is refused with 422 and changes nothing", async () => {
  const { one, two, game } = await activeGame();
  for (let i = 0; i < 6; i++) await move(i % 2 === 0 ? one : two, game.id, 2);

  expect(await move(one, game.id, 2)).toEqual({
    status: 422,
    body: { ok: false, error: "column_full" },
  });
  expect(await move(one, game.id, 7)).toEqual({
    status: 422,
    body: { ok: false, error: "column_out_of_range" },
  });
  expect(await db.game.findUnique({ where: { id: game.id } })).toMatchObject({
    moveCount: 6,
    nextPlayerId: one.id,
  });
});

test("a winning move ends the game and any move after it is refused with 409", async () => {
  const { one, two, game } = await activeGame();
  // One stacks column 0, two stacks column 1; one's fourth disc wins.
  for (const [as, column] of [
    [one, 0],
    [two, 1],
    [one, 0],
    [two, 1],
    [one, 0],
    [two, 1],
    [one, 0],
  ] as const) {
    expect(await move(as, game.id, column)).toMatchObject({ status: 200 });
  }

  const won = await db.game.findUniqueOrThrow({ where: { id: game.id } });
  expect(won).toMatchObject({
    status: "WON",
    winnerId: one.id,
    nextPlayerId: null,
    moveCount: 7,
  });
  expect(won.finishedAt).toBeInstanceOf(Date);

  for (const as of [two, one]) {
    expect(await move(as, game.id, 3)).toEqual({
      status: 409,
      body: { ok: false, error: "game_over" },
    });
  }
  expect(await db.move.count({ where: { gameId: game.id } })).toBe(7);
});

test("nextPlayerId never points at an empty seat", async () => {
  // An invited game: player two's seat stays empty until the invite is
  // accepted (#14), which is when nextPlayerId gets set for them.
  const one = await player("inviter");
  const game = await db.game.create({
    data: { playerOneId: one.id, status: "INVITED", nextPlayerId: one.id },
  });

  expect(await move(one, game.id, 3)).toMatchObject({ status: 200 });
  expect(await db.game.findUnique({ where: { id: game.id } })).toMatchObject({
    status: "INVITED",
    playerTwoId: null,
    nextPlayerId: null,
    moveCount: 1,
  });
  expect(await move(one, game.id, 4)).toEqual({
    status: 409,
    body: { ok: false, error: "not_your_turn" },
  });
  expect(await readState(one, game.id)).toMatchObject({
    status: 200,
    body: { status: "INVITED", nextPlayerId: null, yourTurn: false },
  });

  // And in a full game, every turn goes to one of the two seated players.
  const { one: a, two: b, game: played } = await activeGame();
  for (const column of [0, 1, 2, 3, 4, 5, 6, 0]) {
    const turn = await db.game.findUniqueOrThrow({ where: { id: played.id } });
    expect([a.id, b.id]).toContain(turn.nextPlayerId);
    await move(turn.nextPlayerId === a.id ? a : b, played.id, column);
  }
});

test("a non-player gets 404 from the board, moves, state and rematch", async () => {
  const { one, two, game } = await activeGame();
  for (const [as, column] of [
    [one, 0],
    [two, 1],
    [one, 0],
    [two, 1],
    [one, 0],
    [two, 1],
    [one, 0],
  ] as const) {
    await move(as, game.id, column);
  }
  const finished = await db.game.findUniqueOrThrow({ where: { id: game.id } });
  expect(finished.status).toBe("WON");
  const outsider = await player("outsider");
  const params = { id: game.id };

  const responses = {
    board: await run(
      board.loader,
      get(`/games/${game.id}`, { cookie: outsider.cookie }),
      params,
    ),
    move: await run(
      moves.action,
      formPost(
        `/games/${game.id}/moves`,
        { column: "3", expectedMoveCount: "7" },
        { cookie: outsider.cookie, referer: `/games/${game.id}` },
      ),
      params,
    ),
    state: await run(
      state.loader,
      get(`/games/${game.id}/state`, { cookie: outsider.cookie }),
      params,
    ),
    rematch: await run(
      games.action,
      formPost(
        "/games",
        { rematchOf: game.id },
        { cookie: outsider.cookie, referer: "/games" },
      ),
    ),
  };
  for (const [route, response] of Object.entries(responses)) {
    expect({ route, status: (await reply(response)).status }).toEqual({
      route,
      status: 404,
    });
  }

  expect(await db.move.count({ where: { gameId: game.id } })).toBe(7);
  expect(await db.game.count({ where: { rematchOfId: game.id } })).toBe(0);
});

test("rematch starts a new game with the same opponent, second mover first", async () => {
  const { one, two, game } = await activeGame();
  expect(await rematch(two, game.id)).toMatchObject({ status: 409 });
  await playToWin(one, two, game.id);

  const started = await rematch(two, game.id);
  expect(started.status).toBe(302);
  const created = await db.game.findFirstOrThrow({
    where: { rematchOfId: game.id },
  });
  expect(created).toMatchObject({
    playerOneId: two.id,
    playerTwoId: one.id,
    status: "ACTIVE",
    nextPlayerId: two.id,
    moveCount: 0,
  });

  // The other player's rematch joins the same game rather than a second one.
  const joined = (await run(
    games.action,
    formPost(
      "/games",
      { rematchOf: game.id },
      { cookie: one.cookie, referer: "/games" },
    ),
  )) as Response;
  expect(joined.headers.get("location")).toBe(`/games/${created.id}`);
  expect(await db.game.count({ where: { rematchOfId: game.id } })).toBe(1);
});

test("the game list shows each player whose turn it is and the result", async () => {
  const { one, two, game: finished } = await activeGame();
  await playToWin(one, two, finished.id);
  const ongoing = await db.game.create({
    data: {
      playerOneId: two.id,
      playerTwoId: one.id,
      status: "ACTIVE",
      nextPlayerId: two.id,
    },
  });
  const list = async (as: Player) =>
    (await reply(
      await run(games.loader, get("/games", { cookie: as.cookie })),
    )) as { status: number; body: { games: unknown[] } };

  expect((await list(one)).body.games).toEqual([
    expect.objectContaining({
      id: ongoing.id,
      opponent: two.email,
      yourTurn: false,
      result: null,
    }),
    expect.objectContaining({
      id: finished.id,
      opponent: two.email,
      yourTurn: false,
      result: "won",
    }),
  ]);
  expect((await list(two)).body.games).toEqual([
    expect.objectContaining({ id: ongoing.id, yourTurn: true, result: null }),
    expect.objectContaining({ id: finished.id, result: "lost" }),
  ]);
  expect((await list(await player("loner"))).body.games).toEqual([]);
});
