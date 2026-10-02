export interface GridPosition {
  readonly row: number;
  readonly column: number;
}

export interface GridSize {
  readonly rows: number;
  readonly columns: number;
}

export interface Modifiers {
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
}

/**
 * Where a key takes the focus in a grid, by the ARIA grid pattern: arrows move one cell and stop at
 * the edge, Home and End go to the ends of the row, with Ctrl to the corners of the grid. `null` for
 * a key the grid does not use, and for any combination the browser or the system owns (Alt+Arrow
 * is history, Cmd+Arrow too).
 */
export function movedFocus(
  from: GridPosition,
  key: string,
  { ctrl, alt, shift, meta }: Modifiers,
  { rows, columns }: GridSize,
): GridPosition | null {
  if (alt || shift) return null;
  const withCtrl = ctrl || meta;
  const last = { row: rows - 1, column: columns - 1 };
  const clamp = (row: number, column: number): GridPosition => ({
    row: Math.min(Math.max(row, 0), last.row),
    column: Math.min(Math.max(column, 0), last.column),
  });
  switch (key) {
    case 'ArrowUp':
      return withCtrl ? null : clamp(from.row - 1, from.column);
    case 'ArrowDown':
      return withCtrl ? null : clamp(from.row + 1, from.column);
    case 'ArrowLeft':
      return withCtrl ? null : clamp(from.row, from.column - 1);
    case 'ArrowRight':
      return withCtrl ? null : clamp(from.row, from.column + 1);
    case 'Home':
      return clamp(withCtrl ? 0 : from.row, 0);
    case 'End':
      return clamp(withCtrl ? last.row : from.row, last.column);
    default:
      return null;
  }
}

/** Line keys are JSON arrays, so no line can be called this. */
const TOTAL_ROW = 'total';

/**
 * The cell that has the tab stop is remembered by its row's key, since rows come and go as items
 * are collapsed. `key` is null before the grid has had the focus.
 */
export interface RememberedFocus {
  readonly key: string | null;
  readonly column: number;
}

/** The totals row comes after the lines. If the remembered row is hidden, the first row has the stop. */
export function tabStopOf(
  focus: RememberedFocus,
  lineKeys: readonly string[],
  columns: number,
): GridPosition {
  const row =
    focus.key === null
      ? 0
      : focus.key === TOTAL_ROW
        ? lineKeys.length
        : lineKeys.indexOf(focus.key);
  return { row: Math.max(row, 0), column: Math.min(focus.column, columns - 1) };
}

export function rememberFocus(
  { row, column }: GridPosition,
  lineKeys: readonly string[],
): RememberedFocus {
  return { key: row === lineKeys.length ? TOTAL_ROW : (lineKeys[row] ?? null), column };
}
