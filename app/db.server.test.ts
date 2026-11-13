import { afterAll, beforeAll, expect, test } from "vitest";
import type { PrismaClient } from "./generated/prisma/client";
import { createPgliteDb } from "./pglite.server";

let db: PrismaClient;

// A fresh in-memory database for this file, with every migration applied.
beforeAll(async () => {
  db = await createPgliteDb();
});

afterAll(async () => {
  await db.$disconnect();
});

test("writes and reads one row of each model", async () => {
  const one = await db.user.create({ data: { email: "one@example.com" } });
  const two = await db.user.create({ data: { email: "two@example.com" } });
  await db.identity.create({
    data: {
      userId: one.id,
      provider: "email",
      identifier: "one@example.com",
      metadata: { providerState: "opaque" },
    },
  });
  const game = await db.game.create({
    data: {
      playerOneId: one.id,
      playerTwoId: two.id,
      status: "ACTIVE",
      nextPlayerId: one.id,
    },
  });
  await db.move.create({
    data: { gameId: game.id, number: 1, playerId: one.id, column: 3, row: 0 },
  });
  await db.invite.create({
    data: { gameId: game.id, inviterId: one.id, email: "two@example.com" },
  });

  const user = await db.user.findUniqueOrThrow({
    where: { id: one.id },
    include: { identities: true },
  });
  expect(user.email).toBe("one@example.com");
  expect(user.identities).toMatchObject([
    {
      provider: "email",
      identifier: "one@example.com",
      metadata: { providerState: "opaque" },
      verifiedAt: null,
    },
  ]);

  const read = await db.game.findUniqueOrThrow({
    where: { id: game.id },
    include: { moves: true, invite: true },
  });
  expect(read).toMatchObject({
    status: "ACTIVE",
    moveCount: 0,
    winnerId: null,
    finishedAt: null,
  });
  expect(read.moves).toMatchObject([
    {
      number: 1,
      playerId: one.id,
      column: 3,
      row: 0,
      turnEmailClaimedAt: null,
    },
  ]);
  expect(read.invite).toMatchObject({
    inviterId: one.id,
    email: "two@example.com",
    acceptedAt: null,
  });
});

test("rejects a second move with the same game and number", async () => {
  const user = await db.user.create({ data: { email: "dup@example.com" } });
  const game = await db.game.create({
    data: { playerOneId: user.id, status: "INVITED" },
  });
  const move = { gameId: game.id, number: 1, playerId: user.id, row: 0 };
  await db.move.create({ data: { ...move, column: 0 } });

  await expect(
    db.move.create({ data: { ...move, column: 1 } }),
  ).rejects.toMatchObject({ code: "P2002" });
  expect(await db.move.count({ where: { gameId: game.id } })).toBe(1);
});
