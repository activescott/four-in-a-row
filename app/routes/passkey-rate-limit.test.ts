import { afterAll, expect, test, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { createPgliteDb } from "../pglite.server";
import { run } from "../test/routes";

const { getDb, capture } = vi.hoisted(() => ({
  getDb: vi.fn<() => Promise<PrismaClient>>(),
  capture: { lines: [] as Record<string, unknown>[] },
}));
vi.mock("../db.server", () => ({ getDb }));
vi.mock("../logger.server", async (importOriginal) => {
  const original = await importOriginal<typeof import("../logger.server")>();
  return {
    ...original,
    logger: original.createLogger({
      write: (line: string) => capture.lines.push(JSON.parse(line)),
    }),
  };
});

const db = await createPgliteDb();
getDb.mockResolvedValue(db);

afterAll(async () => {
  await db.$disconnect();
});

const authRoute = await import("./auth.$provider.$action");

// Traefik appends the peer it saw, so the app reads the last hop.
function optionsCall(ip: string) {
  return run(
    authRoute.action,
    new Request("http://localhost/auth/passkey/authenticate-options", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `203.0.113.99, ${ip}`,
      },
      body: "{}",
    }),
    { provider: "passkey", action: "authenticate-options" },
  ) as Promise<Response>;
}

test("passkey authenticate-options is refused per client IP past the limit and logged", async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 40; i++)
    statuses.push((await optionsCall("198.51.100.7")).status);

  const refused = statuses.filter((status) => status === 429).length;
  expect(statuses[0]).toBe(200);
  expect(refused).toBeGreaterThan(0);
  expect(statuses.filter((status) => status === 200).length).toBe(40 - refused);

  const blocked = capture.lines.filter(
    (line) => line.event === "auth.initiate.blocked",
  );
  expect(blocked).toHaveLength(refused);
  expect(blocked[0]).toMatchObject({ provider: "passkey" });

  // Another client is not affected by the first one's burst.
  expect((await optionsCall("198.51.100.8")).status).toBe(200);
});
