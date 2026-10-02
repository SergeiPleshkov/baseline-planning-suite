import { describe, expect, it } from 'vitest';
import { createDeliveryGateway } from './deliveryGateway';
import type { Fetch } from './http';
import { loadRemoteConfig } from './remoteConfig';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

function recorder(answer: () => Promise<Response>) {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl: Fetch = (url, init) => {
    requests.push({ url, init });
    return answer();
  };
  return { fetchImpl, requests };
}

const PLAN = {
  revision: 2,
  projects: [{ id: 'p', name: 'P', firstMonth: '2026-01', lastMonth: '2026-12' }],
  items: [{ id: 'a', projectId: 'p', parentId: null, name: 'A' }],
  allocations: [],
};

describe('plan', () => {
  it('reads the plan from the configured base', async () => {
    const { fetchImpl, requests } = recorder(() => json(PLAN));
    const gateway = createDeliveryGateway({ baseUrl: '/api/delivery/v1/', fetch: fetchImpl });
    expect((await gateway.plan()).items).toHaveLength(1);
    expect(requests[0]?.url).toBe('/api/delivery/v1/plan');
  });

  it('throws for an HTTP error and for a plan that breaks its schema', async () => {
    const down = createDeliveryGateway({ baseUrl: '/x', fetch: () => json({}, 503) });
    await expect(down.plan()).rejects.toThrow(/HTTP 503/);
    const odd = createDeliveryGateway({ baseUrl: '/x', fetch: () => json({ revision: 1 }) });
    await expect(odd.plan()).rejects.toThrow(/does not understand/);
  });
});

describe('commands', () => {
  it('sends JSON to the right routes with the ids escaped', async () => {
    const { fetchImpl, requests } = recorder(() =>
      json({
        revision: 3,
        item: { id: 'n', projectId: 'p', parentId: 'a/b', name: 'N' },
        movedAllocations: 0,
      }),
    );
    const gateway = createDeliveryGateway({ baseUrl: '/api/delivery/v1', fetch: fetchImpl });
    await gateway.addItem({ projectId: 'p', parentId: 'a/b', name: 'N' });
    await gateway.updateItem('x y', { name: 'Z' });
    await gateway.deleteItem({ root: 'r/1', items: ['r/1'], allocations: [], personMonths: 0 });
    expect(requests.map((r) => [r.init?.method, r.url])).toEqual([
      ['POST', '/api/delivery/v1/items'],
      ['PATCH', '/api/delivery/v1/items/x%20y'],
      ['POST', '/api/delivery/v1/items/r%2F1/deletion'],
    ]);
    expect(requests[0]?.init?.headers).toEqual({ 'content-type': 'application/json' });
    expect(requests[1]?.init?.body).toBe('{"name":"Z"}');
    const deleteBody = requests[2]?.init?.body;
    expect(typeof deleteBody === 'string' ? JSON.parse(deleteBody) : null).toEqual({
      root: 'r/1',
      items: ['r/1'],
      allocations: [],
      personMonths: 0,
    });
  });

  it('hands back the new item and how many allocations moved onto it', async () => {
    const gateway = createDeliveryGateway({
      baseUrl: '/x',
      fetch: () =>
        json(
          {
            revision: 3,
            item: { id: 'n', projectId: 'p', parentId: 'a', name: 'N' },
            movedAllocations: 2,
          },
          201,
        ),
    });
    expect(await gateway.addItem({ projectId: 'p', parentId: 'a', name: 'N' })).toEqual({
      ok: true,
      item: { id: 'n', projectId: 'p', parentId: 'a', name: 'N' },
      movedAllocations: 2,
    });
  });

  it('passes on the service’s own words when it refuses', async () => {
    const gateway = createDeliveryGateway({
      baseUrl: '/x',
      fetch: () => json({ error: { code: 'too-deep', message: 'At most three levels.' } }, 409),
    });
    expect(await gateway.updateItem('a', { parentId: 'b' })).toEqual({
      ok: false,
      message: 'At most three levels.',
    });
  });

  it('says it may not have been saved when there was no answer, and what an odd answer was', async () => {
    const unreachable = createDeliveryGateway({
      baseUrl: '/x',
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    const lost = await unreachable.updateItem('a', { name: 'B' });
    expect(lost.ok ? '' : lost.message).toContain('may not have been saved');

    const odd = createDeliveryGateway({
      baseUrl: '/x',
      fetch: () => Promise.resolve(new Response('<html>', { status: 502 })),
    });
    expect(await odd.updateItem('a', { name: 'B' })).toEqual({
      ok: false,
      message: 'The Delivery service answered HTTP 502. The change may not have been saved.',
    });
  });
});

describe('deletionSummary', () => {
  it('reads what a deletion would take', async () => {
    const summary = {
      root: 'a',
      items: ['a'],
      allocations: [{ id: 'x', personMonths: 0.5 }],
      personMonths: 0.5,
    };
    const { fetchImpl, requests } = recorder(() => json(summary));
    const gateway = createDeliveryGateway({ baseUrl: '/api/delivery/v1', fetch: fetchImpl });
    expect(await gateway.deletionSummary('a')).toEqual({ ok: true, summary });
    expect(requests[0]?.url).toBe('/api/delivery/v1/items/a/deletion-summary');
  });

  it('does not claim a change was attempted when the summary cannot be read', async () => {
    const unreachable = createDeliveryGateway({
      baseUrl: '/x',
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    expect(await unreachable.deletionSummary('a')).toEqual({
      ok: false,
      message: 'The Delivery service did not answer.',
    });
    const odd = createDeliveryGateway({
      baseUrl: '/x',
      fetch: () => Promise.resolve(new Response('<html>', { status: 502 })),
    });
    expect(await odd.deletionSummary('a')).toEqual({
      ok: false,
      message: 'The Delivery service answered HTTP 502.',
    });
  });

  it('refuses an item that does not exist and a summary it cannot read', async () => {
    const missing = createDeliveryGateway({
      baseUrl: '/x',
      fetch: () =>
        json({ error: { code: 'unknown-item', message: 'There is no such item.' } }, 404),
    });
    expect(await missing.deletionSummary('a')).toEqual({
      ok: false,
      message: 'There is no such item.',
    });
    const odd = createDeliveryGateway({ baseUrl: '/x', fetch: () => json({ nonsense: true }) });
    expect(await odd.deletionSummary('a')).toMatchObject({ ok: false });
  });
});

describe('loadRemoteConfig', () => {
  it('reads config.json from the remote’s own public path', async () => {
    const config = { deliveryApi: '/api/delivery/v1', peopleApi: '/api/people/v1' };
    const { fetchImpl, requests } = recorder(() => json(config));
    expect(await loadRemoteConfig(fetchImpl, '/mf/delivery/', 'http://host:8080/delivery')).toEqual(
      config,
    );
    expect(requests[0]?.url).toBe('http://host:8080/mf/delivery/config.json');
  });

  it('refuses a missing file and a config that lacks what it needs', async () => {
    await expect(loadRemoteConfig(() => json({}, 404), 'http://h/', 'http://p/')).rejects.toThrow(
      /HTTP 404/,
    );
    await expect(loadRemoteConfig(() => json({}), 'http://h/', 'http://p/')).rejects.toThrow();
    await expect(
      loadRemoteConfig(() => json({ deliveryApi: '/d' }), 'http://h/', 'http://p/'),
    ).rejects.toThrow();
  });
});
