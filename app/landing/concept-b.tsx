import { Board } from "./board";
import { PRIVACY, SignIn, STEPS } from "./shared";

// Direction B: calm and editorial. Serif type, hairline rules, and a small
// board where the last disc drops in once (not at all under
// prefers-reduced-motion).
export function ConceptB() {
  return (
    <main className="font-editorial">
      <section className="mx-auto grid max-w-5xl items-center gap-x-16 gap-y-8 px-6 pt-8 pb-12 md:grid-cols-[1.2fr_1fr] md:py-24">
        <div className="flex flex-col gap-5">
          <p className="font-sans text-sm font-semibold tracking-[0.18em] text-slate-700 uppercase">
            A game for two
          </p>
          <h1 className="text-[2.6rem] leading-[1.05] font-medium tracking-tight text-balance text-slate-900 md:text-7xl">
            Four in a Row, at your own pace.
          </h1>
          <p className="text-xl leading-relaxed text-pretty text-slate-800 md:text-2xl">
            Drop four discs in a line before your opponent does. Play family or
            a friend from any phone or laptop. Nothing to install, no password.
          </p>
          <div className="flex flex-col gap-3 pt-1 font-sans md:max-w-xs">
            <SignIn className="rounded-md" />
            <p className="text-base text-slate-700">
              We’ll email you a link or a code.
            </p>
          </div>
        </div>
        <Board
          headroom={110}
          animate
          className="mx-auto w-full max-w-[17rem] md:max-w-none"
        />
      </section>

      <section className="border-t border-slate-300">
        <div className="mx-auto max-w-5xl px-6 py-12 md:py-16">
          <h2 className="font-sans text-sm font-semibold tracking-[0.18em] text-slate-700 uppercase">
            How it works
          </h2>
          <ol className="mt-8 grid gap-8 md:grid-cols-3 md:gap-12">
            {STEPS.map((step, i) => (
              <li key={step.title} className="border-t-2 border-slate-900 pt-4">
                <span className="text-4xl text-blue-800">{i + 1}</span>
                <h3 className="mt-2 text-2xl font-medium text-slate-900">
                  {step.title}
                </h3>
                <p className="mt-2 text-lg leading-relaxed text-slate-800">
                  {step.text}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="bg-blue-950 text-amber-50">
        <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-12 md:flex-row md:items-center md:justify-between md:gap-12 md:py-14">
          <div className="flex max-w-xl flex-col gap-3">
            <h2 className="text-3xl font-medium">Your move.</h2>
            <p className="font-sans text-base text-amber-50">{PRIVACY}</p>
          </div>
          <SignIn className="rounded-md bg-amber-50! text-blue-950! hover:bg-white! focus-visible:outline-amber-50! md:w-56" />
        </div>
      </section>
    </main>
  );
}
