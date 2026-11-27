import type { GameStatus } from "../generated/prisma/client";

type Game = {
  id: string;
  playerOneId: string;
  playerTwoId: string | null;
  status: GameStatus;
  winnerId: string | null;
  finishedAt: Date | null;
};

export type Award = {
  id:
    | "first-win"
    | "ten-wins"
    | "hat-trick"
    | "full-board"
    | "regular"
    | "rematch";
  name: string;
  howTo: string;
  earned: boolean;
  earnedAt: Date | null;
  progress: { have: number; need: number } | null;
};

export function awards(games: readonly Game[], userId: string): Award[] {
  let wins = 0;
  let draws = 0;
  let run = 0;
  let bestRun = 0;
  let played = 0;
  const opponents = new Map<string, number>();
  const earned = new Map<Award["id"], Date | null>();
  for (const game of games) {
    if (game.status !== "WON" && game.status !== "DRAW") continue;
    played++;
    const won = game.status === "WON" && game.winnerId === userId;
    const opponent =
      game.playerOneId === userId ? game.playerTwoId : game.playerOneId;
    if (opponent) opponents.set(opponent, (opponents.get(opponent) ?? 0) + 1);
    if (won) {
      wins++;
      run++;
      bestRun = Math.max(bestRun, run);
      if (wins === 1) earned.set("first-win", game.finishedAt);
      if (wins === 10) earned.set("ten-wins", game.finishedAt);
      if (run === 3) earned.set("hat-trick", game.finishedAt);
    } else {
      run = 0;
      if (game.status === "DRAW") {
        draws++;
        if (draws === 1) earned.set("full-board", game.finishedAt);
      }
    }
    if (played === 25) earned.set("regular", game.finishedAt);
    if ([...opponents.values()].some((count) => count === 5))
      earned.set("rematch", game.finishedAt);
  }
  const definitions: Award[] = [
    {
      id: "first-win",
      name: "First win",
      howTo: "Win a game",
      earned: false,
      earnedAt: null,
      progress: null,
    },
    {
      id: "ten-wins",
      name: "Ten wins",
      howTo: "Win 10 games",
      earned: false,
      earnedAt: null,
      progress: { have: wins, need: 10 },
    },
    {
      id: "hat-trick",
      name: "Hat trick",
      howTo: "Win 3 games in a row",
      earned: false,
      earnedAt: null,
      progress: { have: bestRun, need: 3 },
    },
    {
      id: "full-board",
      name: "Full board",
      howTo: "Draw a game",
      earned: false,
      earnedAt: null,
      progress: null,
    },
    {
      id: "regular",
      name: "Regular",
      howTo: "Finish 25 games",
      earned: false,
      earnedAt: null,
      progress: {
        have: played,
        need: 25,
      },
    },
    {
      id: "rematch",
      name: "Rematch!",
      howTo: "Play 5 games against one person",
      earned: false,
      earnedAt: null,
      progress: { have: Math.max(0, ...opponents.values()), need: 5 },
    },
  ];
  return definitions
    .map((award) => ({
      ...award,
      ...(earned.has(award.id)
        ? { earned: true, earnedAt: earned.get(award.id)! }
        : {}),
    }))
    .sort(
      (a, b) =>
        Number(b.earned) - Number(a.earned) ||
        (a.earnedAt?.getTime() ?? Infinity) -
          (b.earnedAt?.getTime() ?? Infinity),
    );
}
