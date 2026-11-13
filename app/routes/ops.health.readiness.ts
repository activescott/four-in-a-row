import { getDbSize } from "../db-size.server";
import { getDb } from "../db.server";
import { logger } from "../logger.server";

// Readiness: 200 with the database size in bytes, or 503 if it can't be reached.
export async function loader() {
  try {
    const size = await getDbSize(await getDb());
    return Response.json({ status: "ok", db: { size } });
  } catch (err) {
    logger.error({ event: "db.ready.failed", err });
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
