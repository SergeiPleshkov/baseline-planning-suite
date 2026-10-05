import { setAllocation, type AllocationCell } from '../domain/allocations';
import { addItem, deleteItem, moveItem, renameItem } from '../domain/breakdown';
import {
  allocationId,
  breakdownItemId,
  type AllocationId,
  type BreakdownItemId,
  type ProjectId,
} from '../domain/ids';
import type { Plan } from '../domain/plan';
import type { Result } from '../domain/result';
import { messageFor, movedAllocationsNotice, type TreeCommandError } from './messages';
import { stateFromDocument, type DeletionSummaryDto } from './planDocument';
import type { CommandResult, DeliveryGateway, Refusal } from './ports';

type PlanView =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly message: string }
  | {
      readonly status: 'ready';
      readonly plan: Plan;
      /** Set when the last attempt to read the plan failed: what is shown may be out of date. */
      readonly stale: string | null;
      /** A change is on its way to the service; the plan shown already includes it. */
      readonly saving: boolean;
    };

export interface DeliverySnapshot {
  readonly plan: PlanView;
}

type CommandOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

type AddOutcome =
  | { readonly ok: true; readonly notice: string | null; readonly itemId: BreakdownItemId }
  | { readonly ok: false; readonly message: string };

export interface DeliveryStore {
  /** The same object until something changes, as `useSyncExternalStore` requires. */
  getSnapshot: () => DeliverySnapshot;
  subscribe: (listener: () => void) => () => void;
  /** Reads the plan again; also what a Retry button calls. */
  load: () => Promise<void>;
  addItem: (
    project: ProjectId,
    parent: BreakdownItemId | null,
    name: string,
  ) => Promise<AddOutcome>;
  renameItem: (item: BreakdownItemId, name: string) => Promise<CommandOutcome>;
  moveItem: (item: BreakdownItemId, parent: BreakdownItemId | null) => Promise<CommandOutcome>;
  /** What deleting would take, as the service sees it: the person confirms exactly this. */
  deletionSummary: (
    item: BreakdownItemId,
  ) => Promise<{ readonly ok: true; readonly summary: DeletionSummaryDto } | Refusal>;
  deleteItem: (summary: DeletionSummaryDto) => Promise<CommandOutcome>;
  /** Zero removes the allocation; an amount equal to the stored one changes nothing. */
  setAllocation: (cell: AllocationCell, personMonths: number) => Promise<CommandOutcome>;
}

/** A sentence for the screen; what exactly went wrong goes to the console. */
function describeFailure(error: unknown): string {
  console.error(error);
  if (error instanceof RangeError) return 'The plan the service sent breaks the rules of a plan.';
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return 'The Delivery service did not answer in time.';
  }
  if (error instanceof TypeError) return 'The Delivery service cannot be reached.';
  return error instanceof Error ? error.message : String(error);
}

const NOT_LOADED = 'The plan is not loaded yet.';

/** An id the plan does not have, to try a command on before the service has named the item. */
function unusedId(plan: Plan): BreakdownItemId {
  let candidate = 'pending-item';
  while (plan.items.has(breakdownItemId(candidate))) candidate += '_';
  return breakdownItemId(candidate);
}

function unusedAllocationId(plan: Plan): AllocationId {
  let candidate = 'pending-allocation';
  while (plan.allocations.has(allocationId(candidate))) candidate += '_';
  return allocationId(candidate);
}

