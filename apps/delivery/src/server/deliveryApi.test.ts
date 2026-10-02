import {
  WorkloadChangedEventSchema,
  WorkloadResponseSchema,
  type WorkloadChangedEvent,
} from '@baseline/delivery-contract';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createDeliveryService } from '../application/deliveryService';
import { PlanDocumentSchema } from '../application/planDocument';
import { testPlan } from '../domain/plan.fixtures';
import { createDeliveryApi } from './deliveryApi';
import { createEventBus } from './eventBus';

function setup() {
  const events = createEventBus<WorkloadChangedEvent>();
  let counter = 0;
  const service = createDeliveryService({
    initial: { revision: 3, plan: testPlan() },
    write: () => Promise.resolve(),
    newItemId: () => `item-${String((counter += 1))}`,
    newAllocationId: () => `alloc-new-${String((counter += 1))}`,
    notify: events.publish,
  });
  let listening = 0;
  const subscribe: typeof events.subscribe = (listener) => {
    listening += 1;
    const stop = events.subscribe(listener);
    return () => {
      listening -= 1;
      stop();
    };
  };
  const app = new Hono().route(
    '/api/delivery/v1',
    createDeliveryApi({ service, subscribe, heartbeatMs: 20 }),
  );
  const call = (method: string, path: string, body?: unknown) =>
    app.request(`/api/delivery/v1${path}`, {
      method,
      ...(method === 'GET' || method === 'DELETE'
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          }),
    });
  return { app, call, listeners: () => listening };
}

const errorCode = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

const allocation = (breakdownItemId: string, month = '2026-07', personMonths = 0.4) => ({
  breakdownItemId,
  employeeId: 'emp-005',
  month,
  personMonths,
});

describe('reading', () => {
  it('answers with the plan and a contract-valid workload', async () => {
    const { call } = setup();
    const plan = PlanDocumentSchema.parse(await (await call('GET', '/plan')).json());
    expect(plan.items).toHaveLength(9);
    const workload = WorkloadResponseSchema.parse(await (await call('GET', '/workload')).json());
    expect(workload.entries.find((entry) => entry.status === 'over')?.employeeId).toBe('emp-003');
  });
});

describe('POST /items', () => {
  it('creates an item, reporting how many allocations moved down', async () => {
    const { call } = setup();
    const response = await call('POST', '/items', {
      projectId: 'ledger',
      parentId: 'cutover',
      name: 'Rehearsal',
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      revision: 4,
      item: { id: 'item-1', projectId: 'ledger', parentId: 'cutover', name: 'Rehearsal' },
      movedAllocations: 1,
    });
  });

  it.each([
    ['no project', { parentId: null, name: 'x' }],
    ['a parent that is not a string', { projectId: 'ledger', parentId: 3, name: 'x' }],
    ['a blank project id', { projectId: ' ', parentId: null, name: 'x' }],
    ['no body', undefined],
  ])('answers 400 for %s', async (_label, body) => {
    const { call } = setup();
    const response = await call('POST', '/items', body);
    expect([response.status, await errorCode(response)]).toEqual([400, 'invalid-request']);
  });

  it.each([
    ['a blank name', { projectId: 'ledger', parentId: null, name: ' ' }, 422, 'blank-name'],
    [
      'an unknown project',
      { projectId: 'nope', parentId: null, name: 'x' },
      404,
      'unknown-project',
    ],
    [
      'an unknown parent',
      { projectId: 'ledger', parentId: 'nope', name: 'x' },
      404,
      'unknown-parent',
    ],
    ['a fourth level', { projectId: 'ledger', parentId: 'design', name: 'x' }, 409, 'too-deep'],
  ])('answers with the rule broken for %s', async (_label, body, status, code) => {
    const { call } = setup();
    const response = await call('POST', '/items', body);
    expect([response.status, await errorCode(response)]).toEqual([status, code]);
  });
});

