import { afterEach, expect, test } from "vitest";
import { renderToString } from "react-dom/server";
import { AwardsCard, date, type DisplayAward } from "./profile-record";

const zone = process.env.TZ;
afterEach(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

const earnedAt = "2026-01-02T03:00:00.000Z";
const award: DisplayAward = {
  id: "first-win",
  name: "First win",
  howTo: "Win a game",
  earned: true,
  earnedAt,
  progress: null,
};

test.each([
  ["America/Los_Angeles", "1 Jan 2026"],
  ["UTC", "2 Jan 2026"],
])("formats award dates in the viewer's zone, %s", (timeZone, expected) => {
  process.env.TZ = timeZone;
  expect(date(earnedAt)).toBe(expected);
});

test("renders award dates without text on the server", () => {
  expect(renderToString(<AwardsCard awards={[award]} />)).toContain(
    `<time dateTime="${earnedAt}"></time>`,
  );
});
