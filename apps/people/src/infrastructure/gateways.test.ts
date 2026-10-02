import { describe, expect, it } from 'vitest';
import type { Fetch } from './http';
import { createPeopleGateway } from './peopleGateway';
import { loadRemoteConfig } from './remoteConfig';
import { createWorkloadGateway } from './workloadGateway';

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

describe('People gateway reads', () => {
  it('asks the configured base and returns a payload that satisfies the contract', async () => {
    const { fetchImpl, requests } = recorder(() =>
      json({ revision: 3, employees: [{ id: 'e1', name: 'A', role: 'B', weeklyHours: 40 }] }),
    );
    const gateway = createPeopleGateway({ baseUrl: '/api/people/v1/', fetch: fetchImpl });
    expect((await gateway.employees()).employees).toHaveLength(1);
    expect(requests[0]?.url).toBe('/api/people/v1/employees');
  });

  it('says a page that is not JSON is something it does not understand, not a parse error', async () => {
    const gateway = createPeopleGateway({
      baseUrl: '/x',
      fetch: () => Promise.resolve(new Response('<html>', { status: 200 })),
    });
    await expect(gateway.employees()).rejects.toThrow(/does not understand/);
  });

  it('throws for an HTTP error and for a payload that breaks the contract', async () => {
    const down = createPeopleGateway({ baseUrl: '/x', fetch: () => json({}, 503) });
    await expect(down.rates()).rejects.toThrow(/HTTP 503/);
    const odd = createPeopleGateway({
      baseUrl: '/x',
      fetch: () => json({ revision: 1, rates: [{ id: 'r' }] }),
    });
    await expect(odd.rates()).rejects.toThrow(/does not understand/);
  });
});

describe('People gateway commands', () => {
  it('sends JSON to the right route with the ids escaped', async () => {
    const { fetchImpl, requests } = recorder(() => json({ revision: 2 }));
    const gateway = createPeopleGateway({ baseUrl: '/api/people/v1', fetch: fetchImpl });
    await gateway.addRate('e/1', { validFrom: '2026-01-01', hourlyRateEur: 70 });
    await gateway.correctRate('r 2', { hourlyRateEur: 5 });
    await gateway.removeRate('r3');
    await gateway.clearRates('e1');
    expect(requests.map((r) => [r.init?.method, r.url])).toEqual([
      ['POST', '/api/people/v1/employees/e%2F1/rates'],
      ['PATCH', '/api/people/v1/rates/r%202'],
      ['DELETE', '/api/people/v1/rates/r3'],
      ['DELETE', '/api/people/v1/employees/e1/rates'],
    ]);
    expect(requests[0]?.init?.headers).toEqual({ 'content-type': 'application/json' });
    expect(requests[0]?.init?.body).toBe('{"validFrom":"2026-01-01","hourlyRateEur":70}');
    expect(requests[2]?.init?.body).toBeUndefined();
  });

  it('succeeds on a 2xx answer', async () => {
    const gateway = createPeopleGateway({ baseUrl: '/x', fetch: () => json({ revision: 2 }, 201) });
    expect(await gateway.removeRate('r')).toEqual({ ok: true });
  });

  it('passes on the service’s own words when it refuses', async () => {
    const gateway = createPeopleGateway({
      baseUrl: '/x',
      fetch: () => json({ error: { code: 'duplicate-valid-from', message: 'Taken.' } }, 409),
    });
    expect(await gateway.addRate('e', { validFrom: '2026-01-01', hourlyRateEur: 1 })).toEqual({
      ok: false,
      message: 'Taken.',
    });
  });

  it('says nothing was saved when the answer is not an explanation, or there is none', async () => {
    const odd = createPeopleGateway({
      baseUrl: '/x',
      fetch: () => Promise.resolve(new Response('<html>', { status: 502 })),
    });
    expect(await odd.removeRate('r')).toEqual({
      ok: false,
      message: 'The People service answered HTTP 502. Nothing was saved.',
    });
    const unreachable = createPeopleGateway({
      baseUrl: '/x',
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    const lost = await unreachable.removeRate('r');
    expect(lost).toMatchObject({ ok: false, outcomeUnknown: true });
    expect(lost.ok ? '' : lost.message).toContain('may not have been saved');
  });
});

describe('Workload gateway', () => {
  it('reads Delivery’s workload from its own base', async () => {
    const { fetchImpl, requests } = recorder(() =>
      json({
        revision: 1,
        entries: [
          { employeeId: 'e', month: '2026-06', personMonths: 1.2, status: 'over', cause: 'a' },
        ],
      }),
    );
    const gateway = createWorkloadGateway({ baseUrl: '/api/delivery/v1', fetch: fetchImpl });
    expect((await gateway.workload()).entries).toHaveLength(1);
    expect(requests[0]?.url).toBe('/api/delivery/v1/workload');
  });

  it('throws for a workload that breaks the contract: an over entry without its cause', async () => {
    const gateway = createWorkloadGateway({
      baseUrl: '/x',
      fetch: () =>
        json({
          revision: 1,
          entries: [{ employeeId: 'e', month: '2026-06', personMonths: 1.2, status: 'over' }],
        }),
    });
    await expect(gateway.workload()).rejects.toThrow(/does not understand/);
  });
});

describe('loadRemoteConfig', () => {
  const config = { peopleApi: '/api/people/v1', deliveryApi: '/api/delivery/v1' };

  it('reads config.json from the remote’s own public path', async () => {
    const { fetchImpl, requests } = recorder(() => json(config));
    expect(
      await loadRemoteConfig(fetchImpl, 'http://host:3001/mf/people/', 'http://page/'),
    ).toEqual(config);
    expect(requests[0]?.url).toBe('http://host:3001/mf/people/config.json');
  });

  it('resolves a public path that is relative to the page', async () => {
    const { fetchImpl, requests } = recorder(() => json(config));
    await loadRemoteConfig(fetchImpl, '/mf/people/', 'http://host:8080/people');
    expect(requests[0]?.url).toBe('http://host:8080/mf/people/config.json');
  });

  it('refuses a missing file and a config that lacks what it needs', async () => {
    await expect(
      loadRemoteConfig(() => json({}, 404), 'http://h/', 'http://page/'),
    ).rejects.toThrow(/HTTP 404/);
    await expect(
      loadRemoteConfig(() => json({ peopleApi: '/x' }), 'http://h/', 'http://page/'),
    ).rejects.toThrow();
  });
});
