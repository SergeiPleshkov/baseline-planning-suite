import type { WorkloadChangedEvent } from '@baseline/delivery-contract';
import { WorkloadResponseSchema } from '@baseline/delivery-contract';
import { describe, expect, it } from 'vitest';
import { testPlan } from '../domain/plan.fixtures';
import { createDeliveryService } from './deliveryService';
import { documentFromState, stateFromDocument, type PlanDocument } from './planDocument';

function setup(options: { failWrites?: boolean } = {}) {
  const written: PlanDocument[] = [];
  const events: WorkloadChangedEvent[] = [];
  let counter = 0;
  const service = createDeliveryService({
    initial: { revision: 3, plan: testPlan() },
    write: (document) => {
      if (options.failWrites) return Promise.reject(new Error('disk full'));
      written.push(document);
      return Promise.resolve();
    },
    newItemId: () => `item-${String((counter += 1))}`,
    newAllocationId: () => `alloc-new-${String((counter += 1))}`,
    notify: (event) => events.push(event),
  });
  return { service, written, events };
}

const cell = (breakdownItemId: string, employeeId: string, month: string) => ({
  breakdownItemId,
  employeeId,
  month,
});

describe('reading', () => {
  it('publishes the plan and a workload that satisfies the contract', () => {
    const { service } = setup();
    expect(service.plan().revision).toBe(3);
    expect(service.plan().items.map((item) => item.id)).toContain('discovery');
    const workload = service.workload();
    expect(WorkloadResponseSchema.parse(workload)).toEqual(workload);
    expect(workload.revision).toBe(3);
  });
});

describe('addItem', () => {
  it('adds an item and raises the revision', async () => {
    const { service, written } = setup();
    const added = await service.addItem({
      projectId: 'ledger',
      parentId: 'handover',
      name: ' QA ',
    });
    expect(added).toEqual({
      ok: true,
      value: {
        revision: 4,
        item: { id: 'item-1', projectId: 'ledger', parentId: 'handover', name: 'QA' },
        movedAllocations: 0,
      },
    });
    expect(written.at(-1)?.items.map((item) => item.id)).toContain('item-1');
  });

  it('moves the allocations of a leaf onto its first child without announcing a workload change', async () => {
    const { service, events } = setup();
    const added = await service.addItem({
      projectId: 'ledger',
      parentId: 'cutover',
      name: 'Rehearsal',
    });
    expect(added).toMatchObject({ ok: true, value: { movedAllocations: 1 } });
    const moved = service.plan().allocations.find((each) => each.id === 'alloc-cutover');
    expect(moved?.breakdownItemId).toBe('item-1');
    expect(events).toEqual([]);
  });

  it('refuses what the tree rules forbid, changing nothing', async () => {
    const { service, written } = setup();
    expect(await service.addItem({ projectId: 'ledger', parentId: 'design', name: 'x' })).toEqual({
      ok: false,
      error: 'too-deep',
    });
    expect(await service.addItem({ projectId: 'ledger', parentId: null, name: ' ' })).toEqual({
      ok: false,
      error: 'blank-name',
    });
    expect(await service.addItem({ projectId: 'ledger', parentId: 'shell', name: 'x' })).toEqual({
      ok: false,
      error: 'parent-in-other-project',
    });
    expect(service.plan().revision).toBe(3);
    expect(written).toEqual([]);
  });
});

describe('updateItem', () => {
  it('renames and moves in one change', async () => {
    const { service, written } = setup();
    const updated = await service.updateItem('docs', {
      name: 'Documentation',
      parentId: 'migration',
    });
    expect(updated).toEqual({ ok: true, value: { revision: 4 } });
    const docs = service.plan().items.find((item) => item.id === 'docs');
    expect(docs).toMatchObject({ name: 'Documentation', parentId: 'migration' });
    expect(written).toHaveLength(1);
  });

  it('applies neither part when one of them is refused', async () => {
    const { service } = setup();
    const refused = await service.updateItem('docs', { name: 'Renamed', parentId: 'cutover' });
    expect(refused).toEqual({ ok: false, error: 'parent-has-allocations' });
    expect(service.plan().items.find((item) => item.id === 'docs')?.name).toBe('docs');
    expect(service.plan().revision).toBe(3);
  });

  it('says nothing changed when asked to set what is already there', async () => {
    const { service, written } = setup();
    expect(await service.updateItem('docs', { name: 'docs' })).toEqual({
      ok: true,
      value: { revision: 3 },
    });
    expect(written).toEqual([]);
  });

  it('refuses an unknown item', async () => {
    const { service } = setup();
    expect(await service.updateItem('nope', { name: 'x' })).toEqual({
      ok: false,
      error: 'unknown-item',
    });
  });
});

