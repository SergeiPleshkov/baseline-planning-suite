import styles from './ItemPanel.module.css';

interface Props {
  readonly name: string;
  readonly path: string;
  readonly depth: number;
  readonly childCount: number;
  readonly allocationCount: number;
  readonly canAddChild: boolean;
  readonly onAddChild: () => void;
  readonly onRename: () => void;
  readonly onMove: () => void;
  readonly onDelete: () => void;
}

export function ItemPanel({
  name,
  path,
  depth,
  childCount,
  allocationCount,
  canAddChild,
  onAddChild,
  onRename,
  onMove,
  onDelete,
}: Props) {
  return (
    <section className={styles.panel} aria-label={`Selected item: ${name}`}>
      <h2 className={styles.name}>{name}</h2>
      {depth > 1 ? <p className={styles.facts}>{path}</p> : null}
      <p className={styles.facts}>
        Level {depth} ·{' '}
        {childCount > 0
          ? `${String(childCount)} ${childCount === 1 ? 'child' : 'children'}`
          : allocationCount > 0
            ? `holds ${String(allocationCount)} ${allocationCount === 1 ? 'allocation' : 'allocations'}`
            : 'no children and no allocations'}
      </p>

      <div className={styles.actions}>
        <button type="button" onClick={onAddChild} disabled={!canAddChild}>
          Add a child
        </button>
        <button type="button" onClick={onRename}>
          Rename
        </button>
        <button type="button" onClick={onMove}>
          Move…
        </button>
        <button type="button" onClick={onDelete}>
          Delete…
        </button>
      </div>

      {canAddChild ? (
        allocationCount > 0 ? (
          <p className={styles.hint}>
            Adding a child moves this item’s {allocationCount === 1 ? 'allocation' : 'allocations'}{' '}
            onto it: an item with children holds none itself.
          </p>
        ) : null
      ) : (
        <p className={styles.hint}>
          This is the third level, the deepest there is. To add an item next to it, select its
          parent.
        </p>
      )}
    </section>
  );
}
