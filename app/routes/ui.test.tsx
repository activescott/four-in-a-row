import { createRoutesStub } from "react-router";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import type { GameState } from "../game/games.server";
import { emptyBoard } from "../game/rules";
import Board from "./games.$id";
import Games from "./games";
import Invite from "./invite.$key";

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
  const board = emptyBoard().map((row, r) =>
    row.map((cell, c) => (r === 0 && c === 3 ? (2 as const) : cell)),
  );
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

test("the turn heading is short and the legend uses the short name", () => {
  const html = render("/games/:id", Board, { game: state(), emails });
  expect(html).toContain("Your turn");
  expect(html).not.toContain("you are red");
  expect(html).toContain("bob");
  expect(html).not.toContain("bob@example.com");
});

test("the board names who it is waiting for and their colour", () => {
  const html = render("/games/:id", Board, {
    game: state({ yourTurn: false }),
    emails,
  });
  expect(html.replace(/<!-- -->/g, "")).toContain("Waiting for bob (yellow).");
});

test("the last-move dot is 16 pt", () => {
  const html = render("/games/:id", Board, { game: state(), emails });
  expect(html).toMatch(/aria-label="Last move"[^>]*class="size-4 /);
});

test("after a win the other discs get a lighter tint, never an opacity fade", () => {
  const board = emptyBoard().map((r) => [...r]);
  board[0]![0] = 1;
  board[0]![1] = 2;
  board[1]![1] = 2;
  const html = render("/games/:id", Board, {
    game: state({
      board,
      status: "WON",
      result: "lost",
      yourTurn: false,
      winningCells: [{ row: 1, column: 1 }],
      lastMove: null,
    }),
    emails,
  });
  expect(html).not.toContain("opacity-");
  expect(html).toContain("bg-red-300");
  expect(html).toContain("bg-amber-200");
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

test("the game list has a New game form taking the opponent's email", () => {
  const html = render("/games", Games, { games: [] });
  expect(html).toContain(">New game</h2>");
  expect(html).toMatch(/<form method="post"[^>]*>/);
  expect(html).toMatch(
    /<input[^>]*id="invite-email"[^>]*name="email"[^>]*type="email"[^>]*required/,
  );
  expect(html).toMatch(/<label for="invite-email"[^>]*>Your opponent/);
  expect(html).toMatch(
    /<button type="submit"[^>]*class="[^"]*min-h-11[^"]*"[^>]*>Invite<\/button>/,
  );
});

test("the invite page offers the invited address an email sign-in back to the game", () => {
  const html = render("/invite/:id", Invite, {
    state: "pending",
    inviter: "alice",
    email: "bob@example.com",
    redirectTo: "/invite/g1",
    sent: false,
    error: null,
    formToken: "t",
  });
  expect(html).toMatch(/alice(<!-- -->)? invited you to play Four in a Row/);
  expect(html).toMatch(
    /<form[^>]*action="\/auth\/email\/initiate" method="post"/,
  );
  expect(html).toMatch(/name="email" value="bob@example.com"/);
  expect(html).toMatch(/name="redirectTo" value="\/invite\/g1"/);
});

test("an expired invite page says so", () => {
  const html = render("/invite/:id", Invite, { state: "expired" });
  expect(html).toContain("This invite has expired");
});
