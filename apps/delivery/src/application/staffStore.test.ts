import { describe, expect, it, vi } from 'vitest';
import { employeeId } from '../domain/ids';
import type { PeopleSource } from './ports';
import { createStaffStore } from './staffStore';

const EMPLOYEES = {
  revision: 1,
  employees: [{ id: 'emp-1', name: 'Ada Lovelace', role: 'Engineer', weeklyHours: 40 }],
};
const RATES = {
  revision: 1,
  rates: [{ id: 'rate-1', employeeId: 'emp-1', validFrom: '2026-01-01', hourlyRateEur: 80 }],
};

const source = (overrides: Partial<PeopleSource> = {}): PeopleSource => ({
  employees: () => Promise.resolve(EMPLOYEES),
  rates: () => Promise.resolve(RATES),
  ...overrides,
});

describe('createStaffStore', () => {
  it('starts loading, then holds the people and their rate timelines', async () => {
    const store = createStaffStore(source());
    expect(store.getSnapshot()).toEqual({ status: 'loading' });
    await store.load();
    const view = store.getSnapshot();
    if (view.status !== 'ready') throw new Error(`expected ready, got ${view.status}`);
    expect(view.staff.get(employeeId('emp-1'))).toEqual({
      id: 'emp-1',
      name: 'Ada Lovelace',
      weeklyHours: 40,
    });
    expect(view.rates.get(employeeId('emp-1'))?.changes).toEqual([
      { effectiveFrom: '2026-01-01', hourlyRateEur: 80 },
    ]);
  });

  it('tells its listeners about each change, and only while they listen', async () => {
    const store = createStaffStore(source());
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    await store.load();
    const calls = listener.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(1);
    stop();
    await store.load();
    expect(listener).toHaveBeenCalledTimes(calls);
  });

  it('fails with a sentence when People cannot be reached', async () => {
    const store = createStaffStore(
      source({ rates: () => Promise.reject(new TypeError('Failed to fetch')) }),
    );
    await store.load();
    expect(store.getSnapshot()).toEqual({
      status: 'failed',
      message: 'The People service cannot be reached.',
    });
  });

  it('fails when an answer breaks the contract, naming whose rates are unusable', async () => {
    const malformed = createStaffStore(source({ employees: () => Promise.resolve({}) }));
    await malformed.load();
    expect(malformed.getSnapshot()).toMatchObject({ status: 'failed' });

    const twoOnOneDay = createStaffStore(
      source({
        rates: () =>
          Promise.resolve({
            revision: 1,
            rates: [
              { id: 'a', employeeId: 'emp-1', validFrom: '2026-01-01', hourlyRateEur: 80 },
              { id: 'b', employeeId: 'emp-1', validFrom: '2026-01-01', hourlyRateEur: 90 },
            ],
          }),
      }),
    );
    await twoOnOneDay.load();
    const view = twoOnOneDay.getSnapshot();
    expect(view).toMatchObject({ status: 'failed' });
    expect(view.status === 'failed' && view.message).toContain('emp-1');
  });

  it('says it is loading again while a retry is under way', async () => {
    let failing = true;
    let release: () => void = () => undefined;
    const store = createStaffStore(
      source({
        employees: async () => {
          if (failing) throw new TypeError('down');
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return EMPLOYEES;
        },
      }),
    );
    await store.load();
    expect(store.getSnapshot().status).toBe('failed');
    failing = false;
    const retry = store.load();
    expect(store.getSnapshot()).toEqual({ status: 'loading' });
    await Promise.resolve();
    release();
    await retry;
    expect(store.getSnapshot().status).toBe('ready');
  });

  it('tells a timeout from an unreachable service', async () => {
    const store = createStaffStore(
      source({ rates: () => Promise.reject(new DOMException('slow', 'TimeoutError')) }),
    );
    await store.load();
    expect(store.getSnapshot()).toEqual({
      status: 'failed',
      message: 'The People service did not answer in time.',
    });
  });

  it('recovers when a retry succeeds', async () => {
    let failing = true;
    const store = createStaffStore(
      source({
        employees: () =>
          failing ? Promise.reject(new TypeError('down')) : Promise.resolve(EMPLOYEES),
      }),
    );
    await store.load();
    expect(store.getSnapshot().status).toBe('failed');
    failing = false;
    await store.load();
    expect(store.getSnapshot().status).toBe('ready');
  });

  it('shares one read between callers that ask while it is under way', async () => {
    const employees = vi.fn(() => Promise.resolve(EMPLOYEES));
    const store = createStaffStore(source({ employees }));
    await Promise.all([store.load(), store.load()]);
    expect(employees).toHaveBeenCalledTimes(1);
  });
});
