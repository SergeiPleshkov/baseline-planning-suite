import type { WorkloadResponse } from '@baseline/delivery-contract';
import type { RatesResponse } from '@baseline/people-contract';
import { describe, expect, it } from 'vitest';
import { isoDate } from '../domain/calendar';
import { employeeId, rateId } from '../domain/ids';
import { rateOn } from '../domain/rates';
import { createPeopleStore } from './peopleStore';
import type { CommandResult, PeopleGateway, WorkloadGateway } from './ports';

const EMPLOYEES = {
  revision: 1,
  employees: [
    { id: 'e1', name: 'Adaeze Okafor', role: 'Tech Lead', weeklyHours: 40 },
    { id: 'e2', name: 'Lena Okafor', role: 'Frontend Engineer', weeklyHours: 32 },
  ],
};

function fakes(overrides: { workload?: () => Promise<WorkloadResponse> } = {}) {
  const sent: string[] = [];
  let rates: RatesResponse = {
    revision: 1,
    rates: [{ id: 'r1', employeeId: 'e1', validFrom: '2025-01-01', hourlyRateEur: 80 }],
  };
  let refuse: CommandResult | undefined;
  const calls: string[] = [];
  const people: PeopleGateway = {
    employees: () => Promise.resolve(EMPLOYEES),
    rates: () => Promise.resolve(rates),
    addRate: (employee, input) => {
      calls.push(`add ${employee} ${input.validFrom}`);
      if (refuse) return Promise.resolve(refuse);
      rates = {
        revision: rates.revision + 1,
        rates: [...rates.rates, { id: 'r2', employeeId: employee, ...input }],
      };
      return Promise.resolve({ ok: true });
    },
    correctRate: (id, change) => {
      sent.push(`correct ${id} ${JSON.stringify(change)}`);
      if (refuse) return Promise.resolve(refuse);
      rates = {
        revision: rates.revision + 1,
        rates: rates.rates.map((rate) => (rate.id === id ? { ...rate, ...change } : rate)),
      };
      return Promise.resolve({ ok: true });
    },
    removeRate: (id) => {
      sent.push(`remove ${id}`);
      if (refuse) return Promise.resolve(refuse);
      rates = { revision: rates.revision + 1, rates: rates.rates.filter((rate) => rate.id !== id) };
      return Promise.resolve({ ok: true });
    },
    clearRates: (employee) => {
      sent.push(`clear ${employee}`);
      if (refuse) return Promise.resolve(refuse);
      rates = {
        revision: rates.revision + 1,
        rates: rates.rates.filter((rate) => rate.employeeId !== employee),
      };
      return Promise.resolve({ ok: true });
    },
  };
  const workload: WorkloadGateway = {
    workload:
      overrides.workload ??
      (() =>
        Promise.resolve({
          revision: 1,
          entries: [
            { employeeId: 'e2', month: '2026-07', personMonths: 1.2, status: 'over', cause: 'a' },
            { employeeId: 'e2', month: '2026-06', personMonths: 0.5, status: 'within' },
            { employeeId: 'e1', month: '2026-06', personMonths: 1, status: 'within' },
          ],
        })),
  };
  return {
    people,
    workload,
    calls,
    sent,
    refuseWith: (result: CommandResult) => {
      refuse = result;
    },
  };
}

