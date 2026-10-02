import type { RemoteAppProps } from '@baseline/host-contract';
import { useMemo, useState } from 'react';
import type { PeopleStore } from '../application/peopleStore';
import { registerRows, rolesOf } from '../application/registerView';
import { isoDate } from '../domain/calendar';
import type { EmployeeId } from '../domain/ids';
import { EmployeeCard } from './EmployeeCard';
import styles from './PeopleScreen.module.css';
import { Register } from './Register';
import { usePeopleSnapshot } from './usePeopleStore';

interface Props {
  readonly host: RemoteAppProps['host'];
  readonly store: PeopleStore;
}

export function PeopleScreen({ host, store }: Props) {
  const { register, workload } = usePeopleSnapshot(store);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<string | null>(null);
  const [selected, setSelected] = useState<EmployeeId | null>(null);
  // Rates change on whole days, UTC like every date here; "today" is read once per visit.
  const today = useMemo(() => isoDate(new Date().toISOString().slice(0, 10)), []);

  if (register.status === 'loading') {
    return (
      <p role="status" className={styles.message}>
        Loading the register…
      </p>
    );
  }
  if (register.status === 'failed') {
    return (
      <div role="alert" className={styles.message}>
        <p>The register could not be loaded: {register.message}</p>
        <button
          type="button"
          onClick={() => {
            void store.load();
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  const load = workload.status === 'ready' ? workload.byEmployee : null;
  const rows = registerRows({
    employees: register.employees,
    histories: register.histories,
    load,
    query,
    role,
    today,
  });
  const chosen = register.employees.find((each) => each.id === selected);
  const history = chosen ? register.histories.get(chosen.id) : undefined;

  return (
    <div className={styles.layout}>
      {register.stale === null ? null : (
        <div role="alert" className={styles.stale}>
          <p>The list could not be refreshed, so it may be out of date: {register.stale}</p>
          <button
            type="button"
            onClick={() => {
              void store.load();
            }}
          >
            Retry
          </button>
        </div>
      )}
      <Register
        rows={rows}
        total={register.employees.length}
        roles={rolesOf(register.employees)}
        query={query}
        role={role}
        selected={selected}
        currency={host.displayCurrency}
        loadStatus={workload.status}
        onQuery={setQuery}
        onRole={setRole}
        onSelect={setSelected}
      />
      {chosen && history ? (
        <EmployeeCard
          key={chosen.id}
          employee={chosen}
          history={history}
          workload={workload}
          currency={host.displayCurrency}
          store={store}
        />
      ) : (
        <p className={styles.hint}>Choose an employee to see and edit their hourly rates.</p>
      )}
    </div>
  );
}
