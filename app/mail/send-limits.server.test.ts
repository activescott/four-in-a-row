import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { createLogger } from "../logger.server";
import { createPgliteDb } from "../pglite.server";
import { logCapture } from "../test/routes";
import {
  bucketKey,
  reserveSend,
  SEND_LIMITS,
  startEmailSendPruning,
} from "./send-limits.server";

let db: PrismaClient;

beforeAll(async () => {
  db = await createPgliteDb();
});

afterAll(async () => {
  await db.$disconnect();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await db.emailSend.deleteMany();
});

function logged() {
  const capture = logCapture();
  return { capture, logger: createLogger(capture.destination) };
}

const send = (
  address: string,
  ip: string | null,
  kind: "signin" | "invite" | "turn" = "signin",
) => reserveSend(db, { address, kind, ip }, logged().logger);

// Rows as if `count` sign-ins had gone out, `ageMs` ago.
async function sentBefore(
  count: number,
  { address, ip, ageMs }: { address: string; ip: string; ageMs: number },
) {
  await db.emailSend.createMany({
    data: Array.from({ length: count }, () => ({
      address,
      bucket: address,
      kind: "signin",
      ip,
      createdAt: new Date(Date.now() - ageMs),
    })),
  });
}

const THREE_HOURS = 3 * 60 * 60 * 1000;
const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;

test.each([
  ["Name@Example.com", "name@example.com"],
  ["name+1@example.com", "name@example.com"],
  ["name+a+b@example.com", "name@example.com"],
  ["name+1@gmail.com", "name@gmail.com"],
  ["n.a.m.e@gmail.com", "name@gmail.com"],
  ["N.a.M.e+news@googlemail.com", "name@googlemail.com"],
  // Dots count everywhere but Gmail.
  ["n.a.m.e@example.com", "n.a.m.e@example.com"],
  // Nothing left of the local part to key on: leave it alone.
  ["+tag@example.com", "+tag@example.com"],
])("the bucket key of %s is %s", (address, key) => {
  expect(bucketKey(address)).toBe(key);
});

test.each([
  // A quoted local part may contain "+" and "."; it is not tag-stripped.
  ['"a+b"@x.com', '"a+b"@x.com'],
  ['"A+B"@Gmail.com', '"a+b"@gmail.com'],
  ['"n.a"@gmail.com', '"n.a"@gmail.com'],
])("a quoted local part is only lowercased: %s", (address, key) => {
  expect(bucketKey(address)).toBe(key);
});

test.each([
  // NFKC folds compatibility forms (fullwidth, Kelvin sign) before lowercasing.
  ["\uFF2E\uFF21\uFF2D\uFF25@example.com", "name@example.com"],
  ["\u212Aate@example.com", "kate@example.com"],
  ["n.a.m.e@\uFF47mail.com", "name@gmail.com"],
  // One trailing dot on the domain is the same domain.
  ["n.a.m.e@gmail.com.", "name@gmail.com"],
  ["name+1@Example.com.", "name@example.com"],
])("the bucket key of %j is %s after NFKC and trailing-dot handling", (address, key) => {
  expect(bucketKey(address)).toBe(key);
});

test("name+1@gmail.com and n.a.m.e@gmail.com share one bucket with name@gmail.com", async () => {
  const variants = [
    "name+1@gmail.com",
    "name+2@gmail.com",
    "n.a.m.e@gmail.com",
    "N.Ame+x@gmail.com",
    "name@gmail.com",
  ];
  for (const [n, address] of variants.entries()) {
    expect(await send(address, `198.51.100.${n + 1}`)).toEqual({ ok: true });
  }

  expect(await send("na.me+last@gmail.com", "198.51.100.9")).toEqual({
    ok: false,
    reason: "address",
  });
  expect(await send("name@gmail.com", "198.51.100.10")).toEqual({
    ok: false,
    reason: "address",
  });
  // The same words under another domain are another inbox.
  expect(await send("name@example.com", "198.51.100.11")).toEqual({ ok: true });
});

test("the address a send is recorded under is the one the mail goes to", async () => {
  await send("Name+1@Gmail.com", "198.51.100.1");

  expect(await db.emailSend.findMany()).toMatchObject([
    { address: "name+1@gmail.com" },
  ]);
});

