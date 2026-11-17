import type { GameStatus, PrismaClient } from "../generated/prisma/client";

/** A player's finished games against one opponent, from their side. */
export type HeadToHead = { won: number; lost: number; drawn: number };

type Finished = {
  playerOneId: string;
  playerTwoId: string | null;
  status: GameStatus;
  winnerId: string | null;
};

/**
 * The user's record against each opponent, keyed by the opponent's id. Only
 * finished games count (WON or DRAW), whichever colour the user played. An
 * opponent with no finished game has no entry.
 */
export function tally(games: readonly Finished[], userId: string) {
  const records = new Map<string, HeadToHead>();
  for (const game of games) {
    if (game.status !== "WON" && game.status !== "DRAW") continue;
    const opponentId =
      game.playerOneId === userId
        ? game.playerTwoId
        : game.playerTwoId === userId
          ? game.playerOneId
          : null;
    if (!opponentId) continue;
    const record = records.get(opponentId) ?? { won: 0, lost: 0, drawn: 0 };
    if (game.status === "DRAW") record.drawn++;
    else if (game.winnerId === userId) record.won++;
    else record.lost++;
    records.set(opponentId, record);
  }
  return records;
}

/** tally for the user's finished games in the database. Only theirs are read. */
export async function recordsFor(db: PrismaClient, userId: string) {
  const games = await db.game.findMany({
    where: {
      status: { in: ["WON", "DRAW"] },
      OR: [{ playerOneId: userId }, { playerTwoId: userId }],
    },
    select: {
      playerOneId: true,
      playerTwoId: true,
      status: true,
      winnerId: true,
    },
  });
  return tally(games, userId);
}
