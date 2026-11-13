import type { PrismaClient } from "./generated/prisma/client";
import type { Logger } from "./logger.server";

const SIX_HOURS = 6 * 60 * 60 * 1000;

export async function getDbSize(db: PrismaClient): Promise<number> {
  const [{ bytes }] = await db.$queryRaw<[{ bytes: bigint }]>`
    SELECT pg_database_size(current_database()) AS bytes`;
  return Number(bytes);
}

async function logDbSize(db: PrismaClient, logger: Logger) {
  try {
    logger.info({ event: "db.size", bytes: await getDbSize(db) });
  } catch (err) {
    logger.error({ event: "db.size.failed", err });
  }
}

// Logs db.size now and every 6 hours; returns a function that stops it.
export function startDbSizeLogging(db: PrismaClient, logger: Logger) {
  void logDbSize(db, logger);
  const timer = setInterval(() => void logDbSize(db, logger), SIX_HOURS);
  timer.unref();
  return () => clearInterval(timer);
}
