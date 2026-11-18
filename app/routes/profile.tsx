import { ProfilePage } from "@activescott/auth-adapter-react-router/profile";
import { Link, useRevalidator } from "react-router";
import { profileAuthLoader, requireAuth } from "../auth.server";
import { passkeys } from "../passkey.client";
import { CONTROL_BORDER } from "../controls";
import type { Route } from "./+types/profile";

export function meta() {
  return [{ title: "Profile · Four in a Row" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireAuth(request);
  return {
    email: user.email,
    memberSince: user.createdAt,
    ...(await profileAuthLoader(user.id, request)),
  };
}

// The library's default look follows the device's dark mode. Naming these two
// slots replaces it, so the page stays light like the rest of the app.
//
// The other slots named here replace the library's inline styles, which use
// system greys (3.95:1) and 24px buttons. Each sign-in method is a stacked
// card: the column is at most 28rem, too narrow for a four-column table.
const BUTTON = `inline-block min-h-11 cursor-pointer rounded-lg border ${CONTROL_BORDER} bg-white px-4 text-base text-slate-900`;
const STACKED = [
  "block w-full",
  "[&_thead]:sr-only",
  "[&_button]:w-full",
  "[&_tbody]:block",
  "[&_tr]:mb-3 [&_tr]:flex [&_tr]:flex-col [&_tr]:gap-1",
  "[&_tr]:rounded-lg [&_tr]:border [&_tr]:border-slate-300 [&_tr]:p-3",
  "[&_td:nth-child(3)]:before:content-['Added_']",
].join(" ");
const LIGHT = {
  container: "text-slate-900 [color-scheme:light]",
  card: "mb-4 rounded-lg border border-slate-300 bg-white",
  table: STACKED,
  td: "break-words",
  removeButton: `${BUTTON} mt-2`,
  addButton: BUTTON,
  definitionTerm: "text-slate-600",
  description: "mb-3 text-slate-600",
  itemDetail: "text-xs text-slate-600",
  muted: "text-slate-600",
  helpText: "mt-1 text-xs text-slate-600",
};

export default function Profile({ loaderData }: Route.ComponentProps) {
  const revalidator = useRevalidator();
  return (
    <main className="mx-auto flex max-w-md flex-col gap-2 p-4">
      <nav>
        <Link
          to="/games"
          className="-mx-3 inline-flex min-h-11 items-center gap-1.5 px-3 text-base font-medium text-blue-800 underline"
        >
          <span aria-hidden="true">←</span> Your games
        </Link>
      </nav>
      <ProfilePage
        {...loaderData}
        passkeyClient={passkeys}
        onPasskeyRegistered={revalidator.revalidate}
        allowRemove
        linkComponent={Link}
        classNames={LIGHT}
      />
    </main>
  );
}
