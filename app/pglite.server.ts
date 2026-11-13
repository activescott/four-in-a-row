import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "./generated/prisma/client";

const MIGRATIONS = path.resolve("prisma/migrations");

// An in-process Postgres for dev and tests: in memory unless dataDir is given.
export async function createPgliteDb(dataDir?: string) {
  const pg = new PGlite(dataDir);
  await migrate(pg);
  return new PrismaClient({ adapter: new PrismaPGlite(pg) });
}

// Applies each prisma/migrations/*/migration.sql not yet applied, in name order.
async function migrate(pg: PGlite) {
  await pg.exec(
    `CREATE TABLE IF NOT EXISTS _pglite_migrations (name text PRIMARY KEY)`,
  );
  const { rows } = await pg.query<{ name: string }>(
    `SELECT name FROM _pglite_migrations`,
  );
  const applied = new Set(rows.map((row) => row.name));
  const entries = await readdir(MIGRATIONS, { withFileTypes: true });
  const pending = entries
    .filter((entry) => entry.isDirectory() && !applied.has(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const name of pending) {
    const sql = await readFile(
      path.join(MIGRATIONS, name, "migration.sql"),
      "utf8",
    );
    await pg.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query(`INSERT INTO _pglite_migrations (name) VALUES ($1)`, [
        name,
      ]);
    });
  }
}
