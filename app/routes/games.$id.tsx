import { Form, Link, useFetcher } from "react-router";
import { requireAuth } from "../auth.server";
import { getDb } from "../db.server";
import {
  findGameForPlayer,
  gameState,
  playerEmails,
} from "../game/games.server";
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
  };
}

// Reload the board after every move, refused ones included, so a stale tab
// catches up.
export function shouldRevalidate() {
  return true;
}

const DISC: Record<Player, string> = { 1: "bg-red-600", 2: "bg-amber-400" };
const COLOUR: Record<Player, string> = { 1: "red", 2: "yellow" };

const ERRORS: Record<string, string> = {
  not_your_turn: "It's not your turn.",
  stale: "The board changed. Here is the latest.",
  game_over: "This game has finished.",
  column_full: "That column is full.",
  column_out_of_range: "Pick one of the seven columns.",
};

export default function Board({ loaderData }: Route.ComponentProps) {
  const { game, emails } = loaderData;
  const fetcher = useFetcher<typeof moveAction>();
  const opponent: Player = game.you === 1 ? 2 : 1;
  const finished = game.result !== null;
  const canMove = game.yourTurn && fetcher.state === "idle";
  const winning = new Set(game.winningCells.map((c) => `${c.row}:${c.column}`));
  const error = fetcher.state === "idle" ? fetcher.data?.error : null;

  let status: string;
  if (game.result === "won") status = "You won!";
  else if (game.result === "lost") status = "You lost.";
  else if (game.result === "draw") status = "Draw.";
  else if (game.yourTurn) status = "Your turn.";
  else if (!emails[opponent]) status = "Waiting for your opponent to join.";
  else status = "Their turn.";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between">
        <Link to="/games" className="text-slate-700 underline">
          Your games
        </Link>
        <h1 className="text-lg font-bold text-slate-900">Four in a Row</h1>
      </header>

      <div className="flex flex-col gap-1 text-slate-800">
        <p className="flex items-center gap-2">
          <span
            className={`inline-block size-4 rounded-full ${DISC[game.you]}`}
          />
          You are {COLOUR[game.you]}
        </p>
        <p className="flex items-center gap-2 truncate">
          <span
            className={`inline-block size-4 shrink-0 rounded-full ${DISC[opponent]}`}
          />
          {emails[opponent] ?? "Invited player"}
        </p>
      </div>

      <p role="status" className="text-xl font-semibold text-slate-900">
        {status}
      </p>

      <fetcher.Form
        method="post"
        action={`/games/${game.id}/moves`}
        className="grid grid-cols-7 gap-1 rounded-lg bg-blue-700 p-1.5"
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
              className="flex flex-col-reverse gap-1 rounded enabled:active:bg-blue-600"
            >
              {Array.from({ length: ROWS }, (_, row) => {
                const cell = game.board[row]![column];
                const ring = winning.has(`${row}:${column}`)
                  ? " ring-4 ring-white"
                  : "";
                return (
                  <span
                    key={row}
                    className={`block aspect-square w-full rounded-full ${
                      cell ? DISC[cell] : "bg-white"
                    }${ring}`}
                  />
                );
              })}
            </button>
          );
        })}
      </fetcher.Form>

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
            className="w-full rounded bg-slate-900 px-4 py-3 font-medium text-white"
          >
            Rematch
          </button>
        </Form>
      )}
    </main>
  );
}
