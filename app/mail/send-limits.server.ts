import type { PrismaClient } from "../generated/prisma/client";
import { ipKey } from "../auth/client-ip.server";
import { type Logger, logger as appLogger } from "../logger.server";
import type { MailKind } from "./mailer.server";

// Send limits (#58). Anyone can sign up, so the app must not become a way to
// mail strangers. Every sign-in, invite and turn email is checked against
// these and recorded in `email_sends`, in Postgres so the counts survive a
// restart and are shared by replicas. Change the numbers here.
//
// Each kind has its own per-address bucket, so invites and turn mail can't use
// up a player's sign-in quota (#59 review). Sign-in includes the "link this
// address" email, which goes through the same transport.
export const SEND_LIMITS = {
  /** Sign-in mail to one address, from anyone. */
  signInPerAddressPerHour: 5,
  /**
   * Sign-in mail to one address from one client, so a stranger can't use up
   * the owner's day (#60). The hourly cap above counts every client.
   */
  signInPerAddressPerDay: 10,
  /** Invites to one address, from anyone. */
  invitePerAddressPerDay: 2,
  /** "Your turn" mail to one address. */
  turnPerAddressPerHour: 10,
  /** Sign-in mail from one client, to any address. */
  signInPerIpPerHour: 30,
  /** Sign-in and invite mail from one client to addresses without an account. */
  ipPerDay: 10,
  /** Sign-in and invite mail to addresses without an account, site-wide. */
  globalPerDay: 100,
  /** Rows older than this are deleted by a prune. */
  retainMs: 2 * 24 * 60 * 60 * 1000,
  /** About one send in this many prunes. */
  pruneOneIn: 20,
  /** Also pruned at start and this often, so a quiet site keeps its retention. */
  pruneEveryMs: 24 * 60 * 60 * 1000,
  /**
   * Prisma's transaction defaults (2 s and 5 s) are short for a send that
   * queues on the site lock behind a burst.
   */
  transactionMaxWaitMs: 10_000,
  transactionTimeoutMs: 15_000,
} as const;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The key an address is counted under: NFKC-normalised and lowercased, without a `+tag` in the
 * local part, and for Gmail without dots in it, since all of those reach one
 * inbox. Only the key changes, never the address the mail goes to.
 */
export function bucketKey(address: string): string {
  const lower = address.trim().normalize("NFKC").toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at < 1) return lower;
  // A quoted local part may legitimately contain "+" and ".": leave it be.
  if (lower.startsWith('"')) return lower;
  let local = lower.slice(0, at);
  // "gmail.com." is the same domain as "gmail.com".
  const domain = lower.slice(at + 1).replace(/\.$/, "");
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replaceAll(".", "");
  }
  return `${local}@${domain}`;
}

export type LimitReason = "address" | "ip" | "global" | "error";
export type SendVerdict = { ok: true } | { ok: false; reason: LimitReason };

// Thrown inside the transaction to roll the recorded send back.
class Refused extends Error {
  constructor(readonly verdict: SendVerdict) {
    super("send refused");
  }
}

type Counts = {
  address_hour: number;
  address_day: number;
  address_client_day: number;
  client_signin_hour: number;
  client_day: number;
  site_day: number;
};

/**
 * Checks a send against the limits and, if it is under them, keeps its
 * record, in one transaction.
 *
 * Every send that isn't turn mail does the same work whatever the address
 * and whatever the verdict: take the address lock and the site lock, look the
 * address up, count, and write the record, and only then apply the verdict (a
 * refused send's record is rolled back, so it doesn't extend its own block).
 * Otherwise how long a request takes would say whether the address has an
 * account, which is exempt from the client and site-wide caps (#43). Turn mail
 * goes only to existing players and takes the address lock alone.
 *
 * Sends to one address queue on an advisory lock (no row exists to lock for
 * an address with no account), and the site-wide counts on a second one, so a
 * burst can't overshoot either. They are always taken in that order. The
 * prune is its own statement, after the locks, on about 1 in 20 sends and
 * whatever the verdict; it skips rows another transaction holds, so it can't
 * wait on, or deadlock with, anything.
 *
 * A refused send is logged as `email.limit` with the reason and the client's
 * key (never the address): `global` and `error` at error level, since they
 * mean the site as a whole is being used to mail strangers, or the database is
 * failing. A database error is a refusal, never a throw, so the caller's
 * answer doesn't change.
 */
