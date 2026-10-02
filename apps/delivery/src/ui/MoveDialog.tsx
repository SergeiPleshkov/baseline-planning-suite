import { useId, useState, type SyntheticEvent } from 'react';
import type { MoveTarget } from '../application/treeView';
import type { BreakdownItemId } from '../domain/ids';
import styles from './Dialogs.module.css';
import { Modal } from './Modal';

interface Props {
  readonly itemName: string;
  /** The places the item may go, worked out when the dialog was opened. */
  readonly targets: readonly MoveTarget[];
  readonly onSubmit: (
    parent: BreakdownItemId | null,
  ) => Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
  readonly onClose: () => void;
}

const TOP = 'top-level';
const NOTHING = '';

/**
 * Only places the item may go are offered, so the person cannot pick one that would be refused.
 * Nothing is preselected: a move is a deliberate choice, not whatever happens to be first.
 */
export function MoveDialog({ itemName, targets, onSubmit, onClose }: Props) {
  const selectId = useId();
  const [chosen, setChosen] = useState(NOTHING);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const keyOf = (target: MoveTarget) => target.parent ?? TOP;
  const target = targets.find((each) => keyOf(each) === chosen);

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (!target) return;
    setPending(true);
    setRefusal(null);
    const result = await onSubmit(target.parent);
    setPending(false);
    if (result.ok) onClose();
    else setRefusal(result.message);
  }

  return (
    <Modal title={`Move “${itemName}”`} dismissible={!pending} onClose={onClose}>
      {targets.length === 0 ? (
        <>
          <p>
            There is nowhere else this item can go: below the top, the breakdown is at most three
            levels deep, and an item that holds allocations cannot take children by a move.
          </p>
          <div className={styles.actions}>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={(event) => void submit(event)} className={styles.form}>
          <div className={styles.field}>
            <label htmlFor={selectId}>Move under</label>
            <select
              id={selectId}
              value={chosen}
              disabled={pending}
              onChange={(event) => {
                setChosen(event.target.value);
              }}
            >
              <option value={NOTHING}>Choose a place…</option>
              {targets.map((each) => (
                <option key={keyOf(each)} value={keyOf(each)}>
                  {each.label}
                </option>
              ))}
            </select>
          </div>
          <p className={styles.hint}>
            Only places where it fits are listed. Everything below the item moves with it.
          </p>
          {refusal ? (
            <p role="alert" className={styles.error}>
              {refusal}
            </p>
          ) : null}
          <div className={styles.actions}>
            <button type="button" onClick={onClose} disabled={pending}>
              Cancel
            </button>
            <button type="submit" disabled={pending || !target}>
              {pending ? 'Moving…' : 'Move'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
