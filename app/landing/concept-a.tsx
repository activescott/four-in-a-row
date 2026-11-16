import { Board } from "./board";
import { PRIVACY, SignIn, STEPS } from "./shared";

// Direction A: warm and playful. A big board with a winning four is the hero.
const DISCS = ["bg-red-600", "bg-amber-400", "bg-red-600"];
const DISC_INK = ["text-white", "text-slate-900", "text-white"];

export function ConceptA() {
  return (
    <main className="overflow-hidden font-rounded">
      <section className="mx-auto grid max-w-6xl items-center gap-x-12 gap-y-6 px-5 pt-6 pb-10 md:grid-cols-2 md:py-16">
        <div className="relative z-10 flex flex-col gap-4 md:gap-6">
          <h1 className="text-5xl leading-none font-extrabold tracking-tight text-balance text-slate-900 md:text-7xl">
            Four in a Row
          </h1>
          <p className="text-xl leading-snug text-balance text-slate-800 md:text-2xl">
            Drop discs, line up four, win. Play with family and friends, one
            turn at a time, from any phone or laptop.
          </p>
          <div className="flex flex-col gap-2 md:max-w-xs">
            <SignIn className="shadow-[0_5px_0_0_#1e3a8a] active:translate-y-1 active:shadow-[0_1px_0_0_#1e3a8a]" />
            <p className="text-base text-slate-700">
              Nothing to install. No password: we email you a link or code.
            </p>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-md md:max-w-none">
          <div
            aria-hidden="true"
            className="absolute -top-6 -right-6 size-40 rounded-full bg-amber-200 md:size-64"
          />
          <div
            aria-hidden="true"
            className="absolute -bottom-6 -left-4 size-28 rounded-full bg-red-100 md:size-48"
          />
          <Board
            face="#1e3a8a"
            className="relative w-full -rotate-2 drop-shadow-[10px_12px_0_#172554]"
          />
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-5 py-12 md:py-16">
          <h2 className="mb-8 text-3xl font-extrabold text-slate-900 md:text-4xl">
            How it works
          </h2>
          <ol className="grid gap-5 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <li
                key={step.title}
                className="flex items-start gap-4 rounded-3xl bg-amber-50 p-5 md:flex-col md:p-6"
              >
                <span
                  className={`flex size-14 shrink-0 items-center justify-center rounded-full text-2xl font-extrabold ${DISCS[i]} ${DISC_INK[i]}`}
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
        <SignIn className="w-full shadow-[0_5px_0_0_#1e3a8a] md:w-auto" />
        <p className="max-w-md text-base text-slate-700">{PRIVACY}</p>
      </section>
    </main>
  );
}
