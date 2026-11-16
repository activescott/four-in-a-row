import { Link, redirect } from "react-router";
import { getSession } from "../auth.server";
import type { Route } from "./+types/home";

export function meta() {
  return [{ title: "Four in a Row" }];
}

// Same as /login: someone already signed in has nothing to do here.
export async function loader({ request }: Route.LoaderArgs) {
  if (await getSession(request)) throw redirect("/games");
  return null;
}

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-4xl font-bold text-slate-900">Four in a Row</h1>
      <p className="text-xl text-balance text-slate-700">
        Take turns with family, from any phone or laptop.
      </p>
      <Link
        to="/login"
        className="flex min-h-12 w-full items-center justify-center rounded-lg bg-blue-700 px-4 py-3 text-lg font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
      >
        Sign in
      </Link>
      <p className="-mt-3 text-sm text-slate-600">
        We'll email you a link or code. No password needed.
      </p>
    </main>
  );
}
