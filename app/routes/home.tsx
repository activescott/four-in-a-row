import { Link, redirect } from "react-router";
import { getSession } from "../auth.server";
import { Board } from "../landing/board";
import type { Route } from "./+types/home";

export function meta() {
  return [
    { title: "Four in a Row" },
    {
      name: "description",
      content:
        "Drop discs, line up four, win. Play Four in a Row with family and friends, one turn at a time, from any phone or laptop.",
    },
  ];
}

// Same as /login: someone already signed in has nothing to do here.
export async function loader({ request }: Route.LoaderArgs) {
  if (await getSession(request)) throw redirect("/games");
  return null;
}

// Same wording as /login's note.
const PRIVACY =
  "We use your email only to sign you in and send your game emails. We never share or sell it.";

const STEPS = [
  {
    title: "Sign in",
    text: "We email you a link or a code. No password to remember.",
    disc: "bg-red-600 text-white",
  },
  {
    title: "Invite someone",
    text: "Type their email. They get a link to join, and you move first.",
    disc: "bg-amber-400 text-slate-900",
  },
  {
    title: "Take turns",
    text: "Play at your own pace. We email you when it’s your turn.",
    disc: "bg-red-600 text-white",
  },
];

function SignIn({ className = "" }: { className?: string }) {
  return (
    <Link
      to="/login"
      className={`flex min-h-14 items-center justify-center rounded-xl bg-blue-700 px-8 py-3 text-xl font-semibold text-white shadow-[0_5px_0_0_#1e3a8a] hover:bg-blue-800 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-blue-700 active:translate-y-1 active:shadow-[0_1px_0_0_#1e3a8a] ${className}`}
    >
      Sign in
    </Link>
  );
}

export default function Home() {
  return (
    <main className="font-rounded">
      <section className="mx-auto grid max-w-6xl items-center gap-x-12 gap-y-8 px-5 pt-6 pb-10 md:grid-cols-2 md:py-16">
        <div className="flex min-w-0 flex-col gap-4 md:gap-6">
          <h1 className="text-4xl leading-none font-extrabold tracking-tight text-balance text-slate-900 sm:text-5xl md:text-7xl">
            Four in a Row
          </h1>
          <p className="text-xl leading-snug text-balance text-slate-800 md:text-2xl">
            Drop discs, line up four, win. Play with family and friends, one
            turn at a time, from any phone or laptop.
          </p>
          <div className="flex flex-col gap-3 md:max-w-sm">
            <SignIn />
            <p className="text-lg font-semibold text-slate-800">
              Nothing to install. No password: we email you a link or code.
            </p>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-md px-2 pb-3 md:max-w-none">
          <div
            aria-hidden="true"
            className="absolute top-0 right-0 hidden rounded-full bg-amber-200 md:block md:size-56"
          />
          <div
            aria-hidden="true"
            className="absolute bottom-0 left-0 hidden rounded-full bg-red-100 md:block md:size-44"
          />
          <Board className="relative w-full -rotate-2 drop-shadow-[6px_8px_0_#0f172a]" />
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto grid max-w-6xl gap-6 px-5 py-12 md:grid-cols-[1fr_2fr] md:gap-12 md:py-16">
          <h2 className="text-3xl font-extrabold text-slate-900 md:text-4xl">
            How it works
          </h2>
          <ol>
            {STEPS.map((step, i) => (
              <li
                key={step.title}
                className="flex items-start gap-4 border-t-2 border-slate-900 py-5 last:border-b-2"
              >
                <span
                  className={`flex size-12 shrink-0 items-center justify-center rounded-full text-2xl font-extrabold ${step.disc}`}
                >
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-2xl font-bold text-slate-900">
                    {step.title}
                  </h3>
                  <p className="mt-1 text-lg text-slate-800">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto flex max-w-6xl flex-col items-start gap-4 px-5 py-12 md:items-center md:text-center">
        <h2 className="text-3xl font-extrabold text-slate-900 md:text-4xl">
          Ready for your move?
        </h2>
        <SignIn className="w-full md:w-auto" />
        <p className="max-w-md text-base text-slate-700">{PRIVACY}</p>
      </section>
    </main>
  );
}
