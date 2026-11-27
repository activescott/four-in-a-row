import { afterEach, expect, test, vi } from "vitest";
import { appUrl } from "./app-url.server";

afterEach(() => {
  vi.unstubAllEnvs();
});

const request = new Request("http://localhost:3000/some/path?q=1");

test("returns APP_URL when it is set", () => {
  vi.stubEnv("APP_URL", "https://fourinarow.example");
  expect(appUrl(request)).toBe("https://fourinarow.example");
});

test("throws in production when APP_URL is unset", () => {
  vi.stubEnv("APP_URL", "");
  vi.stubEnv("NODE_ENV", "production");
  expect(() => appUrl(request)).toThrow("APP_URL must be set in production");
});

test("otherwise returns the request URL's origin", () => {
  vi.stubEnv("APP_URL", "");
  vi.stubEnv("NODE_ENV", "test");
  expect(appUrl(request)).toBe("http://localhost:3000");
});
