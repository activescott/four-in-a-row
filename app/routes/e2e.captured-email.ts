import { createCaptureReadbackLoader } from "@activescott/auth-adapter-react-router/testing";
import { captureEmailTransport } from "../auth.server";

// Test-only readback of the last sign-in email per address, for e2e tests.
// A bare 404 unless E2E_TEST_MODE=true and the x-e2e-secret header matches
// E2E_CAPTURE_SECRET. Never set E2E_TEST_MODE in production.
export const loader = createCaptureReadbackLoader({
  transports: { email: captureEmailTransport },
  enabled: process.env.E2E_TEST_MODE === "true",
  secret: process.env.E2E_CAPTURE_SECRET,
});
