import { expect, test } from "vitest";
import { tally } from "./record.server";

type G = Parameters<typeof tally>[0][number];
const me = "me";
const game = (g: Partial<G> & Pick<G, "playerOneId" | "playerTwoId">): G => ({
  status: "WON",
  winnerId: null,
  ...g,
});

test("counts wins, losses and draws against one opponent", () => {
  const records = tally(
    [
      game({ playerOneId: me, playerTwoId: "jo", winnerId: me }),
      game({ playerOneId: me, playerTwoId: "jo", winnerId: me }),
      game({ playerOneId: me, playerTwoId: "jo", winnerId: "jo" }),
      game({ playerOneId: me, playerTwoId: "jo", status: "DRAW" }),
    ],
    me,
  );
  expect(records.get("jo")).toEqual({ won: 2, lost: 1, drawn: 1 });
});

test("counts the same whether you played red (first) or yellow (second)", () => {
  const records = tally(
    [
      game({ playerOneId: me, playerTwoId: "jo", winnerId: me }),
      game({ playerOneId: "jo", playerTwoId: me, winnerId: me }),
      game({ playerOneId: "jo", playerTwoId: me, winnerId: "jo" }),
      game({ playerOneId: "jo", playerTwoId: me, status: "DRAW" }),
      game({ playerOneId: me, playerTwoId: "jo", status: "DRAW" }),
    ],
    me,
  );
  expect(records.get("jo")).toEqual({ won: 2, lost: 1, drawn: 2 });
});

test("ignores games that have not finished", () => {
  const records = tally(
    [
      game({ playerOneId: me, playerTwoId: "jo", status: "ACTIVE" }),
      game({ playerOneId: me, playerTwoId: null, status: "INVITED" }),
      game({ playerOneId: me, playerTwoId: "jo", winnerId: me }),
    ],
    me,
  );
  expect(records.get("jo")).toEqual({ won: 1, lost: 0, drawn: 0 });
  expect(records.size).toBe(1);
});

test("keeps each opponent's record apart and skips games you are not in", () => {
  const records = tally(
    [
      game({ playerOneId: me, playerTwoId: "jo", winnerId: me }),
      game({ playerOneId: "cy", playerTwoId: me, winnerId: "cy" }),
      game({ playerOneId: "jo", playerTwoId: "cy", winnerId: "jo" }),
    ],
    me,
  );
  expect(records.get("jo")).toEqual({ won: 1, lost: 0, drawn: 0 });
  expect(records.get("cy")).toEqual({ won: 0, lost: 1, drawn: 0 });
  expect(records.has(me)).toBe(false);
  expect(records.size).toBe(2);
});

test("an opponent you have no finished game with has no record", () => {
  expect(tally([], me).get("jo")).toBeUndefined();
});
