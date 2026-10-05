import type { WorkloadEntry, WorkloadResponse } from '@baseline/delivery-contract';
import { workload } from '../domain/capacity';
import type { Plan } from '../domain/plan';
import { byKey } from './sorting';

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
  entries.sort((a, b) => byKey(a.employeeId, b.employeeId) || byKey(a.month, b.month));
  return { revision, entries };
}
