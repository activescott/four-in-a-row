import { describe, expect, it } from "vitest";
import {
  COLUMNS,
  ROWS,
  applyMove,
  boardFromMoves,
  dropRow,
  emptyBoard,
  outcome,
  type Board,
  type Player,
} from "./rules";

/** Play columns in order, alternating players starting with 1. */
function play(columns: number[]) {
  const result = boardFromMoves(columns);
  if (!result.ok) throw new Error(`unexpected error ${result.error.type}`);
  return result;
}

describe("dropRow", () => {
  it("returns the lowest open row", () => {
    let board = emptyBoard();
    expect(dropRow(board, 3)).toBe(0);
    const r = applyMove(board, 3, 1);
    if (!r.ok) throw new Error("move failed");
    board = r.board;
    expect(dropRow(board, 3)).toBe(1);
  });

  it("returns null for a full column", () => {
    const { board } = play([0, 0, 0, 0, 0, 0]);
    expect(dropRow(board, 0)).toBeNull();
  });
});

describe("applyMove", () => {
  it("returns a new board and does not mutate the input", () => {
    const board = emptyBoard();
    const snapshot = JSON.stringify(board);
    const r = applyMove(board, 2, 1);
    if (!r.ok) throw new Error("move failed");
    expect(JSON.stringify(board)).toBe(snapshot);
    expect(r.board).not.toBe(board);
    expect(r.board[0]![2]).toBe(1);
    expect(r.move).toEqual({ column: 2, row: 0, player: 1 });
  });

  it("rejects a full column", () => {
    const { board } = play([0, 0, 0, 0, 0, 0]);
    const r = applyMove(board, 0, 1);
    expect(r).toEqual({ ok: false, error: { type: "column_full", column: 0 } });
  });

  it.each([-1, 7, 1.5, Number.NaN])(
    "rejects column %s as out of range",
    (c) => {
      const r = applyMove(emptyBoard(), c, 1);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.type).toBe("column_out_of_range");
    },
  );
});

describe("boardFromMoves", () => {
  it("alternates turns starting with player 1", () => {
    const { board } = play([0, 1, 2]);
    expect(board[0]!.slice(0, 3)).toEqual([1, 2, 1]);
  });

  it("stacks discs and reports the last move", () => {
    const { board, lastMove } = play([4, 4]);
    expect(board[0]![4]).toBe(1);
    expect(board[1]![4]).toBe(2);
    expect(lastMove).toEqual({ column: 4, row: 1, player: 2 });
  });

  it("reports the index of an illegal move", () => {
    const r = boardFromMoves([0, 0, 0, 0, 0, 0, 0]);
    expect(r).toEqual({
      ok: false,
      error: { type: "column_full", column: 0, moveIndex: 6 },
    });
  });

  it("has no last move for an empty list", () => {
    const r = play([]);
    expect(r.lastMove).toBeNull();
    expect(r.board).toEqual(emptyBoard());
  });
});

