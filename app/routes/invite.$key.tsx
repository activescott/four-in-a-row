import { FORM_TOKEN_FIELD } from "@activescott/auth";
import { data, Form, Link, redirect } from "react-router";
import { optionalAuth, requireAuth, signInLoader } from "../auth.server";
import { getDb } from "../db.server";
import { displayName } from "../game/display";
import { acceptInvite, inviteByToken } from "../game/invites.server";
import type { Route } from "./+types/invite.$key";

export function meta() {
  return [{ title: "You're invited · Four in a Row" }];
}

const GAME_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Two kinds of link share this path:
// - /invite/:token is the link in the invite email. Signed out, it offers
//   the normal email sign-in for the invited address, run from this browser
//   (POST /auth/email/initiate), which comes back to /invite/:gameId.
// - /invite/:gameId accepts the invite for the signed-in user, if the
//   invite is for their address, and opens the game. Anyone else gets 404.
export async function loader({ request, params }: Route.LoaderArgs) {
  const db = await getDb();
  const key = params.key;

  if (GAME_ID.test(key)) {
    const user = await requireAuth(request);
    const result = await acceptInvite(db, {
      gameId: key,
      userId: user.id,
      userEmail: user.email,
    });
    if (result.ok) throw redirect(`/games/${result.gameId}`);
    if (result.status === 404) throw new Response("Not found", { status: 404 });
    return data({ state: result.reason }, { status: 410 });
  }

  const invite = await inviteByToken(db, key);
  if (!invite) throw new Response("Not found", { status: 404 });
  const user = await optionalAuth(request);
  if (user && invite.state !== "expired") {
    const result = await acceptInvite(db, {
      gameId: invite.gameId,
      userId: user.id,
      userEmail: user.email,
    });
    if (result.ok) throw redirect(`/games/${result.gameId}`);
    if (invite.state === "pending") {
      return data({ state: "wrong_account" as const }, { status: 404 });
    }
  }
  if (invite.state !== "pending") {
    return data({ state: invite.state }, { status: 410 });
  }

  const signIn = await signInLoader(request);
  return {
    state: "pending" as const,
    inviter: displayName(invite.inviterEmail),
    email: invite.email,
    redirectTo: `/invite/${invite.gameId}`,
    sent: signIn.sent,
    error: signIn.error,
    formToken: signIn.formToken,
  };
}

const button =
  "min-h-12 w-full rounded-lg bg-blue-700 px-4 py-3 text-lg font-semibold text-white hover:bg-blue-800";
const input = "min-h-11 rounded-lg border border-slate-400 px-3 text-lg";

const ENDED = {
  expired: "This invite has expired. Ask for a new one.",
  used: "This invite has already been used.",
  wrong_account:
    "This invite is for a different address than the one you're signed in with.",
};

export default function Invite({ loaderData }: Route.ComponentProps) {
  if (loaderData.state !== "pending") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4">
        <h1 className="text-2xl font-bold text-slate-900">Four in a Row</h1>
        <p role="alert" className="text-lg text-slate-800">
          {ENDED[loaderData.state]}
        </p>
        {loaderData.state === "wrong_account" ? (
          <Form method="post" action="/logout" reloadDocument>
            <button type="submit" className={button}>
              Sign out
            </button>
          </Form>
        ) : (
          <Link to="/" className="text-slate-700 underline">
            Go to Four in a Row
          </Link>
        )}
      </main>
    );
  }

  const { inviter, email, redirectTo, sent, error, formToken } = loaderData;
  const verifyAction = `/auth/email/verify?redirectTo=${encodeURIComponent(redirectTo)}`;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4">
      <h1 className="text-2xl font-bold text-slate-900">
        {inviter} invited you to play Four in a Row
      </h1>

      {!sent ? (
        <Form
          method="post"
          action="/auth/email/initiate"
          reloadDocument
          className="flex flex-col gap-3"
        >
          <p className="text-lg text-slate-800">
            To join, sign in as <span className="font-semibold">{email}</span>.
            We&apos;ll email you a sign-in link and code.
          </p>
          <input type="hidden" name={FORM_TOKEN_FIELD} value={formToken} />
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <button type="submit" className={button}>
            Email me a sign-in link
          </button>
        </Form>
      ) : (
        <Form
          method="post"
          action={verifyAction}
          reloadDocument
          className="flex flex-col gap-3"
        >
          <p role="status" className="text-lg text-green-800">
            Check {email} for a sign-in link and code.
          </p>
          <label htmlFor="code" className="text-slate-800">
            Or enter the code
          </label>
          <input
            id="code"
            name="code"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]*"
            required
            className={input}
          />
          <button type="submit" className={button}>
            Sign in and join
          </button>
        </Form>
      )}

      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}

      <Link
        to={`/login?redirectTo=${encodeURIComponent(redirectTo)}`}
        className="inline-flex min-h-11 items-center text-slate-700 underline"
      >
        Sign in with a passkey instead
      </Link>
    </main>
  );
}
