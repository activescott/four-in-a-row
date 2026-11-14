import { data } from "react-router";
import { requireAuth } from "../auth.server";
import { getDb } from "../db.server";
import { makeMove } from "../game/games.server";
import type { Route } from "./+types/games.$id.moves";

// POST /games/:id/moves with { column, expectedMoveCount }.
export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireAuth(request);
  const form = await request.formData();
  const result = await makeMove(await getDb(), {
    gameId: params.id,
    userId: user.id,
    column: Number(form.get("column")),
    expectedMoveCount: Number(form.get("expectedMoveCount")),
  });
  if (result.ok) return { ok: true as const, error: null };
  if (result.status === 404) throw new Response("Not found", { status: 404 });
  return data(
    { ok: false as const, error: result.error },
    { status: result.status },
  );
}
