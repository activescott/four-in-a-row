import { expect, test } from "vitest";
import { AwardsCard } from "./profile-record";

test("formats award dates in the player's time zone", () => {
  const award = {
    id: "first-win" as const,
    name: "First win",
    howTo: "Win a game",
    earned: true,
    earnedAt: "2026-01-02T03:00:00.000Z",
    progress: null,
  };
  const html = AwardsCard({ awards: [award] });
  expect(html).toBeTruthy();
  expect(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Los_Angeles",
      day: "numeric",
      month: "long",
    }).format(new Date(award.earnedAt)),
  ).toBe("1 January");
  expect(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      day: "numeric",
      month: "long",
    }).format(new Date(award.earnedAt)),
  ).toBe("2 January");
});
