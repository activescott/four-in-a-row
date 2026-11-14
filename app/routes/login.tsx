import { FORM_TOKEN_FIELD } from "@activescott/auth";
import {
  usePasskeySignIn,
  usePreservedInput,
} from "@activescott/auth-adapter-react-router/client";
import { Form, redirect } from "react-router";
import { getSession, signInLoader } from "../auth.server";
import { passkeys } from "../passkey.client";
import type { Route } from "./+types/login";

export function meta() {
  return [{ title: "Sign in · Four in a Row" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const data = await signInLoader(request);
  if (await getSession(request)) throw redirect(data.redirectTo ?? "/profile");
  return data;
}

const input = "rounded border border-slate-300 p-2";
const button =
  "rounded bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-50";

export default function Login({ loaderData }: Route.ComponentProps) {
  const { sent, error, redirectTo, formToken } = loaderData;
  const [email, setEmail, saveEmail] = usePreservedInput("login.email");
  const verifyAction = redirectTo
    ? `/auth/email/verify?redirectTo=${encodeURIComponent(redirectTo)}`
    : "/auth/email/verify";

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold text-slate-900">Sign in</h1>

      {/* Posts straight to the email provider, which sends the link and code
          and redirects back here with ?sent=1. */}
      <Form
        method="post"
        action="/auth/email/initiate"
        reloadDocument
        onSubmit={saveEmail}
        className="flex flex-col gap-3"
      >
        <input type="hidden" name={FORM_TOKEN_FIELD} value={formToken} />
        {redirectTo && (
          <input type="hidden" name="redirectTo" value={redirectTo} />
        )}
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username webauthn"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={input}
        />
        <button type="submit" className={button}>
          {sent ? "Send again" : "Email me a sign-in link"}
        </button>
      </Form>

      {sent && (
        <Form
          method="post"
          action={verifyAction}
          reloadDocument
          className="flex flex-col gap-3"
        >
          <p role="status" className="text-green-800">
            Check your email for a sign-in link and code.
          </p>
          <label htmlFor="code">Or enter the code</label>
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
            Sign in
          </button>
        </Form>
      )}

      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}

      <PasskeySignIn redirectTo={redirectTo ?? "/profile"} />
    </main>
  );
}

function PasskeySignIn({ redirectTo }: { redirectTo: string }) {
  const passkey = usePasskeySignIn({ client: passkeys, redirectTo });
  return (
    <div className="flex flex-col gap-2 border-t border-slate-200 pt-6">
      <button
        type="button"
        onClick={passkey.signIn}
        disabled={passkey.pending}
        className="rounded border border-slate-300 px-4 py-2"
      >
        Sign in with a passkey
      </button>
      <p className="text-sm text-slate-600">
        First time? Sign in by email, then add a passkey on your profile.
      </p>
      {passkey.error && (
        <p role="alert" className="text-red-700">
          {passkey.error}
        </p>
      )}
    </div>
  );
}
