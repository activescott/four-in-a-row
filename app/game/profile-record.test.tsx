import { expect, test } from "vitest";
import { date } from "./profile-record";

test("formats award dates in the player's time zone", () => {
  const value = "2026-01-02T03:00:00.000Z";
  expect(date(value, "America/Los_Angeles")).toBe("1 Jan 2026");
  expect(date(value, "UTC")).toBe("2 Jan 2026");
});
