import { afterAll, beforeAll, expect, test } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { createPgliteDb } from "../pglite.server";
import { createUserStore } from "./user-store.server";

let db: PrismaClient;

beforeAll(async () => {
  db = await createPgliteDb();
});

afterAll(async () => {
  await db.$disconnect();
});

test("create makes a User row for an email identity and findById reads it back", async () => {
  const store = createUserStore(db);

  const created = await store.create({
    provider: "email",
    identifier: "alice@example.com",
  });

  const row = await db.user.findUniqueOrThrow({ where: { id: created.id } });
  expect(row.email).toBe("alice@example.com");
  const found = await store.findById(created.id);
  expect(found).toEqual({
    id: created.id,
    metadata: {
      email: "alice@example.com",
      createdAt: row.createdAt.toISOString(),
    },
  });
});

test("create returns the existing user when the email already has a row", async () => {
  const store = createUserStore(db);
  const existing = await db.user.create({ data: { email: "bob@example.com" } });

  const created = await store.create({
    provider: "email",
    identifier: "bob@example.com",
  });

  expect(created.id).toBe(existing.id);
  expect(await db.user.count({ where: { email: "bob@example.com" } })).toBe(1);
});

test("create refuses a user from any provider but email", async () => {
  const store = createUserStore(db);

  await expect(
    store.create({ provider: "passkey", identifier: "credential-id" }),
  ).rejects.toThrow(/email/);
});

test("findById returns null for an unknown id", async () => {
  const store = createUserStore(db);

  expect(
    await store.findById("00000000-0000-0000-0000-000000000000"),
  ).toBeNull();
});

test("onMerge refuses to merge accounts", async () => {
  const store = createUserStore(db);

  await expect(store.onMerge({ id: "a" }, { id: "b" })).rejects.toThrow(
    /merge/i,
  );
});
