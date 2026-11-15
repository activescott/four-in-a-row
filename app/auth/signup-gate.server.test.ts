import type {
  EmailProviderConfig,
  EmailTransport,
} from "@activescott/auth-provider-email";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { createLogger } from "../logger.server";
import { createPgliteDb } from "../pglite.server";
import { logCapture } from "../test/routes";
import { createSignupGate, parseSignupEmails } from "./signup-gate.server";

let db: PrismaClient;

beforeAll(async () => {
  db = await createPgliteDb();
});

afterAll(async () => {
  await db.$disconnect();
});

function gate(signupEmails?: string) {
  const capture = logCapture();
  const logger = createLogger(capture.destination);
  const signup = createSignupGate({ db, signupEmails, logger });
  const inner = {
    sendMagicLink: vi.fn<EmailTransport["sendMagicLink"]>(async () => true),
  };
  return {
    gate: signup.gate,
    transport: signup.transport(inner),
    inner,
    capture,
  };
}

const request = new Request("http://localhost/auth/email/initiate", {
  method: "POST",
});
const attempt = (identifier: string) => ({
  provider: "email",
  identifier,
  mode: "signin" as const,
  request,
});

const CONFIG = {} as EmailProviderConfig;
const LINK = "http://localhost/auth/email/verify?challenge=c&key=k";

// The sign-in email for this address: true for every address, and whether
// the inner transport was asked to send it.
async function signInMail(signup: ReturnType<typeof gate>, email: string) {
  const answer = await signup.transport.sendMagicLink(email, LINK, CONFIG, {
    code: "123456",
  });
  return {
    answer,
    sent: signup.inner.sendMagicLink.mock.calls.some(([to]) => to === email),
  };
}

test("parseSignupEmails splits on commas and whitespace and lowercases", () => {
  expect(
    parseSignupEmails(" One@Example.com, two@example.com\nthree@example.com "),
  ).toEqual(
    new Set(["one@example.com", "two@example.com", "three@example.com"]),
  );
  expect(parseSignupEmails(undefined)).toEqual(new Set());
});

// #43: a refused address must not get a different answer, or a stranger
// could learn which addresses have an account or an invite.
test("the gate lets every initiate through, a stranger's too", async () => {
  expect(await gate().gate.onInitiate(attempt("stranger@example.com"))).toBe(
    "allow",
  );
});

test("sends to an address that already has an account", async () => {
  await db.user.create({ data: { email: "member@example.com" } });

  expect(await signInMail(gate(), "member@example.com")).toEqual({
    answer: true,
    sent: true,
  });
});

test("sends to an address with a pending invite, matching case-insensitively", async () => {
  const inviter = await db.user.create({
    data: { email: "inviter@example.com" },
  });
  const game = await db.game.create({
    data: { playerOneId: inviter.id, status: "INVITED" },
  });
  await db.invite.create({
    data: {
      gameId: game.id,
      inviterId: inviter.id,
      email: "Invitee@Example.com",
      tokenHash: "hash-pending",
      expiresAt: new Date(Date.now() + 60_000),
    },
  });

  expect(await signInMail(gate(), "invitee@example.com")).toEqual({
    answer: true,
    sent: true,
  });
});

test("sends nothing to an address whose only invite was already accepted", async () => {
  const inviter = await db.user.create({
    data: { email: "inviter2@example.com" },
  });
  const game = await db.game.create({
    data: { playerOneId: inviter.id, status: "ACTIVE" },
  });
  await db.invite.create({
    data: {
      gameId: game.id,
      inviterId: inviter.id,
      email: "accepted@example.com",
      acceptedAt: new Date(),
      tokenHash: "hash-accepted",
      expiresAt: new Date(Date.now() + 60_000),
    },
  });

  expect(await signInMail(gate(), "accepted@example.com")).toEqual({
    answer: true,
    sent: false,
  });
});

test("sends nothing to an address whose only invite has expired", async () => {
  const inviter = await db.user.create({
    data: { email: "inviter3@example.com" },
  });
  const game = await db.game.create({
    data: { playerOneId: inviter.id, status: "INVITED" },
  });
  await db.invite.create({
    data: {
      gameId: game.id,
      inviterId: inviter.id,
      email: "expired@example.com",
      tokenHash: "hash-expired",
      expiresAt: new Date(Date.now() - 1),
    },
  });

  expect(await signInMail(gate(), "expired@example.com")).toEqual({
    answer: true,
    sent: false,
  });
});

