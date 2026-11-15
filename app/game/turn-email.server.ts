import type { PrismaClient } from "../generated/prisma/client";
import { logger } from "../logger.server";
import type { Mailer } from "../mail/mailer.server";
import { turnEmail } from "../mail/templates";

// "Your turn" email (R6 in #1, design #2). The opponent counts as watching
// while their last poll is under this old.
export const VIEWING_MS = 10_000;

/**
 * After move `moveNumber` commits, emails the player whose turn it now is,
 * unless the game isn't ACTIVE (an invitee hasn't joined, or it's over) or
 * they are watching. The move row is claimed first, so a turn gets at most
 * one email; a failed send is logged and not retried.
 */
export async function notifyTurn(
  db: PrismaClient,
  mailer: Mailer,
  {
    gameId,
    moveNumber,
    appUrl,
  }: { gameId: string; moveNumber: number; appUrl: string },
) {
  const game = await db.game.findUnique({ where: { id: gameId } });
  if (!game) return;
  const log = { gameId, moveNumber };
  const nextId = game.nextPlayerId;
  // A later move already passed the turn on; its own email covers it.
  if (game.moveCount !== moveNumber) return;
  if (game.status !== "ACTIVE" || !nextId || !game.playerTwoId) {
    logger.info({ event: "email.turn.skipped", ...log, reason: "not_active" });
    return;
  }
  const seenAt =
    nextId === game.playerOneId ? game.playerOneSeenAt : game.playerTwoSeenAt;
  if (seenAt && Date.now() - seenAt.getTime() < VIEWING_MS) {
    logger.info({ event: "email.turn.skipped", ...log, reason: "viewing" });
    return;
  }
  const { count } = await db.move.updateMany({
    where: { gameId, number: moveNumber, turnEmailClaimedAt: null },
    data: { turnEmailClaimedAt: new Date() },
  });
  if (count === 0) return;

  const moverId =
    nextId === game.playerOneId ? game.playerTwoId : game.playerOneId;
  const users = await db.user.findMany({
    where: { id: { in: [nextId, moverId] } },
  });
  const to = users.find((u) => u.id === nextId)?.email;
  const opponentEmail = users.find((u) => u.id === moverId)?.email;
  if (!to || !opponentEmail) return;
  const link = new URL(`/games/${gameId}`, appUrl).toString();
  const sent = await mailer.send(turnEmail({ to, opponentEmail, link }));
  logger.info({
    event: sent ? "email.turn.sent" : "email.turn.failed",
    ...log,
    userId: nextId,
  });
}