describe("outcome", () => {
  it("is ongoing on an empty-ish board", () => {
    const { board, lastMove } = play([3]);
    expect(outcome(board, lastMove!)).toEqual({ status: "ongoing" });
  });

  it("does not report a win for three in a row", () => {
    // P1: 0,1,2  P2: 0,1 -> three in a row for P1
    const { board, lastMove } = play([0, 0, 1, 1, 2]);
    expect(outcome(board, lastMove!)).toEqual({ status: "ongoing" });
  });

  it("detects a horizontal win", () => {
    const { board, lastMove } = play([0, 0, 1, 1, 2, 2, 3]);
    const o = outcome(board, lastMove!);
    expect(o.status).toBe("win");
    if (o.status === "win") {
      expect(o.player).toBe(1);
      expect(o.cells).toHaveLength(4);
      expect(o.cells).toEqual(
        expect.arrayContaining([
          { row: 0, column: 0 },
          { row: 0, column: 1 },
          { row: 0, column: 2 },
          { row: 0, column: 3 },
        ]),
      );
    }
  });

  it("detects a horizontal win with the last disc in the middle", () => {
    // P1 plays 0,1,3 then fills the gap at 2.
    const { board, lastMove } = play([0, 0, 1, 1, 3, 3, 2]);
    expect(lastMove!.column).toBe(2);
    const o = outcome(board, lastMove!);
    expect(o.status).toBe("win");
  });

  it("detects a vertical win", () => {
    const { board, lastMove } = play([0, 1, 0, 1, 0, 1, 0]);
    const o = outcome(board, lastMove!);
    expect(o.status).toBe("win");
    if (o.status === "win") {
      expect(o.cells).toEqual(
        expect.arrayContaining([
          { row: 0, column: 0 },
          { row: 3, column: 0 },
        ]),
      );
    }
  });

  it("detects a rising diagonal win (last disc at the end)", () => {
    // P1 ends on (3,3): cells (0,0),(1,1),(2,2),(3,3)
    const { board, lastMove } = play([0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]);
    expect(lastMove).toEqual({ column: 3, row: 3, player: 1 });
    const o = outcome(board, lastMove!);
    expect(o.status).toBe("win");
    if (o.status === "win") {
      expect(o.player).toBe(1);
      expect(o.cells).toEqual(
        expect.arrayContaining([
          { row: 0, column: 0 },
          { row: 1, column: 1 },
          { row: 2, column: 2 },
          { row: 3, column: 3 },
        ]),
      );
    }
  });

  it("detects a rising diagonal win with the last disc in the middle", () => {
    // Build the same diagonal but complete it at (1,1) last.
    const b = fromRows([
      [1, 0, 0, 0, 0, 0, 0],
      [2, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
    ]);
    // diagonal cells (0,0) (2,2) (3,3) placed; (1,1) is last, supported by (0,1)
    const board = withCells(b, [
      [0, 0, 1],
      [0, 1, 2],
      [0, 2, 2],
      [1, 2, 1],
      [0, 3, 2],
      [1, 3, 2],
      [2, 3, 1],
      [2, 2, 1],
      [3, 3, 1],
      [1, 1, 1],
    ]);
    const o = outcome(board, { row: 1, column: 1 });
    expect(o.status).toBe("win");
  });

  it("detects a falling diagonal win", () => {
    // P1 on (3,0),(2,1),(1,2),(0,3) as row,col -> mirror of rising.
    const board = withCells(emptyBoard(), [
      [0, 3, 1],
      [0, 2, 2],
      [1, 2, 1],
      [0, 1, 2],
      [1, 1, 2],
      [2, 1, 1],
      [0, 0, 2],
      [1, 0, 2],
      [2, 0, 2],
      [3, 0, 1],
    ]);
    const o = outcome(board, { row: 3, column: 0 });
    expect(o.status).toBe("win");
    if (o.status === "win") {
      expect(o.cells).toEqual(
        expect.arrayContaining([
          { row: 3, column: 0 },
          { row: 2, column: 1 },
          { row: 1, column: 2 },
          { row: 0, column: 3 },
        ]),
      );
    }
  });

  it("detects a falling diagonal win with the last disc in the middle", () => {
    const board = withCells(emptyBoard(), [
      [0, 3, 1],
      [0, 2, 2],
      [1, 2, 1],
      [0, 1, 2],
      [1, 1, 2],
      [2, 1, 1],
      [0, 0, 2],
      [1, 0, 2],
      [2, 0, 2],
      [3, 0, 1],
    ]);
    const o = outcome(board, { row: 2, column: 1 });
    expect(o.status).toBe("win");
  });

  it("detects a horizontal win ending in the last column", () => {
    const { board, lastMove } = play([3, 3, 4, 4, 5, 5, 6]);
    const o = outcome(board, lastMove!);
    expect(o.status).toBe("win");
  });

  it("detects a falling diagonal win ending in the top row", () => {
    const board = withCells(emptyBoard(), [
      [5, 0, 1],
      [4, 1, 1],
      [3, 2, 1],
      [2, 3, 1],
    ]);
    const o = outcome(board, { row: 5, column: 0 });
    expect(o.status).toBe("win");
  });

  it("reports a draw on a full board with no win", () => {
    const board = drawBoard();
    expect(board.every((r) => r.every((c) => c !== null))).toBe(true);
    expect(hasAnyFour(board)).toBe(false);
    const o = outcome(board, { row: ROWS - 1, column: COLUMNS - 1 });
    expect(o).toEqual({ status: "draw" });
  });
});

/** Build a board from bottom-up rows of 0/1/2 (0 = empty). */
function fromRows(rows: number[][]): Board {
  const board = emptyBoard().map((r) => [...r]);
  rows.forEach((r, i) =>
    r.forEach((v, c) => {
      board[i]![c] = v === 0 ? null : (v as Player);
    }),
  );
  return board;
}

function withCells(board: Board, cells: [number, number, Player][]): Board {
  const next = board.map((r) => [...r]);
  for (const [row, column, player] of cells) next[row]![column] = player;
  return next;
}

/** True if any cell of the board is part of a four-in-a-row. */
function hasAnyFour(board: Board): boolean {
  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      if (
        board[row]![column] &&
        outcome(board, { row, column }).status === "win"
      )
        return true;
    }
  }
  return false;
}

/**
 * Legal move sequence (player 1 first) that fills the board with no four in a
 * row: columns alternate vertically, in pairs horizontally.
 */
const DRAW_MOVES = [
  0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 4, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4,
  4, 4, 4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 5,
];

function drawBoard(): Board {
  return play(DRAW_MOVES).board;
}