test("sends to an address in SIGNUP_EMAILS", async () => {
  expect(
    await signInMail(
      gate("seed@example.com, other@example.com"),
      "seed@example.com",
    ),
  ).toEqual({ answer: true, sent: true });
});

test("sends nothing to any other address and logs auth.signin.failed without the address", async () => {
  const signup = gate("seed@example.com");

  expect(await signInMail(signup, "stranger@example.com")).toEqual({
    answer: true,
    sent: false,
  });
  expect(signup.capture.events("auth.signin.failed")).toMatchObject([
    { provider: "email", reason: "not_invited" },
  ]);
  expect(JSON.stringify(signup.capture.lines)).not.toContain(
    "stranger@example.com",
  );
});

test("never waits for the relay, so a send takes no longer than a refusal", async () => {
  await db.user.create({ data: { email: "slow-relay@example.com" } });
  const signup = gate();
  signup.inner.sendMagicLink.mockReturnValue(new Promise(() => {}));
  const timeout = new Promise((resolve) =>
    setTimeout(resolve, 1_000, "waited"),
  );

  const answer = await Promise.race([
    signup.transport.sendMagicLink("slow-relay@example.com", LINK, CONFIG),
    timeout,
  ]);

  expect(answer).toBe(true);
  expect(signup.inner.sendMagicLink).toHaveBeenCalledOnce();
});

test("a send that fails in the background is logged as email.signin.failed", async () => {
  await db.user.create({ data: { email: "relay-down@example.com" } });
  const signup = gate();
  signup.inner.sendMagicLink.mockResolvedValue(false);

  await signup.transport.sendMagicLink("relay-down@example.com", LINK, CONFIG);
  await vi.waitFor(() =>
    expect(signup.capture.events("email.signin.failed")).toHaveLength(1),
  );
  expect(JSON.stringify(signup.capture.lines)).not.toContain(
    "relay-down@example.com",
  );
});

test("every address costs the same lookups, whichever one would match", async () => {
  const lookups: string[] = [];
  const counting = {
    user: {
      findUnique: async () => {
        lookups.push("user");
        return null;
      },
    },
    invite: {
      findFirst: async () => {
        lookups.push("invite");
        return null;
      },
    },
  } as unknown as PrismaClient;
  const signup = createSignupGate({
    db: counting,
    signupEmails: "seed@example.com",
    logger: createLogger(logCapture().destination),
  });
  const transport = signup.transport({ sendMagicLink: async () => true });

  for (const email of ["seed@example.com", "stranger@example.com"]) {
    lookups.length = 0;
    await transport.sendMagicLink(email, LINK, CONFIG);
    expect(lookups.sort()).toEqual(["invite", "user"]);
  }
});

test("onVerified logs auth.signin.succeeded with the user id and allows the session", async () => {
  const { gate: open, capture } = gate();
  const user = { id: "user-1" };
  const identity = {
    id: "identity-1",
    userId: "user-1",
    provider: "email",
    identifier: "member@example.com",
    providerState: {},
    createdAt: new Date(),
  };

  const decision = await open.onVerified!({
    ...attempt("member@example.com"),
    user,
    identity,
    isNewUser: false,
  });

  expect(decision).toBe("allow");
  expect(capture.events("auth.signin.succeeded")).toMatchObject([
    { userId: "user-1", provider: "email", isNewUser: false },
  ]);
  expect(JSON.stringify(capture.lines)).not.toContain("member@example.com");
});

test("onVerified does not log a sign-in for a link to the signed-in account", async () => {
  const { gate: open, capture } = gate();

  await open.onVerified!({
    ...attempt("member@example.com"),
    mode: "link",
    user: { id: "user-1" },
    identity: {
      id: "identity-2",
      userId: "user-1",
      provider: "email",
      identifier: "member@example.com",
      providerState: {},
      createdAt: new Date(),
    },
    isNewUser: false,
  });

  expect(capture.events("auth.signin.succeeded")).toEqual([]);
});
