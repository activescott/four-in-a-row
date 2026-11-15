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

const invitedBoard = (overrides: Partial<GameState> = {}) =>
  render("/games/:id", Board, {
    game: state({
      status: "INVITED",
      board: emptyBoard(),
      moveCount: 0,
      lastMove: null,
      ...overrides,
    }),
    emails: { 1: "alice@example.com", 2: null },
    invitedEmail: "bob@example.com",
  });

test("right after inviting, the board says who was emailed and that you can move first", () => {
  const html = invitedBoard().replace(/<!-- -->/g, "");
  expect(html).toMatch(
    /<p role="status" class="[^"]*text-lg text-slate-800[^"]*"><svg[^>]*aria-hidden="true"[^>]*>.*?<\/svg><span>We emailed an invite to <strong>bob@example.com<\/strong>\. You can play your first move now\.<\/span><\/p>/,
  );
  expect(html).toContain("bob (invited)");
  expect(html).not.toContain("Invited player");
});

test("once the inviter has moved, the board still says who was invited", () => {
  const html = invitedBoard({ yourTurn: false, moveCount: 1 }).replace(
    /<!-- -->/g,
    "",
  );
  expect(html).toContain(
    "We emailed an invite to <strong>bob@example.com</strong>.</span>",
  );
  expect(html).not.toContain("first move");
});

test("a game list row waiting on a join names the invited player", () => {
  const html = render("/games", Games, {
    games: [
      { ...row("g1", "", false), opponent: null, invited: "bob@example.com" },
    ],
  }).replace(/<!-- -->/g, "");
  expect(html).toContain("bob (invited)");
  expect(html).toContain("Waiting for your opponent to join");
  expect(html).not.toContain("Invited player");
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

test("the game list has a New game form asking who to play", () => {
  const html = render("/games", Games, { games: [] });
  expect(html).toContain(">New game</h2>");
  expect(html).toMatch(/<form[^>]*action="\/games" method="post"/);
  const input = html.match(/<input[^>]*id="invite-email"[^>]*>/)?.[0] ?? "";
  expect(input).toMatch(/type="email"/);
  expect(input).toMatch(/name="email"/);
  expect(input).toMatch(/required/);
  expect(html).toMatch(
    /<label for="invite-email"[^>]*>Who do you want to play\? Enter their email\.<\/label>/,
  );
  expect(html).toMatch(
    /<button type="submit"[^>]*class="[^"]*min-h-11[^"]*"[^>]*>Invite<\/button>/,
  );
});

const pending = {
  state: "pending",
  inviter: "alice",
  maskedEmail: "b•••@example.com",
  redirectTo: "/invite/g1",
  sent: false,
  error: null,
  formToken: "t",
};

test("the invite page explains the sign-in email and posts to itself, without the address", () => {
  const html = render("/invite/:id", Invite, pending);
  expect(html).toMatch(/alice(<!-- -->)? invited you to play Four in a Row/);
  expect(html).toMatch(
    /One more step\. We(&#x27;|')ll send a sign-in email to(<!-- -->)? <strong>b•••@example.com<\/strong> so we know it(&#x27;|')s you\. No password needed\./,
  );
  expect(html).toMatch(/<form[^>]*action="\/invite\/g1" method="post"/);
  expect(html).not.toMatch(/name="email"/);
  expect(html).toMatch(
    /<button type="submit"[^>]*>Send my sign-in email<\/button>/,
  );
});

test("after sending, the invite page says what to do with the email and labels the code", () => {
  const html = render("/invite/:id", Invite, { ...pending, sent: true });
  expect(html).toContain(
    "Open the email we just sent, “Sign in to Four in a Row”, and tap the link, or type the 6-digit code here.",
  );
  expect(html).toMatch(/<label for="code"[^>]*>6-digit code<\/label>/);
  expect(html).toMatch(
    /<input[^>]*id="code"[^>]*class="[^"]*text-2xl tracking-widest/,
  );
});

test("the passkey link on the invite page is small", () => {
  const html = render("/invite/:id", Invite, pending);
  expect(html).toMatch(
    /<a[^>]*class="[^"]*text-sm[^"]*"[^>]*>Sign in with a passkey instead<\/a>/,
  );
});

test("an expired invite page says whom to ask for a new one", () => {
  const html = render("/invite/:id", Invite, {
    state: "expired",
    inviter: "alice",
  });
  expect(html).toMatch(
    /This invite has expired\. Ask (<!-- -->)?alice(<!-- -->)? for a new one\./,
  );
});

test("a used invite opened signed out offers sign-in back to the game", () => {
  const html = render("/invite/:id", Invite, { state: "joined", gameId: "g9" });
  expect(html).toContain(
    "You&#x27;ve already joined this game. Sign in to play.",
  );
  expect(html).toMatch(
    /<a(?=[^>]*href="\/login\?redirectTo=%2Fgames%2Fg9")(?=[^>]*w-full)[^>]*>Sign in<\/a>/,
  );
});

test("the wrong-account page names both addresses and how to fix it", () => {
  const html = render("/invite/:id", Invite, {
    state: "wrong_account",
    maskedEmail: "b•••@example.com",
    signedInAs: "carol@example.com",
  });
  expect(html).toMatch(
    /This invite is for <strong>b•••@example.com<\/strong>, but you(&#x27;|')re signed in as <strong>carol@example.com<\/strong>\. Sign out, then tap the link in the email again\./,
  );
  expect(html).toMatch(/>Sign out<\/button>/);
});
