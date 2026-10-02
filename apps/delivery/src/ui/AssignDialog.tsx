import { useId, useState, type SyntheticEvent } from 'react';
import type { LeafOption } from '../application/treeView';
import type { BreakdownItemId, EmployeeId } from '../domain/ids';
import styles from './Dialogs.module.css';
import { Modal } from './Modal';

export interface PersonOption {
  readonly id: EmployeeId;
  readonly name: string;
}

interface Props {
  readonly leaves: readonly LeafOption[];
  readonly people: readonly PersonOption[];
  readonly onSubmit: (item: BreakdownItemId, employee: EmployeeId) => void;
  readonly onClose: () => void;
}

const NOTHING = '';

/**
 * Gives a person a row on a leaf, to enter their allocations in. Nothing is stored until a figure is
 * entered; nothing is preselected, because assigning is a deliberate choice.
 */
export function AssignDialog({ leaves, people, onSubmit, onClose }: Props) {
  const leafId = useId();
  const personId = useId();
  const [leaf, setLeaf] = useState(NOTHING);
  const [person, setPerson] = useState(NOTHING);
  const chosenLeaf = leaves.find((each) => each.id === leaf);
  const chosenPerson = people.find((each) => each.id === person);

  function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (!chosenLeaf || !chosenPerson) return;
    onSubmit(chosenLeaf.id, chosenPerson.id);
    onClose();
  }

  return (
    <Modal title="Assign a person" onClose={onClose}>
      {leaves.length === 0 ? (
        <>
          <p>This project has no work items to assign people to yet.</p>
          <div className={styles.actions}>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={submit} className={styles.form}>
          <div className={styles.field}>
            <label htmlFor={leafId}>Work item</label>
            <select
              id={leafId}
              value={leaf}
              onChange={(event) => {
                setLeaf(event.target.value);
              }}
            >
              <option value={NOTHING}>Choose a work item…</option>
              {leaves.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.label}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor={personId}>Person</label>
            <select
              id={personId}
              value={person}
              onChange={(event) => {
                setPerson(event.target.value);
              }}
            >
              <option value={NOTHING}>Choose a person…</option>
              {people.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.name}
                </option>
              ))}
            </select>
          </div>
          <p className={styles.hint}>
            Only the lowest level of the breakdown takes people. They get a row to enter months in.
          </p>
          <div className={styles.actions}>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={!chosenLeaf || !chosenPerson}>
              Assign
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
