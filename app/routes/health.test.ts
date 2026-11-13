import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { createPgliteDb } from "../pglite.server";

const getDb = vi.hoisted(() => vi.fn<() => Promise<PrismaClient>>());
vi.mock("../db.server", () => ({ getDb }));

const { loader: liveness } = await import("./ops.health.liveness");
const { loader: readiness } = await import("./ops.health.readiness");

let db: PrismaClient;

beforeAll(async () => {
  db = await createPgliteDb();
});

afterAll(async () => {
  await db.$disconnect();
});

test("/ops/health/liveness returns 200 without touching the database", async () => {
  getDb.mockReset();
  getDb.mockRejectedValue(new Error("database must not be used"));

  const response = liveness();

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
  expect(getDb).not.toHaveBeenCalled();
});

test("/ops/health/readiness returns 200 with a numeric db.size", async () => {
  getDb.mockReset();
  getDb.mockResolvedValue(db);

  const response = await readiness();

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.status).toBe("ok");
  expect(body.db.size).toBeTypeOf("number");
  expect(body.db.size).toBeGreaterThan(0);
});

test("/ops/health/readiness returns 503 when the database is unreachable", async () => {
  getDb.mockReset();
  getDb.mockRejectedValue(new Error("connection refused"));

  const response = await readiness();

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: "unavailable" });
});

test("the route config no longer serves /healthz or /readyz", async () => {
  const { default: routes } = await import("../routes");
  const paths = JSON.stringify(routes);

  expect(paths).toContain("ops/health/liveness");
  expect(paths).toContain("ops/health/readiness");
  expect(paths).not.toContain("healthz");
  expect(paths).not.toContain("readyz");
});
