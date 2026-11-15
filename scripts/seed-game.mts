// Seeds two players and an ACTIVE game between them in the dev database, for
// trying the board without an invite. Stop `npm run dev` first: PGlite
// allows one process at a time.
//
//   node scripts/seed-game.mts first@example.com second@example.com
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const [first, second] = process.argv.slice(2).map((e) => e.toLowerCase());
if (!first || !second || first === second) {
  console.error("Usage: node scripts/seed-game.mts <email> <other email>");
  process.exit(1);
}

const pg = new PGlite(process.env.PGLITE_DIR ?? "pglite-data");
const { rows } = await pg.query(`SELECT to_regclass('games') AS games`);
if (!(rows[0] as { games: string | null }).games) {
  console.error(
    "No tables yet: run `npm run dev` once to migrate, then stop it.",
  );
  process.exit(1);
}

async function userId(email: string) {
  await pg.query(
    `INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING`,
    [randomUUID(), email],
  );
  const result = await pg.query<{ id: string }>(
    `SELECT id FROM users WHERE email = $1`,
    [email],
  );
  return result.rows[0]!.id;
}

const one = await userId(first);
const two = await userId(second);
const gameId = randomUUID();
await pg.query(
  `INSERT INTO games (id, player_one_id, player_two_id, status, next_player_id)
   VALUES ($1, $2, $3, 'ACTIVE', $2)`,
  [gameId, one, two],
);
await pg.close();
console.log(`Game /games/${gameId}: ${first} moves first against ${second}.`);
