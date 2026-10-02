import type { WorkloadChangedEvent, WorkloadResponse } from '@baseline/delivery-contract';
import { yearMonth } from '../domain/calendar';
import { setAllocation, type AllocationCell, type SetAllocationError } from '../domain/allocations';
import {
  addItem,
  deleteItem,
  deletionSummary,
  moveItem,
  renameItem,
  type AddItemError,
  type MoveItemError,
} from '../domain/breakdown';
import { allocationId, breakdownItemId, employeeId, projectId } from '../domain/ids';
import { cellKey, type Plan } from '../domain/plan';
import { ok, type Result } from '../domain/result';
import { workloadToContract } from '../infrastructure/workloadContract';
import {
  type DeletionSummaryDto,
  documentFromState,
  itemToDto,
  type AllocationDto,
  type ItemDto,
  type PlanDocument,
  type PlanState,
} from './planDocument';

export type UpdateItemFailure = MoveItemError | 'blank-name';
export type DeleteItemFailure = 'unknown-item' | 'changed-since-confirmation';

export interface DeliveryService {
  plan: () => PlanDocument;
  workload: () => WorkloadResponse;
  addItem: (input: {
    readonly projectId: string;
    readonly parentId: string | null;
    readonly name: string;
  }) => Promise<
    Result<
      { readonly revision: number; readonly item: ItemDto; readonly movedAllocations: number },
      AddItemError
    >
  >;
  updateItem: (
    id: string,
    change: { readonly name?: string; readonly parentId?: string | null },
  ) => Promise<Result<{ readonly revision: number }, UpdateItemFailure>>;
  deletionSummary: (id: string) => Result<DeletionSummaryDto, 'unknown-item'>;
  deleteItem: (
    root: string,
    confirmed: Pick<DeletionSummaryDto, 'items' | 'allocations'>,
  ) => Promise<Result<{ readonly revision: number }, DeleteItemFailure>>;
  setAllocation: (
    cell: { readonly breakdownItemId: string; readonly employeeId: string; readonly month: string },
    personMonths: number,
  ) => Promise<
    Result<
      { readonly revision: number; readonly allocation: AllocationDto | null },
      SetAllocationError
    >
  >;
}

export interface DeliveryServiceDeps {
  readonly initial: PlanState;
  /** Resolves once the document is safely stored; a change is not visible before that. */
  readonly write: (document: PlanDocument) => Promise<void>;
  readonly newItemId: () => string;
  readonly newAllocationId: () => string;
  readonly notify: (event: WorkloadChangedEvent) => void;
}

function employeesWithChangedWorkload(before: Plan, after: Plan): string[] {
  const byEmployee = (plan: Plan) =>
    Map.groupBy(workloadToContract(plan, 0).entries, (entry) => entry.employeeId);
  const [was, now] = [byEmployee(before), byEmployee(after)];
  const same = (employee: string) =>
    JSON.stringify(was.get(employee) ?? []) === JSON.stringify(now.get(employee) ?? []);
  return [...new Set([...was.keys(), ...now.keys()])].filter((employee) => !same(employee)).sort();
}

export function createDeliveryService(deps: DeliveryServiceDeps): DeliveryService {
  let state = deps.initial;
  let queue: Promise<unknown> = Promise.resolve();

  /** One change at a time: each reads the plan the previous one left, and stores before it shows. */
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task);
    queue = run.catch(() => undefined);
    return run;
  };

  async function commit(plan: Plan): Promise<number> {
    const next: PlanState = { revision: state.revision + 1, plan };
    const employeeIds = employeesWithChangedWorkload(state.plan, plan);
    await deps.write(documentFromState(next));
    state = next;
    if (employeeIds.length > 0) {
      deps.notify({ type: 'workload-changed', version: 1, employeeIds, revision: next.revision });
    }
    return next.revision;
  }

  /** Applies a change to the plan; a change that leaves the plan as it was is not a change. */
  const mutate = <T, E>(change: (plan: Plan) => Result<{ plan: Plan; value: T }, E>) =>
    serial(async (): Promise<Result<{ revision: number; value: T }, E>> => {
      const changed = change(state.plan);
      if (!changed.ok) return changed;
      const { plan, value } = changed.value;
      if (plan === state.plan) return ok({ revision: state.revision, value });
      return ok({ revision: await commit(plan), value });
    });

  return {
    plan: () => documentFromState(state),

    workload: () => workloadToContract(state.plan, state.revision),

    addItem: async (input) => {
      const id = breakdownItemId(deps.newItemId());
      const added = await mutate((plan) => {
        const result = addItem(plan, {
          id,
          projectId: projectId(input.projectId),
          parentId: input.parentId === null ? null : breakdownItemId(input.parentId),
          name: input.name,
        });
        if (!result.ok) return result;
        const item = result.value.plan.items.get(id);
        if (!item) throw new Error(`Item ${id} is missing from the plan it was added to`);
        return ok({
          plan: result.value.plan,
          value: { item: itemToDto(item), movedAllocations: result.value.movedAllocations },
        });
      });
      return added.ok ? ok({ revision: added.value.revision, ...added.value.value }) : added;
    },

    updateItem: async (id, { name, parentId }) => {
      const updated = await mutate((plan) => {
        const renamed = name === undefined ? ok(plan) : renameItem(plan, breakdownItemId(id), name);
        if (!renamed.ok) return renamed;
        const moved =
          parentId === undefined
            ? ok(renamed.value)
            : moveItem(
                renamed.value,
                breakdownItemId(id),
                parentId === null ? null : breakdownItemId(parentId),
              );
        return moved.ok ? ok({ plan: moved.value, value: undefined }) : moved;
      });
      return updated.ok ? ok({ revision: updated.value.revision }) : updated;
    },

    deletionSummary: (id) => {
      const summary = deletionSummary(state.plan, breakdownItemId(id));
      return summary;
    },

    deleteItem: async (root, confirmed) => {
      const deleted = await mutate((plan) => {
        const result = deleteItem(plan, {
          root: breakdownItemId(root),
          items: confirmed.items.map(breakdownItemId),
          allocations: confirmed.allocations.map(({ id, personMonths }) => ({
            id: allocationId(id),
            personMonths,
          })),
        });
        return result.ok ? ok({ plan: result.value, value: undefined }) : result;
      });
      return deleted.ok ? ok({ revision: deleted.value.revision }) : deleted;
    },

    setAllocation: async (cell, personMonths) => {
      const id = allocationId(deps.newAllocationId());
      const typed: AllocationCell = {
        breakdownItemId: breakdownItemId(cell.breakdownItemId),
        employeeId: employeeId(cell.employeeId),
        month: yearMonth(cell.month),
      };
      const set = await mutate((plan) => {
        const result = setAllocation(plan, typed, personMonths, id);
        if (!result.ok) return result;
        const key = cellKey(typed);
        const stored = [...result.value.allocations.values()].find((each) => cellKey(each) === key);
        return ok({
          plan: result.value,
          value: stored && {
            id: stored.id,
            breakdownItemId: stored.breakdownItemId,
            employeeId: stored.employeeId,
            month: stored.month,
            personMonths: stored.personMonths,
            revision: stored.revision,
          },
        });
      });
      return set.ok
        ? ok({ revision: set.value.revision, allocation: set.value.value ?? null })
        : set;
    },
  };
}
