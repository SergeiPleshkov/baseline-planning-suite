import { describe, expect, it } from 'vitest';
import { breakdownItemId, projectId } from '../domain/ids';
import { testPlan } from '../domain/plan.fixtures';
import { createDeliveryService } from './deliveryService';
import { createDeliveryStore, type DeliveryStore } from './deliveryStore';
import type { DeliveryGateway } from './ports';

const id = breakdownItemId;
const LEDGER = projectId('ledger');

/** The real service behind the gateway port, with switches to make things go wrong or slow. */
function setup() {
  let counter = 0;
  const service = createDeliveryService({
    initial: { revision: 3, plan: testPlan() },
    write: () => Promise.resolve(),
    newItemId: () => `item-${String((counter += 1))}`,
    newAllocationId: () => `alloc-new-${String((counter += 1))}`,
    notify: () => {},
  });
  const sent: string[] = [];
  const hooks = {
    failReads: false,
    refuse: undefined as string | undefined,
    hold: undefined as Promise<void> | undefined,
  };

  const gateway: DeliveryGateway = {
    plan: () =>
      hooks.failReads ? Promise.reject(new Error('service down')) : Promise.resolve(service.plan()),
    deletionSummary: (itemId) => {
      const summary = service.deletionSummary(itemId);
      return Promise.resolve(
        summary.ok ? { ok: true, summary: summary.value } : { ok: false, message: 'unknown item' },
      );
    },
    addItem: async (input) => {
      sent.push(`add ${input.name}`);
      await hooks.hold;
      if (hooks.refuse) return { ok: false, message: hooks.refuse };
      const added = await service.addItem(input);
      return added.ok
        ? { ok: true, item: added.value.item, movedAllocations: added.value.movedAllocations }
        : { ok: false, message: added.error };
    },
    updateItem: async (itemId, change) => {
      sent.push(`update ${itemId} ${JSON.stringify(change)}`);
      await hooks.hold;
      if (hooks.refuse) return { ok: false, message: hooks.refuse };
      const updated = await service.updateItem(itemId, change);
      return updated.ok ? { ok: true } : { ok: false, message: updated.error };
    },
    deleteItem: async (summary) => {
      sent.push(`delete ${summary.root}`);
      await hooks.hold;
      if (hooks.refuse) return { ok: false, message: hooks.refuse };
      const deleted = await service.deleteItem(summary.root, summary);
      return deleted.ok ? { ok: true } : { ok: false, message: deleted.error };
    },
  };
  return { store: createDeliveryStore(gateway), service, gateway, sent, hooks };
}

function itemsOf(store: DeliveryStore): Map<string, { name: string; parentId: string | null }> {
  const { plan } = store.getSnapshot();
  if (plan.status !== 'ready') throw new Error('not ready');
  return new Map([...plan.plan.items.values()].map((item) => [item.id, item]));
}

