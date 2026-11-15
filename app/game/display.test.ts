import { expect, test } from "vitest";
import { displayName } from "./display";

test("a name is the part of the address before the @", () => {
  expect(displayName("bob@example.com")).toBe("bob");
  expect(displayName(null)).toBe("Invited player");
});

test("two different addresses with the same local part show in full", () => {
  const opponents = ["bob@a.com", "bob@b.com", "cy@a.com"];
  expect(displayName("bob@a.com", opponents)).toBe("bob@a.com");
  expect(displayName("bob@b.com", opponents)).toBe("bob@b.com");
  expect(displayName("cy@a.com", opponents)).toBe("cy");
});

test("the same opponent in several games keeps the short name", () => {
  expect(displayName("bob@a.com", ["bob@a.com", "bob@a.com"])).toBe("bob");
});

test("the match ignores case and empty entries", () => {
  expect(displayName("bob@a.com", ["Bob@B.com", null])).toBe("bob@a.com");
  expect(displayName("bob@a.com", [null])).toBe("bob");
});