describe('load', () => {
  it('starts loading, then holds the register with each employee’s rate history', async () => {
    const { people, workload } = fakes();
    const store = createPeopleStore({ people, workload });
    expect(store.getSnapshot().register.status).toBe('loading');
    await store.load();
    const { register } = store.getSnapshot();
    if (register.status !== 'ready') throw new Error('not ready');
    expect(register.employees.map((each) => each.id)).toEqual(['e1', 'e2']);
    const history = register.histories.get(employeeId('e1'));
    if (!history) throw new Error('no history');
    expect(rateOn(history, isoDate('2026-01-01'))).toBe(80);
    expect(register.histories.get(employeeId('e2'))?.records).toEqual([]);
  });

  it('groups Delivery’s workload per employee, in month order, counting months over capacity', async () => {
    const { people, workload } = fakes();
    const store = createPeopleStore({ people, workload });
    await store.load();
    const view = store.getSnapshot().workload;
    if (view.status !== 'ready') throw new Error('not ready');
    const e2 = view.byEmployee.get(employeeId('e2'));
    expect(e2?.months.map((month) => month.month)).toEqual(['2026-06', '2026-07']);
    expect(e2?.overMonths).toBe(1);
    expect(view.byEmployee.get(employeeId('e1'))?.overMonths).toBe(0);
  });

  it('keeps working when Delivery is down, and says so', async () => {
    const { people, workload } = fakes({ workload: () => Promise.reject(new Error('refused')) });
    const store = createPeopleStore({ people, workload });
    await store.load();
    expect(store.getSnapshot().register.status).toBe('ready');
    expect(store.getSnapshot().workload).toEqual({ status: 'unavailable', message: 'refused' });
  });

  it('fails when People is down, then recovers on the next load', async () => {
    const { people, workload } = fakes();
    let down = true;
    const store = createPeopleStore({
      people: {
        ...people,
        employees: () => (down ? Promise.reject(new Error('down')) : people.employees()),
      },
      workload,
    });
    await store.load();
    expect(store.getSnapshot().register).toEqual({ status: 'failed', message: 'down' });
    down = false;
    await store.load();
    expect(store.getSnapshot().register.status).toBe('ready');
  });

  it('fails, rather than show nonsense, when the rates contradict the rules', async () => {
    const { people, workload } = fakes();
    const store = createPeopleStore({
      people: {
        ...people,
        rates: () =>
          Promise.resolve({
            revision: 1,
            rates: [
              { id: 'a', employeeId: 'e1', validFrom: '2025-01-01', hourlyRateEur: 80 },
              { id: 'b', employeeId: 'e1', validFrom: '2025-01-01', hourlyRateEur: 90 },
            ],
          }),
      },
      workload,
    });
    await store.load();
    expect(store.getSnapshot().register.status).toBe('failed');
  });

  it('keeps showing the register while it is read again', async () => {
    const { people, workload } = fakes();
    const store = createPeopleStore({ people, workload });
    await store.load();
    const reloading = store.load();
    expect(store.getSnapshot().register.status).toBe('ready');
    await reloading;
  });

  it('does not let a slow old read undo a newer one', async () => {
    const { people, workload } = fakes();
    let release = () => {};
    let first = true;
    const store = createPeopleStore({
      people: {
        ...people,
        rates: async () => {
          if (first) {
            first = false;
            await new Promise<void>((resolve) => {
              release = resolve;
            });
            return { revision: 1, rates: [] };
          }
          return people.rates();
        },
      },
      workload,
    });
    const slow = store.load();
    await store.load();
    release();
    await slow;
    const { register } = store.getSnapshot();
    if (register.status !== 'ready') throw new Error('not ready');
    expect(register.histories.get(employeeId('e1'))?.records).toHaveLength(1);
  });
});

