import { useId, useState, type SyntheticEvent } from 'react';
import { messageFor } from '../application/messages';
import styles from './Dialogs.module.css';
import { Modal } from './Modal';

interface Props {
  readonly title: string;
  readonly submitLabel: string;
  readonly initialName: string;
  readonly onSubmit: (
    name: string,
  ) => Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
  readonly onClose: () => void;
}

/** The service refuses names over this length; the field says so before the request is sent. */
const MAX_NAME_LENGTH = 200;

export function NameDialog({ title, submitLabel, initialName, onSubmit, onClose }: Props) {
  const inputId = useId();
  const errorId = useId();
  const [name, setName] = useState(initialName);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (name.trim() === '') {
      setRefusal(messageFor('blank-name'));
      return;
    }
    setPending(true);
    setRefusal(null);
    const result = await onSubmit(name);
    setPending(false);
    if (result.ok) onClose();
    else setRefusal(result.message);
  }

  return (
    <Modal title={title} dismissible={!pending} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} noValidate className={styles.form}>
        <div className={styles.field}>
          <label htmlFor={inputId}>Name</label>
          <input
            id={inputId}
            type="text"
            value={name}
            autoComplete="off"
            maxLength={Math.max(MAX_NAME_LENGTH, initialName.length)}
            aria-invalid={refusal !== null}
            aria-describedby={refusal ? errorId : undefined}
            onChange={(event) => {
              setName(event.target.value);
              setRefusal(null);
            }}
          />
        </div>
        {refusal ? (
          <p id={errorId} role="alert" className={styles.error}>
            {refusal}
          </p>
        ) : null}
        <div className={styles.actions}>
          <button type="button" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" disabled={pending}>
            {pending ? 'Saving…' : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
