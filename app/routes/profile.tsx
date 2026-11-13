import { ProfilePage } from "@activescott/auth-adapter-react-router/profile";
import { Form, Link, useRevalidator } from "react-router";
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
      />
      <Form method="post" action="/logout" reloadDocument>
        <button
          type="submit"
          className="rounded bg-slate-900 px-4 py-2 font-medium text-white"
        >
          Sign out
        </button>
      </Form>
    </main>
  );
}
