import type { AllocationId, BreakdownItemId } from './ids';
import {
  MAX_DEPTH,
  allocationsOn,
  childrenOf,
  depthOf,
  heightOf,
  revise,
  subtreeOf,
  type Allocation,
  type BreakdownItem,
  type Plan,
} from './plan';
import { err, ok, type Result } from './result';

export type AddItemError =
  | 'duplicate-id'
  | 'blank-name'
  | 'unknown-project'
  | 'unknown-parent'
  | 'parent-in-other-project'
  | 'too-deep';

/**
 * Adds an item. If its parent was a leaf with allocations, they move onto the new child: a parent's
 * figures are derived from its children, so leaving them on the parent would lose them silently.
 */
export function addItem(
  plan: Plan,
  item: BreakdownItem,
): Result<{ plan: Plan; movedAllocations: number }, AddItemError> {
  const name = item.name.trim();
  if (plan.items.has(item.id)) return err('duplicate-id');
  if (name === '') return err('blank-name');
  if (!plan.projects.has(item.projectId)) return err('unknown-project');

  let inherited: Allocation[] = [];
  if (item.parentId !== null) {
    const parent = plan.items.get(item.parentId);
    if (!parent) return err('unknown-parent');
    if (parent.projectId !== item.projectId) return err('parent-in-other-project');
    if (depthOf(plan, parent.id) >= MAX_DEPTH) return err('too-deep');
    if (childrenOf(plan, parent.id).length === 0) inherited = allocationsOn(plan, parent.id);
  }

  const added: BreakdownItem = {
    id: item.id,
    projectId: item.projectId,
    parentId: item.parentId,
    name,
  };
  const moving = new Set(inherited.map((allocation) => allocation.id));
  return ok({
    plan: revise(plan, {
      items: [...plan.items.values(), added],
      allocations: [...plan.allocations.values()].map((allocation) =>
        moving.has(allocation.id) ? { ...allocation, breakdownItemId: added.id } : allocation,
      ),
    }),
    movedAllocations: inherited.length,
  });
}

export function renameItem(
  plan: Plan,
  id: BreakdownItemId,
  newName: string,
): Result<Plan, 'unknown-item' | 'blank-name'> {
  const item = plan.items.get(id);
  const name = newName.trim();
  if (!item) return err('unknown-item');
  if (name === '') return err('blank-name');
  if (name === item.name) return ok(plan);
  return ok(
    revise(plan, {
      items: [...plan.items.values()].map((each) => (each.id === id ? { ...each, name } : each)),
    }),
  );
}

export type MoveItemError =
  | 'unknown-item'
  | 'unknown-parent'
  | 'parent-in-other-project'
  | 'into-own-subtree'
  | 'too-deep'
  | 'parent-has-allocations';

/**
 * Moves an item, with everything below it, under another parent in the same project or to the
 * top. A leaf holding allocations cannot become a parent this way: the arriving item may itself be
 * a parent, or hold its own allocations for the same people and months, so they have nowhere to go.
 */
export function moveItem(
  plan: Plan,
  id: BreakdownItemId,
  parentId: BreakdownItemId | null,
): Result<Plan, MoveItemError> {
  const item = plan.items.get(id);
  if (!item) return err('unknown-item');
  if (parentId === item.parentId) return ok(plan);

  let parentDepth = 0;
  if (parentId !== null) {
    const parent = plan.items.get(parentId);
    if (!parent) return err('unknown-parent');
    if (parent.projectId !== item.projectId) return err('parent-in-other-project');
    if (subtreeOf(plan, id).includes(parentId)) return err('into-own-subtree');
    if (childrenOf(plan, parentId).length === 0 && allocationsOn(plan, parentId).length > 0) {
      return err('parent-has-allocations');
    }
    parentDepth = depthOf(plan, parentId);
  }
  if (parentDepth + heightOf(plan, id) > MAX_DEPTH) return err('too-deep');

  return ok(
    revise(plan, {
      items: [...plan.items.values()].map((each) =>
        each.id === id ? { ...each, parentId } : each,
      ),
    }),
  );
}

export interface DeletionSummary {
  readonly root: BreakdownItemId;
  readonly items: readonly BreakdownItemId[];
  readonly allocations: readonly { readonly id: AllocationId; readonly personMonths: number }[];
  readonly personMonths: number;
}

/** What deleting an item would take with it, for the user to confirm first. */
export function deletionSummary(
  plan: Plan,
  id: BreakdownItemId,
): Result<DeletionSummary, 'unknown-item'> {
  if (!plan.items.has(id)) return err('unknown-item');
  const items = subtreeOf(plan, id);
  const allocations = items.flatMap((itemId) => allocationsOn(plan, itemId));
  return ok({
    root: id,
    items,
    allocations: allocations.map(({ id, personMonths }) => ({ id, personMonths })),
    personMonths: allocations.reduce((sum, allocation) => sum + allocation.personMonths, 0),
  });
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

type Entry = string | { readonly id: string; readonly personMonths: number };

/** Same ids, and for allocations the same amounts: an edited amount is not what was confirmed. */
const sameEntries = (a: readonly Entry[], b: readonly Entry[]): boolean => {
  const canonical = (entries: readonly Entry[]) =>
    JSON.stringify(
      entries
        .map((entry) => (typeof entry === 'string' ? [entry] : [entry.id, entry.personMonths]))
        .sort((x, y) => compare(String(x[0]), String(y[0]))),
    );
  return canonical(a) === canonical(b);
};

/**
 * Deletes what the user confirmed. If the subtree or its allocations changed since the summary
 * was shown (someone else edited them meanwhile), nothing is deleted.
 */
export function deleteItem(
  plan: Plan,
  confirmed: Pick<DeletionSummary, 'root' | 'items' | 'allocations'>,
): Result<Plan, 'unknown-item' | 'changed-since-confirmation'> {
  const current = deletionSummary(plan, confirmed.root);
  if (!current.ok) return current;
  if (
    !sameEntries(current.value.items, confirmed.items) ||
    !sameEntries(current.value.allocations, confirmed.allocations)
  ) {
    return err('changed-since-confirmation');
  }
  const doomed = new Set(current.value.items);
  return ok(
    revise(plan, {
      items: [...plan.items.values()].filter((item) => !doomed.has(item.id)),
      allocations: [...plan.allocations.values()].filter(
        (allocation) => !doomed.has(allocation.breakdownItemId),
      ),
    }),
  );
}
