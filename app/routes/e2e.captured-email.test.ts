import { expect, test, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { get, run } from "../test/routes";

const getDb = vi.hoisted(() => vi.fn<() => Promise<PrismaClient>>());
vi.mock("../db.server", () => ({ getDb }));

test("/e2e/captured-email returns 404 when E2E_TEST_MODE is unset", async () => {
  const { createPgliteDb } = await import("../pglite.server");
  getDb.mockResolvedValue(await createPgliteDb());
  // vitest.config.mts turns test mode on for every file; this one turns it off
  // before the auth module first loads.
  vi.stubEnv("E2E_TEST_MODE", undefined);
  const { captureEmailTransport } = await import("../auth.server");
  const { loader } = await import("./e2e.captured-email");

  const response = (await run(
    loader,
    get("/e2e/captured-email?email=seed%40example.com", {
      "x-e2e-secret": "test-only-e2e-capture-secret",
    }),
  )) as Response;

  expect(captureEmailTransport).toBeNull();
  expect(response.status).toBe(404);
});
