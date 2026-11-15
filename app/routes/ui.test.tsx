import { createRoutesStub } from "react-router";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import type { GameState } from "../game/games.server";
import { emptyBoard } from "../game/rules";
import Board from "./games.$id";
import Games from "./games";

// Renders a route component the way React Router would with this loader data.
function render(path: string, Component: unknown, loaderData: unknown) {
  const Stub = createRoutesStub([
    { path, Component: Component as never, loader: () => loaderData },
  ]);
  return renderToString(
    <Stub
      initialEntries={[path.replace(":id", "g1")]}
      hydrationData={{ loaderData: { "0": loaderData } }}
    />,
  );
}

function state(overrides: Partial<GameState> = {}): GameState {
  const board = emptyBoard();
  board[0]![3] = 2;
  return {
    id: "g1",
    status: "ACTIVE",
    moveCount: 1,
    board,
    you: 1,
    yourTurn: true,
    result: null,
    winningCells: [],
    lastMove: { row: 0, column: 3, player: 2 },
    ...overrides,
  };
}

const emails = { 1: "alice@example.com", 2: "bob@example.com" };

test("the board says who played which column and marks that disc", () => {
  const html = render("/games/:id", Board, { game: state(), emails });
  expect(html).toContain("bob played column 4.");
  expect(html.match(/aria-label="Last move"/g)).toHaveLength(1);
});

test("the board names you when you made the last move", () => {
  const html = render("/games/:id", Board, {
    game: state({
      yourTurn: false,
      lastMove: { row: 0, column: 3, player: 1 },
    }),
    emails,
  });
  expect(html).toContain("You played column 4.");
});

test("a new board has no last-move line or marker", () => {
  const html = render("/games/:id", Board, {
    game: state({ board: emptyBoard(), moveCount: 0, lastMove: null }),
    emails,
  });
  expect(html).not.toContain("played column");
  expect(html).not.toContain("Last move");
});

const row = (id: string, opponent: string, yourTurn: boolean) => ({
  id,
  status: "ACTIVE",
  opponent,
  yourTurn,
  result: null,
});

test("long emails truncate and Rematch never shrinks", () => {
  const long = `${"a".repeat(80)}@example.com`;
  const html = render("/games", Games, {
    games: [{ ...row("g1", long, false), result: "won" }],
  });
  expect(html).toMatch(/class="[^"]*min-w-0[^"]*truncate[^"]*"[^>]*>a{80}/);
  expect(html).toMatch(/<button[^>]*class="[^"]*shrink-0[^"]*"[^>]*>Rematch/);
});

test("your-turn rows are highlighted", () => {
  const html = render("/games", Games, {
    games: [
      row("g1", "bob@example.com", true),
      row("g2", "cy@example.com", false),
    ],
  });
  expect(html.match(/border-l-4/g)).toHaveLength(1);
});
