import { randomBytes } from "node:crypto";
import { Auth, InMemoryChallengeStore, type AuthUser } from "@activescott/auth";
import {
  createAuthHandlers,
  createAuthPageLoaders,
} from "@activescott/auth-adapter-react-router";
import {
  EmailProvider,
  NodemailerTransport,
  validateEmailConfig,
  type EmailTransport,
} from "@activescott/auth-provider-email";
import { CaptureEmailTransport } from "@activescott/auth-provider-email/testing";
import {
  listPasskeys,
  PasskeyProvider,
} from "@activescott/auth-provider-passkey";
import { createPrismaIdentityStore } from "@activescott/auth-store-prisma";
import { createSignupGate, NOT_INVITED } from "./auth/signup-gate.server";
import { createUserStore } from "./auth/user-store.server";
import { getDb } from "./db.server";
import { logger } from "./logger.server";

const env = process.env;
const production = env.NODE_ENV === "production";

// Production must be given its secrets. Elsewhere a missing one is replaced by
// a random value for this process, so dev needs no setup and nothing is
// committed; sessions then end when the dev server restarts.
function secret(name: string) {
  const value = env[name];
  if (value) return value;
  if (production) throw new Error(`${name} must be set in production`);
  return randomBytes(32).toString("base64url");
}

// Mail goes through SMTP_* from env. Dev without SMTP_HOST prints the link to
// the console instead. Under E2E_TEST_MODE nothing is sent: the capture
// transport records each email for /e2e/captured-email.
const e2eTestMode = env.E2E_TEST_MODE === "true";
const smtpConfigured = Boolean(env.SMTP_HOST);
const notSent: EmailTransport = { sendMagicLink: async () => true };

export const captureEmailTransport = e2eTestMode
  ? new CaptureEmailTransport(notSent)
  : null;

const emailConfig = validateEmailConfig({
  smtp: {
    host: env.SMTP_HOST ?? (production ? "" : "localhost"),
    port: Number(env.SMTP_PORT ?? 587),
    secure: env.SMTP_SECURE === "true",
    user: env.SMTP_USER ?? (production ? "" : "dev"),
    pass: env.SMTP_PASS ?? (production ? "" : "dev"),
  },
  from: env.FROM_EMAIL ?? (production ? "" : "noreply@localhost.test"),
  template: {
    appName: "Four in a Row",
    subject: "Sign in to Four in a Row",
  },
});

const emailTransport =
  captureEmailTransport ??
  new NodemailerTransport(!production && !smtpConfigured);

const db = await getDb();
const jwtSecret = secret("JWT_SECRET");

export const auth = new Auth({
  session: {
    secret: jwtSecret,
    maxAge: "30d",
    cookieName: "session",
    cookie: { secure: production, sameSite: "lax", path: "/" },
  },
  userStore: createUserStore(db),
  identityStore: createPrismaIdentityStore({
    model: db.identity,
    providerStateField: "metadata",
    // Refuse merges before anything moves; see UserStore.onMerge.
    reassignByUserId: async () => {
      throw new Error("Account merge is not supported");
    },
  }),
  // One replica for now; a database-backed store is activescott/auth#154 (G2).
  challengeStore: new InMemoryChallengeStore(),
  gate: createSignupGate({ db, signupEmails: env.SIGNUP_EMAILS, logger }),
  logger: {
    warn: (message, context) =>
      logger.warn({ event: "auth.warn", ...context }, message),
  },
  abuse: {
    onBlocked: ({ reason, providerId, rule }) =>
      logger.warn({
        event: "auth.initiate.blocked",
        reason,
        provider: providerId,
        rule,
      }),
  },
  providers: [
    new EmailProvider(emailConfig, emailTransport),
    new PasskeyProvider({
      rpName: "Four in a Row",
      // Unset in dev and tests, so rpID and origin come from each request.
      appUrl: production ? env.APP_URL : undefined,
      challengeSecret: production
        ? secret("PASSKEY_CHALLENGE_SECRET")
        : (env.PASSKEY_CHALLENGE_SECRET ?? jwtSecret),
    }),
  ],
});

export type AppUser = { id: string; email: string; createdAt: string };

function mapUser(user: AuthUser): AppUser {
  return {
    id: user.id,
    email: String(user.metadata?.email ?? ""),
    createdAt: String(user.metadata?.createdAt ?? ""),
  };
}

export const { handleAuth, getSession, requireAuth, optionalAuth, logout } =
  createAuthHandlers<AppUser>(auth, {
    successRedirect: "/profile",
    loginUrl: "/login",
    mapUser,
    // Called for every failed email verify (wrong or expired code or link).
    // The failure carries no user, and the address is never logged.
    errorRedirect: (error, request) => {
      const provider = new URL(request.url).pathname.split("/")[2];
      logger.warn({ event: "auth.signin.failed", provider, code: error.code });
      return `/login?error=${encodeURIComponent(error.code)}`;
    },
  });

export const { signInLoader, profileAuthLoader } = createAuthPageLoaders(auth, {
  listPasskeys,
  errorMessages: {
    [NOT_INVITED]:
      "That address isn't signed up for Four in a Row. Ask a player to invite you.",
  },
});
