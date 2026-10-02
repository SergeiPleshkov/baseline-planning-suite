import {
  EmployeesResponseSchema,
  RatesChangedEventSchema,
  RatesResponseSchema,
  type RatesChangedEvent,
} from '@baseline/people-contract';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { stateFromDocument } from '../application/document';
import { createPeopleService } from '../application/peopleService';
import { createEventBus } from './eventBus';
import { createPeopleApi } from './peopleApi';

function setup() {
  const events = createEventBus<RatesChangedEvent>();
  let counter = 0;
  const service = createPeopleService({
    initial: stateFromDocument({
      revision: 1,
      employees: [
        { id: 'emp-1', name: 'Adaeze Okafor', role: 'Tech Lead', weeklyHours: 40 },
        { id: 'emp-2', name: 'Lena Okafor', role: 'Frontend Engineer', weeklyHours: 32 },
      ],
      rates: [
        { id: 'r1', employeeId: 'emp-1', validFrom: '2025-01-01', hourlyRateEur: 80 },
        { id: 'r2', employeeId: 'emp-1', validFrom: '2026-03-12', hourlyRateEur: 95 },
      ],
    }),
    write: () => Promise.resolve(),
    newRateId: () => `new-${String((counter += 1))}`,
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
    '/api/people/v1',
    createPeopleApi({ service, subscribe, heartbeatMs: 20 }),
  );
  const call = (method: string, path: string, body?: unknown) =>
    app.request(`/api/people/v1${path}`, {
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

describe('reading', () => {
  it('answers with payloads that satisfy the contract', async () => {
    const { call } = setup();
    const employees = await call('GET', '/employees');
    expect(employees.status).toBe(200);
    expect(EmployeesResponseSchema.parse(await employees.json()).employees).toHaveLength(2);
    const rates = await call('GET', '/rates');
    expect(RatesResponseSchema.parse(await rates.json()).rates).toHaveLength(2);
  });
});

describe('POST /employees/:id/rates', () => {
  it('creates a rate that the next read shows', async () => {
    const { call } = setup();
    const created = await call('POST', '/employees/emp-2/rates', {
      validFrom: '2026-01-01',
      hourlyRateEur: 70.5,
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({
      revision: 2,
      rate: { id: 'new-1', employeeId: 'emp-2', validFrom: '2026-01-01', hourlyRateEur: 70.5 },
    });
    const rates = RatesResponseSchema.parse(await (await call('GET', '/rates')).json());
    expect(rates.revision).toBe(2);
    expect(rates.rates.map((rate) => rate.id)).toContain('new-1');
  });

  it.each([
    ['a rate with three decimals', { validFrom: '2026-01-01', hourlyRateEur: 70.125 }],
    ['a rate of zero', { validFrom: '2026-01-01', hourlyRateEur: 0 }],
    ['a rate above the limit', { validFrom: '2026-01-01', hourlyRateEur: 10_001 }],
    ['a date that does not exist', { validFrom: '2026-02-30', hourlyRateEur: 70 }],
    ['a date before 1900', { validFrom: '1850-01-01', hourlyRateEur: 70 }],
    ['a missing rate', { validFrom: '2026-01-01' }],
    ['a rate as text', { validFrom: '2026-01-01', hourlyRateEur: '70' }],
    ['no body', undefined],
  ])('answers 400 for %s', async (_label, body) => {
    const { call } = setup();
    const response = await call('POST', '/employees/emp-2/rates', body);
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('invalid-request');
  });

  it('answers 400 for text that is not JSON', async () => {
    const { app } = setup();
    const response = await app.request('/api/people/v1/employees/emp-2/rates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ nope',
    });
    expect(response.status).toBe(400);
  });

  it('answers 404 for an unknown employee and 409 for a taken start date', async () => {
    const { call } = setup();
    const unknown = await call('POST', '/employees/nobody/rates', {
      validFrom: '2026-01-01',
      hourlyRateEur: 70,
    });
    expect([unknown.status, await errorCode(unknown)]).toEqual([404, 'unknown-employee']);
    const taken = await call('POST', '/employees/emp-1/rates', {
      validFrom: '2026-03-12',
      hourlyRateEur: 70,
    });
    expect([taken.status, await errorCode(taken)]).toEqual([409, 'duplicate-valid-from']);
  });
});

describe('PATCH /rates/:id', () => {
  it('corrects a rate', async () => {
    const { call } = setup();
    const response = await call('PATCH', '/rates/r2', { hourlyRateEur: 99 });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      revision: 2,
      rate: { id: 'r2', hourlyRateEur: 99 },
    });
  });

  it('answers 400 when it is told to change nothing', async () => {
    const { call } = setup();
    expect((await call('PATCH', '/rates/r2', {})).status).toBe(400);
  });

  it('answers 404 for an unknown rate and 409 for a date another rate has', async () => {
    const { call } = setup();
    expect((await call('PATCH', '/rates/nope', { hourlyRateEur: 1 })).status).toBe(404);
    const taken = await call('PATCH', '/rates/r2', { validFrom: '2025-01-01' });
    expect([taken.status, await errorCode(taken)]).toEqual([409, 'duplicate-valid-from']);
  });
});

describe('DELETE', () => {
  it('removes a rate, but not the only one of an employee', async () => {
    const { call } = setup();
    expect((await call('DELETE', '/rates/r1')).status).toBe(200);
    const only = await call('DELETE', '/rates/r2');
    expect([only.status, await errorCode(only)]).toEqual([409, 'only-rate']);
  });

  it('clears every rate of an employee on request', async () => {
    const { call } = setup();
    expect((await call('DELETE', '/employees/emp-1/rates')).status).toBe(200);
    const rates = RatesResponseSchema.parse(await (await call('GET', '/rates')).json());
    expect(rates.rates).toEqual([]);
  });

  it('answers 404 for what does not exist', async () => {
    const { call } = setup();
    expect((await call('DELETE', '/rates/nope')).status).toBe(404);
    expect((await call('DELETE', '/employees/nobody/rates')).status).toBe(404);
  });
});

describe('what a hostile or careless caller can do', () => {
  it('gets 404, not 500, for an id that is only whitespace', async () => {
    const { call } = setup();
    const rate = { validFrom: '2026-01-01', hourlyRateEur: 70 };
    for (const [method, path, body] of [
      ['POST', '/employees/%20/rates', rate],
      ['PATCH', '/rates/%20', { hourlyRateEur: 1 }],
      ['DELETE', '/rates/%20', undefined],
      ['DELETE', '/employees/%20/rates', undefined],
    ] as const) {
      expect([method, path, (await call(method, path, body)).status]).toEqual([method, path, 404]);
    }
  });

  it('gets 415 for anything but JSON, so a web page cannot write with a plain form post', async () => {
    const { app } = setup();
    const response = await app.request('/api/people/v1/employees/emp-1/rates', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ validFrom: '2026-01-01', hourlyRateEur: 70 }),
    });
    expect([response.status, await errorCode(response)]).toEqual([415, 'unsupported-media-type']);
    expect((await app.request('/api/people/v1/rates')).status).toBe(200);
  });

  it('gets 413 for a body far larger than any command', async () => {
    const { call } = setup();
    const response = await call('POST', '/employees/emp-1/rates', {
      validFrom: '2026-01-01',
      hourlyRateEur: 70,
      padding: 'x'.repeat(100_000),
    });
    expect([response.status, await errorCode(response)]).toEqual([413, 'too-large']);
  });

  it.each([
    [
      'a field it does not know',
      '/rates/r2',
      'PATCH',
      { hourlyRateEur: 5, validFrm: '2026-01-01' },
    ],
    [
      'a field it does not know',
      '/employees/emp-2/rates',
      'POST',
      { validFrom: '2026-01-01', hourlyRateEur: 70, note: 'x' },
    ],
  ])('gets 400 for %s', async (_label, path, method, body) => {
    const { call } = setup();
    const response = await call(method, path, body);
    expect([response.status, await errorCode(response)]).toEqual([400, 'invalid-request']);
  });
});

describe('GET /events', () => {
  async function nextChunk(reader: ReadableStreamDefaultReader<Uint8Array>) {
    const { value } = await reader.read();
    return new TextDecoder().decode(value);
  }

  it('streams a rates-changed event to everyone listening when a rate changes', async () => {
    const { call } = setup();
    const response = await call('GET', '/events');
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('no body');

    expect(await nextChunk(reader)).toContain(': open');
    await call('POST', '/employees/emp-2/rates', { validFrom: '2026-01-01', hourlyRateEur: 70 });

    let received = '';
    while (!received.includes('data:')) received += await nextChunk(reader);
    await reader.cancel();

    expect(received).toContain('event: rates-changed');
    const data = /data: (.*)/.exec(received)?.[1] ?? '';
    expect(RatesChangedEventSchema.parse(JSON.parse(data))).toEqual({
      type: 'rates-changed',
      version: 1,
      employeeIds: ['emp-2'],
      revision: 2,
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