const deferred = () => {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

describe('load', () => {
  it('starts loading, then holds the plan', async () => {
    const { store } = setup();
    expect(store.getSnapshot().plan.status).toBe('loading');
    await store.load();
    expect(store.getSnapshot().plan).toMatchObject({ status: 'ready', stale: null, saving: false });
    expect(itemsOf(store).has('design')).toBe(true);
  });

  it('fails when the service is down, then recovers on the next load', async () => {
    const { store, hooks } = setup();
    hooks.failReads = true;
    await store.load();
    expect(store.getSnapshot().plan).toEqual({ status: 'failed', message: 'service down' });
    hooks.failReads = false;
    await store.load();
    expect(store.getSnapshot().plan.status).toBe('ready');
  });

  it('keeps showing the plan while it is read again, and marks it when that fails', async () => {
    const { store, hooks } = setup();
    await store.load();
    hooks.failReads = true;
    await store.load();
    const { plan } = store.getSnapshot();
    expect(plan.status === 'ready' && plan.stale).toBe('service down');
    expect(itemsOf(store).size).toBe(9);
  });

  it('waits for a command in flight, so that a read does not undo what it shows', async () => {
    const { store, hooks } = setup();
    await store.load();
    const gate = deferred();
    hooks.hold = gate.promise;
    const renaming = store.renameItem(id('docs'), 'Documentation');
    await Promise.resolve();
    const loading = store.load();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(itemsOf(store).get('docs')?.name).toBe('Documentation');
    const { plan } = store.getSnapshot();
    expect(plan.status === 'ready' && plan.saving).toBe(true);
    gate.release();
    await Promise.all([renaming, loading]);
    expect(itemsOf(store).get('docs')?.name).toBe('Documentation');
  });
});

describe('renameItem', () => {
  it('shows the new name at once and keeps it once the service agrees', async () => {
    const { store, hooks, sent } = setup();
    await store.load();
    const gate = deferred();
    hooks.hold = gate.promise;
    const pending = store.renameItem(id('docs'), '  Documentation ');
    await Promise.resolve();
    await Promise.resolve();
    expect(itemsOf(store).get('docs')?.name).toBe('Documentation');
    const { plan } = store.getSnapshot();
    expect(plan.status === 'ready' && plan.saving).toBe(true);

    gate.release();
    expect(await pending).toEqual({ ok: true });
    expect(itemsOf(store).get('docs')?.name).toBe('Documentation');
    expect(store.getSnapshot().plan).toMatchObject({ saving: false });
    expect(sent).toEqual(['update docs {"name":"  Documentation "}']);
  });

  it('refuses a blank name before sending anything', async () => {
    const { store, sent } = setup();
    await store.load();
    const before = store.getSnapshot();
    expect(await store.renameItem(id('docs'), '   ')).toEqual({
      ok: false,
      message: 'An item needs a name.',
    });
    expect(sent).toEqual([]);
    expect(store.getSnapshot()).toBe(before);
  });

  it('sends nothing when the name is the one it already has', async () => {
    const { store, sent } = setup();
    await store.load();
    expect(await store.renameItem(id('docs'), 'docs')).toEqual({ ok: true });
    expect(sent).toEqual([]);
  });

  it('goes back to what the service holds, and says why, when the service refuses', async () => {
    const { store, hooks } = setup();
    await store.load();
    hooks.refuse = 'The service said no.';
    expect(await store.renameItem(id('docs'), 'Documentation')).toEqual({
      ok: false,
      message: 'The service said no.',
    });
    expect(itemsOf(store).get('docs')?.name).toBe('docs');
    expect(store.getSnapshot().plan).toMatchObject({ saving: false, stale: null });
  });

  it('goes back to the last known plan when the service refuses and cannot be read either', async () => {
    const { store, hooks } = setup();
    await store.load();
    hooks.refuse = 'The service said no.';
    hooks.failReads = true;
    await store.renameItem(id('docs'), 'Documentation');
    expect(itemsOf(store).get('docs')?.name).toBe('docs');
    const { plan } = store.getSnapshot();
    expect(plan.status === 'ready' && plan.stale).toBe('service down');
  });

  it('keeps the change on screen when the service accepted it but cannot be read afterwards', async () => {
    const { store, hooks } = setup();
    await store.load();
    hooks.failReads = true;
    await store.renameItem(id('docs'), 'Documentation');
    expect(itemsOf(store).get('docs')?.name).toBe('Documentation');
    const { plan } = store.getSnapshot();
    expect(plan.status === 'ready' && plan.stale).toBe('service down');
  });

  it('does not send a second change until the first has been answered', async () => {
    const { store, hooks, sent } = setup();
    await store.load();
    const gate = deferred();
    hooks.hold = gate.promise;
    const first = store.renameItem(id('docs'), 'First');
    const second = store.renameItem(id('review'), 'Second');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sent).toHaveLength(1);
    gate.release();
    await Promise.all([first, second]);
    expect(sent).toHaveLength(2);
  });

  it('goes back to the last accepted plan, not an older one, when a later refusal cannot be read', async () => {
    const { store, hooks } = setup();
    await store.load();
    hooks.failReads = true;
    await store.renameItem(id('docs'), 'Accepted');
    hooks.refuse = 'No.';
    await store.renameItem(id('review'), 'Refused');
    expect(itemsOf(store).get('docs')?.name).toBe('Accepted');
    expect(itemsOf(store).get('review')?.name).toBe('review');
  });

  it('stops saving, and refuses, when the gateway throws instead of answering', async () => {
    const { gateway } = setup();
    const broken = createDeliveryStore({
      ...gateway,
      updateItem: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    await broken.load();
    const result = await broken.renameItem(id('docs'), 'Documentation');
    expect(result).toMatchObject({ ok: false });
    const { plan } = broken.getSnapshot();
    expect(plan.status === 'ready' && plan.saving).toBe(false);
    expect(itemsOf(broken).get('docs')?.name).toBe('docs');
  });

  it('applies changes made at the same time one after another', async () => {
    const { store, sent } = setup();
    await store.load();
    await Promise.all([
      store.renameItem(id('docs'), 'First'),
      store.renameItem(id('docs'), 'Second'),
      store.renameItem(id('review'), 'Third'),
    ]);
    expect(itemsOf(store).get('docs')?.name).toBe('Second');
    expect(itemsOf(store).get('review')?.name).toBe('Third');
    expect(sent).toHaveLength(3);
  });

  it('cannot run before the plan is loaded', async () => {
    const { store } = setup();
    expect(await store.renameItem(id('docs'), 'x')).toMatchObject({ ok: false });
  });
});

describe('moveItem', () => {
  it('moves at once and keeps the move once the service agrees', async () => {
    const { store, sent } = setup();
    await store.load();
    expect(await store.moveItem(id('docs'), id('migration'))).toEqual({ ok: true });
    expect(itemsOf(store).get('docs')?.parentId).toBe('migration');
    expect(sent).toEqual(['update docs {"parentId":"migration"}']);
  });

  it('can move an item to the top level', async () => {
    const { store } = setup();
    await store.load();
    await store.moveItem(id('docs'), null);
    expect(itemsOf(store).get('docs')?.parentId).toBeNull();
  });

  it('refuses a move the tree rules forbid, explaining it, without sending anything', async () => {
    const { store, sent } = setup();
    await store.load();
    const underLeafWithAllocations = await store.moveItem(id('docs'), id('cutover'));
    expect(underLeafWithAllocations).toMatchObject({ ok: false });
    expect(!underLeafWithAllocations.ok && underLeafWithAllocations.message).toContain(
      'holds allocations',
    );
    expect(await store.moveItem(id('migration'), id('design'))).toMatchObject({ ok: false });
    expect(sent).toEqual([]);
  });

  it('goes back when the service refuses', async () => {
    const { store, hooks } = setup();
    await store.load();
    hooks.refuse = 'No.';
    await store.moveItem(id('docs'), id('migration'));
    expect(itemsOf(store).get('docs')?.parentId).toBe('handover');
  });
});

describe('addItem', () => {
  it('adds an item under a parent and tells which item it is', async () => {
    const { store } = setup();
    await store.load();
    const added = await store.addItem(LEDGER, id('handover'), ' QA ');
    expect(added).toEqual({ ok: true, itemId: 'item-1', notice: null });
    expect(itemsOf(store).get('item-1')).toMatchObject({ name: 'QA', parentId: 'handover' });
  });

  it('shows the new item even when the plan cannot be read right after it was added', async () => {
    const { store, hooks } = setup();
    await store.load();
    hooks.failReads = true;
    const added = await store.addItem(LEDGER, id('handover'), 'QA');
    expect(added).toMatchObject({ ok: true, itemId: 'item-1' });
    expect(itemsOf(store).get('item-1')).toMatchObject({ name: 'QA', parentId: 'handover' });
    const { plan } = store.getSnapshot();
    expect(plan.status === 'ready' && plan.stale).not.toBeNull();
  });

  it('adds a top-level item', async () => {
    const { store } = setup();
    await store.load();
    await store.addItem(LEDGER, null, 'Extra');
    expect(itemsOf(store).get('item-1')?.parentId).toBeNull();
  });

  it('says so when the allocations of a leaf move onto its first child (R4)', async () => {
    const { store } = setup();
    await store.load();
    const added = await store.addItem(LEDGER, id('cutover'), 'Rehearsal');
    expect(added.ok && added.notice).toBe(
      '1 allocation was moved from “cutover” onto the new item “Rehearsal”, because an item that has children holds none itself.',
    );
  });

  it('refuses what the tree rules forbid before sending anything', async () => {
    const { store, sent } = setup();
    await store.load();
    expect(await store.addItem(LEDGER, id('design'), 'x')).toEqual({
      ok: false,
      message: 'The breakdown is at most three levels deep.',
    });
    expect(await store.addItem(LEDGER, null, ' ')).toEqual({
      ok: false,
      message: 'An item needs a name.',
    });
    expect(sent).toEqual([]);
  });

  it('shows what the service holds when it refuses', async () => {
    const { store, hooks } = setup();
    await store.load();
    hooks.refuse = 'Not today.';
    expect(await store.addItem(LEDGER, null, 'Extra')).toEqual({
      ok: false,
      message: 'Not today.',
    });
    expect(itemsOf(store).size).toBe(9);
  });
});

describe('deleting', () => {
  it('summarises what a deletion takes, and deletes exactly that once confirmed', async () => {
    const { store, sent } = setup();
    await store.load();
    const summary = await store.deletionSummary(id('cutover'));
    expect(summary).toMatchObject({
      ok: true,
      summary: { items: ['cutover'], allocations: [{ id: 'alloc-cutover', personMonths: 0.5 }] },
    });
    if (!summary.ok) throw new Error('no summary');
    expect(await store.deleteItem(summary.summary)).toEqual({ ok: true });
    expect(itemsOf(store).has('cutover')).toBe(false);
    expect(sent).toEqual(['delete cutover']);
  });

  it('shows the deletion at once, before the service has answered', async () => {
    const { store, hooks } = setup();
    await store.load();
    const summary = await store.deletionSummary(id('cutover'));
    if (!summary.ok) throw new Error('no summary');
    const gate = deferred();
    hooks.hold = gate.promise;
    const pending = store.deleteItem(summary.summary);
    await Promise.resolve();
    await Promise.resolve();
    expect(itemsOf(store).has('cutover')).toBe(false);
    gate.release();
    await pending;
  });

  it('deletes nothing, and says to review, when the item changed after the summary', async () => {
    const { store } = setup();
    await store.load();
    const summary = await store.deletionSummary(id('handover'));
    if (!summary.ok) throw new Error('no summary');
    await store.addItem(LEDGER, id('handover'), 'Late arrival');
    const result = await store.deleteItem(summary.summary);
    expect(result).toMatchObject({ ok: false });
    expect(itemsOf(store).has('handover')).toBe(true);
    expect(itemsOf(store).has('item-1')).toBe(true);
  });

  it('asks the service even when the plan on screen is out of date', async () => {
    const { store, service, sent } = setup();
    await store.load();
    const summary = await store.deletionSummary(id('handover'));
    if (!summary.ok) throw new Error('no summary');
    // Someone else adds a child; this screen has not heard of it.
    await service.addItem({ projectId: 'ledger', parentId: 'handover', name: 'Elsewhere' });
    const result = await store.deleteItem(summary.summary);
    expect(sent).toEqual(['delete handover']);
    expect(result).toMatchObject({ ok: false });
    expect(itemsOf(store).has('item-1')).toBe(true);
  });

  it('reports an item that does not exist', async () => {
    const { store } = setup();
    await store.load();
    expect(await store.deletionSummary(id('nope'))).toEqual({ ok: false, message: 'unknown item' });
  });
});

describe('subscribe', () => {
  it('tells listeners about each change, and stops after unsubscribe', async () => {
    const { store } = setup();
    let heard = 0;
    const stop = store.subscribe(() => {
      heard += 1;
    });
    await store.load();
    expect(heard).toBeGreaterThan(0);
    const after = heard;
    stop();
    await store.renameItem(id('docs'), 'Renamed');
    expect(heard).toBe(after);
  });

  it('hands out the same snapshot until something changes', async () => {
    const { store } = setup();
    await store.load();
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });
});
