import { useEffect, useId, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import { entryEndedBy, entryStartedBy, isChange, type EntryStart } from '../application/cellEntry';
import { formatSteps } from '../application/figures';
import {
  movedFocus,
  rememberFocus,
  tabStopOf,
  type GridPosition,
  type Modifiers,
  type RememberedFocus,
} from '../application/gridNavigation';
import { visibleLines, type Grid, type GridCell, type PersonLine } from '../application/gridView';
import type { BreakdownItemId } from '../domain/ids';
import type { DisplayUnit } from '../domain/units';
import { formatMonth, formatMonthShort } from './format';
import styles from './StaffingGrid.module.css';

interface Props {
  readonly label: string;
  readonly grid: Grid;
  readonly unit: DisplayUnit;
  readonly collapsed: ReadonlySet<BreakdownItemId>;
  readonly onToggle: (id: BreakdownItemId) => void;
  /** Takes a figure typed into a cell: the reason it is refused, or `null` once it is on its way. */
  readonly onEdit: (line: PersonLine, cell: GridCell, text: string) => string | null;
  /** A person's row to bring the focus to, by line key; `onRevealed` says it has been done. */
  readonly reveal: string | null;
  readonly onRevealed: () => void;
}

/** The cell is named by its row's key, not its place: rows move when People or the plan arrive. */
interface Editing {
  readonly key: string;
  readonly column: number;
  readonly text: string;
  readonly error: string | null;
}

const NO_MODIFIERS: Modifiers = { ctrl: false, alt: false, shift: false, meta: false };

const classes = (...names: (string | false | undefined)[]): string =>
  names.filter(Boolean).join(' ');

/** The body or footer cell an event came from, by the position it was rendered at. */
function positionOf(event: SyntheticEvent): GridPosition | null {
  const cell =
    event.target instanceof Element ? event.target.closest<HTMLElement>('[data-row]') : null;
  if (!cell) return null;
  return { row: Number(cell.dataset['row']), column: Number(cell.dataset['column']) };
}

function focusCell(root: HTMLElement | null, { row, column }: GridPosition) {
  root
    ?.querySelector<HTMLElement>(`[data-row="${String(row)}"][data-column="${String(column)}"]`)
    ?.focus();
}

const focusOnMount = (element: HTMLInputElement | null) => {
  element?.focus();
};

/**
 * The staffing grid as an ARIA treegrid: one tab stop, arrow keys move between cells. Rows are the
 * breakdown, with the people allocated to each leaf below it; a breakdown row's figures are sums of
 * what is below it, are marked DERIVED and cannot be edited. The last row holds the totals of the
 * whole project.
 *
 * A person's cell inside the project is edited in place: Enter or F2 opens it on its text, a digit
 * starts a new figure, Delete clears it. Enter commits and moves down, Tab commits and moves
 * along, Escape drops the text.
 */
export function StaffingGrid({
  label,
  grid,
  unit,
  collapsed,
  onToggle,
  onEdit,
  reveal,
  onRevealed,
}: Props) {
  const table = useRef<HTMLTableElement>(null);
  const errorId = useId();
  const lines = visibleLines(grid.lines, collapsed);
  const columns = grid.months.length + 2;
  const totalRow = lines.length;
  const lineKeys = lines.map((line) => line.key);

  const [focus, setFocus] = useState<RememberedFocus>({ key: null, column: 0 });
  const tabStop = tabStopOf(focus, lineKeys, columns);
  const remember = (position: GridPosition) => {
    setFocus(rememberFocus(position, lineKeys));
  };

  const [editing, setEditingState] = useState<Editing | null>(null);
  // What the handlers see: a key and the blur it causes can both arrive before the next render.
  const editingNow = useRef<Editing | null>(null);
  const setEditing = (next: Editing | null) => {
    editingNow.current = next;
    setEditingState(next);
  };
  const pendingFocus = useRef<GridPosition | null>(null);

  // The input is gone once an edit has ended, and the cell can take the focus back.
  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null || editing !== null) return;
    pendingFocus.current = null;
    focusCell(table.current, target);
  });

  useEffect(() => {
    if (reveal === null) return;
    const row = lines.findIndex((line) => line.key === reveal);
    const first = lines[row]?.cells.findIndex((cell) => cell.active) ?? -1;
    if (first !== -1) focusCell(table.current, { row, column: first + 1 });
    onRevealed();
  }, [reveal, lines, onRevealed]);

  const shownText = (cell: GridCell): string =>
    cell.allocation === null ? '' : formatSteps(cell.steps, unit);

  function personCellOf(key: string, column: number) {
    const line = lines.find((each) => each.key === key);
    const cell = column >= 1 ? line?.cells[column - 1] : undefined;
    return line?.kind === 'person' && cell?.active ? { line, cell } : null;
  }

  /** The reason a figure is refused, or `null`; a figure the cell already showed is not sent. */
  function commit({ key, column }: Pick<Editing, 'key' | 'column'>, text: string): string | null {
    const target = personCellOf(key, column);
    if (!target || !isChange(text, shownText(target.cell))) return null;
    return onEdit(target.line, target.cell, text);
  }

  function startEntry({ row, column }: GridPosition, start: EntryStart): boolean {
    const key = lines[row]?.key;
    const target = key === undefined ? null : personCellOf(key, column);
    if (key === undefined || !target) return false;
    if (start.kind === 'clear') {
      commit({ key, column }, '');
    } else {
      const text = start.kind === 'open' ? shownText(target.cell) : start.text;
      setEditing({ key, column, text, error: null });
    }
    return true;
  }

  function endEntry({ key, column }: Editing, step: 'down' | 'up' | 'right' | 'left' | 'stay') {
    setEditing(null);
    const row = lineKeys.indexOf(key);
    if (row === -1) return;
    const arrow = {
      down: 'ArrowDown',
      up: 'ArrowUp',
      right: 'ArrowRight',
      left: 'ArrowLeft',
      stay: null,
    }[step];
    const at = { row, column };
    pendingFocus.current =
      arrow === null
        ? at
        : (movedFocus(at, arrow, NO_MODIFIERS, { rows: totalRow + 1, columns }) ?? at);
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const current = editingNow.current;
    const exit = entryEndedBy(event.key, event.shiftKey);
    if (!current || !exit) return;
    event.preventDefault();
    if (exit.commit) {
      const refusal = commit(current, current.text);
      if (refusal !== null) {
        setEditing({ ...current, error: refusal });
        return;
      }
    }
    endEntry(current, exit.step);
  }

  function onInputBlur() {
    const current = editingNow.current;
    if (!current) return;
    // Leaving a cell with text in it that is refused drops the text: Enter is what shows why.
    commit(current, current.text);
    setEditing(null);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.target instanceof HTMLInputElement) return;
    const from = positionOf(event);
    if (!from) return;
    const line = lines[from.row];
    if (event.key === ' ') event.preventDefault();
    if (from.column === 0 && line?.kind === 'item' && line.hasChildren) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onToggle(line.item.id);
        return;
      }
    }
    const modifiers = {
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      meta: event.metaKey,
    };
    const start = entryStartedBy(event.key, modifiers);
    if (start && startEntry(from, start)) {
      event.preventDefault();
      return;
    }
    const to = movedFocus(from, event.key, modifiers, { rows: totalRow + 1, columns });
    if (!to) return;
    event.preventDefault();
    remember(to);
    focusCell(table.current, to);
  }

  const cell = (row: number, column: number) => ({
    'data-row': row,
    'data-column': column,
    tabIndex: row === tabStop.row && column === tabStop.column ? 0 : -1,
  });

  const figure = (steps: number, derived: boolean): string =>
    derived && steps === 0 ? '–' : formatSteps(steps, unit);

  return (
    <div className={styles.scroller}>
      <table
        ref={table}
        role="treegrid"
        aria-label={label}
        className={styles.grid}
        onFocus={(event) => {
          const at = positionOf(event);
          if (at) remember(at);
        }}
        onDoubleClick={(event) => {
          if (event.target instanceof HTMLInputElement) return;
          const at = positionOf(event);
          if (at) startEntry(at, { kind: 'open' });
        }}
        onKeyDown={onKeyDown}
      >
        <thead>
          <tr>
            <th scope="col" className={styles.corner}>
              Work item / person
            </th>
            {grid.months.map((month) => (
              <th key={month} scope="col" className={styles.number} title={formatMonth(month)}>
                {formatMonthShort(month)}
              </th>
            ))}
            <th scope="col" className={classes(styles.number, styles.totalColumn)}>
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, row) => {
            const derived = line.kind === 'item';
            return (
              <tr
                key={line.key}
                aria-level={line.depth}
                aria-expanded={
                  line.kind === 'item' && line.hasChildren
                    ? !collapsed.has(line.item.id)
                    : undefined
                }
                className={derived ? styles.derivedRow : styles.personRow}
              >
                <th
                  scope="row"
                  className={styles.rowHeader}
                  style={{ paddingLeft: `${String(8 + (line.depth - 1) * 18)}px` }}
                  {...cell(row, 0)}
                >
                  {line.kind === 'item' ? (
                    <>
                      <span
                        className={styles.toggle}
                        aria-hidden="true"
                        onClick={() => {
                          if (line.hasChildren) onToggle(line.item.id);
                        }}
                      >
                        {line.hasChildren ? (collapsed.has(line.item.id) ? '▸' : '▾') : ''}
                      </span>
                      <span className={styles.name}>{line.item.name}</span>
                      <span className={styles.derivedTag}>derived</span>
                    </>
                  ) : (
                    <span className={styles.name}>{line.name}</span>
                  )}
                </th>
                {line.cells.map((each, index) => (
                  <td
                    key={each.month}
                    aria-disabled={each.active ? undefined : true}
                    aria-readonly={derived ? true : undefined}
                    className={classes(
                      styles.number,
                      !each.active && styles.inactive,
                      each.allocation !== null && styles.planned,
                    )}
                    {...cell(row, index + 1)}
                  >
                    {editing?.key === line.key &&
                    editing.column === index + 1 &&
                    line.kind === 'person' ? (
                      <input
                        ref={focusOnMount}
                        className={styles.entry}
                        value={editing.text}
                        inputMode="decimal"
                        aria-label={`${line.name}, ${formatMonth(each.month)}`}
                        aria-invalid={editing.error !== null}
                        aria-describedby={editing.error === null ? undefined : errorId}
                        onChange={(event) => {
                          setEditing({ ...editing, text: event.target.value, error: null });
                        }}
                        onKeyDown={onInputKeyDown}
                        onBlur={onInputBlur}
                      />
                    ) : each.active && (derived || each.allocation !== null) ? (
                      figure(each.steps, derived)
                    ) : (
                      ''
                    )}
                  </td>
                ))}
                <td
                  aria-readonly="true"
                  className={classes(styles.number, styles.totalColumn)}
                  {...cell(row, columns - 1)}
                >
                  {figure(line.total, true)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className={styles.totalRow}>
            <th scope="row" className={styles.rowHeader} {...cell(totalRow, 0)}>
              Total
            </th>
            {grid.totals.cells.map((steps, index) => (
              <td
                key={grid.months[index]}
                aria-readonly="true"
                className={styles.number}
                {...cell(totalRow, index + 1)}
              >
                {figure(steps, true)}
              </td>
            ))}
            <td
              aria-readonly="true"
              className={classes(styles.number, styles.totalColumn)}
              {...cell(totalRow, columns - 1)}
            >
              {figure(grid.totals.total, true)}
            </td>
          </tr>
        </tfoot>
      </table>
      {editing?.error ? (
        <p id={errorId} role="alert" className={styles.entryError}>
          {editing.error}
        </p>
      ) : null}
    </div>
  );
}
