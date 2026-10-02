import { useId } from 'react';
import type { WorkloadView } from '../application/peopleStore';
import type { EmployeeId } from '../domain/ids';
import { formatCapacity, formatMonth } from './format';
import styles from './MonthlyLoad.module.css';

interface Props {
  readonly employeeId: EmployeeId;
  readonly workload: WorkloadView;
  readonly onRetry: () => void;
}

/** Delivery's figures: share of the person's capacity per month, summed over every project. */
export function MonthlyLoad({ employeeId, workload, onRetry }: Props) {
  const id = useId();
  const heading = (
    <h3 id={id} className={styles.heading}>
      Monthly load
    </h3>
  );

  if (workload.status === 'loading') {
    return (
      <section aria-labelledby={id}>
        {heading}
        <p className={styles.note} role="status">
          Loading the load from Delivery…
        </p>
      </section>
    );
  }
  if (workload.status === 'unavailable') {
    return (
      <section aria-labelledby={id}>
        {heading}
        <p className={styles.note} role="status">
          Delivery’s figures are not available right now, so the load is not shown.{' '}
          <button type="button" className={styles.link} onClick={onRetry}>
            Try again
          </button>
        </p>
      </section>
    );
  }

  const load = workload.byEmployee.get(employeeId);
  if (!load || load.months.length === 0) {
    return (
      <section aria-labelledby={id}>
        {heading}
        <p className={styles.note}>Not allocated to any project yet.</p>
      </section>
    );
  }
  return (
    <section aria-labelledby={id}>
      {heading}
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col" className={styles.number}>
              Load
            </th>
            <th scope="col">
              <span className={styles.visuallyHidden}>Status</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {load.months.map((month) => (
            <tr key={month.month} className={month.status === 'over' ? styles.over : undefined}>
              <td>{formatMonth(month.month)}</td>
              <td className={styles.number}>{formatCapacity(month.personMonths)}</td>
              <td>{month.status === 'over' ? '▲ Over capacity' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