export async function reserveSend(
  db: PrismaClient,
  { address, kind, ip }: { address: string; kind: MailKind; ip: string | null },
  logger: Logger = appLogger,
): Promise<SendVerdict> {
  const to = address.toLowerCase();
  const bucket = bucketKey(address);
  const key = ipKey(ip);
  if (kind !== "turn" && key === "unknown") {
    // Turn mail has no client by design. For anything else a missing address
    // means the proxy didn't set X-Forwarded-For, and everyone shares a bucket.
    logger.warn({ event: "email.limit.no_ip", kind });
  }

  let verdict: SendVerdict;
  let code: unknown;
  try {
    verdict = await db.$transaction(
      async (tx): Promise<SendVerdict> => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`email_sends:${bucket}`}, 0))`;
        if (kind !== "turn") {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('email_sends:site', 0))`;
        }
        const now = Date.now();
        if (Math.random() < 1 / SEND_LIMITS.pruneOneIn) {
          await pruneEmailSends(tx, now);
        }

        const account =
          kind === "turn"
            ? null
            : await tx.user.findUnique({
                where: { email: to },
                select: { approvedAt: true },
              });
        const hourSince = new Date(now - HOUR_MS).toISOString();
        const daySince = new Date(now - DAY_MS).toISOString();
        const [counts] = await tx.$queryRaw<Counts[]>`
        SELECT
          (count(*) FILTER (WHERE s.bucket = ${bucket} AND s.kind = ${kind}
            AND s.created_at > ${hourSince}::timestamp))::int AS address_hour,
          (count(*) FILTER (WHERE s.bucket = ${bucket} AND s.kind = ${kind}))::int
            AS address_day,
          (count(*) FILTER (WHERE s.bucket = ${bucket} AND s.kind = ${kind}
            AND s.ip = ${key}))::int AS address_client_day,
          (count(*) FILTER (WHERE s.kind = 'signin' AND s.ip = ${key}
            AND s.created_at > ${hourSince}::timestamp))::int
            AS client_signin_hour,
          (count(*) FILTER (WHERE s.kind <> 'turn' AND u.id IS NULL
            AND s.ip = ${key}))::int AS client_day,
          (count(*) FILTER (WHERE s.kind <> 'turn' AND u.id IS NULL))::int
            AS site_day
        FROM email_sends s
        LEFT JOIN users u ON u.email = s.address AND u.approved_at IS NOT NULL
        WHERE s.created_at > ${daySince}::timestamp`;

        const decided = decide(kind, counts, Boolean(account?.approvedAt));
        await tx.emailSend.create({
          data: {
            address: to,
            bucket,
            kind,
            ip: kind === "turn" ? null : key,
            createdAt: new Date(now),
          },
        });
        if (!decided.ok) throw new Refused(decided);
        return decided;
      },
      {
        maxWait: SEND_LIMITS.transactionMaxWaitMs,
        timeout: SEND_LIMITS.transactionTimeoutMs,
      },
    );
  } catch (error) {
    if (error instanceof Refused) {
      verdict = error.verdict;
    } else {
      verdict = { ok: false, reason: "error" };
      code = (error as { code?: unknown } | null)?.code;
    }
  }

  if (!verdict.ok) {
    const log = {
      event: "email.limit",
      reason: verdict.reason,
      kind,
      ...(kind !== "turn" && { ipKey: key }),
      ...(typeof code === "string" && { code }),
    };
    if (verdict.reason === "global" || verdict.reason === "error") {
      logger.error(log);
    } else logger.warn(log);
  }
  return verdict;
}

function decide(
  kind: MailKind,
  counts: Counts | undefined,
  hasAccount: boolean,
): SendVerdict {
  const c = counts ?? {
    address_hour: 0,
    address_day: 0,
    address_client_day: 0,
    client_signin_hour: 0,
    client_day: 0,
    site_day: 0,
  };
  const L = SEND_LIMITS;
  const refuse = (reason: LimitReason): SendVerdict => ({ ok: false, reason });

  if (kind === "turn") {
    return c.address_hour >= L.turnPerAddressPerHour
      ? refuse("address")
      : { ok: true };
  }
  if (
    kind === "invite"
      ? c.address_day >= L.invitePerAddressPerDay
      : c.address_hour >= L.signInPerAddressPerHour ||
        c.address_client_day >= L.signInPerAddressPerDay
  ) {
    return refuse("address");
  }
  if (kind === "signin" && c.client_signin_hour >= L.signInPerIpPerHour) {
    return refuse("ip");
  }
  // Accounts are exempt from these two in the decision, not in the work done.
  if (!hasAccount) {
    if (c.client_day >= L.ipPerDay) return refuse("ip");
    if (c.site_day >= L.globalPerDay) return refuse("global");
  }
  return { ok: true };
}

/**
 * Deletes rows older than the retention. One statement that skips rows
 * another transaction holds, so it can't wait on, or deadlock with, anything.
 */
export async function pruneEmailSends(
  db: Pick<PrismaClient, "$executeRaw">,
  now = Date.now(),
) {
  // Compared as UTC wall time, as Prisma stores it.
  const cutoff = new Date(now - SEND_LIMITS.retainMs).toISOString();
  await db.$executeRaw`
    DELETE FROM email_sends WHERE id IN (
      SELECT id FROM email_sends
      WHERE created_at < ${cutoff}::timestamp
      FOR UPDATE SKIP LOCKED)`;
}

/**
 * Prunes now and then daily, on top of the 1-in-20 draw on sends, so rows
 * don't outlive the retention on a site too quiet to draw (#60). A failure is
 * logged and the next run tries again. Returns a function that stops it.
 */
export function startEmailSendPruning(
  db: Pick<PrismaClient, "$executeRaw">,
  logger: Logger = appLogger,
) {
  const run = async () => {
    try {
      await pruneEmailSends(db);
    } catch (err) {
      logger.error({ event: "email.limit.prune.failed", err });
    }
  };
  void run();
  const timer = setInterval(() => void run(), SEND_LIMITS.pruneEveryMs);
  timer.unref();
  return () => clearInterval(timer);
}
