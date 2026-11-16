import type { PrismaClient } from "../generated/prisma/client";
import { ipKey } from "../auth/client-ip.server";
import { type Logger, logger as appLogger } from "../logger.server";
import type { MailKind } from "./mailer.server";

// Send limits (#58). Anyone can sign up, so the app must not become a way to
// mail strangers. Every sign-in, invite and turn email is checked against
// these and recorded in `email_sends`, in Postgres so the counts survive a
// restart and are shared by replicas. Change the numbers here.
export const SEND_LIMITS = {
  /** All app mail to one address: sign-in, invite and turn. */
  addressPerHour: 3,
  addressPerDay: 6,
  /** Sign-in and invite mail from one client to addresses without an account. */
  ipPerDay: 10,
  /** Sign-in and invite mail to addresses without an account, site-wide. */
  globalPerDay: 100,
  // Per-kind limits (#59 review). Not used yet: the next commit switches to them.
  signInPerAddressPerHour: 5,
  signInPerAddressPerDay: 10,
  invitePerAddressPerDay: 2,
  turnPerAddressPerHour: 10,
  signInPerIpPerHour: 30,
  /** Rows older than this are deleted on write. */
  retainMs: 2 * 24 * 60 * 60 * 1000,
} as const;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type LimitReason = "address" | "ip" | "global";
export type SendVerdict = { ok: true } | { ok: false; reason: LimitReason };

/**
 * Checks a send against the limits and, if it is under them, records it, in
 * one transaction. Concurrent sends to one address queue on an advisory lock
 * (no row exists to lock for an address with no account), and sends that
 * count toward the IP and site-wide caps queue on a second one, so a burst
 * can't overshoot either. A refused send is not recorded, so it doesn't
 * extend its own block, and is logged as `email.limit` with the reason
 * (never the address): `global` at error level, since it means the site as a
 * whole is being used to mail strangers. Turn mail passes `ip: null` and is
 * held only to the per-address limit.
 */
export async function reserveSend(
  db: PrismaClient,
  { address, kind, ip }: { address: string; kind: MailKind; ip: string | null },
  logger: Logger = appLogger,
): Promise<SendVerdict> {
  const to = address.toLowerCase();
  const key = ipKey(ip);
  const verdict = await db.$transaction(async (tx): Promise<SendVerdict> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`email_sends:${to}`}, 0))`;
    const now = Date.now();
    await tx.emailSend.deleteMany({
      where: { createdAt: { lt: new Date(now - SEND_LIMITS.retainMs) } },
    });

    const [hour, day] = await Promise.all([
      tx.emailSend.count({
        where: { address: to, createdAt: { gt: new Date(now - HOUR_MS) } },
      }),
      tx.emailSend.count({
        where: { address: to, createdAt: { gt: new Date(now - DAY_MS) } },
      }),
    ]);
    if (
      hour >= SEND_LIMITS.addressPerHour ||
      day >= SEND_LIMITS.addressPerDay
    ) {
      return { ok: false, reason: "address" };
    }

    if (kind !== "turn") {
      const account = await tx.user.findUnique({
        where: { email: to },
        select: { approvedAt: true },
      });
      if (!account?.approvedAt) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('email_sends:site', 0))`;
        // Compared as UTC wall time, as Prisma stores it.
        const since = new Date(now - DAY_MS).toISOString();
        const [counts] = await tx.$queryRaw<{ site: number; client: number }[]>`
          SELECT count(*)::int AS site,
                 (count(*) FILTER (WHERE s.ip = ${key}))::int AS client
          FROM email_sends s
          WHERE s.created_at > ${since}::timestamp
            AND s.kind <> 'turn'
            AND NOT EXISTS (
              SELECT 1 FROM users u
              WHERE u.email = s.address AND u.approved_at IS NOT NULL
            )`;
        if ((counts?.client ?? 0) >= SEND_LIMITS.ipPerDay) {
          return { ok: false, reason: "ip" };
        }
        if ((counts?.site ?? 0) >= SEND_LIMITS.globalPerDay) {
          return { ok: false, reason: "global" };
        }
      }
    }

    await tx.emailSend.create({
      data: {
        address: to,
        kind,
        ip: kind === "turn" ? null : key,
        createdAt: new Date(now),
      },
    });
    return { ok: true };
  });

  if (!verdict.ok) {
    const log = { event: "email.limit", reason: verdict.reason, kind };
    if (verdict.reason === "global") logger.error(log);
    else logger.warn(log);
  }
  return verdict;
}
