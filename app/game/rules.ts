/** Pure Four in a Row rules. No I/O. Row 0 is the bottom row. */

export const COLUMNS = 7;
export const ROWS = 6;

export type Player = 1 | 2;
export type Cell = Player | null;
/** `board[row][column]`, row 0 at the bottom. */
export type Board = readonly (readonly Cell[])[];

export type Position = { readonly row: number; readonly column: number };
export type Move = Position & { readonly player: Player };

export type MoveError =
  | { type: "column_out_of_range"; column: number }
  | { type: "column_full"; column: number };

export type MoveResult =
  { ok: true; board: Board; move: Move } | { ok: false; error: MoveError };

export type Outcome =
  | { status: "win"; player: Player; cells: Position[] }
  | { status: "draw" }
  | { status: "ongoing" };

export type ReplayResult =
  | { ok: true; board: Board; lastMove: Move | null }
  | { ok: false; error: MoveError & { moveIndex: number } };

export function emptyBoard(): Board {
  return Array.from({ length: ROWS }, () =>
    Array.from({ length: COLUMNS }, (): Cell => null),
  );
}

function validColumn(column: number): boolean {
  return Number.isInteger(column) && column >= 0 && column < COLUMNS;
}

/** The lowest open row in the column, or null if it is full (or invalid). */
export function dropRow(board: Board, column: number): number | null {
  if (!validColumn(column)) return null;
  for (let row = 0; row < ROWS; row++) {
    if (board[row]![column] === null) return row;
  }
  return null;
}

/** Drops a disc. Returns a new board; the input is never mutated. */
export function applyMove(
  board: Board,
  column: number,
  player: Player,
): MoveResult {
  if (!validColumn(column)) {
    return { ok: false, error: { type: "column_out_of_range", column } };
  }
  const row = dropRow(board, column);
  if (row === null) {
    return { ok: false, error: { type: "column_full", column } };
  }
  const next = board.map((r, i) =>
    i === row ? r.map((c, j): Cell => (j === column ? player : c)) : [...r],
  );
  return { ok: true, board: next, move: { row, column, player } };
}

const DIRECTIONS: readonly [number, number][] = [
  [0, 1], // horizontal
  [1, 0], // vertical
  [1, 1], // rising diagonal
  [1, -1], // falling diagonal
];

/** Outcome after `lastMove` was placed, checking all four lines through it. */
export function outcome(board: Board, lastMove: Position): Outcome {
  const player = board[lastMove.row]?.[lastMove.column];
  if (player) {
    for (const [dr, dc] of DIRECTIONS) {
      const cells: Position[] = [
        { row: lastMove.row, column: lastMove.column },
      ];
      for (const sign of [1, -1]) {
        let row = lastMove.row + dr * sign;
        let column = lastMove.column + dc * sign;
        while (board[row]?.[column] === player) {
          cells.push({ row, column });
          row += dr * sign;
          column += dc * sign;
        }
      }
      // A longer line returns every cell in it (all of them, not just four).
      if (cells.length >= 4) return { status: "win", player, cells };
    }
  }
  const full = board.every((r) => r.every((c) => c !== null));
  return full ? { status: "draw" } : { status: "ongoing" };
}

/** Rebuilds a board from ordered columns; player 1 first, turns alternate. */
export function boardFromMoves(columns: readonly number[]): ReplayResult {
  let board = emptyBoard();
  let lastMove: Move | null = null;
  for (const [moveIndex, column] of columns.entries()) {
    const player: Player = moveIndex % 2 === 0 ? 1 : 2;
    const result = applyMove(board, column, player);
    if (!result.ok) {
      return { ok: false, error: { ...result.error, moveIndex } };
    }
    board = result.board;
    lastMove = result.move;
  }
  return { ok: true, board, lastMove };
}
