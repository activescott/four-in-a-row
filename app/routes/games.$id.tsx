import { useEffect, useRef } from "react";
import { Form, Link, useFetcher, useRevalidator } from "react-router";
import { requireAuth } from "../auth.server";
import { getDb } from "../db.server";
import {
  findGameForPlayer,
  gameState,
  invitedEmailFor,
  listGames,
  playerEmails,
  recordForGame,
} from "../game/games.server";
import { displayName, drawsLabel } from "../game/display";
import { Wrappable } from "../game/wrappable";
import { recordIsCurrent, useLiveGame } from "../game/live";
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
    // Your finished games against this opponent; null before the first.
    record: await recordForGame(db, game, user.id),
    // Everyone the user plays, so two with one name can be told apart.
    opponents: (await listGames(db, user.id)).map(
      (g) => g.opponent ?? g.invited,
    ),
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
// The last-move mark is a small filled dot, white on red and dark on yellow,
// with no ring of its own: a ring there reads as a target next to the yellow
// disc's inner ring. White on red is not mistaken for a hole (holes are dark).
const INK: Record<Player, string> = { 1: "text-white", 2: "text-slate-900" };
// An empty hole is dark, so a disc in any tint stands clear of it. WCAG
// contrast against slate-900: red-300 9.30, amber-200 14.34, red-600 3.74,
// amber-400 10.36. (Against the old white hole: 1.92, 1.24, 4.77, 1.72.)
// The hole gets a 1 px lighter edge so the seven columns read on the navy board.
// The winning ring is white outside, with a dark ring inside it: white alone
// is 1.24:1 against pale yellow, and dark alone vanishes on the holes. The
// dark ring sits between the white band (outside) and the disc fill (inside):
// slate-900 on white 17.85, on red-600 3.74, on amber-400 10.36. The ring, not
// the fill, carries the red/yellow distinction on a winning disc.
const WIN_RING = "shadow-[inset_0_0_0_4px_#fff,inset_0_0_0_7px_#0f172a]";
const HOLE = "bg-slate-900 ring-1 ring-inset ring-slate-700";
// Yellow discs, whatever their tint, get a thin inner ring so red and yellow
// differ by shape and not hue alone. amber-800 on amber-400 4.14, on amber-200
// 5.73; it is not a fill, so it stays quiet during play.
function YellowMark({ player }: { player: Player }) {
  return player === 2 ? (
    <span
      data-yellow-mark
      aria-hidden="true"
      className="absolute size-3/5 rounded-full border-2 border-amber-800"
    />
  ) : null;
}
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
  const { emails, opponents, record } = loaderData;
  const { game, ended } = useLiveGame(loaderData.game);
  const fetcher = useFetcher<typeof moveAction>();
  const opponent: Player = game.you === 1 ? 2 : 1;
  // Until the invitee joins, the inviter sees whom the invite went to.
  const invitedEmail =
    game.status === "INVITED" ? loaderData.invitedEmail : null;
  const opponentName =
    !emails[opponent] && invitedEmail
      ? `${displayName(invitedEmail, opponents)} (invited)`
      : displayName(emails[opponent], opponents);
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
  // The poll saw the game finish: reload once for the record that includes it.
  const recordStale = !recordIsCurrent(game, loaderData.game);
  const recordFor = useRef<string | null>(null);
  useEffect(() => {
    if (!recordStale || recordFor.current === game.id) return;
    recordFor.current = game.id;
    void revalidate();
  }, [recordStale, game.id, revalidate]);
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
          className={`relative flex size-6 shrink-0 items-center justify-center rounded-full ${DISC[game.you]}`}
          aria-hidden="true"
        >
          <YellowMark player={game.you} />
        </span>
        Your turn.
      </>
    );
  } else if (!emails[opponent]) status = "Waiting for your opponent to join.";
  else {
    status = (
      <>
        <span
          className={`relative flex size-6 shrink-0 items-center justify-center rounded-full ${DISC[opponent]}`}
          aria-hidden="true"
        >
          <YellowMark player={opponent} />
        </span>
        <span className="min-w-0 break-words">
          <Wrappable text={`${opponentName}'s turn.`} />
        </span>
      </>
    );
  }

  // The loser's discs are tinted on the board, so their swatch is too.
  const loser: Player | null =
    game.result === "won" ? opponent : game.result === "lost" ? game.you : null;
  const legend = (seat: Player, label: string) => (
    <p
      className={`flex items-center gap-2 ${mover === seat ? "font-semibold" : ""}`}
    >
      <span
        className={`relative flex size-5 shrink-0 items-center justify-center rounded-full border border-slate-500 sm:size-6 ${
          seat === loser ? DISC_DIM[seat] : DISC[seat]
        } ${mover === seat ? "ring-2 ring-slate-900 ring-offset-2" : ""}`}
      >
        <YellowMark player={seat} />
      </span>
      <span className="min-w-0 truncate" title={label}>
        {label}
      </span>
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

      {record && !recordStale && (
        <p data-record className="-mt-2 text-xl font-semibold text-slate-900">
          You {record.won} · <Wrappable text={opponentName} /> {record.lost}
          {record.drawn > 0 && ` · ${drawsLabel(record.drawn)}`}
        </p>
      )}

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

      <div className="flex flex-col gap-1 text-slate-800 sm:gap-y-1.5">
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
            {`${last.player === game.you ? "You" : displayName(emails[last.player], opponents)} played column ${last.column + 1}.`}
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
                const ring = isWin && cell ? ` ${WIN_RING}` : "";
                return (
                  <span
                    key={row}
                    data-win-ring={isWin && cell ? "" : undefined}
                    className={`relative flex aspect-square w-full items-center justify-center rounded-full ${
                      cell ? (dim ? DISC_DIM[cell] : DISC[cell]) : HOLE
                    }${ring}`}
                  >
                    {cell && <YellowMark player={cell} />}
                    {cell && isWin && <Star className={INK[cell]} />}
                    {cell && isLast && !isWin && (
                      <span
                        data-last-move
                        aria-hidden="true"
                        className={`size-3 rounded-full bg-current ${INK[cell]}`}
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
