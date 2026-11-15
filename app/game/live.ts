import { useEffect, useRef, useState } from "react";
import type { GameState, StateUpdate } from "./games.server";
import type { Cell } from "./rules";

// Live updates (R5): the board page polls /games/:id/state?since=n while the
// tab is visible. 1.5 s plus a round trip stays inside the 3 s budget.
export const POLL_INTERVAL_MS = 1500;
// A fetch can stay pending for minutes on a phone that changes networks.
export const POLL_TIMEOUT_MS = 5000;

type VisibilitySource = Pick<
  Document,
  "visibilityState" | "addEventListener" | "removeEventListener"
>;

/**
 * Calls `poll` every `intervalMs` while `doc` is visible, one call at a time.
 * Stops while hidden and polls at once when visible again. Each call's signal
 * aborts after `timeoutMs`, or when stopped. Returns a stop function.
 */
export function startPolling({
  poll,
  doc,
  intervalMs,
  timeoutMs = POLL_TIMEOUT_MS,
}: {
  poll: (signal: AbortSignal) => Promise<void>;
  doc: VisibilitySource;
  intervalMs: number;
  timeoutMs?: number;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: AbortController | undefined;
  let stopped = false;
  const visible = () => doc.visibilityState === "visible";

  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const schedule = () => {
    if (!stopped && visible() && !inFlight && timer === undefined) {
      timer = setTimeout(tick, intervalMs);
    }
  };
  async function tick() {
    timer = undefined;
    if (stopped || !visible() || inFlight) return;
    const controller = new AbortController();
    inFlight = controller;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await poll(controller.signal);
    } catch {
      // Offline, timed out or a deploy in progress: try again next tick.
    } finally {
      clearTimeout(timeout);
      inFlight = undefined;
    }
    schedule();
  }
  const onVisibilityChange = () => {
    cancel();
    if (visible()) void tick();
  };

  doc.addEventListener("visibilitychange", onVisibilityChange);
  schedule();
  return () => {
    stopped = true;
    cancel();
    inFlight?.abort();
    doc.removeEventListener("visibilitychange", onVisibilityChange);
  };
}

/**
 * The state with a poll's answer applied: the new discs, the turn, the last
 * move and the result. Returns the same state when there is nothing to apply.
 */
export function applyUpdate(state: GameState, update: StateUpdate): GameState {
  if (update.unchanged || update.moveCount <= state.moveCount) return state;
  const moves = update.moves.filter((m) => m.number > state.moveCount);
  if (moves[0]?.number !== state.moveCount + 1) return state;
  const board = state.board.map((row) => [...row]) as Cell[][];
  for (const m of moves) board[m.row]![m.column] = m.player;
  return {
    ...state,
    board,
    moveCount: update.moveCount,
    status: update.status,
    yourTurn: update.yourTurn,
    result: update.result,
    winningCells: update.winningCells,
    lastMove: update.lastMove,
  };
}

/**
 * Whether the game can still change. A finished game's moves can't, and a
 * rematch is a new game with its own page, so it isn't polled.
 */
export function isLive(state: GameState) {
  return state.status === "ACTIVE" || state.status === "INVITED";
}

/** Why polling stopped: the game is gone, or the session expired. */
export type PollEnd = "gone" | "signed_out";

/**
 * A poll's answer, a reason to stop polling, or null to try again next tick
 * (a deploy in progress or a server error).
 */
export async function readPoll(
  response: Response,
): Promise<StateUpdate | PollEnd | null> {
  if (response.status === 404) return "gone";
  // requireAuth redirects to /login, and fetch follows it to an HTML page.
  if (response.redirected || [401, 403].includes(response.status)) {
    return "signed_out";
  }
  if (!response.ok) return null;
  if (!response.headers.get("content-type")?.includes("application/json")) {
    return "signed_out";
  }
  return (await response.json()) as StateUpdate;
}

/**
 * The board page's game state, kept up to date by polling. A newer loader
 * result (after the player's own move) replaces it. `ended` says why polling
 * stopped, if it did.
 */
export function useLiveGame(loaded: GameState): {
  game: GameState;
  ended: PollEnd | null;
} {
  const [live, setLive] = useState(loaded);
  const [ended, setEnded] = useState<PollEnd | null>(null);
  const [seen, setSeen] = useState(loaded);
  if (seen !== loaded) {
    setSeen(loaded);
    if (loaded.id !== live.id) setEnded(null);
    if (loaded.id !== live.id || loaded.moveCount >= live.moveCount) {
      setLive(loaded);
    }
  }

  const latest = useRef(live);
  useEffect(() => {
    latest.current = live;
  });

  const polling = ended === null && isLive(live);
  useEffect(() => {
    if (!polling) return;
    return startPolling({
      doc: document,
      intervalMs: POLL_INTERVAL_MS,
      poll: async (signal) => {
        const { id, moveCount } = latest.current;
        const response = await fetch(`/games/${id}/state?since=${moveCount}`, {
          headers: { accept: "application/json" },
          signal,
        });
        const update = await readPoll(response);
        if (update === null) return;
        if (typeof update === "string") return setEnded(update);
        setLive((current) =>
          current.id === id ? applyUpdate(current, update) : current,
        );
      },
    });
  }, [loaded.id, polling]);

  return { game: live, ended };
}
