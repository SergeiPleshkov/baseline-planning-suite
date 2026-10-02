import type { DisplayCurrency } from '@baseline/host-contract';
import { useEffect, useId, useRef, useState } from 'react';
import type { PeopleStore } from '../application/peopleStore';
import type { CommandResult } from '../application/ports';
import { dayBefore } from '../domain/calendar';
import type { Employee } from '../domain/employees';
import { effectivePeriods, type EffectivePeriod, type RateHistory } from '../domain/rates';
import { formatDate, formatMoney } from './format';
import { RateForm } from './RateForm';
import styles from './RateHistoryEditor.module.css';

type Commands = Pick<PeopleStore, 'addRate' | 'correctRate' | 'removeRate' | 'clearRates'>;

interface Props {
  readonly employee: Employee;
  readonly history: RateHistory;
  readonly currency: DisplayCurrency;
  readonly commands: Commands;
  /** Tells the person what happened; an empty message clears the last one. */
  readonly onSaved: (message: string) => void;
}

type Mode =
  | { readonly kind: 'idle' }
  | { readonly kind: 'adding' }
  | { readonly kind: 'editing'; readonly id: string }
  | { readonly kind: 'removing'; readonly id: string }
  | { readonly kind: 'clearing' };

function consequenceOfRemoving(
  periods: readonly EffectivePeriod[],
  index: number,
  currency: DisplayCurrency,
): string {
  const removed = periods[index];
  const previous = periods[index - 1];
  const next = periods[index + 1];
  if (!removed) return '';
  if (!previous) {
    return next
      ? `The days before ${formatDate(next.from)} will have no rate: they cost nothing and are reported as unpriced.`
      : '';
  }
  const runsOn = `${formatMoney(previous.record.hourlyRateEur, currency)} an hour`;
  return next
    ? `${runsOn} will run on until ${formatDate(dayBefore(next.from))}.`
    : `${runsOn} will run on with no end.`;
}

