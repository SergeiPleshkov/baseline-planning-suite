import { useEffect, useId, useRef, type ReactNode } from 'react';
import styles from './Modal.module.css';

interface Props {
  readonly title: string;
  /** False while something is being saved: Escape and a click outside then do nothing. */
  readonly dismissible?: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/**
 * A native `<dialog>` opened as a modal: the browser traps focus inside, closes it on Escape and
 * gives the focus back to what opened it. It is rendered only while it is wanted.
 */
export function Modal({ title, dismissible = true, onClose, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pressedOutside = useRef(false);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    return () => {
      if (element.open) element.close();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        if (!dismissible) event.preventDefault();
      }}
      onClose={() => {
        // Under StrictMode the dialog is closed and opened again at once, and the close event of
        // the first lands after the second: a dialog that is open is not one that was dismissed.
        if (!dialog.current?.open) onClose();
      }}
      onMouseDown={(event) => {
        pressedOutside.current = event.target === dialog.current;
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself, not on its content. It counts
        // only if it also began there: selecting text and letting go outside must not close it.
        if (event.target === dialog.current && pressedOutside.current && dismissible) onClose();
      }}
    >
      <div className={styles.content}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}
