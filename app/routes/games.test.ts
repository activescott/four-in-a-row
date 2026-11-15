import { afterAll, expect, test, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { createPgliteDb } from "../pglite.server";
import { formPost, get, logCapture, run } from "../test/routes";

// These tests seed both players and the game directly (invites are in
// invites.test.ts), and sign each player in with a session cookie from Auth.

const { getDb, log } = vi.hoisted(() => ({
  getDb: vi.fn<() => Promise<PrismaClient>>(),
  log: { capture: undefined as unknown as ReturnType<typeof logCapture> },
}));
vi.mock("../db.server", () => ({ getDb }));
vi.mock("../logger.server", async (importOriginal) => {
  const original = await importOriginal<typeof import("../logger.server")>();
  const { logCapture } = await import("../test/routes");
  log.capture = logCapture();
  return {
    ...original,
    logger: original.createLogger(log.capture.destination),
  };
});

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
const { createRematch, makeMove } = await import("../game/games.server");

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

async function readState(
  as: Player,
  gameId: string,
  since?: number | string,
  status?: string,
) {
  const params = new URLSearchParams();
  if (since !== undefined) params.set("since", String(since));
  if (status !== undefined) params.set("status", status);
  const query = params.size ? `?${params}` : "";
  return reply(
    await run(
      state.loader,
      get(`/games/${gameId}/state${query}`, { cookie: as.cookie }),
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

test("a move emails the opponent that it's their turn", async () => {
  const { captureMailer } = await import("../mail/mailer.server");
  const { one, two, game } = await activeGame();

  expect((await move(one, game.id, 3)).status).toBe(200);

  expect(captureMailer!.last(two.email, "turn")).toMatchObject({
    link: `http://localhost/games/${game.id}`,
  });
  expect(captureMailer!.last(one.email, "turn")).toBeNull();
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

test("the 42nd move of a full board with no four ends the game as a draw", async () => {
  const { one, two, game } = await activeGame();
  // DRAW_MOVES in rules.test.ts: a full board with no four in a row.
  const columns = [
    0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 4, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3,
    4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 5,
  ];
  for (const [i, column] of columns.entries()) {
    expect(await move(i % 2 === 0 ? one : two, game.id, column)).toMatchObject({
      status: 200,
    });
  }

  const drawn = await db.game.findUniqueOrThrow({ where: { id: game.id } });
  expect(drawn).toMatchObject({
    status: "DRAW",
    winnerId: null,
    nextPlayerId: null,
    moveCount: 42,
  });
  expect(drawn.finishedAt).toBeInstanceOf(Date);

  expect(await move(one, game.id, 3)).toEqual({
    status: 409,
    body: { ok: false, error: "game_over" },
  });
  expect(await db.move.count({ where: { gameId: game.id } })).toBe(42);
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
    body: { status: "INVITED", yourTurn: false },
  });

  // And in a full game, every turn goes to one of the two seated players.
  const { one: a, two: b, game: played } = await activeGame();
  for (const column of [0, 1, 2, 3, 4, 5, 6, 0]) {
    const turn = await db.game.findUniqueOrThrow({ where: { id: played.id } });
    expect([a.id, b.id]).toContain(turn.nextPlayerId);
    await move(turn.nextPlayerId === a.id ? a : b, played.id, column);
  }
});

test("the state payload has yourTurn and result but no user ids", async () => {
  const { one, two, game } = await activeGame();
  const ongoing = await readState(one, game.id);
  expect(ongoing).toMatchObject({
    status: 200,
    body: { yourTurn: true, result: null },
  });

  await playToWin(one, two, game.id);
  for (const [as, result] of [
    [one, "won"],
    [two, "lost"],
  ] as const) {
    const { body } = await readState(as, game.id);
    expect(body).toMatchObject({ yourTurn: false, result });
    expect(body).not.toHaveProperty("nextPlayerId");
    expect(body).not.toHaveProperty("winnerId");
    expect(JSON.stringify(body)).not.toContain(one.id);
    expect(JSON.stringify(body)).not.toContain(two.id);
  }
  expect(JSON.stringify(ongoing.body)).not.toContain(two.id);
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

test("rematch on an older finished game rematches the newest game in its chain", async () => {
  const { one, two, game: first } = await activeGame();
  await playToWin(one, two, first.id);
  await rematch(two, first.id);
  const second = await db.game.findUniqueOrThrow({
    where: { rematchOfId: first.id },
  });
  // Two moves first in the rematch and wins it.
  await playToWin(two, one, second.id);

  const started = (await run(
    games.action,
    formPost(
      "/games",
      { rematchOf: first.id },
      { cookie: one.cookie, referer: "/games" },
    ),
  )) as Response;

  const third = await db.game.findUniqueOrThrow({
    where: { rematchOfId: second.id },
  });
  expect(started.headers.get("location")).toBe(`/games/${third.id}`);
  expect(third).toMatchObject({
    playerOneId: one.id,
    playerTwoId: two.id,
    status: "ACTIVE",
    nextPlayerId: one.id,
  });
  // Pressing it again on either finished game joins the same new game.
  for (const [as, from] of [
    [two, first],
    [one, second],
  ] as const) {
    const again = (await run(
      games.action,
      formPost(
        "/games",
        { rematchOf: from.id },
        { cookie: as.cookie, referer: "/games" },
      ),
    )) as Response;
    expect(again.headers.get("location")).toBe(`/games/${third.id}`);
  }
  expect(
    await db.game.count({
      where: { rematchOfId: { in: [first.id, second.id, third.id] } },
    }),
  ).toBe(2);
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

test("a move with a missing or non-integer column is refused with 400", async () => {
  const { one, game } = await activeGame();
  const path = `/games/${game.id}/moves`;
  const cases: Record<string, string>[] = [
    { expectedMoveCount: "0" },
    { column: "", expectedMoveCount: "0" },
    { column: "abc", expectedMoveCount: "0" },
    { column: "1.5", expectedMoveCount: "0" },
    { column: "3" },
    { column: "3", expectedMoveCount: "x" },
  ];
  for (const fields of cases) {
    const result = await reply(
      await run(
        moves.action,
        formPost(path, fields, { cookie: one.cookie, referer: path }),
        { id: game.id },
      ),
    );
    expect({ fields, result }).toEqual({
      fields,
      result: { status: 400, body: { ok: false, error: "invalid_input" } },
    });
  }
  expect(await db.move.count({ where: { gameId: game.id } })).toBe(0);
});

test("two moves racing for the same turn: exactly one is played", async () => {
  const { one, game } = await activeGame();

  const results = await Promise.all([
    move(one, game.id, 2, 0),
    move(one, game.id, 5, 0),
  ]);

  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(await db.move.count({ where: { gameId: game.id } })).toBe(1);
  expect(await db.game.findUnique({ where: { id: game.id } })).toMatchObject({
    moveCount: 1,
  });
});

test("a move whose read lost the race is refused as stale by the update", async () => {
  // PGlite runs one transaction at a time, so a real race can't interleave
  // here. Instead the game read returns the snapshot from before another
  // move landed, as a concurrent transaction on Postgres would see it.
  const { one, two, game } = await activeGame();
  const before = await db.game.findUniqueOrThrow({
    where: { id: game.id },
    include: { moves: true },
  });
  expect(await move(one, game.id, 0)).toMatchObject({ status: 200 });
  const lostRace = { ...before, nextPlayerId: two.id };

  const result = await makeMove(staleGameReads(lostRace), {
    gameId: game.id,
    userId: two.id,
    column: 1,
    expectedMoveCount: 0,
  });

  expect(result).toEqual({ ok: false, status: 409, error: "stale" });
  expect(await db.move.count({ where: { gameId: game.id } })).toBe(1);
});

test("an inviter's first move whose read predates the invitee joining is refused as stale", async () => {
  // As above, the read returns the snapshot a concurrent transaction would
  // see: still INVITED with an empty seat, though the invitee has joined.
  const one = await player("inviter");
  const two = await player("invitee");
  const game = await db.game.create({
    data: { playerOneId: one.id, status: "INVITED", nextPlayerId: one.id },
  });
  const before = await db.game.findUniqueOrThrow({
    where: { id: game.id },
    include: { moves: true },
  });
  await db.game.update({
    where: { id: game.id },
    data: { status: "ACTIVE", playerTwoId: two.id },
  });

  const result = await makeMove(staleGameReads(before), {
    gameId: game.id,
    userId: one.id,
    column: 3,
    expectedMoveCount: 0,
  });

  expect(result).toEqual({ ok: false, status: 409, error: "stale" });
  expect(await db.game.findUnique({ where: { id: game.id } })).toMatchObject({
    status: "ACTIVE",
    nextPlayerId: one.id,
    moveCount: 0,
  });
});

test("two rematch posts on a double submit start one new game", async () => {
  const { one, two, game } = await activeGame();
  await playToWin(one, two, game.id);

  const results = await Promise.all([
    rematch(two, game.id),
    rematch(two, game.id),
  ]);

  expect(results.map((r) => r.status)).toEqual([302, 302]);
  expect(await db.game.count({ where: { rematchOfId: game.id } })).toBe(1);
});

test("a rematch whose lookup lost the race returns the game the other press created", async () => {
  // PGlite runs one transaction at a time, so instead the first lookup for an
  // existing rematch misses the game another press has already created, as a
  // concurrent transaction on Postgres could. The unique index on
  // rematch_of_id refuses the second game.
  const { one, two, game } = await activeGame();
  await playToWin(one, two, game.id);
  expect(await rematch(two, game.id)).toMatchObject({ status: 302 });
  const existing = await db.game.findFirstOrThrow({
    where: { rematchOfId: game.id },
  });

  const result = await createRematch(missFirstRematchLookup(), game.id, one.id);

  expect(result).toEqual({ ok: true, gameId: existing.id, created: false });
  expect(await db.game.count({ where: { rematchOfId: game.id } })).toBe(1);
});

test("moves and rematches are logged with user ids, never emails", async () => {
  const { one, two, game } = await activeGame();
  log.capture.lines.length = 0;

  await move(one, game.id, 0);
  await move(one, game.id, 1);
  await reply(
    await run(
      moves.action,
      formPost(
        `/games/${game.id}/moves`,
        { expectedMoveCount: "1" },
        { cookie: two.cookie, referer: `/games/${game.id}` },
      ),
      { id: game.id },
    ),
  );
  expect(log.capture.events("move.accepted")).toEqual([
    expect.objectContaining({
      gameId: game.id,
      userId: one.id,
      column: 0,
      moveNumber: 1,
    }),
  ]);
  expect(log.capture.events("move.rejected")).toEqual([
    expect.objectContaining({
      gameId: game.id,
      userId: one.id,
      reason: "not_your_turn",
    }),
    expect.objectContaining({
      gameId: game.id,
      userId: two.id,
      reason: "invalid_input",
    }),
  ]);

  // Finish the game: one stacks column 0, two stacks column 1.
  for (let i = 1; i < 7; i++)
    await move(i % 2 === 0 ? one : two, game.id, i % 2);
  await rematch(two, game.id);
  await rematch(one, game.id);
  const created = await db.game.findFirstOrThrow({
    where: { rematchOfId: game.id },
  });
  expect(log.capture.events("game.rematch")).toEqual([
    expect.objectContaining({
      gameId: created.id,
      rematchOfId: game.id,
      userId: two.id,
      created: true,
    }),
    expect.objectContaining({
      gameId: created.id,
      rematchOfId: game.id,
      userId: one.id,
      created: false,
    }),
  ]);

  const text = JSON.stringify(log.capture.lines);
  expect(text).not.toContain(one.email);
  expect(text).not.toContain(two.email);
});

// The test database, except that game.findUnique inside a transaction
// returns the given snapshot.
function staleGameReads(snapshot: unknown): PrismaClient {
  const withStaleGame = <T extends object>(tx: T) =>
    new Proxy(tx, {
      get(target, prop) {
        const value = Reflect.get(target, prop);
        if (prop !== "game") return value;
        return new Proxy(value as object, {
          get(game, method) {
            if (method === "findUnique") return async () => snapshot;
            return Reflect.get(game, method);
          },
        });
      },
    });
  return new Proxy(db, {
    get(target, prop) {
      if (prop !== "$transaction") return Reflect.get(target, prop);
      return (fn: (tx: unknown) => Promise<unknown>) =>
        target.$transaction((tx) => fn(withStaleGame(tx)));
    },
  });
}

// The test database, except that the first lookup by rematchOfId inside a
// transaction finds nothing.
function missFirstRematchLookup(): PrismaClient {
  let missed = false;
  const misses = (args: unknown) =>
    !missed &&
    typeof args === "object" &&
    args !== null &&
    "where" in args &&
    typeof args.where === "object" &&
    args.where !== null &&
    "rematchOfId" in args.where;
  const withMiss = <T extends object>(tx: T) =>
    new Proxy(tx, {
      get(target, prop) {
        const value = Reflect.get(target, prop);
        if (prop !== "game") return value;
        return new Proxy(value as object, {
          get(game, method) {
            const fn = Reflect.get(game, method);
            if (method !== "findUnique" && method !== "findFirst") return fn;
            return async (args: unknown) => {
              if (misses(args)) {
                missed = true;
                return null;
              }
              return (fn as (a: unknown) => unknown).call(game, args);
            };
          },
        });
      },
    });
  return new Proxy(db, {
    get(target, prop) {
      if (prop !== "$transaction") return Reflect.get(target, prop);
      return (fn: (tx: unknown) => Promise<unknown>) =>
        target.$transaction((tx) => fn(withMiss(tx)));
    },
  });
}

test("the game list puts your-turn games first, newest first within each group", async () => {
  const me = await player("me");
  const them = await player("them");
  const make = (first: Player, next: Player) =>
    db.game.create({
      data: {
        playerOneId: first.id,
        playerTwoId: first === me ? them.id : me.id,
        status: "ACTIVE",
        nextPlayerId: next.id,
      },
    });
  const theirOld = await make(me, them);
  const mineOld = await make(them, me);
  const theirNew = await make(me, them);
  const mineNew = await make(them, me);
  const { body } = (await reply(
    await run(games.loader, get("/games", { cookie: me.cookie })),
  )) as { body: { games: { id: string }[] } };
  expect(body.games.map((g) => g.id)).toEqual([
    mineNew.id,
    mineOld.id,
    theirNew.id,
    theirOld.id,
  ]);
});

test("the board state names the last move's column, row and seat", async () => {
  const { one, two, game } = await activeGame();
  expect((await readState(one, game.id)).body).toMatchObject({
    lastMove: null,
  });
  await makeMove(db, {
    gameId: game.id,
    userId: one.id,
    column: 3,
    expectedMoveCount: 0,
  });
  expect((await readState(two, game.id)).body).toMatchObject({
    lastMove: { row: 0, column: 3, player: 1 },
  });
});

test("state?since=n is unchanged when nothing moved, and has the new moves when something did", async () => {
  const { one, two, game } = await activeGame();
  expect(await readState(two, game.id, 0)).toEqual({
    status: 200,
    body: { unchanged: true, moveCount: 0 },
  });

  await move(one, game.id, 3);
  await move(two, game.id, 3);
  expect(await readState(one, game.id, 2)).toEqual({
    status: 200,
    body: { unchanged: true, moveCount: 2 },
  });
  expect(await readState(one, game.id, 1)).toEqual({
    status: 200,
    body: {
      unchanged: false,
      moveCount: 2,
      status: "ACTIVE",
      yourTurn: true,
      result: null,
      winningCells: [],
      lastMove: { row: 1, column: 3, player: 2 },
      moves: [{ number: 2, row: 1, column: 3, player: 2 }],
    },
  });
  expect((await readState(two, game.id, 0)).body).toMatchObject({
    unchanged: false,
    yourTurn: false,
    moves: [
      { number: 1, row: 0, column: 3, player: 1 },
      { number: 2, row: 1, column: 3, player: 2 },
    ],
  });
});

test("state?since=n carries the result and winning cells once the game ends", async () => {
  const { one, two, game } = await activeGame();
  await playToWin(one, two, game.id);

  const { body } = await readState(two, game.id, 6);
  expect(body).toEqual({
    unchanged: false,
    moveCount: 7,
    status: "WON",
    yourTurn: false,
    result: "lost",
    winningCells: expect.arrayContaining(
      [0, 1, 2, 3].map((row) => ({ row, column: 0 })),
    ),
    lastMove: { row: 3, column: 0, player: 1 },
    moves: [{ number: 7, row: 3, column: 0, player: 1 }],
  });
  expect(JSON.stringify(body)).not.toContain(one.id);
  expect(JSON.stringify(body)).not.toContain(two.id);
});

test("state?since= ahead of the game, or not a whole number, is refused with 400", async () => {
  const { one, game } = await activeGame();
  await move(one, game.id, 0);
  for (const since of ["2", "-1", "x", "1.5", ""]) {
    expect({
      since,
      status: (await readState(one, game.id, since)).status,
    }).toEqual({
      since,
      status: 400,
    });
  }
});

test("state?since=n&status= returns the new state when an INVITED game turns ACTIVE at the same move count", async () => {
  const one = await player("inviter");
  const two = await player("invitee");
  const game = await db.game.create({
    data: { playerOneId: one.id, status: "INVITED", nextPlayerId: one.id },
  });
  await move(one, game.id, 3);
  expect(await readState(one, game.id, 1, "INVITED")).toEqual({
    status: 200,
    body: { unchanged: true, moveCount: 1 },
  });

  // The invitee accepts: no move, so the move count stays at 1.
  await db.game.update({
    where: { id: game.id },
    data: { playerTwoId: two.id, status: "ACTIVE", nextPlayerId: two.id },
  });

  expect(await readState(one, game.id, 1, "INVITED")).toEqual({
    status: 200,
    body: {
      unchanged: false,
      moveCount: 1,
      status: "ACTIVE",
      yourTurn: false,
      result: null,
      winningCells: [],
      lastMove: { row: 0, column: 3, player: 1 },
      moves: [],
    },
  });
  // A client that already has ACTIVE is told nothing changed.
  expect(await readState(one, game.id, 1, "ACTIVE")).toEqual({
    status: 200,
    body: { unchanged: true, moveCount: 1 },
  });
});

test("state?status= that isn't a game status is refused with 400", async () => {
  const { one, game } = await activeGame();
  for (const status of ["", "active", "PLAYING"]) {
    expect((await readState(one, game.id, 0, status)).status).toBe(400);
  }
});

test("a non-player polling state?since=n gets 404", async () => {
  const { game } = await activeGame();
  const outsider = await player("outsider");
  expect((await readState(outsider, game.id, 0)).status).toBe(404);
});

test("a poll records when that player last saw the game, at most every 5 s", async () => {
  const { one, two, game } = await activeGame();
  const seen = async () => {
    const g = await db.game.findUniqueOrThrow({ where: { id: game.id } });
    return { one: g.playerOneSeenAt, two: g.playerTwoSeenAt };
  };
  const start = new Date("2026-11-15T12:00:00.000Z");
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(start);
    await readState(one, game.id, 0);
    expect(await seen()).toEqual({ one: start, two: null });

    vi.setSystemTime(start.getTime() + 4_000);
    await readState(one, game.id, 0);
    expect(await seen()).toEqual({ one: start, two: null });

    const later = new Date(start.getTime() + 6_000);
    vi.setSystemTime(later);
    await readState(one, game.id, 0);
    await readState(two, game.id, 0);
    expect(await seen()).toEqual({ one: later, two: later });

    // Nor does a refused request.
    vi.setSystemTime(start.getTime() + 20_000);
    expect((await readState(one, game.id, 1)).status).toBe(400);
    expect(await seen()).toEqual({ one: later, two: later });

    // Someone who isn't playing leaves no trace.
    vi.setSystemTime(start.getTime() + 20_000);
    await readState(await player("outsider"), game.id, 0);
    expect(await seen()).toEqual({ one: later, two: later });
  } finally {
    vi.useRealTimers();
  }
});
