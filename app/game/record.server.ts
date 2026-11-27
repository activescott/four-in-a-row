import type { GameStatus, PrismaClient } from "../generated/prisma/client";
import { awards } from "./awards";
import { displayName } from "./display";

/** A player's finished games against one opponent, from their side. */
export type HeadToHead = { won: number; lost: number; drawn: number };
export type Totals = HeadToHead & { played: number };

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

export function totals(records: ReadonlyMap<string, HeadToHead>): Totals {
  const result = { played: 0, won: 0, lost: 0, drawn: 0 };
  for (const record of records.values()) {
    result.won += record.won;
    result.lost += record.lost;
    result.drawn += record.drawn;
  }
  result.played = result.won + result.lost + result.drawn;
  return result;
}

export function byOpponent(
  records: ReadonlyMap<string, HeadToHead>,
  emails: ReadonlyMap<string, string>,
  others: readonly (string | null)[],
) {
  const collator = new Intl.Collator("en", { sensitivity: "base" });
  return [...records.entries()]
    .map(([id, record]) => ({
      name: displayName(emails.get(id) ?? null, others),
      ...record,
    }))
    .sort(
      (a, b) =>
        b.won + b.lost + b.drawn - (a.won + a.lost + a.drawn) ||
        collator.compare(a.name, b.name),
    );
}

export async function profileRecord(db: PrismaClient, userId: string) {
  const games = await db.game.findMany({
    where: { OR: [{ playerOneId: userId }, { playerTwoId: userId }] },
    select: {
      id: true,
      playerOneId: true,
      playerTwoId: true,
      status: true,
      winnerId: true,
      finishedAt: true,
      invite: { select: { email: true } },
    },
    orderBy: [{ finishedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
  });
  const opponentIds = games
    .map((game) =>
      game.playerOneId === userId ? game.playerTwoId : game.playerOneId,
    )
    .filter((id): id is string => id !== null);
  const users = await db.user.findMany({ where: { id: { in: opponentIds } } });
  const emails = new Map(users.map((user) => [user.id, user.email]));
  const others = games.map((game) => {
    const email =
      game.playerOneId === userId
        ? (emails.get(game.playerTwoId ?? "") ?? game.invite?.email ?? null)
        : (emails.get(game.playerOneId) ?? null);
    return email;
  });
  const records = tally(games, userId);
  return {
    totals: totals(records),
    opponents: byOpponent(records, emails, others),
    awards: awards(games, userId),
  };
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
