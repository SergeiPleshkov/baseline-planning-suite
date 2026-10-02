import type { DisplayCurrency } from '@baseline/host-contract';
import { useId, useRef, useState, type SyntheticEvent } from 'react';
import type { CommandResult } from '../application/ports';
import { parseDateInput, parseHourlyRateInput } from '../application/rateForm';
import type { IsoDate } from '../domain/calendar';
import { formatMoney } from './format';
import styles from './RateForm.module.css';

interface Props {
  /** Names the form for assistive technology: "Add a rate", "Edit the rate from 12 Mar 2026". */
  readonly label: string;
  readonly submitLabel: string;
  readonly initial: { readonly validFrom: string; readonly hourlyRateEur: string };
  readonly currency: DisplayCurrency;
  readonly onSubmit: (values: {
    readonly validFrom: IsoDate;
    readonly hourlyRateEur: number;
  }) => Promise<CommandResult>;
  readonly onCancel?: () => void;
}

/**
 * The rate is typed in EUR, the currency it is stored in: a value typed in another currency would
 * seldom convert to a whole cent. The equivalent in the display currency is shown beside it.
 */
export function RateForm({ label, submitLabel, initial, currency, onSubmit, onCancel }: Props) {
  const id = useId();
  const [validFrom, setValidFrom] = useState(initial.validFrom);
  const [rate, setRate] = useState(initial.hourlyRateEur);
  const [shown, setShown] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const dateInput = useRef<HTMLInputElement>(null);
  const rateInput = useRef<HTMLInputElement>(null);

  const date = parseDateInput(validFrom);
  const amount = parseHourlyRateInput(rate);
  const dateError = shown && !date.ok ? date.error : null;
  const rateError = shown && !amount.ok ? amount.error : null;

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    setShown(true);
    if (!date.ok) {
      dateInput.current?.focus();
      return;
    }
    if (!amount.ok) {
      rateInput.current?.focus();
      return;
    }
    setPending(true);
    setRefusal(null);
    const result = await onSubmit({ validFrom: date.value, hourlyRateEur: amount.value });
    setPending(false);
    if (!result.ok) setRefusal(result.message);
  }

  return (
    <form
      className={styles.form}
      onSubmit={(event) => void submit(event)}
      aria-label={label}
      noValidate
    >
      <div className={styles.field}>
        <label htmlFor={`${id}-from`}>Starts on</label>
        <input
          ref={dateInput}
          // A form that opens takes the focus: the button that opened it is gone.
          autoFocus
          id={`${id}-from`}
          type="date"
          placeholder="YYYY-MM-DD"
          value={validFrom}
          onChange={(event) => {
            setValidFrom(event.target.value);
            setRefusal(null);
          }}
          aria-invalid={dateError !== null}
          aria-describedby={dateError ? `${id}-from-error` : undefined}
        />
        {dateError ? (
          <p id={`${id}-from-error`} role="alert" className={styles.error}>
            {dateError}
          </p>
        ) : null}
      </div>

      <div className={styles.field}>
        <label htmlFor={`${id}-rate`}>Hourly rate, EUR</label>
        <input
          ref={rateInput}
          id={`${id}-rate`}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={rate}
          onChange={(event) => {
            setRate(event.target.value);
            setRefusal(null);
          }}
          aria-invalid={rateError !== null}
          aria-describedby={`${id}-rate-hint${rateError ? ` ${id}-rate-error` : ''}`}
        />
        <p id={`${id}-rate-hint`} className={styles.hint}>
          {amount.ok && currency.code !== 'EUR'
            ? `${formatMoney(amount.value, currency)} an hour in ${currency.code}`
            : amount.ok
              ? `Reads as ${amount.value.toFixed(2)} EUR an hour`
              : 'Up to two decimals'}
        </p>
        {rateError ? (
          <p id={`${id}-rate-error`} role="alert" className={styles.error}>
            {rateError}
          </p>
        ) : null}
      </div>

      <div className={styles.actions}>
        <button type="submit" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} disabled={pending}>
            Cancel
          </button>
        ) : null}
      </div>

      {refusal ? (
        <p role="alert" className={styles.error}>
          {refusal}
        </p>
      ) : null}
    </form>
  );
}
