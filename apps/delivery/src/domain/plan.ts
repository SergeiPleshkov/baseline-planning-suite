import type { YearMonth } from './calendar';
import type { AllocationId, BreakdownItemId, EmployeeId, ProjectId } from './ids';

export const MAX_DEPTH = 3;

/** Far beyond any real plan; it keeps sums finite and published figures meaningful. */
export const MAX_ALLOCATION_PERSON_MONTHS = 100;

export interface Project {
  readonly id: ProjectId;
  readonly name: string;
  readonly firstMonth: YearMonth;
  readonly lastMonth: YearMonth;
}

export interface BreakdownItem {
  readonly id: BreakdownItemId;
  readonly projectId: ProjectId;
  readonly parentId: BreakdownItemId | null;
  readonly name: string;
}

export interface Allocation {
  readonly id: AllocationId;
  readonly breakdownItemId: BreakdownItemId;
  readonly employeeId: EmployeeId;
  readonly month: YearMonth;
  readonly personMonths: number;
  /** Edit order among the current allocations: higher is more recent. */
  readonly revision: number;
}

/**
 * Projects, their work breakdown and the allocations on it. Only `createPlan` builds one (the
 * commands go through `revise`), so it always holds: items nest at most `MAX_DEPTH` deep within one
 * project, allocations sit on leaves inside their project's months, at most one per cell, with
 * distinct revisions.
 */
export type Plan = PlanContents & { readonly __brand: 'Plan' };

interface PlanContents {
  readonly projects: ReadonlyMap<ProjectId, Project>;
  readonly items: ReadonlyMap<BreakdownItemId, BreakdownItem>;
  readonly allocations: ReadonlyMap<AllocationId, Allocation>;
  readonly lastRevision: number;
}

export const isValidAllocationAmount = (personMonths: number): boolean =>
  Number.isFinite(personMonths) &&
  personMonths >= 0 &&
  personMonths <= MAX_ALLOCATION_PERSON_MONTHS;

export const childrenOf = (plan: Plan, id: BreakdownItemId): BreakdownItem[] =>
  [...plan.items.values()].filter((item) => item.parentId === id);

export function depthOf(plan: Plan, id: BreakdownItemId): number {
  let depth = 0;
  let current = plan.items.get(id);
  while (current) {
    depth += 1;
    if (depth > plan.items.size) throw new RangeError(`Breakdown cycle through ${id}`);
    current = current.parentId === null ? undefined : plan.items.get(current.parentId);
  }
  return depth;
}

/** The item and everything below it, parents before children. */
export const subtreeOf = (plan: Plan, id: BreakdownItemId): BreakdownItemId[] => [
  id,
  ...childrenOf(plan, id).flatMap((child) => subtreeOf(plan, child.id)),
];

export const heightOf = (plan: Plan, id: BreakdownItemId): number =>
  1 + Math.max(0, ...childrenOf(plan, id).map((child) => heightOf(plan, child.id)));

export const allocationsOn = (plan: Plan, id: BreakdownItemId): Allocation[] =>
  [...plan.allocations.values()].filter((allocation) => allocation.breakdownItemId === id);

export const cellKey = (
  allocation: Pick<Allocation, 'breakdownItemId' | 'employeeId' | 'month'>,
): string => JSON.stringify([allocation.breakdownItemId, allocation.employeeId, allocation.month]);

function keyedById<T extends { readonly id: string }>(
  records: readonly T[],
  kind: string,
): Map<T['id'], T> {
  const byId = new Map<T['id'], T>();
  for (const record of records) {
    if (byId.has(record.id)) throw new RangeError(`Duplicate ${kind} ${record.id}`);
    byId.set(record.id, record);
  }
  return byId;
}

export function createPlan(input: {
  readonly projects: readonly Project[];
  readonly items: readonly BreakdownItem[];
  readonly allocations: readonly Allocation[];
}): Plan {
  const contents: PlanContents = {
    projects: keyedById(input.projects, 'project'),
    items: keyedById(input.items, 'breakdown item'),
    allocations: keyedById(input.allocations, 'allocation'),
    lastRevision: Math.max(0, ...input.allocations.map((allocation) => allocation.revision)),
  };
  const plan = contents as Plan;

  for (const project of plan.projects.values()) {
    if (project.firstMonth > project.lastMonth) {
      throw new RangeError(`${project.id}: ends before it starts`);
    }
  }
  for (const item of plan.items.values()) {
    if (!plan.projects.has(item.projectId)) throw new RangeError(`${item.id}: unknown project`);
    if (item.name.trim() === '') throw new RangeError(`${item.id}: blank name`);
    if (item.parentId !== null) {
      const parent = plan.items.get(item.parentId);
      if (!parent) throw new RangeError(`${item.id}: unknown parent`);
      if (parent.projectId !== item.projectId) {
        throw new RangeError(`${item.id}: parent in another project`);
      }
    }
    if (depthOf(plan, item.id) > MAX_DEPTH) {
      throw new RangeError(`${item.id}: deeper than ${String(MAX_DEPTH)} levels`);
    }
  }

  const cells = new Set<string>();
  const revisions = new Set<number>();
  for (const allocation of plan.allocations.values()) {
    const item = plan.items.get(allocation.breakdownItemId);
    if (!item) throw new RangeError(`${allocation.id}: unknown breakdown item`);
    if (childrenOf(plan, item.id).length > 0) {
      throw new RangeError(`${allocation.id}: not on a leaf`);
    }
    const project = plan.projects.get(item.projectId);
    if (!project || allocation.month < project.firstMonth || allocation.month > project.lastMonth) {
      throw new RangeError(`${allocation.id}: outside its project's months`);
    }
    if (!isValidAllocationAmount(allocation.personMonths) || allocation.personMonths === 0) {
      throw new RangeError(`${allocation.id}: amount must be positive`);
    }
    if (
      !Number.isInteger(allocation.revision) ||
      allocation.revision < 1 ||
      revisions.has(allocation.revision)
    ) {
      throw new RangeError(`${allocation.id}: revision must be a unique positive integer`);
    }
    revisions.add(allocation.revision);
    const key = cellKey(allocation);
    if (cells.has(key)) throw new RangeError(`${allocation.id}: second allocation for one cell`);
    cells.add(key);
  }
  return plan;
}

/** A plan with some parts replaced, validated like any other. */
export const revise = (
  plan: Plan,
  changes: {
    readonly items?: readonly BreakdownItem[];
    readonly allocations?: readonly Allocation[];
  },
): Plan =>
  createPlan({
    projects: [...plan.projects.values()],
    items: changes.items ?? [...plan.items.values()],
    allocations: changes.allocations ?? [...plan.allocations.values()],
  });
