import { Writable } from "node:stream";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { startDbSizeLogging } from "./db-size.server";
import type { PrismaClient } from "./generated/prisma/client";
import { createLogger } from "./logger.server";
import { createPgliteDb } from "./pglite.server";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(JSON.parse(chunk.toString()));
      done();
    },
  });
  return { logger: createLogger(stream), lines };
}

let db: PrismaClient;

beforeAll(async () => {
  db = await createPgliteDb();
});

afterAll(async () => {
  await db.$disconnect();
});

test("logs one JSON line per event with its event name", () => {
  const { logger, lines } = capture();
  logger.info({ event: "game.created", userId: "u1" });
  expect(lines).toMatchObject([{ event: "game.created", userId: "u1" }]);
});

test("never logs an email address", () => {
  const { logger, lines } = capture();
  logger.info({
    event: "invite.accepted",
    email: "a@example.com",
    user: { id: "u1", email: "a@example.com" },
  });
  expect(JSON.stringify(lines)).not.toContain("a@example.com");
  expect(lines[0]).toMatchObject({
    event: "invite.accepted",
    user: { id: "u1" },
  });
});

// Waits on real timeouts; only setInterval is faked below.
async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(check()).toBe(true);
}

test("logs db.size in bytes at startup and every 6 hours", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const { logger, lines } = capture();
  const sizes = () => lines.filter((line) => line.event === "db.size");
  try {
    const stop = startDbSizeLogging(db, logger);
    await until(() => sizes().length === 1);
    expect(sizes()[0].bytes).toBeTypeOf("number");
    expect(sizes()[0].bytes).toBeGreaterThan(0);

    vi.advanceTimersByTime(6 * 60 * 60 * 1000 - 1);
    expect(sizes()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    await until(() => sizes().length === 2);

    stop();
    vi.advanceTimersByTime(6 * 60 * 60 * 1000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sizes()).toHaveLength(2);
  } finally {
    vi.useRealTimers();
  }
});
