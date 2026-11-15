import { requireAuth } from "../auth.server";
import { getDb } from "../db.server";
import {
  findGameForPlayer,
  gameState,
  recordSeen,
  stateSince,
} from "../game/games.server";
import type { Route } from "./+types/games.$id.state";

// GET /games/:id/state?since=n: the board page's poll. Answers "unchanged",
// or the moves after move n with the status. Without since, the whole state.
export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireAuth(request);
  const since = new URL(request.url).searchParams.get("since");
  if (since !== null && !/^\d+$/.test(since)) {
    throw new Response("Bad request", { status: 400 });
  }
  const db = await getDb();
  const game = await findGameForPlayer(db, params.id, user.id);
  if (!game) throw new Response("Not found", { status: 404 });
  const body =
    since === null
      ? gameState(game, user.id)
      : stateSince(game, user.id, Number(since));
  if (!body) throw new Response("Bad request", { status: 400 });
  await recordSeen(db, game, user.id);
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