describe('commands', () => {
  it('reads the rates again after a command, so the view shows what the service holds', async () => {
    const { people, workload, calls } = fakes();
    const store = createPeopleStore({ people, workload });
    await store.load();
    const result = await store.addRate(employeeId('e1'), {
      validFrom: isoDate('2026-03-12'),
      hourlyRateEur: 95,
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual(['add e1 2026-03-12']);
    const { register } = store.getSnapshot();
    if (register.status !== 'ready') throw new Error('not ready');
    expect(register.histories.get(employeeId('e1'))?.records.map((each) => each.id)).toEqual([
      'r1',
      'r2',
    ]);
  });

  it('returns the service’s explanation and leaves the view alone when it refuses', async () => {
    const { people, workload, refuseWith } = fakes();
    const store = createPeopleStore({ people, workload });
    await store.load();
    const before = store.getSnapshot();
    refuseWith({ ok: false, message: 'The employee already has a rate starting on that day.' });
    const result = await store.addRate(employeeId('e1'), {
      validFrom: isoDate('2025-01-01'),
      hourlyRateEur: 70,
    });
    expect(result).toEqual({
      ok: false,
      message: 'The employee already has a rate starting on that day.',
    });
    expect(store.getSnapshot()).toBe(before);
  });

  it('sends a correction, a removal and a clearing to the right target, and shows the result', async () => {
    const { people, workload, sent } = fakes();
    const store = createPeopleStore({ people, workload });
    await store.load();
    const records = () => {
      const { register } = store.getSnapshot();
      if (register.status !== 'ready') throw new Error('not ready');
      return register.histories.get(employeeId('e1'))?.records ?? [];
    };

    await store.correctRate(rateId('r1'), { hourlyRateEur: 90 });
    expect(records().map((rate) => rate.hourlyRateEur)).toEqual([90]);

    await store.addRate(employeeId('e1'), { validFrom: isoDate('2026-03-12'), hourlyRateEur: 95 });
    await store.removeRate(rateId('r1'));
    expect(records().map((rate) => rate.id)).toEqual(['r2']);

    await store.clearRates(employeeId('e1'));
    expect(records()).toEqual([]);
    expect(sent).toEqual(['correct r1 {"hourlyRateEur":90}', 'remove r1', 'clear e1']);
  });

  it('keeps what is on screen, marked as possibly out of date, when a refresh after a change fails', async () => {
    const { people, workload } = fakes();
    let failing = false;
    const store = createPeopleStore({
      people: {
        ...people,
        rates: () => (failing ? Promise.reject(new Error('rates down')) : people.rates()),
      },
      workload,
    });
    await store.load();
    failing = true;
    const result = await store.removeRate(rateId('r1'));
    expect(result).toEqual({ ok: true });
    const { register } = store.getSnapshot();
    if (register.status !== 'ready') throw new Error('the register was thrown away');
    expect(register.stale).toBe('rates down');
    expect(register.employees).toHaveLength(2);
    failing = false;
    await store.load();
    const again = store.getSnapshot().register;
    expect(again.status === 'ready' && again.stale).toBeNull();
  });

  it('reads again after a command whose outcome is unknown, since it may have been applied', async () => {
    const { people, workload } = fakes();
    let reads = 0;
    const store = createPeopleStore({
      people: {
        ...people,
        rates: () => {
          reads += 1;
          return people.rates();
        },
        addRate: () =>
          Promise.resolve({ ok: false, message: 'did not answer', outcomeUnknown: true }),
      },
      workload,
    });
    await store.load();
    const before = reads;
    const result = await store.addRate(employeeId('e1'), {
      validFrom: isoDate('2026-03-12'),
      hourlyRateEur: 95,
    });
    expect(result).toMatchObject({ ok: false, outcomeUnknown: true });
    expect(reads).toBe(before + 1);
  });
});

describe('reloadWorkload', () => {
  it('reads only Delivery again, leaving the register alone', async () => {
    const { people, workload } = fakes();
    let registerReads = 0;
    const store = createPeopleStore({
      people: {
        ...people,
        employees: () => {
          registerReads += 1;
          return people.employees();
        },
      },
      workload,
    });
    await store.load();
    await store.reloadWorkload();
    expect(registerReads).toBe(1);
  });

  it('does not let a slow old answer from Delivery undo a newer one', async () => {
    const { people } = fakes();
    let calls = 0;
    let failSlowly = () => {};
    const store = createPeopleStore({
      people,
      workload: {
        workload: () => {
          calls += 1;
          if (calls === 1) {
            return new Promise<WorkloadResponse>((_resolve, reject) => {
              failSlowly = () => {
                reject(new Error('late failure'));
              };
            });
          }
          return Promise.resolve({ revision: 1, entries: [] });
        },
      },
    });
    const first = store.load();
    await store.reloadWorkload();
    failSlowly();
    await first;
    expect(store.getSnapshot().workload.status).toBe('ready');
  });
});

describe('subscribe', () => {
  it('tells listeners about each change, and stops after unsubscribe', async () => {
    const { people, workload } = fakes();
    const store = createPeopleStore({ people, workload });
    let heard = 0;
    const stop = store.subscribe(() => {
      heard += 1;
    });
    await store.load();
    expect(heard).toBeGreaterThan(0);
    const after = heard;
    stop();
    await store.load();
    expect(heard).toBe(after);
  });

  it('hands out the same snapshot until something changes', async () => {
    const { people, workload } = fakes();
    const store = createPeopleStore({ people, workload });
    await store.load();
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });
});
