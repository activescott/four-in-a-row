import { requireAuth } from "../auth.server";
import { getDb } from "../db.server";
import { findGameForPlayer, gameState } from "../game/games.server";
import type { Route } from "./+types/games.$id.state";

// GET /games/:id/state: JSON for the board page's polling (step 8).
export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireAuth(request);
  const game = await findGameForPlayer(await getDb(), params.id, user.id);
  if (!game) throw new Response("Not found", { status: 404 });
  return Response.json(gameState(game, user.id), {
    headers: { "cache-control": "no-store" },
  });
}
