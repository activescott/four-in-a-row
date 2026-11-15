import { AuthErrors, type InitiateGate } from "@activescott/auth";
import type { EmailTransport } from "@activescott/auth-provider-email";
import type { PrismaClient } from "../generated/prisma/client";
import type { Logger } from "../logger.server";

export function parseSignupEmails(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(/[,\s]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

// Q3 in #2: only an address with an account, a pending (unused, unexpired)
// invite, or a place in SIGNUP_EMAILS is sent a sign-in email. Everyone else
// is sent nothing, but gets the same answer (#43): the gate lets every
// initiate through, and `transport` drops the email instead. A refusal would
// tell a stranger which addresses have an account or an invite.
//
// The library still stores a live code for the dropped email, so a caller
// who guesses it reaches verify, which inserts the users row before the gate
// runs. So an account counts only once `onVerified` has approved it
// (`approved_at`): it refuses any sign-in to an unapproved account whose
// address has no invite or SIGNUP_EMAILS place, and deletes the user row
// (and, by cascade, its identity). That holds whichever verify inserted the
// row, and for a row an earlier failed delete left.
export function createSignupGate({
  db,
  signupEmails,
  logger,
}: {
  db: PrismaClient;
  signupEmails: string | undefined;
  logger: Logger;
}): { gate: InitiateGate; transport(inner: EmailTransport): EmailTransport } {
  const seeded = parseSignupEmails(signupEmails);

  function pendingInvite(email: string) {
    return db.invite.findFirst({
      where: {
        email: { equals: email, mode: "insensitive" },
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
  }

  // Both lookups run for every address, so the time taken doesn't say which
  // one matched.
  async function allowed(email: string) {
    const [user, invite] = await Promise.all([
      db.user.findUnique({ where: { email }, select: { approvedAt: true } }),
      pendingInvite(email),
    ]);
    return seeded.has(email) || !!user?.approvedAt || invite !== null;
  }

  // Approves the account on its first allowed sign-in.
  async function approve(userId: string, email: string) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { approvedAt: true },
    });
    if (user?.approvedAt) return true;
    if (!seeded.has(email) && !(await pendingInvite(email))) return false;
    await db.user.update({
      where: { id: userId },
      data: { approvedAt: new Date() },
    });
    return true;
  }

  function transport(inner: EmailTransport): EmailTransport {
    return {
      async sendMagicLink(to, magicLink, config, options) {
        if (!(await allowed(to))) {
          logger.info({
            event: "auth.signin.failed",
            provider: "email",
            reason: "not_invited",
          });
          return true;
        }
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
    async onVerified({ provider, identifier, mode, user, isNewUser }) {
      // Not isNewUser: a second verify of the same code finds the row the
      // first inserted, and a failed delete leaves one behind.
      if (mode === "signin" && !(await approve(user.id, identifier))) {
        await db.user.deleteMany({ where: { id: user.id, approvedAt: null } });
        logger.info({
          event: "auth.signin.failed",
          provider,
          reason: "not_invited",
        });
        // Answered like a wrong code.
        return { error: AuthErrors.invalidCredentials() };
      }
      if (mode === "signin") {
        logger.info({
          event: "auth.signin.succeeded",
          userId: user.id,
          provider,
          isNewUser,
        });
      }
      return "allow";
    },
  };

  return { gate, transport };
}
