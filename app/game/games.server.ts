import type { PrismaClient } from "../generated/prisma/client";
import { logger } from "../logger.server";
import { applyMove, boardFromMoves, outcome, type Player } from "./rules";

export type MoveInput = {
  gameId: string;
  userId: string;
  column: number;
  expectedMoveCount: number;
};

export type MoveFailure = { status: 404 | 409 | 422; error: string };
export type MoveOutcome =
  { ok: true; moveNumber: number } | ({ ok: false } & MoveFailure);

/**
 * Plays one move in one transaction: the checks use the rules module, then
 * the move and the game's next player and result are written together.
 */
export async function makeMove(
  db: PrismaClient,
  input: MoveInput,
): Promise<MoveOutcome> {
  const { gameId, userId, column, expectedMoveCount } = input;
  return db.$transaction(async (tx) => {
    const game = await tx.game.findUnique({
      where: { id: gameId },
      include: { moves: { orderBy: { number: "asc" } } },
    });
    if (!game || !isPlayer(game, userId)) {
      return { ok: false, status: 404, error: "not_found" };
    }
    if (game.status === "WON" || game.status === "DRAW") {
      return { ok: false, status: 409, error: "game_over" };
    }
    if (game.nextPlayerId !== userId) {
      return { ok: false, status: 409, error: "not_your_turn" };
    }
    if (game.moveCount !== expectedMoveCount) {
      return { ok: false, status: 409, error: "stale" };
    }

    const replay = boardFromMoves(game.moves.map((m) => m.column));
    if (!replay.ok) throw new Error(`Game ${gameId} has an invalid move list`);
    const seat: Player = userId === game.playerOneId ? 1 : 2;
    const result = applyMove(replay.board, column, seat);
    if (!result.ok) return { ok: false, status: 422, error: result.error.type };

    const next = outcome(result.board, result.move);
    const other = seat === 1 ? game.playerTwoId : game.playerOneId;
    // Conditional on the count read above: a concurrent move that got here
    // first leaves zero rows to update. @@unique([gameId, number]) backs it up.
    const { count } = await tx.game.updateMany({
      where: { id: gameId, moveCount: game.moveCount },
      data: {
        moveCount: game.moveCount + 1,
        nextPlayerId: next.status === "ongoing" ? other : null,
        ...(next.status === "win" && {
          status: "WON",
          winnerId: userId,
          finishedAt: new Date(),
        }),
        ...(next.status === "draw" && {
          status: "DRAW",
          finishedAt: new Date(),
        }),
      },
    });
    if (count === 0) return { ok: false, status: 409, error: "stale" };
    await tx.move.create({
      data: {
        gameId,
        number: game.moveCount + 1,
        playerId: userId,
        column,
        row: result.move.row,
      },
    });
    return { ok: true, moveNumber: game.moveCount + 1 };
  });
}

/** The game with its moves, or null unless the user is one of its players. */
export async function findGameForPlayer(
  db: PrismaClient,
  gameId: string,
  userId: string,
) {
  const game = await db.game.findUnique({
    where: { id: gameId },
    include: { moves: { orderBy: { number: "asc" } } },
  });
  return game && isPlayer(game, userId) ? game : null;
}

// Presence (R6): a poll writes the caller's seenAt at most this often.
const SEEN_WRITE_INTERVAL_MS = 5_000;

/** Records that a player of this game is looking at it now. */
export async function recordSeen(
  db: PrismaClient,
  game: { id: string; playerOneId: string },
  userId: string,
) {
  const field =
    userId === game.playerOneId ? "playerOneSeenAt" : "playerTwoSeenAt";
  const now = new Date();
  const stale = new Date(now.getTime() - SEEN_WRITE_INTERVAL_MS);
  // One conditional write: a no-op while the last one is under 5 s old.
  await db.game.updateMany({
    where: {
      id: game.id,
      OR: [{ [field]: null }, { [field]: { lte: stale } }],
    },
    data: { [field]: now },
  });
}

type GameWithMoves = NonNullable<Awaited<ReturnType<typeof findGameForPlayer>>>;

/** What a player sees: the board, whose turn it is and the result. */
export function gameState(game: GameWithMoves, userId: string) {
  const replay = boardFromMoves(game.moves.map((m) => m.column));
  if (!replay.ok) throw new Error(`Game ${game.id} has an invalid move list`);
  const last = replay.lastMove;
  const result = last ? outcome(replay.board, last) : null;
  return {
    id: game.id,
    status: game.status,
    moveCount: game.moveCount,
    board: replay.board,
    you: (userId === game.playerOneId ? 1 : 2) as Player,
    yourTurn: game.nextPlayerId === userId,
    result: resultFor(game, userId),
    winningCells: result?.status === "win" ? result.cells : [],
    lastMove: last,
  };
}

export type GameState = ReturnType<typeof gameState>;

/**
 * What changed since the client's move count: "unchanged", or the moves
 * after it with the status. Null when `since` is ahead of the game.
 */
