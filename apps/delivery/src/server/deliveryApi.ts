import { DELIVERY_API_PATHS, type WorkloadChangedEvent } from '@baseline/delivery-contract';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type {
  DeleteItemFailure,
  DeliveryService,
  UpdateItemFailure,
} from '../application/deliveryService';
import { Id, Month } from '../application/planDocument';
import type { SetAllocationError } from '../domain/allocations';
import type { AddItemError } from '../domain/breakdown';
import { MAX_ALLOCATION_PERSON_MONTHS } from '../domain/plan';
import {
  eventStream,
  firstIssue,
  idParam,
  limitBody,
  problem,
  readJson,
  requireJson,
  type ErrorStatus,
} from './http';

type Failure = AddItemError | UpdateItemFailure | DeleteItemFailure | SetAllocationError;

const FAILURES = {
  'unknown-item': { status: 404, message: 'There is no such breakdown item.' },
  'unknown-project': { status: 404, message: 'There is no such project.' },
  'unknown-parent': { status: 404, message: 'There is no such parent item.' },
  'blank-name': { status: 422, message: 'An item needs a name.' },
  'invalid-amount': {
    status: 422,
    message: `An allocation is between 0 and ${String(MAX_ALLOCATION_PERSON_MONTHS)} person-months.`,
  },
  'duplicate-id': { status: 409, message: 'An item or allocation with this id already exists.' },
  'parent-in-other-project': {
    status: 409,
    message: 'An item and its parent belong to the same project.',
  },
  'into-own-subtree': { status: 409, message: 'An item cannot be moved under itself.' },
  'too-deep': { status: 409, message: 'The breakdown is at most three levels deep.' },
  'parent-has-allocations': {
    status: 409,
    message:
      'That item holds allocations; nothing can be moved under it. Add a child to it instead.',
  },
  'changed-since-confirmation': {
    status: 409,
    message: 'The item changed since you confirmed the deletion; review it again.',
  },
  'not-a-leaf': { status: 409, message: 'Allocations sit on the lowest level of the breakdown.' },
  'outside-project': { status: 409, message: 'That month is outside the project.' },
} as const satisfies Record<Failure, { status: ErrorStatus; message: string }>;

const ItemName = z.string().max(200, 'A name is at most 200 characters.');

const NewItemSchema = z.strictObject({ projectId: Id, parentId: Id.nullable(), name: ItemName });

const ItemChangeSchema = z
  .strictObject({ name: ItemName.optional(), parentId: Id.nullable().optional() })
  .refine(
    (change) => change.name !== undefined || change.parentId !== undefined,
    'Say what to change: name, parentId or both.',
  );

/** The deletion summary as it was shown, sent back unchanged. */
const ConfirmationSchema = z.strictObject({
  root: Id,
  personMonths: z.number(),
  items: z.array(Id),
  allocations: z.array(z.strictObject({ id: Id, personMonths: z.number() })),
});

const AllocationRequestSchema = z.strictObject({
  breakdownItemId: Id,
  employeeId: Id,
  month: Month,
  personMonths: z.number(),
});

export interface DeliveryApiDeps {
  readonly service: DeliveryService;
  readonly subscribe: (listener: (event: WorkloadChangedEvent) => void) => () => void;
  /** Keeps idle event streams from being closed by proxies in between. */
  readonly heartbeatMs?: number;
}

const failure = (context: Context, code: Failure) =>
  problem(context, FAILURES[code].status, code, FAILURES[code].message);

const invalid = (context: Context, issues: readonly { readonly message: string }[]) =>
  problem(context, 400, 'invalid-request', firstIssue(issues));

export function createDeliveryApi({ service, subscribe, heartbeatMs = 15_000 }: DeliveryApiDeps) {
  const api = new Hono();

  api.onError((error, context) => {
    console.error(error);
    return problem(context, 500, 'internal', 'Something went wrong on our side.');
  });

  api.use('*', requireJson, limitBody);

  api.get('/plan', (context) => context.json(service.plan()));

  api.get(DELIVERY_API_PATHS.workload, (context) => context.json(service.workload()));

  api.post('/items', async (context) => {
    const parsed = NewItemSchema.safeParse(await readJson(context));
    if (!parsed.success) return invalid(context, parsed.error.issues);
    const added = await service.addItem(parsed.data);
    return added.ok ? context.json(added.value, 201) : failure(context, added.error);
  });

  api.patch('/items/:itemId', async (context) => {
    const parsed = ItemChangeSchema.safeParse(await readJson(context));
    if (!parsed.success) return invalid(context, parsed.error.issues);
    const itemId = idParam(context, 'itemId');
    if (itemId === undefined) return failure(context, 'unknown-item');
    const updated = await service.updateItem(itemId, {
      ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
      ...(parsed.data.parentId === undefined ? {} : { parentId: parsed.data.parentId }),
    });
    return updated.ok ? context.json(updated.value) : failure(context, updated.error);
  });

  api.get('/items/:itemId/deletion-summary', (context) => {
    const itemId = idParam(context, 'itemId');
    if (itemId === undefined) return failure(context, 'unknown-item');
    const summary = service.deletionSummary(itemId);
    return summary.ok ? context.json(summary.value) : failure(context, summary.error);
  });

  // A POST, not a DELETE: the confirmation travels in the body, which DELETE gives no meaning.
  api.post('/items/:itemId/deletion', async (context) => {
    const parsed = ConfirmationSchema.safeParse(await readJson(context));
    if (!parsed.success) {
      return problem(
        context,
        400,
        'invalid-request',
        'Send the summary you confirmed: its items and allocations with their amounts.',
      );
    }
    const itemId = idParam(context, 'itemId');
    if (itemId === undefined) return failure(context, 'unknown-item');
    if (parsed.data.root !== itemId) {
      return problem(context, 400, 'invalid-request', 'The summary is for another item.');
    }
    const deleted = await service.deleteItem(itemId, parsed.data);
    return deleted.ok ? context.json(deleted.value) : failure(context, deleted.error);
  });

  api.put('/allocations', async (context) => {
    const parsed = AllocationRequestSchema.safeParse(await readJson(context));
    if (!parsed.success) return invalid(context, parsed.error.issues);
    const { personMonths, ...cell } = parsed.data;
    const set = await service.setAllocation(cell, personMonths);
    return set.ok ? context.json(set.value) : failure(context, set.error);
  });

  api.get(DELIVERY_API_PATHS.events, (context) => eventStream(context, subscribe, heartbeatMs));

  return api;
}
