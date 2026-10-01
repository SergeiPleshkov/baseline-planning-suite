import type { WorkloadEntry, WorkloadResponse } from '@baseline/delivery-contract';
import { workload } from '../domain/capacity';
import type { Plan } from '../domain/plan';

/** Entries are ordered by employee, then month, so the same plan always serialises the same way. */
export function workloadToContract(plan: Plan, revision: number): WorkloadResponse {
  const entries: WorkloadEntry[] = [];
  for (const [employee, months] of workload(plan)) {
    for (const [month, load] of months) {
      const common = { employeeId: employee, month, personMonths: load.personMonths };
      entries.push(
        load.status === 'over'
          ? { ...common, status: 'over', cause: load.cause }
          : { ...common, status: 'within' },
      );
    }
  }
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  entries.sort((a, b) => compare(a.employeeId, b.employeeId) || compare(a.month, b.month));
  return { revision, entries };
}
