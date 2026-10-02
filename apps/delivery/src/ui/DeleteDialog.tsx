import { useEffect, useEffectEvent, useState } from 'react';
import type { DeliveryStore } from '../application/deliveryStore';
import type { DeletionSummaryDto } from '../application/planDocument';
import type { BreakdownItemId } from '../domain/ids';
import styles from './Dialogs.module.css';
import { formatDecimal } from './format';
import { Modal } from './Modal';

interface Props {
  readonly itemId: BreakdownItemId;
  readonly itemName: string;
  readonly store: Pick<DeliveryStore, 'deletionSummary' | 'deleteItem'>;
  /** The names of the items the summary lists, as the screen knows them when it arrives. */
  readonly namesOf: (ids: readonly string[]) => readonly string[];
  readonly onDeleted: () => void;
  readonly onClose: () => void;
}

type Summary =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly message: string }
  | {
      readonly status: 'ready';
      readonly summary: DeletionSummaryDto;
      /** Fixed on arrival: deleting removes the items from the screen's plan, and their names with them. */
      readonly names: readonly string[];
    };

const plural = (count: number, one: string, many: string) =>
  `${String(count)} ${count === 1 ? one : many}`;

/**
 * Deletion takes a whole subtree and its allocations, so the person sees exactly what goes and
 * confirms that. If the service finds the subtree changed meanwhile it deletes nothing, and the
 * summary is read again for another look.
 */
export function DeleteDialog({ itemId, itemName, store, namesOf, onDeleted, onClose }: Props) {
  const [summary, setSummary] = useState<Summary>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const arrived = useEffectEvent((result: Awaited<ReturnType<typeof store.deletionSummary>>) => {
    setSummary(
      result.ok
        ? { status: 'ready', summary: result.summary, names: namesOf(result.summary.items) }
        : { status: 'failed', message: result.message },
    );
  });

  useEffect(() => {
    let cancelled = false;
    void store.deletionSummary(itemId).then((result) => {
      if (!cancelled) arrived(result);
    });
    return () => {
      cancelled = true;
    };
  }, [store, itemId, attempt]);

  async function confirm() {
    if (summary.status !== 'ready') return;
    setPending(true);
    setRefusal(null);
    const result = await store.deleteItem(summary.summary);
    setPending(false);
    if (result.ok) {
      onDeleted();
      return;
    }
    setRefusal(result.message);
    setSummary({ status: 'loading' });
    setAttempt((count) => count + 1);
  }

  return (
    <Modal title={`Delete “${itemName}”?`} dismissible={!pending} onClose={onClose}>
      {summary.status === 'loading' ? <p role="status">Checking what this would delete…</p> : null}
      {summary.status === 'failed' ? <p role="alert">{summary.message}</p> : null}
      {summary.status === 'ready' ? (
        <div className={styles.summary}>
          <p>
            This deletes {plural(summary.summary.items.length, 'item', 'items')}
            {summary.summary.allocations.length > 0
              ? ` and ${plural(summary.summary.allocations.length, 'allocation', 'allocations')} totalling ${formatDecimal(summary.summary.personMonths)} person-months`
              : ', none of which holds allocations'}
            :
          </p>
          <ul className={styles.names}>
            {summary.names.map((name, index) => (
              <li key={`${String(index)}-${name}`}>{name}</li>
            ))}
          </ul>
          <p>This cannot be undone.</p>
        </div>
      ) : null}
      {refusal ? (
        <p role="alert" className={styles.error}>
          {refusal}
        </p>
      ) : null}
      <div className={styles.actions}>
        <button type="button" onClick={onClose} disabled={pending}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.danger}
          disabled={summary.status !== 'ready' || pending}
          onClick={() => void confirm()}
        >
          {pending ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </Modal>
  );
}
