import type { YearMonth } from './calendar';
import type { AllocationId, EmployeeId } from './ids';
import type { Allocation, Plan } from './plan';

/** A person's capacity in a month is one person-month: 100 % of their own hours that month. */
const CAPACITY_PERSON_MONTHS = 1;

/** Sums like 0.33 + 0.56 + 0.11 land a hair above 1; that is float noise, not over-allocation. */
const FLOAT_TOLERANCE = 1e-9;

export type PersonMonthLoad =
  | { readonly status: 'within'; readonly personMonths: number }
  | {
      readonly status: 'over';
      readonly personMonths: number;
      /** The most recently edited allocation contributing to this person-month. */
      readonly cause: AllocationId;
    };

/** Load per employee and month, summed over every project in the plan. */
export function workload(
  plan: Plan,
): ReadonlyMap<EmployeeId, ReadonlyMap<YearMonth, PersonMonthLoad>> {
  type MonthSum = { readonly total: number; readonly latest: Allocation };
  const sums = new Map<EmployeeId, Map<YearMonth, MonthSum>>();
  for (const allocation of plan.allocations.values()) {
    const months = sums.get(allocation.employeeId) ?? new Map<YearMonth, MonthSum>();
    sums.set(allocation.employeeId, months);
    const sum = months.get(allocation.month);
    months.set(allocation.month, {
      total: (sum?.total ?? 0) + allocation.personMonths,
      latest: sum && sum.latest.revision > allocation.revision ? sum.latest : allocation,
    });
  }

  return new Map(
    [...sums].map(([employee, months]) => [
      employee,
      new Map(
        [...months].map(([month, { total, latest }]): [YearMonth, PersonMonthLoad] => [
          month,
          total > CAPACITY_PERSON_MONTHS + FLOAT_TOLERANCE
            ? { status: 'over', personMonths: total, cause: latest.id }
            : { status: 'within', personMonths: total },
        ]),
      ),
    ]),
  );
}
