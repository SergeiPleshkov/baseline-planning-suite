import { useRef, type KeyboardEvent } from 'react';
import { nextTreeAction, type TreeRow } from '../application/treeView';
import type { BreakdownItemId } from '../domain/ids';
import styles from './BreakdownTree.module.css';

interface Props {
  readonly label: string;
  readonly rows: readonly TreeRow[];
  readonly selected: BreakdownItemId | null;
  readonly onSelect: (id: BreakdownItemId) => void;
  readonly onToggle: (id: BreakdownItemId) => void;
}

/**
 * The work breakdown as an ARIA tree: one tab stop, arrow keys move between rows (Right opens or
 * enters an item, Left closes it or goes to its parent), and the row that has the focus is the
 * selected one.
 */
export function BreakdownTree({ label, rows, selected, onSelect, onToggle }: Props) {
  const elements = useRef(new Map<BreakdownItemId, HTMLDivElement>());
  const tabStop = rows.some((row) => row.item.id === selected) ? selected : rows[0]?.item.id;

  function onKeyDown(event: KeyboardEvent, index: number) {
    const action = nextTreeAction(rows, index, event.key);
    if (!action) return;
    event.preventDefault();
    if (action.kind === 'toggle') {
      onToggle(action.id);
      return;
    }
    onSelect(action.id);
    elements.current.get(action.id)?.focus();
  }

  return (
    <div role="tree" aria-label={label} className={styles.tree}>
      {rows.map((row, index) => (
        <div
          key={row.item.id}
          ref={(element) => {
            if (element) elements.current.set(row.item.id, element);
            else elements.current.delete(row.item.id);
          }}
          role="treeitem"
          aria-level={row.depth}
          aria-posinset={row.position}
          aria-setsize={row.setSize}
          aria-selected={row.item.id === selected}
          aria-expanded={row.hasChildren ? row.expanded : undefined}
          tabIndex={row.item.id === tabStop ? 0 : -1}
          className={[styles.row, row.item.id === selected ? styles.selected : undefined]
            .filter(Boolean)
            .join(' ')}
          style={{ paddingLeft: `${String(8 + (row.depth - 1) * 20)}px` }}
          onFocus={() => {
            if (row.item.id !== selected) onSelect(row.item.id);
          }}
          onClick={() => {
            onSelect(row.item.id);
          }}
          onKeyDown={(event) => {
            onKeyDown(event, index);
          }}
        >
          <span
            className={styles.toggle}
            aria-hidden="true"
            onClick={(event) => {
              if (!row.hasChildren) return;
              event.stopPropagation();
              onToggle(row.item.id);
            }}
          >
            {row.hasChildren ? (row.expanded ? '▾' : '▸') : ''}
          </span>
          <span className={styles.name}>{row.item.name}</span>
          {row.allocationCount > 0 ? (
            <span className={styles.meta}>
              {row.allocationCount} {row.allocationCount === 1 ? 'allocation' : 'allocations'}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
