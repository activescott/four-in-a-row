import { ProfilePage } from "@activescott/auth-adapter-react-router/profile";
import { Link, useRevalidator } from "react-router";
import { profileAuthLoader, requireAuth } from "../auth.server";
import { passkeys } from "../passkey.client";
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
const LIGHT = {
  container: "text-slate-900 [color-scheme:light]",
  card: "mb-4 rounded-lg border border-slate-300 bg-white",
};

export default function Profile({ loaderData }: Route.ComponentProps) {
  const revalidator = useRevalidator();
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-6">
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
