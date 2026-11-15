import { defineConfig, devices } from "@playwright/test";
import { inviterEmail } from "./e2e/players";

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

// Shared with the spec, which reads the captured links with it. Workers load
// this file too, so they see the same value.
process.env.E2E_CAPTURE_SECRET ??= "e2e-only-capture-secret";

const projects = [
  // iPhone 13: 390x844, Mobile Safari's engine.
  { name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
  { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
  { name: "desktop-firefox", use: { ...devices["Desktop Firefox"] } },
];

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.spec.mts",
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  // Live updates poll every 1.5 s; a slow CI browser gets some headroom.
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: { baseURL, trace: "retain-on-failure" },
  projects,
  // The production build, as `npm start` runs it, with mail captured. The
  // secrets are fakes and no mail leaves under E2E_TEST_MODE. Without
  // DATABASE_URL it uses an in-memory PGlite database.
  webServer: {
    command: "npm start",
    url: `${baseURL}/ops/health/readiness`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: "pipe",
    env: {
      PORT: String(PORT),
      NODE_ENV: "production",
      APP_URL: baseURL,
      JWT_SECRET: "e2e-only-jwt-secret",
      PASSKEY_CHALLENGE_SECRET: "e2e-only-passkey-secret",
      SMTP_HOST: "smtp.invalid",
      SMTP_USER: "e2e",
      SMTP_PASS: "e2e-only",
      FROM_EMAIL: "noreply@example.com",
      SIGNUP_EMAILS: projects.map((p) => inviterEmail(p.name)).join(","),
      E2E_TEST_MODE: "true",
      E2E_CAPTURE_SECRET: process.env.E2E_CAPTURE_SECRET,
    },
  },
});
