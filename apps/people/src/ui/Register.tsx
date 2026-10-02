import type { DisplayCurrency } from '@baseline/host-contract';
import { useId } from 'react';
import type { CurrentRate, RegisterRow } from '../application/registerView';
import type { EmployeeId } from '../domain/ids';
import { formatDate, formatMoney } from './format';
import styles from './Register.module.css';

interface Props {
  readonly rows: readonly RegisterRow[];
  readonly total: number;
  readonly roles: readonly string[];
  readonly query: string;
  readonly role: string | null;
  readonly selected: EmployeeId | null;
  readonly currency: DisplayCurrency;
  readonly loadStatus: 'loading' | 'unavailable' | 'ready';
  readonly onQuery: (query: string) => void;
  readonly onRole: (role: string | null) => void;
  readonly onSelect: (id: EmployeeId) => void;
}

function rateText(current: CurrentRate, currency: DisplayCurrency): string {
  switch (current.kind) {
    case 'rate':
      return `${formatMoney(current.hourlyRateEur, currency)} / h`;
    case 'starts-later':
      return `from ${formatDate(current.from)}`;
    case 'none':
      return 'no rate';
  }
}

export function Register({
  rows,
  total,
  roles,
  query,
  role,
  selected,
  currency,
  loadStatus,
  onQuery,
  onRole,
  onSelect,
}: Props) {
  const id = useId();
  return (
    <section className={styles.register} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={styles.title}>
        Employees
      </h2>

      <div className={styles.filters}>
        <div className={styles.field}>
          <label htmlFor={`${id}-search`}>Search by name or role</label>
          <input
            id={`${id}-search`}
            type="search"
            value={query}
            autoComplete="off"
            onChange={(event) => {
              onQuery(event.target.value);
            }}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-role`}>Role</label>
          <select
            id={`${id}-role`}
            value={role ?? ''}
            onChange={(event) => {
              onRole(event.target.value === '' ? null : event.target.value);
            }}
          >
            <option value="">All roles</option>
            {roles.map((each) => (
              <option key={each} value={each}>
                {each}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className={styles.count} role="status">
        {rows.length === total
          ? `${String(total)} employees`
          : `${String(rows.length)} of ${String(total)} employees`}
        {loadStatus === 'unavailable' ? ' · load figures from Delivery are not available' : ''}
      </p>

      {rows.length === 0 ? (
        <p className={styles.empty}>Nobody matches. Try fewer words or another role.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Role</th>
              <th scope="col" className={styles.number}>
                Hours a week
              </th>
              <th scope="col">Hourly rate today</th>
              <th scope="col">Load</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.employee.id}
                className={row.employee.id === selected ? styles.selected : undefined}
              >
                <th scope="row">
                  <button
                    type="button"
                    className={styles.name}
                    aria-current={row.employee.id === selected ? 'true' : undefined}
                    onClick={() => {
                      onSelect(row.employee.id);
                    }}
                  >
                    {row.employee.name}
                  </button>
                </th>
                <td>{row.employee.role}</td>
                <td className={styles.number}>{row.employee.weeklyHours}</td>
                <td>{rateText(row.current, currency)}</td>
                <td>
                  {row.overMonths !== null && row.overMonths > 0 ? (
                    <span className={styles.badge}>
                      ▲ Over capacity in {row.overMonths}{' '}
                      {row.overMonths === 1 ? 'month' : 'months'}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
