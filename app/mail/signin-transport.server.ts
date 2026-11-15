import { parseDuration } from "@activescott/auth";
import type { EmailTransport } from "@activescott/auth-provider-email";
import type { Mailer } from "./mailer.server";
import { signInEmail } from "./templates";

// The library's own default, used when the config sets no expiry; a test
// checks it against validateEmailConfig.
const DEFAULT_EXPIRY = "15m";

/** The auth library's sign-in mail, sent as the app's own through its mailer. */
export function createSignInTransport(mailer: Mailer): EmailTransport {
  return {
    sendMagicLink: (to, link, config, options) =>
      mailer.send(
        signInEmail({
          to,
          link,
          code: options?.code,
          purpose: options?.purpose,
          minutes: Math.max(
            1,
            Math.round(parseDuration(config.expiry ?? DEFAULT_EXPIRY) / 60),
          ),
        }),
      ),
  };
}
