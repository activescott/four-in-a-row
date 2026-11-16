import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client";
import { logger } from "../logger.server";
import type { Mail, Mailer } from "../mail/mailer.server";
import { isDeliverableAddress } from "../mail/address.server";
import { reserveSend } from "../mail/send-limits.server";
import { inviteEmail } from "../mail/templates";

// Invites (#14): the app emails a random, single-use token that expires in
// 7 days and is tied to the game and the inviter. It is not a sign-in
// credential: /invite/:token starts the normal email sign-in in the
// invitee's own browser, and only a signed-in user whose address matches
// the invite can accept it.

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Bounds how many addresses one account can have the app email at a time.
export const MAX_PENDING_INVITES = 5;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

const pending = (now: Date) => ({ acceptedAt: null, expiresAt: { gt: now } });

export type InviteError = "invalid_email" | "self" | "capped";
export type InviteOutcome =
  | { ok: true; gameId: string }
  | { ok: false; error: InviteError }
  // One pending invite per address per inviter, so one player can't fill a
  // stranger's inbox: the game it started.
  | { ok: false; error: "already_invited"; gameId: string };

/**
 * Starts an INVITED game with the inviter to move first, and emails the
 * invitee a link to /invite/:token. The answer and the work done are the
 * same whether the address has an account, the send limits allowed the email
 * or the relay will refuse it. The email is sent in the background.
 */
export async function createInvite(
  db: PrismaClient,
  mailer: Mailer,
  input: {
    inviterId: string;
    inviterEmail: string;
    email: string;
    appUrl: string;
    /** The inviter's address as the proxy saw it, for the send limits. */
    ip: string | null;
    /** For tests: replaces the send limits' random prune draw. */
    shouldPrune?: () => boolean;
  },
): Promise<InviteOutcome> {
  const { inviterId, inviterEmail, appUrl, ip, shouldPrune } = input;
  const email = input.email.trim().toLowerCase();
  if (
    email.length > 254 ||
    !EMAIL.test(email) ||
    !isDeliverableAddress(email)
  ) {
    return { ok: false, error: "invalid_email" };
  }
  if (email === inviterEmail.toLowerCase()) return { ok: false, error: "self" };

  const token = randomBytes(32).toString("base64url");
  const created = await db.$transaction(async (tx) => {
    // Serialises one inviter's invites, so two at once can't pass the cap.
    await tx.$executeRaw`SELECT 1 FROM users WHERE id = ${inviterId} FOR UPDATE`;
    const now = new Date();
    const count = await tx.invite.count({
      where: { inviterId, ...pending(now) },
    });
    const existing = await tx.invite.findFirst({
      where: { inviterId, email, ...pending(now) },
      select: { gameId: true },
    });
    if (existing)
      return { kind: "already_invited", gameId: existing.gameId } as const;
    if (count >= MAX_PENDING_INVITES) return { kind: "capped", count } as const;
    const game = await tx.game.create({
      data: {
        playerOneId: inviterId,
        status: "INVITED",
        nextPlayerId: inviterId,
      },
    });
    const invite = await tx.invite.create({
      data: {
        gameId: game.id,
        inviterId,
        email,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
      },
    });
    return { kind: "created", gameId: game.id, inviteId: invite.id } as const;
  });
  if (created.kind === "already_invited") {
    return { ok: false, error: "already_invited", gameId: created.gameId };
  }
  if (created.kind === "capped") {
    logger.info({ event: "invite.capped", inviterId, pending: created.count });
    return { ok: false, error: "capped" };
  }

  const { gameId, inviteId } = created;
  // Over a send limit (#58) the invite still stands and the answer is the
  // same as for a sent one, so the form never says which addresses are capped
  // or have an account. The invitee can still sign in from /login, which is
  // under the same limits. The invite keeps counting toward the pending cap.
  // That is an accepted risk: the cap of 5 bounds what a refused invite leaves.
  const allowed = (
    await reserveSend(db, { address: email, kind: "invite", ip }, logger, {
      shouldPrune,
    })
  ).ok;
  if (allowed) {
    const link = new URL(`/invite/${token}`, appUrl).toString();
    // Not awaited: waiting on the relay only for sent invites would make them
    // measurably slower than refused ones, which says who has an account.
    // If the relay fails, nobody can join a game whose invite never arrived,
    // so the game goes, and the cascade takes the invite, so the cap isn't
    // used up.
    void deliver(mailer, inviteEmail({ to: email, inviterEmail, link })).then(
      async (sent) => {
        if (sent) {
          logger.info({
            event: "email.invite.sent",
            gameId,
            inviteId,
            inviterId,
          });
          return;
        }
        logger.error({
          event: "email.invite.failed",
          gameId,
          inviteId,
          inviterId,
        });
        try {
          await db.game.delete({ where: { id: gameId } });
        } catch {
          logger.error({
            event: "email.invite.cleanup_failed",
            gameId,
            inviteId,
            inviterId,
          });
        }
      },
    );
  }
  logger.info({ event: "game.created", gameId, userId: inviterId });
  return { ok: true, gameId };
}