describe('deleting', () => {
  it('summarises what a deletion takes, and deletes exactly that once confirmed', async () => {
    const { service, events } = setup();
    const summary = service.deletionSummary('cutover');
    expect(summary).toEqual({
      ok: true,
      value: {
        root: 'cutover',
        items: ['cutover'],
        allocations: [{ id: 'alloc-cutover', personMonths: 0.5 }],
        personMonths: 0.5,
      },
    });
    if (!summary.ok) throw new Error('no summary');
    const deleted = await service.deleteItem('cutover', summary.value);
    expect(deleted).toEqual({ ok: true, value: { revision: 4 } });
    expect(service.plan().allocations.map((each) => each.id)).not.toContain('alloc-cutover');
    expect(events).toEqual([
      { type: 'workload-changed', version: 1, employeeIds: ['emp-001'], revision: 4 },
    ]);
  });

  it('deletes nothing when an amount changed after the confirmation', async () => {
    const { service } = setup();
    const summary = service.deletionSummary('cutover');
    if (!summary.ok) throw new Error('no summary');
    await service.setAllocation(cell('cutover', 'emp-001', '2026-04'), 1);
    expect(await service.deleteItem('cutover', summary.value)).toEqual({
      ok: false,
      error: 'changed-since-confirmation',
    });
    expect(service.plan().allocations.map((each) => each.id)).toContain('alloc-cutover');
  });

  it('announces every employee a deleted subtree touched, not only the first', async () => {
    const { service, events } = setup();
    await service.setAllocation(cell('docs', 'emp-005', '2026-07'), 0.4);
    await service.setAllocation(cell('docs', 'emp-006', '2026-07'), 0.4);
    const summary = service.deletionSummary('handover');
    if (!summary.ok) throw new Error('no summary');
    events.length = 0;
    await service.deleteItem('handover', summary.value);
    expect(events.map((event) => event.employeeIds)).toEqual([['emp-005', 'emp-006']]);
  });

  it('deletes nothing when the subtree changed after the confirmation', async () => {
    const { service } = setup();
    const summary = service.deletionSummary('handover');
    if (!summary.ok) throw new Error('no summary');
    await service.addItem({ projectId: 'ledger', parentId: 'handover', name: 'Late arrival' });
    expect(await service.deleteItem('handover', summary.value)).toEqual({
      ok: false,
      error: 'changed-since-confirmation',
    });
    expect(service.plan().items.map((item) => item.id)).toContain('handover');
  });

  it('refuses an unknown item', async () => {
    const { service } = setup();
    expect(service.deletionSummary('nope')).toEqual({ ok: false, error: 'unknown-item' });
    expect(await service.deleteItem('nope', { items: [], allocations: [] })).toEqual({
      ok: false,
      error: 'unknown-item',
    });
  });
});

describe('setAllocation', () => {
  it('creates, then changes, then removes an allocation, announcing who is affected', async () => {
    const { service, events } = setup();
    const created = await service.setAllocation(cell('docs', 'emp-005', '2026-07'), 0.4);
    expect(created).toMatchObject({
      ok: true,
      value: {
        revision: 4,
        allocation: { id: 'alloc-new-1', employeeId: 'emp-005', personMonths: 0.4, revision: 74 },
      },
    });
    const changed = await service.setAllocation(cell('docs', 'emp-005', '2026-07'), 0.7);
    expect(changed).toMatchObject({
      ok: true,
      value: { revision: 5, allocation: { id: 'alloc-new-1', personMonths: 0.7, revision: 75 } },
    });
    const removed = await service.setAllocation(cell('docs', 'emp-005', '2026-07'), 0);
    expect(removed).toEqual({ ok: true, value: { revision: 6, allocation: null } });
    expect(events.map((event) => [event.employeeIds, event.revision])).toEqual([
      [['emp-005'], 4],
      [['emp-005'], 5],
      [['emp-005'], 6],
    ]);
  });

  it('shows who is to blame for an over-allocation after the change', async () => {
    const { service } = setup();
    await service.setAllocation(cell('design', 'emp-003', '2026-06'), 0.6);
    const entry = service
      .workload()
      .entries.find((each) => each.employeeId === 'emp-003' && each.month === '2026-06');
    expect(entry).toMatchObject({ status: 'over', cause: 'alloc-050' });
  });

  it('does not count the same amount again as a change', async () => {
    const { service, written, events } = setup();
    const same = await service.setAllocation(cell('cutover', 'emp-001', '2026-04'), 0.5);
    expect(same).toMatchObject({
      ok: true,
      value: { revision: 3, allocation: { id: 'alloc-cutover' } },
    });
    expect(await service.setAllocation(cell('docs', 'emp-001', '2026-04'), 0)).toEqual({
      ok: true,
      value: { revision: 3, allocation: null },
    });
    expect(written).toEqual([]);
    expect(events).toEqual([]);
  });

  it.each([
    ['a negative amount', cell('docs', 'emp-1', '2026-07'), -1, 'invalid-amount'],
    ['an unknown item', cell('nope', 'emp-1', '2026-07'), 0.5, 'unknown-item'],
    ['a parent', cell('handover', 'emp-1', '2026-07'), 0.5, 'not-a-leaf'],
    ['a month outside the project', cell('docs', 'emp-1', '2025-01'), 0.5, 'outside-project'],
  ])('refuses %s', async (_label, target, amount, error) => {
    const { service } = setup();
    expect(await service.setAllocation(target, amount)).toEqual({ ok: false, error });
  });
});

