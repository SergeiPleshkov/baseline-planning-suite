import type { YearMonth } from './calendar';
import type { AllocationId, BreakdownItemId, EmployeeId } from './ids';
import { cellKey, childrenOf, revise, type Allocation, type Plan } from './plan';
import { err, ok, type Result } from './result';

export interface AllocationCell {
  readonly breakdownItemId: BreakdownItemId;
  readonly employeeId: EmployeeId;
  readonly month: YearMonth;
}

export type SetAllocationError =
  'invalid-amount' | 'unknown-item' | 'not-a-leaf' | 'outside-project' | 'duplicate-id';

/**
 * Sets one cell's allocation in person-months; zero removes it. A changed amount takes a revision
 * above every current one, which is what "most recently edited" means when an over-allocation is
 * attributed. `idIfNew` names the allocation only when the cell had none.
 */
export function setAllocation(
  plan: Plan,
  cell: AllocationCell,
  personMonths: number,
  idIfNew: AllocationId,
): Result<Plan, SetAllocationError> {
  if (!Number.isFinite(personMonths) || personMonths < 0) return err('invalid-amount');
  const item = plan.items.get(cell.breakdownItemId);
  if (!item) return err('unknown-item');
  if (childrenOf(plan, item.id).length > 0) return err('not-a-leaf');
  const project = plan.projects.get(item.projectId);
  if (!project || cell.month < project.firstMonth || cell.month > project.lastMonth) {
    return err('outside-project');
  }

  const key = cellKey(cell);
  const existing = [...plan.allocations.values()].find((allocation) => cellKey(allocation) === key);
  if (existing?.personMonths === personMonths || (!existing && personMonths === 0)) return ok(plan);
  if (!existing && plan.allocations.has(idIfNew)) return err('duplicate-id');

  const others = [...plan.allocations.values()].filter((allocation) => allocation !== existing);
  if (personMonths === 0) return ok(revise(plan, { allocations: others }));
  const updated: Allocation = {
    id: existing?.id ?? idIfNew,
    breakdownItemId: cell.breakdownItemId,
    employeeId: cell.employeeId,
    month: cell.month,
    personMonths,
    revision: plan.lastRevision + 1,
  };
  return ok(revise(plan, { allocations: [...others, updated] }));
}