describe('PATCH /items/:id', () => {
  it('renames and moves', async () => {
    const { call } = setup();
    const response = await call('PATCH', '/items/docs', {
      name: 'Documentation',
      parentId: 'migration',
    });
    expect([response.status, await response.json()]).toEqual([200, { revision: 4 }]);
  });

  it('answers 400 when told to change nothing', async () => {
    const { call } = setup();
    expect((await call('PATCH', '/items/docs', {})).status).toBe(400);
  });

  it('answers 404 for an unknown item and 409 for a refused move', async () => {
    const { call } = setup();
    expect((await call('PATCH', '/items/nope', { name: 'x' })).status).toBe(404);
    const refused = await call('PATCH', '/items/docs', { parentId: 'cutover' });
    expect([refused.status, await errorCode(refused)]).toEqual([409, 'parent-has-allocations']);
    const loop = await call('PATCH', '/items/migration', { parentId: 'design' });
    expect([loop.status, await errorCode(loop)]).toEqual([409, 'into-own-subtree']);
  });
});

describe('deleting', () => {
  it('shows what a deletion takes and deletes it once the summary is sent back', async () => {
    const { call } = setup();
    const summary = await call('GET', '/items/cutover/deletion-summary');
    expect(summary.status).toBe(200);
    const confirmed = (await summary.json()) as {
      items: string[];
      allocations: { id: string; personMonths: number }[];
    };
    expect(confirmed).toMatchObject({
      items: ['cutover'],
      allocations: [{ id: 'alloc-cutover', personMonths: 0.5 }],
    });
    const deleted = await call('POST', '/items/cutover/deletion', confirmed);
    expect([deleted.status, await deleted.json()]).toEqual([200, { revision: 4 }]);
  });

  it('answers 409 when the summary is out of date, and 400 without one', async () => {
    const { call } = setup();
    const stale = await call('POST', '/items/handover/deletion', {
      root: 'handover',
      personMonths: 0,
      items: ['handover'],
      allocations: [],
    });
    expect([stale.status, await errorCode(stale)]).toEqual([409, 'changed-since-confirmation']);
    expect((await call('POST', '/items/handover/deletion')).status).toBe(400);
    const other = await call('POST', '/items/handover/deletion', {
      root: 'cutover',
      personMonths: 0,
      items: [],
      allocations: [],
    });
    expect([other.status, await errorCode(other)]).toEqual([400, 'invalid-request']);
  });

  it('answers 404 for an unknown item', async () => {
    const { call } = setup();
    expect((await call('GET', '/items/nope/deletion-summary')).status).toBe(404);
    expect(
      (
        await call('POST', '/items/nope/deletion', {
          root: 'nope',
          personMonths: 0,
          items: [],
          allocations: [],
        })
      ).status,
    ).toBe(404);
  });
});

describe('PUT /allocations', () => {
  it('sets an allocation and reports it with its edit order', async () => {
    const { call } = setup();
    const response = await call('PUT', '/allocations', allocation('docs'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      revision: 4,
      allocation: {
        id: 'alloc-new-1',
        breakdownItemId: 'docs',
        employeeId: 'emp-005',
        month: '2026-07',
        personMonths: 0.4,
        revision: 74,
      },
    });
  });

  it('removes an allocation when it is set to zero', async () => {
    const { call } = setup();
    await call('PUT', '/allocations', allocation('docs'));
    const response = await call('PUT', '/allocations', allocation('docs', '2026-07', 0));
    expect(await response.json()).toEqual({ revision: 5, allocation: null });
  });

  it.each([
    ['text for an amount', { ...allocation('docs'), personMonths: '0.4' }],
    ['a month that does not exist', allocation('docs', '2026-13')],
    ['no employee', { breakdownItemId: 'docs', month: '2026-07', personMonths: 1 }],
  ])('answers 400 for %s', async (_label, body) => {
    const { call } = setup();
    expect((await call('PUT', '/allocations', body)).status).toBe(400);
  });

  it.each([
    ['a negative amount', allocation('docs', '2026-07', -1), 422, 'invalid-amount'],
    ['an unknown item', allocation('nope'), 404, 'unknown-item'],
    ['a parent', allocation('handover'), 409, 'not-a-leaf'],
    ['a month outside the project', allocation('docs', '2025-01'), 409, 'outside-project'],
  ])('answers with the rule broken for %s', async (_label, body, status, code) => {
    const { call } = setup();
    const response = await call('PUT', '/allocations', body);
    expect([response.status, await errorCode(response)]).toEqual([status, code]);
  });
});

