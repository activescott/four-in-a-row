import { requireAuth } from "../auth.server";
import { getDb } from "../db.server";
import {
  findGameForPlayer,
  gameState,
  recordSeen,
  stateSince,
} from "../game/games.server";
import { GameStatus } from "../generated/prisma/enums";
import type { Route } from "./+types/games.$id.state";

function isGameStatus(value: string): value is GameStatus {
  return Object.values<string>(GameStatus).includes(value);
}

// GET /games/:id/state?since=n: the board page's poll. Answers "unchanged",
// or the moves after move n with the status. With status=, a change of
// status at the same move count (an accepted invite) is a change too. Without since, the whole state.
export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireAuth(request);
  const query = new URL(request.url).searchParams;
  const since = query.get("since");
  const status = query.get("status");
  if (
    (since !== null && !/^\d+$/.test(since)) ||
    (status !== null && !isGameStatus(status))
  ) {
    throw new Response("Bad request", { status: 400 });
  }
  const db = await getDb();
  const game = await findGameForPlayer(db, params.id, user.id);
  if (!game) throw new Response("Not found", { status: 404 });
  const body =
    since === null
      ? gameState(game, user.id)
      : stateSince(game, user.id, Number(since), status ?? undefined);
  if (!body) throw new Response("Bad request", { status: 400 });
  await recordSeen(db, game, user.id);
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
