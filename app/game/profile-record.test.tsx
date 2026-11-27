import { expect, test } from "vitest";
import { renderToString } from "react-dom/server";
import { AwardsCard, date, type DisplayAward } from "./profile-record";

const earnedAt = "2026-01-02T03:00:00.000Z";
const award: DisplayAward = {
  id: "first-win",
  name: "First win",
  howTo: "Win a game",
  earned: true,
  earnedAt,
  progress: null,
};

test("formats award dates in Pacific time", () => {
  expect(date(earnedAt)).toBe("1 Jan 2026");
});

test("renders award dates on the server", () => {
  expect(renderToString(<AwardsCard awards={[award]} />)).toContain(
    `<time dateTime="${earnedAt}">1 Jan 2026</time>`,
  );
});

test.each([
  ["ten-wins", "Win 10 games", 6, 10, "6 of 10"],
  ["hat-trick", "Win 3 games in a row", 2, 3, "best run 2 of 3"],
  ["regular", "Finish 25 games", 20, 25, "20 of 25 games"],
  ["rematch", "Play 5 games against one person", 3, 5, "3 of 5"],
] as const)(
  "shows %s progress as the design words it",
  (id, howTo, have, need, text) => {
    const html = renderToString(
      <AwardsCard
        awards={[
          {
            id,
            name: id,
            howTo,
            earned: false,
            earnedAt: null,
            progress: { have, need },
          },
        ]}
      />,
    );
    expect(html.replace(/<!-- -->/g, "")).toContain(`${howTo} · ${text}<`);
  },
);
