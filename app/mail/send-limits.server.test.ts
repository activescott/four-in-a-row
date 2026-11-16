import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { createLogger } from "../logger.server";
import { createPgliteDb } from "../pglite.server";
import { recordDbCalls } from "../test/db-calls";
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
  ['"victim+1"@example.com', "victim@example.com"],
  ['"victim+2"@example.com', "victim@example.com"],
  ['"v.i.c.t.i.m"@gmail.com', "victim@gmail.com"],
  ['"V.ictim+x"@Gmail.com', "victim@gmail.com"],
])("a quoted local part of atom characters is unquoted: %s", (address, key) => {
  expect(bucketKey(address)).toBe(key);
});

test.each([
  ['"a b"@example.com', '"a b"@example.com'],
  ['"a@b"@example.com', '"a@b"@example.com'],
])(
  "a quoted local part that needs its quotes keeps them: %s",
  (address, key) => {
    expect(bucketKey(address)).toBe(key);
  },
);

test.each([
  // NFKC folds compatibility forms (fullwidth, Kelvin sign) before lowercasing.
  ["\uFF2E\uFF21\uFF2D\uFF25@example.com", "name@example.com"],
  ["\u212Aate@example.com", "kate@example.com"],
  ["n.a.m.e@\uFF47mail.com", "name@gmail.com"],
  // One trailing dot on the domain is the same domain.
  ["n.a.m.e@gmail.com.", "name@gmail.com"],
  ["name+1@Example.com.", "name@example.com"],
])(
  "the bucket key of %j is %s after NFKC and trailing-dot handling",
  (address, key) => {
    expect(bucketKey(address)).toBe(key);
  },
);

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

// Rows as if `count` sign-ins had gone out to name+N@host, one per tag and
// client, a few hours ago, so only the daily cap can bind.
async function sentToTags(count: number, host: string) {
  await db.emailSend.createMany({
    data: Array.from({ length: count }, (_, n) => ({
      address: `name+${n}@${host}`,
      bucket: `name@${host}`,
      kind: "signin",
      ip: `192.0.2.${n + 1}`,
      createdAt: new Date(Date.now() - THREE_HOURS),
    })),
  });
}

test("the 25th sign-in request in a day to name+N@x, across tags and IPs, sends nothing", async () => {
  await sentToTags(SEND_LIMITS.signInPerBucketPerDay - 1, "example.com");

  expect(await send("name+24@example.com", "198.51.100.1")).toEqual({
    ok: true,
  });
  expect(await send("name+25@example.com", "198.51.100.2")).toEqual({
    ok: false,
    reason: "address",
  });
  expect(await send("name@example.com", "198.51.100.3")).toEqual({
    ok: false,
    reason: "address",
  });
  // Another inbox, and the same inbox's invites, are not held to it.
  expect(await send("other+1@example.com", "198.51.100.4")).toEqual({
    ok: true,
  });
  await db.emailSend.deleteMany({ where: { kind: "signin" } });
  await sentToTags(SEND_LIMITS.signInPerBucketPerDay, "example.com");
  expect(await send("name+1@example.com", "198.51.100.5", "invite")).toEqual({
    ok: true,
  });
});

test("a send over the daily cap does the same database work as one under it", async () => {
  // Pin the 1-in-20 prune, which would add a statement to one side only.
  const calls = async (address: string) => {
    const recorded = recordDbCalls(db);
    await reserveSend(
      recorded.db,
      { address, kind: "signin", ip: "198.51.100.7" },
      logged().logger,
      { shouldPrune: () => false },
    );
    return recorded.calls;
  };
  await sentToTags(SEND_LIMITS.signInPerBucketPerDay, "full.example");

  const over = await calls("name+1@full.example");
  const under = await calls("name+1@empty.example");

  expect(over).toEqual(under);
  expect(over.join("\n")).toContain("bucket_day");
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

// The prune is housekeeping: a send that prunes is decided, and answered, the
// same as one that doesn't (#69).
test("pruning on every send changes neither the verdict nor which rows count", async () => {
  const address = "prune-verdict@example.com";
  const ip = "203.0.113.9";
  await sentBefore(SEND_LIMITS.signInPerAddressPerHour - 1, {
    address,
    ip,
    ageMs: 60_000,
  });
  const reserve = (shouldPrune: () => boolean) =>
    reserveSend(db, { address, kind: "signin", ip }, logged().logger, {
      shouldPrune,
    });
  await sentBefore(2, {
    address: "ancient@example.com",
    ip,
    ageMs: THREE_DAYS,
  });

  const withPrune = [await reserve(() => true), await reserve(() => true)];
  expect(
    await db.emailSend.count({ where: { address: "ancient@example.com" } }),
  ).toBe(0);
  await db.emailSend.deleteMany({ where: { address } });
  await sentBefore(SEND_LIMITS.signInPerAddressPerHour - 1, {
    address,
    ip,
    ageMs: 60_000,
  });
  const withoutPrune = [await reserve(() => false), await reserve(() => false)];

  expect(withPrune).toEqual([{ ok: true }, { ok: false, reason: "address" }]);
  expect(withoutPrune).toEqual(withPrune);
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
