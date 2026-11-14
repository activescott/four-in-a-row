import { afterAll, beforeAll, expect, test } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { createLogger } from "../logger.server";
import { createPgliteDb } from "../pglite.server";
import { logCapture } from "../test/routes";
import {
  createSignupGate,
  NOT_INVITED,
  parseSignupEmails,
} from "./signup-gate.server";

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
  return { gate: createSignupGate({ db, signupEmails, logger }), capture };
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

test("parseSignupEmails splits on commas and whitespace and lowercases", () => {
  expect(
    parseSignupEmails(" One@Example.com, two@example.com\nthree@example.com "),
  ).toEqual(
    new Set(["one@example.com", "two@example.com", "three@example.com"]),
  );
  expect(parseSignupEmails(undefined)).toEqual(new Set());
});

test("allows an address that already has an account", async () => {
  await db.user.create({ data: { email: "member@example.com" } });

  expect(await gate().gate.onInitiate(attempt("member@example.com"))).toBe(
    "allow",
  );
});

test("allows an address with a pending invite, matching case-insensitively", async () => {
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
    },
  });

  expect(await gate().gate.onInitiate(attempt("invitee@example.com"))).toBe(
    "allow",
  );
});

test("refuses an address whose only invite was already accepted", async () => {
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
    },
  });

  expect(await gate().gate.onInitiate(attempt("accepted@example.com"))).toEqual(
    {
      redirect: `/login?error=${NOT_INVITED}`,
    },
  );
});

test("allows an address in SIGNUP_EMAILS", async () => {
  const { gate: seeded } = gate("seed@example.com, other@example.com");

  expect(await seeded.onInitiate(attempt("seed@example.com"))).toBe("allow");
});

test("refuses any other address and logs auth.signin.failed without the address", async () => {
  const { gate: closed, capture } = gate("seed@example.com");

  const decision = await closed.onInitiate(attempt("stranger@example.com"));

  expect(decision).toEqual({ redirect: `/login?error=${NOT_INVITED}` });
  expect(capture.events("auth.signin.failed")).toMatchObject([
    { provider: "email", reason: "not_invited" },
  ]);
  expect(JSON.stringify(capture.lines)).not.toContain("stranger@example.com");
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
