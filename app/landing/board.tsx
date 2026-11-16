// A Four in a Row board drawn in SVG, in the app's own colours (navy board,
// red-600 and amber-400 discs, as on the game page). Discs sit behind the
// board's face so a dropped disc slides in behind it, as on a real board.

const CELL = 100;
const PAD = 20;
const COLS = 7;
const ROWS = 6;
const W = COLS * CELL + PAD * 2;
const H = ROWS * CELL + PAD * 2;

// Columns, bottom to top. R moves first and has just won on the diagonal
// (1,0) (2,1) (3,2) (4,3): column 4's top disc is the winning drop.
const COLUMNS = ["Y", "RY", "YR", "RYR", "YRYR", "R", ""];
const WIN: [number, number][] = [
  [1, 0],
  [2, 1],
  [3, 2],
  [4, 3],
];

const cx = (c: number) => PAD + c * CELL + CELL / 2;
const cy = (r: number) => PAD + (ROWS - 1 - r) * CELL + CELL / 2;

const COLOUR = { R: "#dc2626", Y: "#fbbf24" } as const; // red-600, amber-400

function facePath() {
  const r = 28;
  let d = `M${r} 0H${W - r}Q${W} 0 ${W} ${r}V${H - r}Q${W} ${H} ${W - r} ${H}H${r}Q0 ${H} 0 ${H - r}V${r}Q0 0 ${r} 0Z`;
  for (let c = 0; c < COLS; c++) {
    for (let row = 0; row < ROWS; row++) {
      const x = cx(c);
      const y = cy(row);
      const k = 40;
      d += `M${x - k} ${y}a${k} ${k} 0 1 0 ${2 * k} 0a${k} ${k} 0 1 0 ${-2 * k} 0Z`;
    }
  }
  return d;
}

export function Board({
  face = "#172554", // blue-950, the app's board
  headroom = 0,
  animate = false,
  className,
}: {
  face?: string;
  /** Room above the board for the disc about to drop. */
  headroom?: number;
  /** Drop the last disc in with CSS (off for prefers-reduced-motion). */
  animate?: boolean;
  className?: string;
}) {
  const discs: React.ReactNode[] = [];
  COLUMNS.forEach((col, c) => {
    [...col].forEach((p, r) => {
      const last = c === 4 && r === 3;
      discs.push(
        <circle
          key={`${c}-${r}`}
          cx={cx(c)}
          cy={cy(r)}
          r={CELL * 0.42}
          fill={COLOUR[p as "R" | "Y"]}
          className={last && animate ? "fiar-drop" : undefined}
        />,
      );
    });
  });
  return (
    <svg
      viewBox={`0 ${-headroom} ${W} ${H + headroom}`}
      className={className}
      role="img"
      aria-label="A Four in a Row board. Red has just dropped the fourth disc of a diagonal line of four, and wins."
    >
      <rect width={W} height={H} rx="28" fill="#0f172a" />
      {discs}
      <path d={facePath()} fillRule="evenodd" fill={face} />
      <g className={animate ? "fiar-win" : undefined}>
        <line
          x1={cx(1)}
          y1={cy(0)}
          x2={cx(4)}
          y2={cy(3)}
          stroke="#fffbeb"
          strokeWidth="14"
          strokeLinecap="round"
        />
        {WIN.map(([c, r]) => (
          <circle
            key={`w${c}-${r}`}
            cx={cx(c)}
            cy={cy(r)}
            r={CELL * 0.42}
            fill="#dc2626"
            stroke="#fffbeb"
            strokeWidth="10"
          />
        ))}
      </g>
    </svg>
  );
}
