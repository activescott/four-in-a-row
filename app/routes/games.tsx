import { data, Form, Link, redirect, useNavigation } from "react-router";
import { requireAuth } from "../auth.server";
import { getDb } from "../db.server";
import { displayName } from "../game/display";
import { Wrappable } from "../game/wrappable";
import { appUrl } from "../app-url.server";
import { createRematch, listGames } from "../game/games.server";
import {
  createInvite,
  MAX_PENDING_INVITES,
  type InviteError,
} from "../game/invites.server";
import { mailer } from "../mail/mailer.server";
import type { Player } from "../game/rules";
import type { Route } from "./+types/games";

export function meta() {
  return [{ title: "Your games · Four in a Row" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireAuth(request);
  return { games: await listGames(await getDb(), user.id) };
}

const INVITE_ERRORS: Record<InviteError, { status: number; error: string }> = {
  invalid_email: { status: 400, error: "Enter an email address." },
  self: { status: 400, error: "That's your own address." },
  capped: {
    status: 429,
    error: `You have ${MAX_PENDING_INVITES} invites waiting. Wait until one is accepted or expires.`,
  },
  not_sent: {
    status: 502,
    error: "The invite email couldn't be sent. Try again in a minute.",
  },
};

// POST /games with email=<address> starts a game by invite (#14), or with
// rematchOf=<finished game id> a rematch.
export async function action({ request }: Route.ActionArgs) {
  const user = await requireAuth(request);
  const form = await request.formData();
  const email = form.get("email");
  if (typeof email === "string") {
    const result = await createInvite(await getDb(), mailer, {
      inviterId: user.id,
      inviterEmail: user.email,
      email,
      appUrl: appUrl(request),
    });
    if (result.ok) return redirect(`/games/${result.gameId}`);
    if (result.error === "already_invited") {
      return data(
        {
          error: `You already invited ${email.trim()}. That game is in your list.`,
          email,
        },
        { status: 409 },
      );
    }
    const { status, error } = INVITE_ERRORS[result.error];
    return data({ error, email }, { status });
  }
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

const DISC: Record<Player, string> = { 1: "bg-red-600", 2: "bg-amber-400" };

export default function Games({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { games } = loaderData;
  const opponents = games.map((game) => game.opponent ?? game.invited ?? null);
  const navigation = useNavigation();
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4">
      <nav className="flex justify-end">
        <Link
          to="/profile"
          className="-mx-3 inline-flex min-h-11 items-center px-3 text-sm text-slate-700 underline"
        >
          Profile
        </Link>
      </nav>
      <h1 className="-mt-2 text-2xl font-bold text-slate-900">Your games</h1>

      <Form
        method="post"
        className="flex flex-col gap-2 rounded-lg border border-slate-300 bg-white p-3"
      >
        <h2 className="text-lg font-semibold text-slate-900">New game</h2>
        <label htmlFor="invite-email" className="text-slate-700">
          Who do you want to play? Enter their email.
        </label>
        <div className="flex gap-2">
          <input
            id="invite-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            required
            defaultValue={
              actionData && "email" in actionData
                ? String(actionData.email)
                : ""
            }
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-400 px-3 text-lg"
          />
          <button
            type="submit"
            disabled={navigation.state === "submitting"}
            className="min-h-11 shrink-0 rounded-lg bg-blue-700 px-4 font-medium text-white hover:bg-blue-800 disabled:opacity-60"
          >
            Invite
          </button>
        </div>
        <p className="text-sm text-slate-600">
          We&apos;ll email them a link to join. You can move first.
        </p>
      </Form>

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
              className={`flex items-center justify-between gap-3 rounded-lg border border-slate-300 bg-white p-3 ${
                game.yourTurn && !game.result
                  ? "border-l-4 border-l-blue-700 pl-[9px] font-semibold"
                  : ""
              }`}
            >
              <Link
                to={`/games/${game.id}`}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-3"
              >
                <span
                  className={`size-6 shrink-0 rounded-full ${DISC[game.opponentSeat]}`}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="min-w-0 break-words text-lg text-slate-900">
                    <Wrappable
                      text={
                        !game.opponent && game.invited
                          ? `${displayName(game.invited, opponents)} (invited)`
                          : displayName(game.opponent, opponents)
                      }
                    />
                  </span>
                  <span
                    className={
                      game.yourTurn && !game.result
                        ? "text-blue-800"
                        : "font-normal text-slate-600"
                    }
                  >
                    {summary(game)}
                  </span>
                </span>
              </Link>
              {game.result && (
                <Form method="post" className="shrink-0">
                  <input type="hidden" name="rematchOf" value={game.id} />
                  <button
                    type="submit"
                    className="min-h-11 shrink-0 rounded-lg bg-blue-700 px-4 font-medium text-white hover:bg-blue-800"
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
