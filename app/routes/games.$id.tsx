import { useEffect, useRef } from "react";
import { Form, Link, useFetcher, useRevalidator } from "react-router";
import { requireAuth } from "../auth.server";
import { getDb } from "../db.server";
import {
  findGameForPlayer,
  gameState,
  invitedEmailFor,
  playerEmails,
} from "../game/games.server";
import { displayName } from "../game/display";
import { useLiveGame } from "../game/live";
import { COLUMNS, ROWS, type Player } from "../game/rules";
import type { Route } from "./+types/games.$id";
import type { action as moveAction } from "./games.$id.moves";

export function meta() {
  return [{ title: "Four in a Row" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireAuth(request);
  const db = await getDb();
  const game = await findGameForPlayer(db, params.id, user.id);
  if (!game) throw new Response("Not found", { status: 404 });
  return {
    game: gameState(game, user.id),
    emails: await playerEmails(db, game),
    invitedEmail: await invitedEmailFor(db, game, user.id),
  };
}

// Reload the board after every move, refused ones included, so a stale tab
// catches up.
export function shouldRevalidate() {
  return true;
}

const DISC: Record<Player, string> = { 1: "bg-red-600", 2: "bg-amber-400" };
// Game over: discs outside the winning four get a lighter tint of their own
// colour. Fading with opacity over the navy board turns yellow brown and red
// nearly invisible.
const DISC_DIM: Record<Player, string> = {
  1: "bg-red-300",
  2: "bg-amber-200",
};
// Marks drawn on a disc: dark on yellow, white on red, so both stay legible.
// The last-move mark is a ring, not a filled dot: a dark dot on red reads as
// a hole, now that the empty holes are dark.
const INK: Record<Player, string> = { 1: "text-white", 2: "text-slate-900" };
// An empty hole is dark, so a disc in any tint stands clear of it. WCAG
// contrast against slate-900: red-300 9.30, amber-200 14.34, red-600 3.74,
// amber-400 10.36. (Against the old white hole: 1.92, 1.24, 4.77, 1.72.)
// The hole gets a 1 px lighter edge so the seven columns read on the navy board.
// The winning ring is white on both colours: a dark ring vanishes on the holes.
const HOLE = "bg-slate-900 ring-1 ring-inset ring-slate-700";
const COLOUR: Record<Player, string> = { 1: "red", 2: "yellow" };

const ERRORS: Record<string, string> = {
  not_your_turn: "It's not your turn.",
  stale: "The board changed. Here is the latest.",
  game_over: "This game has finished.",
  column_full: "That column is full.",
  column_out_of_range: "Pick one of the seven columns.",
};

function Check() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="mt-0.5 size-6 shrink-0 fill-none stroke-current stroke-[3] text-green-700"
    >
      <path
        d="M4 12.5l5 5L20 6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Star({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`size-5 fill-current ${className}`}
    >
      <path d="M12 2l3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 18l-6.4 3.6L7 14.5l-5.3-5 7.2-.9z" />
    </svg>
  );
}

