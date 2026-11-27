import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AwardsCard, type DisplayAward } from "./profile-record";

test("formats award dates in the player's time zone", () => {
  const award: DisplayAward = {
    id: "first-win" as const,
    name: "First win",
    howTo: "Win a game",
    earned: true,
    earnedAt: "2026-01-02T03:00:00.000Z",
    progress: null,
  };
  const original = Intl.DateTimeFormat;
  const dateTimeFormat = function (
    this: Intl.DateTimeFormat,
    locales: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ) {
    return new original(locales, {
      ...options,
      timeZone: process.env.TEST_TIME_ZONE,
    });
  } as unknown as typeof Intl.DateTimeFormat;
  vi.stubGlobal("Intl", { ...Intl, DateTimeFormat: dateTimeFormat });

  process.env.TEST_TIME_ZONE = "America/Los_Angeles";
  expect(renderToStaticMarkup(<AwardsCard awards={[award]} />)).toContain(
    "1 Jan 2026",
  );
  process.env.TEST_TIME_ZONE = "UTC";
  expect(renderToStaticMarkup(<AwardsCard awards={[award]} />)).toContain(
    "2 Jan 2026",
  );

  vi.unstubAllGlobals();
});
