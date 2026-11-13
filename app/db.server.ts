import { PrismaPg } from "@prisma/adapter-pg";
import { startDbSizeLogging } from "./db-size.server";
import { PrismaClient } from "./generated/prisma/client";
import { logger } from "./logger.server";

// Postgres when DATABASE_URL is set (production); otherwise PGlite, which is a
// devDependency and so only imported here.
async function createDb(): Promise<PrismaClient> {
  const url = process.env.DATABASE_URL;
  if (url) return new PrismaClient({ adapter: new PrismaPg(url) });
  const { createPgliteDb } = await import("./pglite.server");
  return createPgliteDb(process.env.PGLITE_DIR);
}

let db: Promise<PrismaClient> | undefined;

export function getDb() {
  return (db ??= createDb());
}

// The server build imports this module at startup, so db.size is logged then.
if (!process.env.VITEST) {
  getDb().then(
    (client) => startDbSizeLogging(client, logger),
    (err) => logger.error({ event: "db.init.failed", err }),
  );
}