describe('storing', () => {
  it('stores a document that restores the same plan', async () => {
    const { service, written } = setup();
    await service.setAllocation(cell('docs', 'emp-005', '2026-07'), 0.4);
    await service.addItem({ projectId: 'portal', parentId: null, name: 'Extra' });
    const stored = written.at(-1);
    expect(stored).toEqual(service.plan());
    expect(documentFromState(stateFromDocument(stored))).toEqual(stored);
  });

  it('does not show or announce a change that could not be stored', async () => {
    const { service, events } = setup({ failWrites: true });
    await expect(service.setAllocation(cell('docs', 'emp-005', '2026-07'), 0.4)).rejects.toThrow(
      'disk full',
    );
    expect(service.plan().revision).toBe(3);
    expect(service.plan().allocations).toHaveLength(3);
    expect(events).toEqual([]);
  });

  it('keeps accepting changes after one could not be stored', async () => {
    let failing = true;
    const events: WorkloadChangedEvent[] = [];
    const service = createDeliveryService({
      initial: { revision: 3, plan: testPlan() },
      write: () => (failing ? Promise.reject(new Error('disk full')) : Promise.resolve()),
      newItemId: () => 'item',
      newAllocationId: () => 'alloc-x',
      notify: (event) => events.push(event),
    });
    await expect(service.setAllocation(cell('docs', 'emp-005', '2026-07'), 0.4)).rejects.toThrow();
    failing = false;
    expect(await service.setAllocation(cell('docs', 'emp-005', '2026-07'), 0.4)).toMatchObject({
      ok: true,
      value: { revision: 4 },
    });
    expect(events).toHaveLength(1);
  });

  it('shows and announces a change only once it is stored', async () => {
    let finish = () => {};
    const events: WorkloadChangedEvent[] = [];
    const service = createDeliveryService({
      initial: { revision: 3, plan: testPlan() },
      write: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      newItemId: () => 'item',
      newAllocationId: () => 'alloc-x',
      notify: (event) => events.push(event),
    });
    const pending = service.setAllocation(cell('docs', 'emp-005', '2026-07'), 0.4);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(service.plan().revision).toBe(3);
    expect(events).toEqual([]);
    finish();
    await pending;
    expect(service.plan().revision).toBe(4);
    expect(events).toHaveLength(1);
  });

  it('applies simultaneous changes one after another without losing any', async () => {
    const { service, events } = setup();
    const results = await Promise.all(
      ['2026-07', '2026-08', '2026-09', '2026-10'].map((month) =>
        service.setAllocation(cell('docs', 'emp-005', month), 0.25),
      ),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    expect(service.plan().allocations).toHaveLength(7);
    expect(events.map((event) => event.revision)).toEqual([4, 5, 6, 7]);
  });
});

describe('stateFromDocument', () => {
  const valid = (): PlanDocument => documentFromState({ revision: 1, plan: testPlan() });

  it('restores what documentFromState wrote', () => {
    expect(documentFromState(stateFromDocument(valid()))).toEqual(valid());
  });

  it.each([
    [
      'an allocation on a parent',
      (d: PlanDocument) => ({
        ...d,
        allocations: [
          ...d.allocations,
          {
            id: 'x',
            breakdownItemId: 'discovery',
            employeeId: 'e',
            month: '2026-06',
            personMonths: 0.1,
            revision: 99,
          },
        ],
      }),
    ],
    [
      'a blank id',
      (d: PlanDocument) => ({
        ...d,
        items: [...d.items, { id: ' ', projectId: 'ledger', parentId: null, name: 'x' }],
      }),
    ],
    [
      'a month that does not exist',
      (d: PlanDocument) => ({
        ...d,
        projects: d.projects.map((p) => ({ ...p, endDate: '2027-13-01' })),
      }),
    ],
    [
      'a repeated revision',
      (d: PlanDocument) => ({
        ...d,
        allocations: d.allocations.map((a) => ({ ...a, revision: 1 })),
      }),
    ],
  ])('refuses a document with %s', (_label, corrupt) => {
    expect(() => stateFromDocument(corrupt(valid()))).toThrow();
  });
});
