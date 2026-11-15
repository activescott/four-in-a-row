import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { GameState, StateUpdate } from "./games.server";
import { applyUpdate, startPolling } from "./live";
import { emptyBoard } from "./rules";

// A stand-in for `document`: its visibility can be flipped, and it fires
// visibilitychange like a browser does.
function fakeDocument(visibility: DocumentVisibilityState = "visible") {
  const target = new EventTarget();
  return Object.assign(target, {
    visibilityState: visibility,
    set(next: DocumentVisibilityState) {
      this.visibilityState = next;
      target.dispatchEvent(new Event("visibilitychange"));
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

test("polls every 1.5 s while the page is visible", async () => {
  const poll = vi.fn(async () => {});
  const stop = startPolling({ poll, doc: fakeDocument(), intervalMs: 1500 });

  await vi.advanceTimersByTimeAsync(1499);
  expect(poll).toHaveBeenCalledTimes(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(poll).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(3000);
  expect(poll).toHaveBeenCalledTimes(3);

  stop();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(poll).toHaveBeenCalledTimes(3);
});

test("stops while hidden, and polls at once when visible again", async () => {
  const doc = fakeDocument();
  const poll = vi.fn(async () => {});
  startPolling({ poll, doc, intervalMs: 1500 });

  await vi.advanceTimersByTimeAsync(1500);
  expect(poll).toHaveBeenCalledTimes(1);
  doc.set("hidden");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(poll).toHaveBeenCalledTimes(1);

  doc.set("visible");
  await vi.advanceTimersByTimeAsync(0);
  expect(poll).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1500);
  expect(poll).toHaveBeenCalledTimes(3);
});

test("does not start while the page is hidden", async () => {
  const doc = fakeDocument("hidden");
  const poll = vi.fn(async () => {});
  startPolling({ poll, doc, intervalMs: 1500 });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(poll).not.toHaveBeenCalled();
});

test("never runs two polls at once, and keeps going after a failed one", async () => {
  const doc = fakeDocument();
  let finish = () => {};
  const poll = vi
    .fn<() => Promise<void>>()
    .mockImplementationOnce(() => new Promise((r) => (finish = r)))
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue();
  startPolling({ poll, doc, intervalMs: 1500 });

  await vi.advanceTimersByTimeAsync(1500);
  expect(poll).toHaveBeenCalledTimes(1);
  // Flipping visibility mid-request doesn't start a second request.
  doc.set("hidden");
  doc.set("visible");
  await vi.advanceTimersByTimeAsync(5000);
  expect(poll).toHaveBeenCalledTimes(1);

  finish();
  await vi.advanceTimersByTimeAsync(1500);
  expect(poll).toHaveBeenCalledTimes(2); // rejects
  await vi.advanceTimersByTimeAsync(1500);
  expect(poll).toHaveBeenCalledTimes(3);
});

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    id: "g1",
    status: "ACTIVE",
    moveCount: 0,
    board: emptyBoard(),
    you: 2,
    yourTurn: false,
    result: null,
    winningCells: [],
    lastMove: null,
    ...overrides,
  };
}

function update(overrides: Partial<StateUpdate> = {}): StateUpdate {
  return {
    unchanged: false,
    moveCount: 1,
    status: "ACTIVE",
    yourTurn: true,
    result: null,
    winningCells: [],
    lastMove: { row: 0, column: 3, player: 1 },
    moves: [{ number: 1, row: 0, column: 3, player: 1 }],
    ...overrides,
  } as StateUpdate;
}

test("applies new moves to the board with the turn, last move and result", () => {
  const next = applyUpdate(state(), update());
  expect(next).toMatchObject({
    moveCount: 1,
    yourTurn: true,
    lastMove: { row: 0, column: 3, player: 1 },
  });
  expect(next.board[0]![3]).toBe(1);

  const won = applyUpdate(
    next,
    update({
      moveCount: 3,
      status: "WON",
      yourTurn: false,
      result: "lost",
      winningCells: [{ row: 0, column: 0 }],
      lastMove: { row: 1, column: 3, player: 1 },
      moves: [
        { number: 2, row: 0, column: 4, player: 2 },
        { number: 3, row: 1, column: 3, player: 1 },
      ],
    }),
  );
  expect(won).toMatchObject({
    moveCount: 3,
    status: "WON",
    result: "lost",
    winningCells: [{ row: 0, column: 0 }],
  });
  expect([won.board[0]![4], won.board[1]![3]]).toEqual([2, 1]);
});

test("keeps the state when nothing changed or the answer is out of date", () => {
  const current = state({ moveCount: 1 });
  expect(applyUpdate(current, { unchanged: true, moveCount: 1 })).toBe(
    current,
  );
  // A poll sent before the page reloaded after the player's own move.
  expect(applyUpdate(current, update())).toBe(current);
  // Moves that don't follow on from this board can't be applied.
  const gap = update({
    moveCount: 3,
    moves: [{ number: 3, row: 0, column: 0, player: 1 }],
  });
  expect(applyUpdate(current, gap)).toBe(current);
});
