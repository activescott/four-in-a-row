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

export function isPlayer(
  game: { playerOneId: string; playerTwoId: string | null },
  userId: string,
) {
  return game.playerOneId === userId || game.playerTwoId === userId;
}
