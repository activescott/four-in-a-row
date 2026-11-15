import { createCaptureReadbackLoader } from "@activescott/auth-adapter-react-router/testing";
import { captureEmailTransport } from "../auth.server";
import { captureMailer, type MailKind } from "../mail/mailer.server";

// The last sign-in email from the auth library, plus the last invite and
// "your turn" email from the app's mailer, for one address.
function readback(to: string) {
  const signIn = captureEmailTransport?.getCapturedEmail(to) ?? null;
  const app = Object.fromEntries(
    (["invite", "turn"] as MailKind[]).flatMap((kind) => {
      const mail = captureMailer?.last(to, kind);
      return mail ? [[kind, { subject: mail.subject, link: mail.link }]] : [];
    }),
  );
  if (!signIn && Object.keys(app).length === 0) return null;
  return { ...signIn, ...app };
}

// Test-only readback of captured email per address, for e2e tests. A bare
// 404 unless E2E_TEST_MODE=true and the x-e2e-secret header matches
// E2E_CAPTURE_SECRET. Never set E2E_TEST_MODE in production.
export const loader = createCaptureReadbackLoader({
  transports: {
    email: captureEmailTransport && { getCapturedEmail: readback },
  },
  enabled: process.env.E2E_TEST_MODE === "true",
  secret: process.env.E2E_CAPTURE_SECRET,
});
