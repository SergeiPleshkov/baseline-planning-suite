import { useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import { formatSteps } from '../application/figures';
import {
  movedFocus,
  rememberFocus,
  tabStopOf,
  type GridPosition,
  type RememberedFocus,
} from '../application/gridNavigation';
import { visibleLines, type Grid } from '../application/gridView';
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
}

const classes = (...names: (string | false | undefined)[]): string =>
  names.filter(Boolean).join(' ');

/** The body or footer cell an event came from, by the position it was rendered at. */
function positionOf(event: SyntheticEvent): GridPosition | null {
  const cell =
    event.target instanceof Element ? event.target.closest<HTMLElement>('[data-row]') : null;
  if (!cell) return null;
  return { row: Number(cell.dataset['row']), column: Number(cell.dataset['column']) };
}

/**
 * The staffing grid as an ARIA treegrid: one tab stop, arrow keys move between cells. Rows are the
 * breakdown, with the people allocated to each leaf below it; a breakdown row's figures are sums of
 * what is below it and are marked DERIVED. The last row holds the totals of the whole project.
 */
export function StaffingGrid({ label, grid, unit, collapsed, onToggle }: Props) {
  const table = useRef<HTMLTableElement>(null);
  const lines = visibleLines(grid.lines, collapsed);
  const columns = grid.months.length + 2;
  const totalRow = lines.length;
  const lineKeys = lines.map((line) => line.key);

  const [focus, setFocus] = useState<RememberedFocus>({ key: null, column: 0 });
  const tabStop = tabStopOf(focus, lineKeys, columns);
  const remember = (position: GridPosition) => {
    setFocus(rememberFocus(position, lineKeys));
  };

  function onKeyDown(event: KeyboardEvent) {
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
    const to = movedFocus(
      from,
      event.key,
      { ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey },
      { rows: totalRow + 1, columns },
    );
    if (!to) return;
    event.preventDefault();
    remember(to);
    table.current
      ?.querySelector<HTMLElement>(
        `[data-row="${String(to.row)}"][data-column="${String(to.column)}"]`,
      )
      ?.focus();
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
        aria-readonly="true"
        className={styles.grid}
        onFocus={(event) => {
          const at = positionOf(event);
          if (at) remember(at);
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
                    className={classes(
                      styles.number,
                      !each.active && styles.inactive,
                      each.allocation !== null && styles.planned,
                    )}
                    {...cell(row, index + 1)}
                  >
                    {each.active && (derived || each.allocation !== null)
                      ? figure(each.steps, derived)
                      : ''}
                  </td>
                ))}
                <td
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
              <td key={grid.months[index]} className={styles.number} {...cell(totalRow, index + 1)}>
                {figure(steps, true)}
              </td>
            ))}
            <td
              className={classes(styles.number, styles.totalColumn)}
              {...cell(totalRow, columns - 1)}
            >
              {figure(grid.totals.total, true)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