export function stateSince(game: GameWithMoves, userId: string, since: number) {
  if (since > game.moveCount) return null;
  if (since === game.moveCount) {
    return { unchanged: true as const, moveCount: game.moveCount };
  }
  const state = gameState(game, userId);
  return {
    unchanged: false as const,
    moveCount: state.moveCount,
    status: state.status,
    yourTurn: state.yourTurn,
    result: state.result,
    winningCells: state.winningCells,
    lastMove: state.lastMove,
    moves: game.moves
      .filter((m) => m.number > since)
      .map((m) => ({
        number: m.number,
        row: m.row,
        column: m.column,
        player: (m.playerId === game.playerOneId ? 1 : 2) as Player,
      })),
  };
}

export type StateUpdate = NonNullable<ReturnType<typeof stateSince>>;

export type GameResult = "won" | "lost" | "draw" | null;

function resultFor(
  game: { status: string; winnerId: string | null },
  userId: string,
): GameResult {
  if (game.status === "WON") return game.winnerId === userId ? "won" : "lost";
  if (game.status === "DRAW") return "draw";
  return null;
}

/**
 * The user's games with the opponent's email: games waiting on the user
 * first, newest first within each group.
 */
export async function listGames(db: PrismaClient, userId: string) {
  const games = await db.game.findMany({
    where: { OR: [{ playerOneId: userId }, { playerTwoId: userId }] },
    orderBy: { createdAt: "desc" },
  });
  const opponentIds = games
    .map((g) => (g.playerOneId === userId ? g.playerTwoId : g.playerOneId))
    .filter((id): id is string => id !== null);
  const users = await db.user.findMany({ where: { id: { in: opponentIds } } });
  const emails = new Map(users.map((u) => [u.id, u.email]));
  const rows = games.map((game) => {
    const opponentId =
      game.playerOneId === userId ? game.playerTwoId : game.playerOneId;
    return {
      id: game.id,
      status: game.status,
      opponentSeat: (game.playerOneId === userId ? 2 : 1) as Player,
      opponent: opponentId ? (emails.get(opponentId) ?? null) : null,
      yourTurn: game.nextPlayerId === userId,
      result: resultFor(game, userId),
    };
  });
  // Array.sort is stable, so the newest-first order holds inside each group.
  return rows.sort((a, b) => Number(b.yourTurn) - Number(a.yourTurn));
}

export type RematchOutcome =
  | { ok: true; gameId: string; created: boolean }
  | { ok: false; status: 404 | 409 };

/**
 * Starts a rematch of a finished game, or returns the one already started,
 * so both players pressing Rematch land in the same game. On an older game
 * it follows the rematch chain to the newest game. The player who moved
 * second moves first.
 */
export async function createRematch(
  db: PrismaClient,
  gameId: string,
  userId: string,
): Promise<RematchOutcome> {
  let result: RematchOutcome;
  try {
    result = await startRematch(db, gameId, userId);
  } catch (error) {
    // Another press created the rematch between our lookup and our insert,
    // and the unique index on rematch_of_id refused this one. Its
    // transaction is aborted, so look again in a new one.
    if (!isUniqueViolation(error)) throw error;
    result = await startRematch(db, gameId, userId);
  }
  if (result.ok) {
    logger.info({
      event: "game.rematch",
      gameId: result.gameId,
      rematchOfId: gameId,
      userId,
      created: result.created,
    });
  }
  return result;
}

function startRematch(
  db: PrismaClient,
  gameId: string,
  userId: string,
): Promise<RematchOutcome> {
  return db.$transaction(async (tx): Promise<RematchOutcome> => {
    // Serialises two Rematch presses on the same game. The unique index on
    // rematch_of_id backs it up.
    await tx.$executeRaw`SELECT 1 FROM games WHERE id = ${gameId} FOR UPDATE`;
    const game = await tx.game.findUnique({ where: { id: gameId } });
    if (!game || !isPlayer(game, userId)) return { ok: false, status: 404 };
    if (resultFor(game, userId) === null || !game.playerTwoId) {
      return { ok: false, status: 409 };
    }
    // Rematch on an older game in a chain rematches the newest one, or joins
    // it if it's still being played.
    let latest = game;
    for (;;) {
      const next = await tx.game.findUnique({
        where: { rematchOfId: latest.id },
      });
      if (!next) break;
      latest = next;
    }
    if (resultFor(latest, userId) === null || !latest.playerTwoId) {
      return { ok: true, gameId: latest.id, created: false };
    }
    const created = await tx.game.create({
      data: {
        playerOneId: latest.playerTwoId,
        playerTwoId: latest.playerOneId,
        status: "ACTIVE",
        nextPlayerId: latest.playerTwoId,
        rematchOfId: latest.id,
      },
    });
    return { ok: true, gameId: created.id, created: true };
  });
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

/** Both players' emails, keyed by seat. */
export async function playerEmails(
  db: PrismaClient,
  game: { playerOneId: string; playerTwoId: string | null },
) {
  const ids = [game.playerOneId, game.playerTwoId].filter(
    (id): id is string => id !== null,
  );
  const users = await db.user.findMany({ where: { id: { in: ids } } });
  const email = (id: string | null) =>
    users.find((u) => u.id === id)?.email ?? null;
  return { 1: email(game.playerOneId), 2: email(game.playerTwoId) };
}

export function isPlayer(
  game: { playerOneId: string; playerTwoId: string | null },
  userId: string,
) {
  return game.playerOneId === userId || game.playerTwoId === userId;
}
