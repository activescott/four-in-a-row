import { drawsLabel } from "./display";
import { Wrappable } from "./wrappable";
import { useSyncExternalStore } from "react";
import type { Award } from "./awards";
import type { Totals, HeadToHead } from "./record.server";

export type DisplayAward = Omit<Award, "earnedAt"> & {
  earnedAt: string | null;
};

const CARD = "rounded-lg border border-slate-300 bg-white p-4";
export const date = (value: Date | string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));

const progress = ({ id, progress }: DisplayAward) => {
  const { have, need } = progress!;
  if (id === "hat-trick") return `best run ${have} of ${need}`;
  if (id === "regular") return `${have} of ${need} games`;
  return `${have} of ${need}`;
};

const subscribe = () => () => {};

function LocalDate({ value }: { value: string }) {
  const formatted = useSyncExternalStore(
    subscribe,
    () => date(value),
    () => null,
  );
  return <time dateTime={value}>{formatted}</time>;
}

export function RecordCard({ totals }: { totals: Totals }) {
  return (
    <section className={CARD}>
      <h2 className="text-lg font-semibold">Your record</h2>
      {totals.played === 0 ? (
        <p>No finished games yet</p>
      ) : (
        <>
          <p>
            {totals.won} win{totals.won === 1 ? "" : "s"} out of {totals.played}{" "}
            game{totals.played === 1 ? "" : "s"}
          </p>
          <p>
            {totals.lost} lost
            {drawsLabel(totals.drawn) && ` · ${drawsLabel(totals.drawn)}`}
          </p>
        </>
      )}
    </section>
  );
}

export function OpponentsCard({
  opponents,
}: {
  opponents: (HeadToHead & { name: string })[];
}) {
  return (
    <section className={CARD}>
      <h2 className="text-lg font-semibold">Against each person</h2>
      <ul>
        {opponents.map((opponent) => (
          <li key={opponent.name}>
            You {opponent.won} · <Wrappable text={opponent.name} />{" "}
            {opponent.lost}
            {drawsLabel(opponent.drawn) && ` · ${drawsLabel(opponent.drawn)}`}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AwardsCard({ awards }: { awards: DisplayAward[] }) {
  return (
    <section className={CARD}>
      <h2 className="text-lg font-semibold">Awards</h2>
      <ul>
        {awards.map((award) => (
          <li key={award.id} className={award.earned ? "" : "text-slate-600"}>
            <span aria-hidden="true">{award.earned ? "✓" : "○"}</span>{" "}
            <span className="sr-only">
              {award.earned ? "Earned" : "Not earned yet"}
            </span>{" "}
            {award.name}{" "}
            {award.earned
              ? award.earnedAt && <LocalDate value={award.earnedAt} />
              : `${award.howTo}${award.progress ? ` · ${progress(award)}` : ""}`}
          </li>
        ))}
      </ul>
    </section>
  );
}
