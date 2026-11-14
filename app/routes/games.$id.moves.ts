import { data } from "react-router";
import { requireAuth } from "../auth.server";
import { getDb } from "../db.server";
import { makeMove } from "../game/games.server";
import { logger } from "../logger.server";
import type { Route } from "./+types/games.$id.moves";

// POST /games/:id/moves with { column, expectedMoveCount }.
export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireAuth(request);
  const form = await request.formData();
  const column = integerField(form, "column");
  const expectedMoveCount = integerField(form, "expectedMoveCount");
  const log = { gameId: params.id, userId: user.id };
  if (column === null || expectedMoveCount === null) {
    logger.info({ event: "move.rejected", ...log, reason: "invalid_input" });
    return data(
      { ok: false as const, error: "invalid_input" },
      { status: 400 },
    );
  }
  const result = await makeMove(await getDb(), {
    gameId: params.id,
    userId: user.id,
    column,
    expectedMoveCount,
  });
  if (result.ok) {
    logger.info({
      event: "move.accepted",
      ...log,
      column,
      moveNumber: result.moveNumber,
    });
    return { ok: true as const, error: null };
  }
  logger.info({ event: "move.rejected", ...log, reason: result.error });
  if (result.status === 404) throw new Response("Not found", { status: 404 });
  return data(
    { ok: false as const, error: result.error },
    { status: result.status },
  );
}

// The field as an integer, or null when it is missing or not an integer.
function integerField(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" && /^-?\d+$/.test(value)
    ? Number(value)
    : null;
}