export function createDeliveryStore(gateway: DeliveryGateway): DeliveryStore {
  let snapshot: DeliverySnapshot = { plan: { status: 'loading' } };
  const listeners = new Set<() => void>();
  /** The plan as the service last reported it, or as it must be after a change it accepted. */
  let confirmed: Plan | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const publish = (plan: PlanView) => {
    snapshot = { plan };
    for (const listener of [...listeners]) listener();
  };

  /**
   * One command or read at a time: each starts from the plan the previous one left, and a read
   * never lands in the middle of a command.
   */
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task);
    queue = run.catch(() => undefined);
    return run;
  };

  const readyPlan = (): Plan | null =>
    snapshot.plan.status === 'ready' ? snapshot.plan.plan : null;

  /**
   * Reads the plan from the service, the source of truth. If that fails, `fallback` is what stays
   * on screen, marked as possibly out of date.
   */
  async function readPlan(fallback: Plan | null = readyPlan()): Promise<void> {
    try {
      const state = stateFromDocument(await gateway.plan());
      confirmed = state.plan;
      publish({ status: 'ready', plan: state.plan, stale: null, saving: false });
    } catch (error) {
      const message = describeFailure(error);
      publish(
        fallback
          ? { status: 'ready', plan: fallback, stale: message, saving: false }
          : { status: 'failed', message },
      );
    }
  }

  /** The service may not have answered, or answered nonsense: that is a refusal to the person. */
  async function attempt<T extends { readonly ok: boolean }>(
    send: () => Promise<T>,
  ): Promise<T | Refusal> {
    try {
      return await send();
    } catch (error) {
      return { ok: false, message: describeFailure(error) };
    }
  }

  /**
   * Applies the change to the plan on screen at once, sends it, and reads the plan again either
   * way: if the service refused, that read is also the rollback.
   */
  const change = (
    local: (plan: Plan) => Result<Plan, TreeCommandError>,
    send: () => Promise<CommandResult>,
  ): Promise<CommandOutcome> =>
    serial(async () => {
      const current = readyPlan();
      if (!current) return { ok: false, message: NOT_LOADED };
      const before = confirmed ?? current;
      const next = local(current);
      // A deletion the screen thinks is stale is still the service's call: it knows the truth.
      if (!next.ok && next.error !== 'changed-since-confirmation') {
        return { ok: false, message: messageFor(next.error) };
      }
      const optimistic = next.ok ? next.value : current;
      if (next.ok && optimistic === current) return { ok: true };

      publish({ status: 'ready', plan: optimistic, stale: null, saving: true });
      const result = await attempt(send);
      if (result.ok) confirmed = optimistic;
      await readPlan(result.ok ? optimistic : before);
      return result.ok ? { ok: true } : { ok: false, message: result.message };
    });

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    load: () =>
      serial(async () => {
        if (snapshot.plan.status !== 'ready') publish({ status: 'loading' });
        await readPlan();
      }),

    addItem: (project, parent, name) =>
      serial(async (): Promise<AddOutcome> => {
        const current = readyPlan();
        if (!current) return { ok: false, message: NOT_LOADED };
        // Not optimistic: the service gives the new item its id. The domain still checks it first.
        const trial = addItem(current, {
          id: unusedId(current),
          projectId: project,
          parentId: parent,
          name,
        });
        if (!trial.ok) return { ok: false, message: messageFor(trial.error) };
        const parentName = parent === null ? null : (current.items.get(parent)?.name ?? null);

        const added = await attempt(() =>
          gateway.addItem({ projectId: project, parentId: parent, name }),
        );
        if (!added.ok) {
          await readPlan(confirmed ?? current);
          return { ok: false, message: added.message };
        }
        // If the plan cannot be read now, show it with the new item, built the way the service did.
        const itemId = breakdownItemId(added.item.id);
        const withItem = addItem(current, {
          id: itemId,
          projectId: project,
          parentId: parent,
          name: added.item.name,
        });
        const known = withItem.ok ? withItem.value.plan : current;
        confirmed = known;
        await readPlan(known);
        return {
          ok: true,
          itemId,
          notice:
            parentName === null
              ? null
              : movedAllocationsNotice(added.movedAllocations, parentName, added.item.name),
        };
      }),

    renameItem: (item, name) =>
      change(
        (plan) => renameItem(plan, item, name),
        () => gateway.updateItem(item, { name }),
      ),

    moveItem: (item, parent) =>
      change(
        (plan) => moveItem(plan, item, parent),
        () => gateway.updateItem(item, { parentId: parent }),
      ),

    deletionSummary: (item) => attempt(() => gateway.deletionSummary(item)),

    deleteItem: (summary) =>
      change(
        (plan) =>
          deleteItem(plan, {
            root: breakdownItemId(summary.root),
            items: summary.items.map(breakdownItemId),
            allocations: summary.allocations.map(({ id, personMonths }) => ({
              id: allocationId(id),
              personMonths,
            })),
          }),
        () => gateway.deleteItem(summary),
      ),

    setAllocation: (cell, personMonths) =>
      change(
        // The service names a new allocation; the id here only has to be one the plan does not use.
        (plan) => setAllocation(plan, cell, personMonths, unusedAllocationId(plan)),
        () => gateway.setAllocation(cell, personMonths),
      ),
  };
}
