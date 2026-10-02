import type { YearMonth } from '../domain/calendar';
import { workload } from '../domain/capacity';
import type { BreakdownItemId, EmployeeId, ProjectId } from '../domain/ids';
import type { Allocation, Plan, Project } from '../domain/plan';
import { byText } from './sorting';
import { pathOf } from './treeView';

export interface Contribution {
  readonly allocation: Allocation;
  readonly project: Project;
  /** The work item and its parents: `Migration › Discovery › Design`. */
  readonly path: string;
  /** The most recently edited contribution: the one an over-allocation is blamed on. */
  readonly isLatestEdit: boolean;
}

export interface OverloadEntry {
  readonly employeeId: EmployeeId;
  readonly month: YearMonth;
  readonly personMonths: number;
  readonly contributions: readonly Contribution[];
}

/** What adds up to a person's load in a month, across all projects, newest edit first. */
export function contributionsOf(
  plan: Plan,
  employee: EmployeeId,
  month: YearMonth,
): readonly Contribution[] {
  const sorted = [...plan.allocations.values()]
    .filter((allocation) => allocation.employeeId === employee && allocation.month === month)
    .sort((a, b) => b.revision - a.revision);
  return sorted.flatMap((allocation, index) => {
    const item = plan.items.get(allocation.breakdownItemId);
    const project = item && plan.projects.get(item.projectId);
    return item && project
      ? [{ allocation, project, path: pathOf(plan, item.id), isLatestEdit: index === 0 }]
      : [];
  });
}

export function overloads(plan: Plan): OverloadEntry[] {
  const entries: OverloadEntry[] = [];
  for (const [employeeId, months] of workload(plan)) {
    for (const [month, load] of months) {
      if (load.status === 'over') {
        entries.push({
          employeeId,
          month,
          personMonths: load.personMonths,
          contributions: contributionsOf(plan, employeeId, month),
        });
      }
    }
  }
  return entries.sort((a, b) => byText(a.employeeId, b.employeeId) || byText(a.month, b.month));
}

/**
 * Where to find an over-capacity month in one project's grid: its newest allocation there, which
 * is the one edited last whenever that one is in the project. `null` if the project has none.
 */
export function cellInProject(
  entry: OverloadEntry,
  project: ProjectId,
): {
  readonly item: BreakdownItemId;
  readonly employee: EmployeeId;
  readonly month: YearMonth;
} | null {
  const target = entry.contributions.find((each) => each.project.id === project);
  return target
    ? { item: target.allocation.breakdownItemId, employee: entry.employeeId, month: entry.month }
    : null;
}