export default function Board({ loaderData }: Route.ComponentProps) {
  const { emails } = loaderData;
  const { game, ended } = useLiveGame(loaderData.game);
  const fetcher = useFetcher<typeof moveAction>();
  const opponent: Player = game.you === 1 ? 2 : 1;
  // Until the invitee joins, the inviter sees whom the invite went to.
  const invitedEmail =
    game.status === "INVITED" ? loaderData.invitedEmail : null;
  const opponentName =
    !emails[opponent] && invitedEmail
      ? `${displayName(invitedEmail)} (invited)`
      : displayName(emails[opponent]);
  // The poll saw the invitee join: reload once for their name.
  const { revalidate } = useRevalidator();
  const joined = game.status !== "INVITED" && !emails[opponent];
  const reloadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!joined || reloadedFor.current === game.id) return;
    reloadedFor.current = game.id;
    void revalidate();
  }, [joined, game.id, revalidate]);
  const finished = game.result !== null;
  const canMove = game.yourTurn && fetcher.state === "idle";
  const winning = new Set(game.winningCells.map((c) => `${c.row}:${c.column}`));
  const last = game.lastMove;
  const error = fetcher.state === "idle" ? fetcher.data?.error : null;
  const waiting = !finished && !game.yourTurn && !!emails[opponent];
  const mover: Player | null = finished
    ? null
    : game.yourTurn
      ? game.you
      : waiting
        ? opponent
        : null;

  let status: React.ReactNode;
  if (game.result === "won") status = "You won!";
  else if (game.result === "lost") status = "You lost.";
  else if (game.result === "draw") status = "Draw.";
  else if (game.yourTurn) {
    status = (
      <>
        <span
          className={`size-6 shrink-0 rounded-full ${DISC[game.you]}`}
          aria-hidden="true"
        />
        Your turn.
      </>
    );
  } else if (!emails[opponent]) status = "Waiting for your opponent to join.";
  else {
    status = (
      <>
        <span
          className={`size-6 shrink-0 rounded-full ${DISC[opponent]}`}
          aria-hidden="true"
        />
        {opponentName}&apos;s turn.
      </>
    );
  }

  const legend = (seat: Player, label: string) => (
    <p
      className={`flex items-center gap-2 ${mover === seat ? "font-semibold" : ""}`}
    >
      <span
        className={`inline-block size-4 shrink-0 rounded-full ${DISC[seat]} ${
          mover === seat ? "ring-2 ring-slate-900 ring-offset-2" : ""
        }`}
      />
      <span className="min-w-0 truncate">{label}</span>
    </p>
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-4 p-4">
      <nav>
        <Link
          to="/games"
          className="-mx-3 inline-flex min-h-11 items-center px-3 text-sm text-slate-700 underline"
        >
          Your games
        </Link>
      </nav>
      <h1 className="-mt-2 text-2xl font-bold text-slate-900">Four in a Row</h1>

      {invitedEmail && (
        <p
          role="status"
          className="flex items-start gap-2 text-lg text-slate-800"
        >
          <Check />
          <span>
            We emailed an invite to <strong>{invitedEmail}</strong>.
            {game.yourTurn && game.moveCount === 0
              ? " You can play your first move now."
              : ""}
          </span>
        </p>
      )}

      <div className="flex flex-col gap-1 text-slate-800">
        {legend(game.you, `You are ${COLOUR[game.you]}`)}
        {legend(opponent, opponentName)}
      </div>

      <div>
        <p
          role="status"
          className={`flex items-center gap-2 text-xl ${
            waiting ? "text-slate-700" : "font-semibold text-slate-900"
          }`}
        >
          {status}
        </p>
        {last && (
          <p className="mt-1 text-base text-slate-700">
            {`${last.player === game.you ? "You" : displayName(emails[last.player])} played column ${last.column + 1}.`}
          </p>
        )}
      </div>

      <fetcher.Form
        method="post"
        action={`/games/${game.id}/moves`}
        className="grid grid-cols-7 gap-1 rounded-lg bg-blue-950 p-1.5"
      >
        <input type="hidden" name="expectedMoveCount" value={game.moveCount} />
        {Array.from({ length: COLUMNS }, (_, column) => {
          const full = game.board[ROWS - 1]![column] !== null;
          return (
            <button
              key={column}
              type="submit"
              name="column"
              value={column}
              disabled={!canMove || full}
              aria-label={`Drop a disc in column ${column + 1}`}
              className="flex flex-col-reverse gap-1 rounded enabled:active:bg-blue-900"
            >
              {Array.from({ length: ROWS }, (_, row) => {
                const cell = game.board[row]![column];
                const isWin = winning.has(`${row}:${column}`);
                const isLast = last?.row === row && last.column === column;
                const dim = game.winningCells.length > 0 && !isWin;
                const ring =
                  isWin && cell ? " ring-4 ring-inset ring-white" : "";
                return (
                  <span
                    key={row}
                    className={`flex aspect-square w-full items-center justify-center rounded-full ${
                      cell ? (dim ? DISC_DIM[cell] : DISC[cell]) : HOLE
                    }${ring}`}
                  >
                    {cell && isWin && <Star className={INK[cell]} />}
                    {cell && isLast && !isWin && (
                      <span
                        data-last-move
                        aria-hidden="true"
                        className={`size-4 rounded-full border-[3px] border-current ${INK[cell]}`}
                      />
                    )}
                  </span>
                );
              })}
            </button>
          );
        })}
      </fetcher.Form>

      {ended && (
        <p role="alert" className="text-red-700">
          {ended === "gone" ? (
            "This game is no longer available."
          ) : (
            <>
              You&apos;ve been signed out, so the board has stopped updating.{" "}
              <Link to="/login" className="underline">
                Sign in again
              </Link>
            </>
          )}
        </p>
      )}

      {error && (
        <p role="alert" className="text-red-700">
          {ERRORS[error] ?? "That move didn't go through."}
        </p>
      )}

      {finished && (
        <Form method="post" action="/games">
          <input type="hidden" name="rematchOf" value={game.id} />
          <button
            type="submit"
            className="min-h-12 w-full rounded-lg bg-blue-700 px-4 py-3 text-lg font-semibold text-white hover:bg-blue-800"
          >
            Rematch
          </button>
        </Form>
      )}
    </main>
  );
}
