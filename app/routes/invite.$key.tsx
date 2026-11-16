import { FORM_TOKEN_FIELD } from "@activescott/auth";
import { data, Form, Link, redirect } from "react-router";
import {
  optionalAuth,
  requireAuth,
  serveAuth,
  signInLoader,
} from "../auth.server";
import { getDb } from "../db.server";
import { displayName, maskEmail } from "../game/display";
import { acceptInvite, inviteByToken } from "../game/invites.server";
import { CONTROL_BORDER } from "../controls";
import type { Route } from "./+types/invite.$key";

export function meta() {
  return [{ title: "You're invited · Four in a Row" }];
}

const GAME_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Two kinds of link share this path:
// - /invite/:token is the link in the invite email. Signed out, it offers
//   the normal email sign-in for the invited address, run from this browser
//   (see the action), which comes back to /invite/:gameId. Whoever holds the
//   link sees the address only masked.
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
    return data(
      result.reason === "expired"
        ? { state: "expired" as const, inviter: null }
        : { state: "used" as const },
      { status: 410 },
    );
  }

  const invite = await inviteByToken(db, key);
  if (!invite) throw new Response("Not found", { status: 404 });
  const inviter = invite.inviterEmail ? displayName(invite.inviterEmail) : null;
  const user = await optionalAuth(request);
  if (user && invite.state !== "expired") {
    const result = await acceptInvite(db, {
      gameId: invite.gameId,
      userId: user.id,
      userEmail: user.email,
    });
    if (result.ok) throw redirect(`/games/${result.gameId}`);
    if (invite.state === "pending") {
      return data(
        {
          state: "wrong_account" as const,
          maskedEmail: maskEmail(invite.email),
          signedInAs: user.email,
        },
        { status: 404 },
      );
    }
  }
  if (invite.state === "expired") {
    return data({ state: "expired" as const, inviter }, { status: 410 });
  }
  if (invite.state === "used") {
    // Signed out, this is most likely the invitee again, on another device.
    return data(
      user
        ? { state: "used" as const }
        : { state: "joined" as const, gameId: invite.gameId },
      { status: 410 },
    );
  }

  const signIn = await signInLoader(request);
  return {
    state: "pending" as const,
    inviter,
    maskedEmail: maskEmail(invite.email),
    redirectTo: `/invite/${invite.gameId}`,
    sent: signIn.sent,
    error: signIn.error,
    formToken: signIn.formToken,
  };
}

// "Send my sign-in email": the normal POST /auth/email/initiate, for the
// address the invite names, so the page never has to hold it. Any email
// field the form sends is ignored.
export async function action({ request, params }: Route.ActionArgs) {
  const invite = GAME_ID.test(params.key)
    ? null
    : await inviteByToken(await getDb(), params.key);
  if (!invite) throw new Response("Not found", { status: 404 });
  if (invite.state !== "pending") throw new Response("Gone", { status: 410 });

  const form = await request.formData();
  const fields = new URLSearchParams({
    email: invite.email,
    redirectTo: `/invite/${invite.gameId}`,
  });
  const formToken = form.get(FORM_TOKEN_FIELD);
  if (typeof formToken === "string") fields.set(FORM_TOKEN_FIELD, formToken);
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/x-www-form-urlencoded");
  return serveAuth(
    new Request(new URL("/auth/email/initiate", request.url), {
      method: "POST",
      headers,
      body: fields,
    }),
  );
}

const button =
  "flex min-h-12 w-full items-center justify-center rounded-lg bg-blue-700 px-4 py-3 text-lg font-semibold text-white hover:bg-blue-800";

function Ended({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4">
      <h1 className="text-2xl font-bold text-slate-900">Four in a Row</h1>
      <p role="alert" className="text-lg text-slate-800">
        {children}
      </p>
      {action ?? (
        <Link to="/" className="text-slate-700 underline">
          Go to Four in a Row
        </Link>
      )}
    </main>
  );
}

export default function Invite({ loaderData }: Route.ComponentProps) {
  switch (loaderData.state) {
    case "expired":
      return (
        <Ended>
          {`This invite has expired. Ask ${loaderData.inviter ?? "the person who invited you"} for a new one.`}
        </Ended>
      );
    case "used":
      return <Ended>This invite has already been used.</Ended>;
    case "joined":
      return (
        <Ended
          action={
            <Link
              to={`/login?redirectTo=${encodeURIComponent(`/games/${loaderData.gameId}`)}`}
              className={button}
            >
              Sign in
            </Link>
          }
        >
          You&apos;ve already joined this game. Sign in to play.
        </Ended>
      );
    case "wrong_account":
      return (
        <Ended
          action={
            <Form method="post" action="/logout" reloadDocument>
              <button type="submit" className={button}>
                Sign out
              </button>
            </Form>
          }
        >
          This invite is for <strong>{loaderData.maskedEmail}</strong>, but
          you&apos;re signed in as <strong>{loaderData.signedInAs}</strong>.
          Sign out, then tap the link in the email again.
        </Ended>
      );
  }

  const { inviter, maskedEmail, redirectTo, sent, error, formToken } =
    loaderData;
  const verifyAction = `/auth/email/verify?redirectTo=${encodeURIComponent(redirectTo)}`;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4">
      <h1 className="text-2xl font-bold text-slate-900">
        {inviter ?? "Someone"} invited you to play Four in a Row
      </h1>

      {!sent ? (
        <Form method="post" reloadDocument className="flex flex-col gap-3">
          <p className="text-lg text-slate-800">
            One more step. We&apos;ll send a sign-in email to{" "}
            <strong>{maskedEmail}</strong> so we know it&apos;s you. No password
            needed.
          </p>
          <input type="hidden" name={FORM_TOKEN_FIELD} value={formToken} />
          <button type="submit" className={button}>
            Send my sign-in email
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
            Open the email we just sent, “Sign in to Four in a Row”, and tap the
            link, or type the 6-digit code here.
          </p>
          <label htmlFor="code" className="text-slate-800">
            6-digit code
          </label>
          <input
            id="code"
            name="code"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]*"
            required
            className={`min-h-11 rounded-lg border ${CONTROL_BORDER} px-3 text-2xl tracking-widest`}
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
        className="inline-flex min-h-11 items-center text-sm text-slate-700 underline"
      >
        Sign in with a passkey instead
      </Link>
    </main>
  );
}
