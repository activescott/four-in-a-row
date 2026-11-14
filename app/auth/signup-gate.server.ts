import type { InitiateGate } from "@activescott/auth";
import type { PrismaClient } from "../generated/prisma/client";
import type { Logger } from "../logger.server";

export const NOT_INVITED = "NOT_INVITED";

export function parseSignupEmails(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(/[,\s]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

// Q3 in #2: only an address with an account, a pending invite, or a place in
// SIGNUP_EMAILS is sent a sign-in email. Everyone else is sent nothing.
export function createSignupGate({
  db,
  signupEmails,
  logger,
}: {
  db: PrismaClient;
  signupEmails: string | undefined;
  logger: Logger;
}): InitiateGate {
  const seeded = parseSignupEmails(signupEmails);

  async function allowed(email: string) {
    if (seeded.has(email)) return true;
    const user = await db.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (user) return true;
    const invite = await db.invite.findFirst({
      where: {
        email: { equals: email, mode: "insensitive" },
        acceptedAt: null,
      },
      select: { id: true },
    });
    return invite !== null;
  }

  return {
    async onInitiate({ provider, identifier }) {
      if (await allowed(identifier)) return "allow";
      logger.info({
        event: "auth.signin.failed",
        provider,
        reason: "not_invited",
      });
      return { redirect: `/login?error=${NOT_INVITED}` };
    },
    // Runs after an email link or code verifies and before the session is
    // created. Passkey sign-ins never reach it (see the PR's library gaps).
    onVerified({ provider, mode, user, isNewUser }) {
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
}