export function RateHistoryEditor({ employee, history, currency, commands, onSaved }: Props) {
  const headingId = useId();
  const [chosen, setChosen] = useState<Mode>({ kind: 'idle' });
  const [failure, setFailure] = useState<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const wasIdle = useRef(true);
  const periods = effectivePeriods(history);
  const showsEur = currency.code === 'EUR';

  // A rate that vanished (read again after a change elsewhere) cannot be the subject of a form.
  const mode: Mode =
    (chosen.kind === 'editing' || chosen.kind === 'removing') &&
    !periods.some((period) => period.record.id === chosen.id)
      ? { kind: 'idle' }
      : chosen;

  const open = (next: Mode) => {
    setChosen(next);
    setFailure(null);
    onSaved('');
  };

  const finish = (message: string) => {
    setChosen({ kind: 'idle' });
    setFailure(null);
    onSaved(message);
  };

  async function confirm(run: () => Promise<CommandResult>, done: string) {
    setFailure(null);
    const result = await run();
    if (result.ok) finish(done);
    else setFailure(result.message);
  }

  // Closing a form or a confirmation removes what had the focus: hand it back to the trigger.
  useEffect(() => {
    if (mode.kind === 'idle' && !wasIdle.current) addButton.current?.focus();
    wasIdle.current = mode.kind === 'idle';
  }, [mode.kind]);

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <div className={styles.heading}>
        <h3 id={headingId}>Hourly rates</h3>
        {mode.kind === 'idle' ? (
          <button
            ref={addButton}
            type="button"
            onClick={() => {
              open({ kind: 'adding' });
            }}
          >
            Add a rate
          </button>
        ) : null}
      </div>

      {periods.length === 0 ? (
        <p className={styles.empty}>
          No rates yet. Until one starts, {employee.name}’s days cost nothing and are reported as
          unpriced.
        </p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">From</th>
              <th scope="col">Until</th>
              <th scope="col" className={styles.number}>
                EUR an hour
              </th>
              {showsEur ? null : (
                <th scope="col" className={styles.number}>
                  {currency.code} an hour
                </th>
              )}
              <th scope="col">
                <span className={styles.visuallyHidden}>Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {periods.map((period, index) => {
              const { record } = period;
              const editing = mode.kind === 'editing' && mode.id === record.id;
              const removing = mode.kind === 'removing' && mode.id === record.id;
              return (
                <RateRow
                  key={record.id}
                  columns={showsEur ? 4 : 5}
                  cells={
                    <>
                      <td>{formatDate(period.from)}</td>
                      <td>{period.to === null ? 'no end' : formatDate(period.to)}</td>
                      <td className={styles.number}>{record.hourlyRateEur.toFixed(2)}</td>
                      {showsEur ? null : (
                        <td className={styles.number}>
                          {formatMoney(record.hourlyRateEur, currency)}
                        </td>
                      )}
                      <td className={styles.actions}>
                        <button
                          type="button"
                          disabled={mode.kind !== 'idle'}
                          aria-label={`Edit the rate from ${formatDate(period.from)}`}
                          onClick={() => {
                            open({ kind: 'editing', id: record.id });
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={mode.kind !== 'idle'}
                          aria-label={`Remove the rate from ${formatDate(period.from)}`}
                          onClick={() => {
                            open(
                              periods.length === 1
                                ? { kind: 'clearing' }
                                : { kind: 'removing', id: record.id },
                            );
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    </>
                  }
                  below={
                    editing ? (
                      <RateForm
                        label={`Edit the rate from ${formatDate(period.from)}`}
                        submitLabel="Save"
                        initial={{
                          validFrom: record.validFrom,
                          hourlyRateEur: String(record.hourlyRateEur),
                        }}
                        currency={currency}
                        onSubmit={async (values) => {
                          const result = await commands.correctRate(record.id, values);
                          if (result.ok) finish('Rate saved.');
                          return result;
                        }}
                        onCancel={() => {
                          setChosen({ kind: 'idle' });
                        }}
                      />
                    ) : removing ? (
                      <Confirmation
                        question={`Remove the rate from ${formatDate(period.from)}?`}
                        consequence={consequenceOfRemoving(periods, index, currency)}
                        confirmLabel="Remove rate"
                        failure={failure}
                        onConfirm={() =>
                          confirm(() => commands.removeRate(record.id), 'Rate removed.')
                        }
                        onCancel={() => {
                          setChosen({ kind: 'idle' });
                          setFailure(null);
                        }}
                      />
                    ) : null
                  }
                />
              );
            })}
          </tbody>
        </table>
      )}

      {mode.kind === 'adding' ? (
        <div className={styles.panel}>
          <RateForm
            label="Add a rate"
            submitLabel="Add rate"
            initial={{ validFrom: '', hourlyRateEur: '' }}
            currency={currency}
            onSubmit={async (values) => {
              const result = await commands.addRate(employee.id, values);
              if (result.ok) finish('Rate added.');
              return result;
            }}
            onCancel={() => {
              setChosen({ kind: 'idle' });
            }}
          />
          <p className={styles.hint}>
            A rate can start in the past: it applies from that day until the next rate begins.
          </p>
        </div>
      ) : null}

      {mode.kind === 'clearing' ? (
        <div className={styles.panel}>
          <Confirmation
            question={`Remove all rates of ${employee.name}?`}
            consequence={`${employee.name} will have no rate at all: every day costs nothing and is reported as unpriced.`}
            confirmLabel="Remove all rates"
            failure={failure}
            onConfirm={() => confirm(() => commands.clearRates(employee.id), 'All rates removed.')}
            onCancel={() => {
              setChosen({ kind: 'idle' });
              setFailure(null);
            }}
          />
        </div>
      ) : null}

      {mode.kind === 'idle' && periods.length > 1 ? (
        <p className={styles.hint}>
          <button
            type="button"
            className={styles.link}
            onClick={() => {
              open({ kind: 'clearing' });
            }}
          >
            Remove all rates
          </button>
        </p>
      ) : null}
    </section>
  );
}

function RateRow({
  cells,
  below,
  columns,
}: {
  readonly cells: React.ReactNode;
  readonly below: React.ReactNode;
  readonly columns: number;
}) {
  return (
    <>
      <tr>{cells}</tr>
      {below ? (
        <tr>
          <td colSpan={columns} className={styles.rowPanel}>
            {below}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Confirmation({
  question,
  consequence,
  confirmLabel,
  failure,
  onConfirm,
  onCancel,
}: {
  readonly question: string;
  readonly consequence: string;
  readonly confirmLabel: string;
  readonly failure: string | null;
  readonly onConfirm: () => Promise<void>;
  readonly onCancel: () => void;
}) {
  const [pending, setPending] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    container.current?.focus();
  }, []);
  return (
    <div
      ref={container}
      tabIndex={-1}
      role="group"
      aria-label={question}
      className={styles.confirmation}
    >
      <p className={styles.question}>{question}</p>
      {consequence ? <p>{consequence}</p> : null}
      <div className={styles.confirmActions}>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setPending(true);
            void onConfirm().finally(() => {
              setPending(false);
            });
          }}
        >
          {pending ? 'Removing…' : confirmLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
      </div>
      {failure ? <p role="alert">{failure}</p> : null}
    </div>
  );
}
