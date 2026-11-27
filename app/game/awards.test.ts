import { expect, test } from "vitest";
import { awards } from "./awards";

const userId = "me";
const date = (day: number) => new Date(`2026-11-${String(day).padStart(2, "0")}T12:00:00Z`);
const game = (day: number, result: "WON" | "DRAW", opponent = "jo") => ({
  id: `g${day}`,
  playerOneId: userId,
  playerTwoId: opponent,
  status: result,
  winnerId: result === "WON" ? userId : null,
  finishedAt: date(day),
});

test("awards the first win and ten wins once with earning dates", () => {
  const result = awards(
    Array.from({ length: 10 }, (_, i) => game(i + 1, "WON")),
    userId,
  );
  expect(result.find((award) => award.id === "first-win")).toMatchObject({
    earned: true,
    earnedAt: date(1),
  });
  expect(result.find((award) => award.id === "ten-wins")).toMatchObject({
    earned: true,
    earnedAt: date(10),
  });
});

test("awards hat trick only for three consecutive wins", () => {
  expect(
    awards(
      [game(1, "WON"), game(2, "WON"), game(3, "DRAW"), game(4, "WON"), game(5, "WON"), game(6, "WON")],
      userId,
    ).find((award) => award.id === "hat-trick"),
  ).toMatchObject({ earned: true, earnedAt: date(6) });
  expect(
    awards([game(1, "WON"), game(2, "WON"), game(3, "WON")], userId).find(
      (award) => award.id === "hat-trick",
    ),
  ).toMatchObject({ earned: true });
});

test("awards full board, regular and rematch", () => {
  const games = [game(1, "DRAW"), ...Array.from({ length: 24 }, (_, i) => game(i + 2, "WON", i < 5 ? "jo" : `p${i}`))];
  const result = awards(games, userId);
  expect(result.find((award) => award.id === "full-board")).toMatchObject({ earned: true, earnedAt: date(1) });
  expect(result.find((award) => award.id === "regular")).toMatchObject({ earned: true, earnedAt: date(25) });
  expect(result.find((award) => award.id === "rematch")).toMatchObject({ earned: true, earnedAt: date(5) });
});

test("a finished game without a date can earn an award", () => {
  expect(awards([{ ...game(1, "WON"), finishedAt: null }], userId)[0]).toMatchObject({
    earned: true,
    earnedAt: null,
  });
});
