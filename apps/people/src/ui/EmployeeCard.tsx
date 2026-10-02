import type { DisplayCurrency } from '@baseline/host-contract';
import { useEffect, useId, useRef, useState } from 'react';
import type { PeopleStore, WorkloadView } from '../application/peopleStore';
import type { Employee } from '../domain/employees';
import type { RateHistory } from '../domain/rates';
import styles from './EmployeeCard.module.css';
import { MonthlyLoad } from './MonthlyLoad';
import { RateHistoryEditor } from './RateHistoryEditor';

interface Props {
  readonly employee: Employee;
  readonly history: RateHistory;
  readonly workload: WorkloadView;
  readonly currency: DisplayCurrency;
  readonly store: PeopleStore;
}

export function EmployeeCard({ employee, history, workload, currency, store }: Props) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [saved, setSaved] = useState('');

  // Choosing someone moves the reader to their card, which sits beside the list.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <article className={styles.card} aria-labelledby={headingId}>
      <header>
        <h2 id={headingId} ref={heading} tabIndex={-1} className={styles.name}>
          {employee.name}
        </h2>
        <p className={styles.facts}>
          {employee.role} · {employee.weeklyHours} hours a week
        </p>
        <p className={styles.saved} role="status">
          {saved}
        </p>
      </header>

      <RateHistoryEditor
        employee={employee}
        history={history}
        currency={currency}
        commands={store}
        onSaved={setSaved}
      />

      <MonthlyLoad
        employeeId={employee.id}
        workload={workload}
        onRetry={() => {
          void store.reloadWorkload();
        }}
      />
    </article>
  );
}
