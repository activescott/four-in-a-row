import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["app/**/*.test.{ts,tsx}"],
    // Obviously fake values: no test talks to a real SMTP server, and these
    // secrets sign nothing outside a test run.
    env: {
      JWT_SECRET: "test-only-jwt-secret-not-a-real-secret",
      PASSKEY_CHALLENGE_SECRET: "test-only-passkey-secret-not-a-real-secret",
      SMTP_HOST: "smtp.invalid",
      SMTP_PORT: "587",
      SMTP_USER: "test-user",
      SMTP_PASS: "test-only-not-a-password",
      FROM_EMAIL: "noreply@example.com",
      SIGNUP_EMAILS: "seed@example.com",
      E2E_TEST_MODE: "true",
      E2E_CAPTURE_SECRET: "test-only-e2e-capture-secret",
    },
  },
});
