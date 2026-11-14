import { data, Form, Link, redirect } from "react-router";
import { requireAuth } from "../auth.server";
import { getDb } from "../db.server";
import { createRematch, listGames } from "../game/games.server";
import type { Route } from "./+types/games";

export function meta() {
  return [{ title: "Your games · Four in a Row" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireAuth(request);
  return { games: await listGames(await getDb(), user.id) };
}

// POST /games with rematchOf=<finished game id>. Creating a game by invite
// is #14.
export async function action({ request }: Route.ActionArgs) {
  const user = await requireAuth(request);
  const form = await request.formData();
  const rematchOf = String(form.get("rematchOf") ?? "");
  const result = await createRematch(await getDb(), rematchOf, user.id);
  if (result.ok) return redirect(`/games/${result.gameId}`);
  if (result.status === 404) throw new Response("Not found", { status: 404 });
  return data(
    { error: "That game hasn't finished yet." },
    { status: result.status },
  );
}

type Game = Route.ComponentProps["loaderData"]["games"][number];

function summary(game: Game) {
  if (game.result === "won") return "You won";
  if (game.result === "lost") return "You lost";
  if (game.result === "draw") return "Draw";
  if (game.yourTurn) return "Your turn";
  if (!game.opponent) return "Waiting for your opponent to join";
  return "Their turn";
}

export default function Games({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { games } = loaderData;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Your games</h1>
        <Link to="/profile" className="text-slate-700 underline">
          Profile
        </Link>
      </header>

      {actionData?.error && (
        <p role="alert" className="text-red-700">
          {actionData.error}
        </p>
      )}

      {games.length === 0 ? (
        <p className="text-slate-700">No games yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {games.map((game) => (
            <li
              key={game.id}
              className="flex items-center justify-between gap-3 rounded border border-slate-300 bg-white p-3"
            >
              <Link to={`/games/${game.id}`} className="min-w-0 flex-1">
                <span className="block truncate text-slate-900">
                  {game.opponent ?? "Invited player"}
                </span>
                <span
                  className={
                    game.yourTurn
                      ? "font-semibold text-green-800"
                      : "text-slate-600"
                  }
                >
                  {summary(game)}
                </span>
              </Link>
              {game.result && (
                <Form method="post">
                  <input type="hidden" name="rematchOf" value={game.id} />
                  <button
                    type="submit"
                    className="rounded bg-slate-900 px-3 py-2 text-white"
                  >
                    Rematch
                  </button>
                </Form>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
