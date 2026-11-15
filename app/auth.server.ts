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
import { createSignupGate } from "./auth/signup-gate.server";
import { createUserStore } from "./auth/user-store.server";
import { getDb } from "./db.server";
import { logger } from "./logger.server";
import { fromHeader, smtp } from "./mail/mailer.server";

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

function required(name: string) {
  const value = env[name];
  if (!value) throw new Error(`${name} must be set in production`);
  return value;
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

// The library's subject is "<subject> to <appName>".
export const emailConfig = validateEmailConfig({
  smtp,
  from: fromHeader,
  template: {
    appName: "Four in a Row",
    subject: "Sign in",
  },
});

const db = await getDb();
const signup = createSignupGate({
  db,
  signupEmails: env.SIGNUP_EMAILS,
  logger,
});

// The sign-up gate decides here, not before the send, which addresses get
// mail; see createSignupGate.
const emailTransport = signup.transport(
  captureEmailTransport ??
    new NodemailerTransport(!production && !smtpConfigured),
);

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
  gate: signup.gate,
  logger: {
    warn: (message, context) =>
      logger.warn({ event: "auth.warn", ...context }, message),
  },
  abuse: {
    // Traefik appends the peer it saw to X-Forwarded-For; everything left of
    // that hop, and cf-connecting-ip, is whatever the caller sent.
    clientIp: {
      getClientIp: (request) =>
        request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
        null,
    },
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
      appUrl: production ? required("APP_URL") : undefined,
      challengeSecret: secret("PASSKEY_CHALLENGE_SECRET"),
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

// The magic link's host comes from the request (Host, or X-Forwarded-Host
// behind Traefik), so a forged one would mail out a link to another site.
// Production requires APP_URL, so there only its host is served.
export function serveAuth(request: Request) {
  const appUrl = env.APP_URL;
  if (appUrl && new URL(request.url).host !== new URL(appUrl).host) {
    return new Response("Misdirected Request", { status: 421 });
  }
  return handleAuth({ request });
}

export const { signInLoader, profileAuthLoader } = createAuthPageLoaders(auth, {
  listPasskeys,
});
