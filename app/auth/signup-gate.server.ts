import type { InitiateGate } from "@activescott/auth";
import type { EmailTransport } from "@activescott/auth-provider-email";
import type { PrismaClient } from "../generated/prisma/client";
import type { Logger } from "../logger.server";
import { reserveSend } from "../mail/send-limits.server";
import { currentClientIp } from "./client-ip.server";

// Anyone may sign up (#58), so who is sent a sign-in email is decided by the
// send limits (app/mail/send-limits.server.ts), not by an account, an invite
// or SIGNUP_EMAILS. An address over a limit is sent nothing, but gets the same
// answer (#43): the gate lets every initiate through, and `transport` drops
// the email instead. A refusal would tell a stranger which addresses have an
// account, since the account holders are the ones the IP and site-wide caps
// don't apply to.
//
// The library stores a live code for a dropped email too. A caller who guesses
// it reaches verify and creates an account for that address, which they could
// have made anyway by asking for the email; so `onVerified` approves every
// verified sign-in. `approved_at` is the time of the first one.
export function createSignupGate({
  db,
  logger,
  shouldPrune,
}: {
  db: PrismaClient;
  logger: Logger;
  /** For tests: replaces the send limits' random prune draw. */
  shouldPrune?: () => boolean;
}): { gate: InitiateGate; transport(inner: EmailTransport): EmailTransport } {
  const allowed = async (email: string) =>
    (
      await reserveSend(
        db,
        { address: email, kind: "signin", ip: currentClientIp() },
        logger,
        { shouldPrune },
      )
    ).ok;

  // Approves the account on its first verified sign-in.
  async function approve(userId: string) {
    await db.user.updateMany({
      where: { id: userId, approvedAt: null },
      data: { approvedAt: new Date() },
    });
  }

  function transport(inner: EmailTransport): EmailTransport {
    return {
      async sendMagicLink(to, magicLink, config, options) {
        if (!(await allowed(to))) return true;
        // Not awaited: waiting on the relay only for allowed addresses would
        // make them measurably slower. A failure is logged instead of shown.
        const failed = () => logger.error({ event: "email.signin.failed" });
        inner
          .sendMagicLink(to, magicLink, config, options)
          .then((sent) => sent || failed(), failed);
        return true;
      },
    };
  }

  const gate: InitiateGate = {
    onInitiate: () => "allow",
    // Runs after an email link or code verifies and before the session is
    // created. Passkey sign-ins never reach it (see the PR's library gaps).
    async onVerified({ provider, mode, user, isNewUser }) {
      if (mode === "signin") {
        await approve(user.id);
        logger.info({
          event: "auth.signin.succeeded",
          userId: user.id,
          provider,
          isNewUser,
        });
      }
      return "allow" as const;
    },
  };

  return { gate, transport };
}