test("mail to a +tag address that has an account still doesn't count against the client or site caps", async () => {
  await db.user.create({
    data: { email: "member+tag@example.com", approvedAt: new Date() },
  });
  for (let n = 0; n < SEND_LIMITS.ipPerDay; n++) {
    expect(
      await send(`stranger${n}@example.com`, "198.51.100.20", "invite"),
    ).toEqual({ ok: true });
  }

  // The client is at its cap for strangers, but a player is not one.
  expect(await send("member+tag@example.com", "198.51.100.20")).toEqual({
    ok: true,
  });
  expect(await send("stranger-last@example.com", "198.51.100.20")).toEqual({
    ok: false,
    reason: "ip",
  });
  await db.user.deleteMany({ where: { email: "member+tag@example.com" } });
});

test("one IP using up an address's daily cap doesn't block that address from another IP", async () => {
  await sentBefore(SEND_LIMITS.signInPerAddressPerDay, {
    address: "target@example.com",
    ip: "203.0.113.1",
    ageMs: THREE_HOURS,
  });

  expect(await send("target@example.com", "203.0.113.1")).toEqual({
    ok: false,
    reason: "address",
  });
  expect(await send("target@example.com", "203.0.113.2")).toEqual({ ok: true });
});

test("the hourly cap on an address still counts every IP", async () => {
  for (let n = 0; n < SEND_LIMITS.signInPerAddressPerHour; n++) {
    expect(await send("hourly@example.com", `203.0.113.${n + 10}`)).toEqual({
      ok: true,
    });
  }

  expect(await send("hourly@example.com", "203.0.113.99")).toEqual({
    ok: false,
    reason: "address",
  });
});

test("an invite to an address is still held to its daily cap whoever asks", async () => {
  for (let n = 0; n < SEND_LIMITS.invitePerAddressPerDay; n++) {
    await send("invitee@example.com", `203.0.113.${n + 40}`, "invite");
  }

  expect(await send("invitee@example.com", "203.0.113.50", "invite")).toEqual({
    ok: false,
    reason: "address",
  });
});

test("a prune runs at startup, whatever the draw says", async () => {
  vi.spyOn(Math, "random").mockReturnValue(0.99);
  await sentBefore(2, {
    address: "ancient@example.com",
    ip: "203.0.113.1",
    ageMs: THREE_DAYS,
  });
  await sentBefore(1, {
    address: "recent@example.com",
    ip: "203.0.113.1",
    ageMs: THREE_HOURS,
  });

  const stop = startEmailSendPruning(db, logged().logger);

  await vi.waitFor(async () =>
    expect(
      await db.emailSend.count({ where: { address: "ancient@example.com" } }),
    ).toBe(0),
  );
  expect(
    await db.emailSend.count({ where: { address: "recent@example.com" } }),
  ).toBe(1);
  stop();
});

test("it prunes again every day, and not before, until stopped", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const executeRaw = vi.fn(async () => 0);
  const fake = { $executeRaw: executeRaw } as unknown as PrismaClient;

  const stop = startEmailSendPruning(fake, logged().logger);
  expect(executeRaw).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(23 * 60 * 60 * 1000);
  expect(executeRaw).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
  expect(executeRaw).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
  expect(executeRaw).toHaveBeenCalledTimes(3);

  stop();
  await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000);
  expect(executeRaw).toHaveBeenCalledTimes(3);
});

test("a prune that fails at startup is logged and doesn't throw", async () => {
  const { capture, logger } = logged();
  const fake = {
    $executeRaw: async () => {
      throw new Error("connection terminated unexpectedly");
    },
  } as unknown as PrismaClient;

  const stop = startEmailSendPruning(fake, logger);

  await vi.waitFor(() =>
    expect(capture.events("email.limit.prune.failed")).toHaveLength(1),
  );
  stop();
});

test("the send transaction waits up to 10 s for a connection and runs up to 15 s", async () => {
  const transaction = vi.spyOn(db, "$transaction");

  await send("options@example.com", "203.0.113.1");

  expect(transaction).toHaveBeenCalledTimes(1);
  expect(transaction.mock.calls[0]?.[1]).toEqual({
    maxWait: 10_000,
    timeout: 15_000,
  });
});

test.each(["P2028", "P2024"])(
  "a transaction that can't start or finish (%s) is refused and logged as reason error",
  async (code) => {
    const { capture, logger } = logged();
    const timedOut = {
      $transaction: async () => {
        throw Object.assign(new Error("Transaction API error"), { code });
      },
    } as unknown as PrismaClient;

    const verdict = await reserveSend(
      timedOut,
      { address: "slow@example.com", kind: "signin", ip: "203.0.113.1" },
      logger,
    );

    expect(verdict).toEqual({ ok: false, reason: "error" });
    expect(capture.events("email.limit")).toEqual([
      expect.objectContaining({
        reason: "error",
        level: 50,
        kind: "signin",
        code,
      }),
    ]);
    expect(JSON.stringify(capture.lines)).not.toContain("slow@");
  },
);
