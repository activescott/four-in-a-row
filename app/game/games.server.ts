import type { PrismaClient } from "../generated/prisma/client";
import { applyMove, boardFromMoves, outcome, type Player } from "./rules";

export type MoveInput = {
  gameId: string;
  userId: string;
  column: number;
  expectedMoveCount: number;
};

export type MoveFailure = { status: 404 | 409 | 422; error: string };
export type MoveOutcome = { ok: true } | ({ ok: false } & MoveFailure);

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
    return { ok: true };
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
    nextPlayerId: game.nextPlayerId,
    yourTurn: game.nextPlayerId === userId,
    winnerId: game.winnerId,
    result: resultFor(game, userId),
    winningCells: result?.status === "win" ? result.cells : [],
  };
}

export type GameState = ReturnType<typeof gameState>;

export type GameResult = "won" | "lost" | "draw" | null;

function resultFor(
  game: { status: string; winnerId: string | null },
  userId: string,
): GameResult {
  if (game.status === "WON") return game.winnerId === userId ? "won" : "lost";
  if (game.status === "DRAW") return "draw";
  return null;
}

/** The user's games, newest first, with the opponent's email. */
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
  return games.map((game) => {
    const opponentId =
      game.playerOneId === userId ? game.playerTwoId : game.playerOneId;
    return {
      id: game.id,
      status: game.status,
      opponent: opponentId ? (emails.get(opponentId) ?? null) : null,
      yourTurn: game.nextPlayerId === userId,
      result: resultFor(game, userId),
    };
  });
}

export type RematchOutcome =
  { ok: true; gameId: string } | { ok: false; status: 404 | 409 };

/**
 * Starts a rematch of a finished game, or returns the one already started,
 * so both players pressing Rematch land in the same game. The player who
 * moved second moves first.
 */
export async function createRematch(
  db: PrismaClient,
  gameId: string,
  userId: string,
): Promise<RematchOutcome> {
  return db.$transaction(async (tx) => {
    // Serialises two Rematch presses on the same game.
    await tx.$executeRaw`SELECT 1 FROM games WHERE id = ${gameId} FOR UPDATE`;
    const game = await tx.game.findUnique({ where: { id: gameId } });
    if (!game || !isPlayer(game, userId)) return { ok: false, status: 404 };
    if (resultFor(game, userId) === null || !game.playerTwoId) {
      return { ok: false, status: 409 };
    }
    const existing = await tx.game.findFirst({
      where: { rematchOfId: gameId },
    });
    if (existing) return { ok: true, gameId: existing.id };
    const created = await tx.game.create({
      data: {
        playerOneId: game.playerTwoId,
        playerTwoId: game.playerOneId,
        status: "ACTIVE",
        nextPlayerId: game.playerTwoId,
        rematchOfId: gameId,
      },
    });
    return { ok: true, gameId: created.id };
  });
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
