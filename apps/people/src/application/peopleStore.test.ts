import type { WorkloadResponse } from '@baseline/delivery-contract';
import type { RatesResponse } from '@baseline/people-contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isoDate } from '../domain/calendar';
import { employeeId, rateId } from '../domain/ids';
import { rateOn } from '../domain/rates';
import { createPeopleStore } from './peopleStore';
import type {
  ChangeFeed,
  CommandResult,
  FeedHandlers,
  PeopleGateway,
  WorkloadGateway,
} from './ports';

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

  it('runs a read asked for during a slow one after it, so that the newer state wins', async () => {
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
    const asked = store.load();
    release();
    await Promise.all([slow, asked]);
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

  it('runs a read of Delivery asked for during a slow one after it, so that the newer state wins', async () => {
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
    const asked = store.reloadWorkload();
    failSlowly();
    await Promise.all([first, asked]);
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

function fakeFeed() {
  let handlers: FeedHandlers | undefined;
  const feed: ChangeFeed = {
    open(next) {
      handlers = next;
      return () => {
        handlers = undefined;
      };
    },
  };
  return {
    feed,
    isOpen: () => handlers !== undefined,
    change: () => handlers?.onChange(),
    connect: () => handlers?.onConnected(),
    lose: () => handlers?.onLost(),
  };
}

const workloadOf = (store: ReturnType<typeof createPeopleStore>) => store.getSnapshot().workload;

describe('followWorkload', () => {
  const entry = (personMonths: number): WorkloadResponse => ({
    revision: 1,
    entries: [{ employeeId: 'e1', month: '2026-06', personMonths, status: 'within' }],
  });
  const monthOf = (store: ReturnType<typeof createPeopleStore>) => {
    const view = workloadOf(store);
    if (view.status !== 'ready') throw new Error(`expected ready, got ${view.status}`);
    return view.byEmployee.get(employeeId('e1'))?.months[0]?.personMonths;
  };

  it('reads Delivery’s figures again when it says they changed, keeping the old ones meanwhile', async () => {
    let current = entry(0.5);
    const { people, workload } = fakes({ workload: () => Promise.resolve(current) });
    const store = createPeopleStore({ people, workload });
    await store.load();
    const live = fakeFeed();
    store.followWorkload(live.feed);
    const statuses: string[] = [];
    store.subscribe(() => {
      statuses.push(workloadOf(store).status);
    });

    current = entry(0.9);
    live.change();
    await vi.waitFor(() => {
      expect(monthOf(store)).toBe(0.9);
    });
    expect(statuses.every((status) => status === 'ready')).toBe(true);
  });

  it('reads again each time the stream opens, since events in between may have been missed', async () => {
    const workloadRead = vi.fn(() => Promise.resolve(entry(0.5)));
    const { people } = fakes();
    const store = createPeopleStore({ people, workload: { workload: workloadRead } });
    await store.load();
    const live = fakeFeed();
    store.followWorkload(live.feed);
    live.connect();
    await vi.waitFor(() => {
      expect(workloadRead).toHaveBeenCalledTimes(2);
    });
  });

  it('reads once more when a change is announced during a read, so that it is not lost', async () => {
    let current = entry(0.5);
    let hold: Promise<void> | null = null;
    let release: () => void = () => undefined;
    const { people } = fakes();
    const store = createPeopleStore({
      people,
      workload: {
        workload: async () => {
          const answer = current;
          if (hold) await hold;
          return answer;
        },
      },
    });
    const live = fakeFeed();
    store.followWorkload(live.feed);
    hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    live.connect();
    current = entry(0.9);
    live.change();
    hold = null;
    release();
    await vi.waitFor(() => {
      expect(monthOf(store)).toBe(0.9);
    });
  });

  it('says capacity is unknown when the stream breaks, and recovers when it reopens', async () => {
    const { people, workload } = fakes();
    const store = createPeopleStore({ people, workload });
    await store.load();
    const live = fakeFeed();
    store.followWorkload(live.feed);
    live.lose();
    expect(workloadOf(store)).toMatchObject({
      status: 'unavailable',
      message: expect.stringContaining('Live updates from Delivery stopped') as string,
    });
    live.lose();
    live.connect();
    await vi.waitFor(() => {
      expect(workloadOf(store).status).toBe('ready');
    });
  });

  it('has nothing to say about a stream that breaks before any figures were shown', async () => {
    const { people } = fakes();
    const store = createPeopleStore({
      people,
      workload: { workload: () => Promise.reject(new Error('Delivery is down')) },
    });
    await store.load();
    const before = workloadOf(store);
    const live = fakeFeed();
    store.followWorkload(live.feed);
    live.lose();
    expect(workloadOf(store)).toBe(before);
  });

  it('shows the figures as unavailable when a read after an event fails', async () => {
    let down = false;
    const { people } = fakes();
    const store = createPeopleStore({
      people,
      workload: {
        workload: () =>
          down ? Promise.reject(new Error('Delivery is down')) : Promise.resolve(entry(0.5)),
      },
    });
    await store.load();
    const live = fakeFeed();
    store.followWorkload(live.feed);
    down = true;
    live.change();
    await vi.waitFor(() => {
      expect(workloadOf(store)).toEqual({ status: 'unavailable', message: 'Delivery is down' });
    });
  });

  it('stops listening when told to stop', () => {
    const { people, workload } = fakes();
    const store = createPeopleStore({ people, workload });
    const live = fakeFeed();
    const stop = store.followWorkload(live.feed);
    expect(live.isOpen()).toBe(true);
    stop();
    expect(live.isOpen()).toBe(false);
  });
});

describe('followRates', () => {
  const rateOf = (store: ReturnType<typeof createPeopleStore>) => {
    const { register } = store.getSnapshot();
    if (register.status !== 'ready') throw new Error(`expected ready, got ${register.status}`);
    const history = register.histories.get(employeeId('e1'));
    return history && rateOn(history, isoDate('2026-01-01'));
  };

  it('reads the register again when rates changed elsewhere, without going back to loading', async () => {
    const { people, workload } = fakes();
    const store = createPeopleStore({ people, workload });
    await store.load();
    const live = fakeFeed();
    store.followRates(live.feed);
    const statuses: string[] = [];
    store.subscribe(() => {
      statuses.push(store.getSnapshot().register.status);
    });

    await people.correctRate('r1', { hourlyRateEur: 90 });
    live.change();
    await vi.waitFor(() => {
      expect(rateOf(store)).toBe(90);
    });
    expect(statuses.every((status) => status === 'ready')).toBe(true);
  });

  it('reads again each time the stream opens, since events in between may have been missed', async () => {
    const { people, workload } = fakes();
    const store = createPeopleStore({ people, workload });
    await store.load();
    const live = fakeFeed();
    store.followRates(live.feed);
    await people.correctRate('r1', { hourlyRateEur: 91 });
    live.connect();
    await vi.waitFor(() => {
      expect(rateOf(store)).toBe(91);
    });
  });

  it('marks the register as possibly out of date when the stream breaks, and clears it on reopening', async () => {
    const { people, workload } = fakes();
    const store = createPeopleStore({ people, workload });
    await store.load();
    const live = fakeFeed();
    store.followRates(live.feed);
    live.lose();
    const lost = store.getSnapshot().register;
    expect(lost.status === 'ready' && lost.stale).toContain('Live updates from People stopped');
    live.lose();
    expect(store.getSnapshot().register).toBe(lost);

    live.connect();
    await vi.waitFor(() => {
      const register = store.getSnapshot().register;
      expect(register.status === 'ready' && register.stale).toBeNull();
    });
  });

  it('keeps the register on screen, marked, when a read after an event fails', async () => {
    let down = false;
    const { people, workload } = fakes();
    const store = createPeopleStore({
      people: {
        ...people,
        rates: () => (down ? Promise.reject(new Error('People is down')) : people.rates()),
      },
      workload,
    });
    await store.load();
    const live = fakeFeed();
    store.followRates(live.feed);
    down = true;
    live.change();
    await vi.waitFor(() => {
      const register = store.getSnapshot().register;
      expect(register.status === 'ready' && register.stale).toBe('People is down');
    });
    expect(rateOf(store)).toBe(80);
  });

  it('has nothing to mark before the register was read, and stops when told to stop', () => {
    const { people, workload } = fakes();
    const store = createPeopleStore({ people, workload });
    const live = fakeFeed();
    const stop = store.followRates(live.feed);
    live.lose();
    expect(store.getSnapshot().register).toEqual({ status: 'loading' });
    stop();
    expect(live.isOpen()).toBe(false);
  });
});

describe('what a stream break and a failed read each say', () => {
  it('keeps the register marked while the stream is broken, whatever a read finds', async () => {
    const { people, workload } = fakes();
    const store = createPeopleStore({ people, workload });
    await store.load();
    const live = fakeFeed();
    store.followRates(live.feed);
    live.lose();
    await store.load();
    const { register } = store.getSnapshot();
    expect(register.status === 'ready' && register.stale).toContain('Live updates from People');
  });

  it('keeps capacity unknown while Delivery’s stream is broken, even when a read succeeds', async () => {
    const { people, workload } = fakes();
    const store = createPeopleStore({ people, workload });
    const live = fakeFeed();
    store.followWorkload(live.feed);
    live.lose();
    await store.load();
    expect(workloadOf(store)).toMatchObject({ status: 'unavailable' });
    live.connect();
    await vi.waitFor(() => {
      expect(workloadOf(store).status).toBe('ready');
    });
  });

  it('marks a stream that breaks while a read is under way', async () => {
    const { people } = fakes();
    let release: () => void = () => undefined;
    const store = createPeopleStore({
      people,
      workload: {
        workload: async () => {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return { revision: 1, entries: [] };
        },
      },
    });
    const live = fakeFeed();
    store.followWorkload(live.feed);
    const reading = store.load();
    live.lose();
    release();
    await reading;
    expect(workloadOf(store).status).toBe('unavailable');
  });

  it('resolves a command only after the read that follows it, whatever else was announced meanwhile', async () => {
    const { people, workload } = fakes();
    const store = createPeopleStore({ people, workload });
    await store.load();
    const live = fakeFeed();
    store.followRates(live.feed);
    const saved = store.correctRate(rateId('r1'), { hourlyRateEur: 92 });
    live.change();
    await saved;
    const { register } = store.getSnapshot();
    const history =
      register.status === 'ready' ? register.histories.get(employeeId('e1')) : undefined;
    expect(history && rateOn(history, isoDate('2026-01-01'))).toBe(92);
  });
});

describe('trying again after a failed read', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function flaky() {
    const state = { failing: true, times: [] as number[] };
    const { people } = fakes();
    const store = createPeopleStore({
      people,
      workload: {
        workload: () => {
          state.times.push(Date.now());
          return state.failing
            ? Promise.reject(new Error('Delivery is down'))
            : Promise.resolve({ revision: 1, entries: [] });
        },
      },
    });
    return { store, state };
  }

  it('reads again by itself while following, after a pause that doubles up to a limit', async () => {
    const { store, state } = flaky();
    store.followWorkload(fakeFeed().feed);
    await store.load();
    await vi.advanceTimersByTimeAsync(200_000);
    const gaps = state.times.slice(1).map((time, index) => time - (state.times[index] ?? 0));
    expect(gaps.slice(0, 7)).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });

  it('shows the figures once a later read succeeds', async () => {
    const { store, state } = flaky();
    store.followWorkload(fakeFeed().feed);
    await store.load();
    expect(workloadOf(store).status).toBe('unavailable');
    state.failing = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(workloadOf(store).status).toBe('ready');
    const reads = state.times.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(state.times).toHaveLength(reads);
  });

  it('starts the pauses over after a good read', async () => {
    const { store, state } = flaky();
    const live = fakeFeed();
    store.followWorkload(live.feed);
    await store.load();
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);
    state.failing = false;
    await vi.advanceTimersByTimeAsync(8000);
    expect(workloadOf(store).status).toBe('ready');

    state.failing = true;
    live.change();
    await vi.advanceTimersByTimeAsync(0);
    const failedAt = state.times.at(-1) ?? 0;
    await vi.advanceTimersByTimeAsync(2000);
    expect((state.times.at(-1) ?? 0) - failedAt).toBe(2000);
  });

  it('does not try again by itself when nothing is following, or after it stopped following', async () => {
    const unfollowed = flaky();
    await unfollowed.store.load();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(unfollowed.state.times).toHaveLength(1);

    const followed = flaky();
    const stop = followed.store.followWorkload(fakeFeed().feed);
    await followed.store.load();
    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(followed.state.times).toHaveLength(1);
  });

  it('does the same for the register', async () => {
    let failing = true;
    let reads = 0;
    const { people, workload } = fakes();
    const store = createPeopleStore({
      people: {
        ...people,
        rates: () => {
          reads += 1;
          return failing ? Promise.reject(new Error('People is down')) : people.rates();
        },
      },
      workload,
    });
    store.followRates(fakeFeed().feed);
    await store.load();
    expect(store.getSnapshot().register.status).toBe('failed');
    failing = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.getSnapshot().register.status).toBe('ready');
    expect(reads).toBe(2);
  });
});