// The mailer promises not to throw; this keeps a broken one from leaving an
// unhandled rejection behind a send nobody is waiting for.
async function deliver(mailer: Mailer, mail: Mail) {
  try {
    return await mailer.send(mail);
  } catch {
    return false;
  }
}

export type InviteState = "pending" | "expired" | "used";

/**
 * The invite behind a token from an invite email, or null if there is none.
 * Opening an expired one logs invite.expired.
 */
export async function inviteByToken(db: PrismaClient, token: string) {
  const invite = await db.invite.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!invite) return null;
  const inviter = await db.user.findUnique({
    where: { id: invite.inviterId },
    select: { email: true },
  });
  const state: InviteState = invite.acceptedAt
    ? "used"
    : invite.expiresAt <= new Date()
      ? "expired"
      : "pending";
  if (state === "expired") {
    logger.info({
      event: "invite.expired",
      gameId: invite.gameId,
      inviteId: invite.id,
    });
  }
  return {
    state,
    gameId: invite.gameId,
    email: invite.email,
    inviterEmail: inviter?.email ?? null,
  };
}

export type AcceptOutcome =
  | { ok: true; gameId: string }
  | { ok: false; status: 404; reason: "not_found" }
  | { ok: false; status: 410; reason: "expired" | "used" };

/**
 * Seats a signed-in user in the game they were invited to: the game turns
 * ACTIVE and the turn goes to whoever is next, never an empty seat. Anyone
 * whose address isn't the invite's gets not_found. Accepting again as the
 * same player is a no-op that answers ok.
 */
export async function acceptInvite(
  db: PrismaClient,
  {
    gameId,
    userId,
    userEmail,
  }: { gameId: string; userId: string; userEmail: string },
): Promise<AcceptOutcome> {
  const notFound = { ok: false, status: 404, reason: "not_found" } as const;
  const result = await db.$transaction(async (tx): Promise<AcceptOutcome> => {
    // Serialises two accepts, and an accept against the inviter's first move.
    await tx.$executeRaw`SELECT 1 FROM games WHERE id = ${gameId} FOR UPDATE`;
    const game = await tx.game.findUnique({
      where: { id: gameId },
      include: { invite: true },
    });
    const invite = game?.invite;
    if (!game || !invite || invite.email !== userEmail.toLowerCase()) {
      return notFound;
    }
    if (userId === game.playerOneId) return notFound;
    if (invite.acceptedAt) {
      return game.playerTwoId === userId
        ? { ok: true, gameId }
        : { ok: false, status: 410, reason: "used" };
    }
    if (invite.expiresAt <= new Date() || game.status !== "INVITED") {
      return { ok: false, status: 410, reason: "expired" };
    }
    await tx.game.update({
      where: { id: gameId },
      data: {
        playerTwoId: userId,
        status: "ACTIVE",
        // Whoever has the next move: the inviter may have played first.
        nextPlayerId: game.moveCount % 2 === 0 ? game.playerOneId : userId,
      },
    });
    await tx.invite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    });
    logger.info({
      event: "invite.accepted",
      gameId,
      inviteId: invite.id,
      inviterId: invite.inviterId,
      userId,
    });
    return { ok: true, gameId };
  });
  if (!result.ok && result.reason === "expired") {
    logger.info({ event: "invite.expired", gameId });
  }
  return result;
}
