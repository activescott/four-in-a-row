import { createHmac } from "node:crypto";
import { afterAll, expect, test, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { createPgliteDb } from "../pglite.server";
import { jsonPost, run } from "../test/routes";

const getDb = vi.hoisted(() => vi.fn<() => Promise<PrismaClient>>());
vi.mock("../db.server", () => ({ getDb }));

const db = await createPgliteDb();
getDb.mockResolvedValue(db);

// Dev with no PASSKEY_CHALLENGE_SECRET; JWT_SECRET is still the fake one
// from vitest.config.mts.
const passkeySecret = process.env.PASSKEY_CHALLENGE_SECRET;
delete process.env.PASSKEY_CHALLENGE_SECRET;
const authRoute = await import("./auth.$provider.$action");

afterAll(async () => {
  process.env.PASSKEY_CHALLENGE_SECRET = passkeySecret;
  await db.$disconnect();
});

test("without PASSKEY_CHALLENGE_SECRET, challenges are not signed with the session secret", async () => {
  const response = (await run(
    authRoute.action,
    jsonPost("/auth/passkey/authenticate-options", {}),
    { provider: "passkey", action: "authenticate-options" },
  )) as Response;
  expect(response.status).toBe(200);

  const token = response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0].split("=")[1])
    .find((value) => value.split(".").length === 3)!;
  const [header, payload, signature] = token.split(".");
  const withSessionSecret = createHmac("sha256", process.env.JWT_SECRET!)
    .update(`${header}.${payload}`)
    .digest("base64url");
  expect(signature).not.toBe(withSessionSecret);
});
