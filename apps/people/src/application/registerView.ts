import type { IsoDate } from '../domain/calendar';
import { searchEmployees, type Employee } from '../domain/employees';
import type { EmployeeId } from '../domain/ids';
import { rateOn, type RateHistory } from '../domain/rates';
import type { EmployeeLoad } from './peopleStore';

export type CurrentRate =
  | { readonly kind: 'rate'; readonly hourlyRateEur: number }
  | { readonly kind: 'starts-later'; readonly from: IsoDate }
  | { readonly kind: 'none' };

export function currentRate(history: RateHistory, today: IsoDate): CurrentRate {
  const rate = rateOn(history, today);
  if (rate !== null) return { kind: 'rate', hourlyRateEur: rate };
  const first = history.records[0];
  return first ? { kind: 'starts-later', from: first.validFrom } : { kind: 'none' };
}

export interface RegisterRow {
  readonly employee: Employee;
  readonly current: CurrentRate;
  /** Months over capacity; `null` while Delivery's figures are not available. */
  readonly overMonths: number | null;
}

// One locale for everyone, so that the list comes out the same in every browser.
const collator = new Intl.Collator('en-GB', { numeric: true });

export const rolesOf = (employees: readonly Employee[]): string[] =>
  [...new Set(employees.map((employee) => employee.role))].sort((a, b) => collator.compare(a, b));

/** Employees matching the query and, if given, the role; in register order. */
export function registerRows(input: {
  readonly employees: readonly Employee[];
  readonly histories: ReadonlyMap<EmployeeId, RateHistory>;
  readonly load: ReadonlyMap<EmployeeId, EmployeeLoad> | null;
  readonly query: string;
  readonly role: string | null;
  readonly today: IsoDate;
}): RegisterRow[] {
  const { employees, histories, load, query, role, today } = input;
  return searchEmployees(employees, query)
    .filter((employee) => role === null || employee.role === role)
    .map((employee) => {
      const history = histories.get(employee.id);
      return {
        employee,
        current: history ? currentRate(history, today) : { kind: 'none' },
        overMonths: load ? (load.get(employee.id)?.overMonths ?? 0) : null,
      };
    });
}