describe('what a hostile or careless caller can do', () => {
  it('gets 404, not 500, for an id that is only whitespace', async () => {
    const { call } = setup();
    for (const [method, path, body] of [
      ['GET', '/items/%20/deletion-summary', undefined],
      ['PATCH', '/items/%20', { name: 'x' }],
      ['POST', '/items/%20/deletion', { root: 'x', personMonths: 0, items: [], allocations: [] }],
    ] as const) {
      expect([method, (await call(method, path, body)).status]).toEqual([method, 404]);
    }
  });

  it('gets 415 for anything but JSON, so a web page cannot write with a plain form post', async () => {
    const { app } = setup();
    const response = await app.request('/api/delivery/v1/allocations', {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify(allocation('docs')),
    });
    expect([response.status, await errorCode(response)]).toEqual([415, 'unsupported-media-type']);
    expect((await app.request('/api/delivery/v1/plan')).status).toBe(200);
  });

  it('gets 413 for a body far larger than any command', async () => {
    const { call } = setup();
    const response = await call('POST', '/items', {
      projectId: 'ledger',
      parentId: null,
      name: 'x'.repeat(100_000),
    });
    expect([response.status, await errorCode(response)]).toEqual([413, 'too-large']);
  });

  it.each([
    [
      'a name that is too long',
      '/items',
      'POST',
      { projectId: 'ledger', parentId: null, name: 'x'.repeat(201) },
    ],
    ['a field it does not know', '/items/docs', 'PATCH', { name: 'n', parent: 'migration' }],
    ['a field it does not know', '/allocations', 'PUT', { ...allocation('docs'), note: 'hi' }],
  ])('gets 400 for %s', async (_label, path, method, body) => {
    const { call } = setup();
    const response = await call(method, path, body);
    expect([response.status, await errorCode(response)]).toEqual([400, 'invalid-request']);
  });

  it('cannot push the workload outside what its contract allows', async () => {
    const { call } = setup();
    for (const employee of ['emp-005']) {
      for (const item of ['docs', 'build']) {
        const response = await call('PUT', '/allocations', {
          ...allocation(item, '2026-07', 1e308),
          employeeId: employee,
        });
        expect(response.status).toBe(422);
      }
    }
    const workload = WorkloadResponseSchema.safeParse(
      await (await call('GET', '/workload')).json(),
    );
    expect(workload.success).toBe(true);
  });
});

describe('GET /events', () => {
  async function nextChunk(reader: ReadableStreamDefaultReader<Uint8Array>) {
    const { value } = await reader.read();
    return new TextDecoder().decode(value);
  }

  it('streams a workload-changed event when an allocation changes', async () => {
    const { call } = setup();
    const response = await call('GET', '/events');
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('no body');

    expect(await nextChunk(reader)).toContain(': open');
    await call('PUT', '/allocations', allocation('docs'));

    let received = '';
    while (!received.includes('data:')) received += await nextChunk(reader);
    await reader.cancel();

    expect(received).toContain('event: workload-changed');
    const data = /data: (.*)/.exec(received)?.[1] ?? '';
    expect(WorkloadChangedEventSchema.parse(JSON.parse(data))).toEqual({
      type: 'workload-changed',
      version: 1,
      employeeIds: ['emp-005'],
      revision: 4,
    });
  });

  it('keeps an idle stream alive with a comment every heartbeat', async () => {
    const { call } = setup();
    const response = await call('GET', '/events');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('no body');
    await nextChunk(reader);
    expect(await nextChunk(reader)).toContain(': keep-alive');
    await reader.cancel();
  });

  it('stops listening when the client goes away', async () => {
    const { call, listeners } = setup();
    const response = await call('GET', '/events');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('no body');
    await nextChunk(reader);
    expect(listeners()).toBe(1);
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(listeners()).toBe(0);
  });
});
