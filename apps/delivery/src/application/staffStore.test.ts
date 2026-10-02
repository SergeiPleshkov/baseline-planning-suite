import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { employeeId } from '../domain/ids';
import type { ChangeFeed, FeedHandlers, PeopleSource } from './ports';
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

  it('never runs two reads at once, and reads again for a caller that asked during one', async () => {
    let running = 0;
    let mostAtOnce = 0;
    const employees = vi.fn(async () => {
      running += 1;
      mostAtOnce = Math.max(mostAtOnce, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return EMPLOYEES;
    });
    const store = createStaffStore(source({ employees }));
    const first = store.load();
    const second = store.load();
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(employees).toHaveBeenCalledTimes(2);
    expect(mostAtOnce).toBe(1);
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

const ratesAt = (revision: number, hourlyRateEur: number) => ({
  revision,
  rates: [{ id: 'rate-1', employeeId: 'emp-1', validFrom: '2026-01-01', hourlyRateEur }],
});

const rateOf = (store: ReturnType<typeof createStaffStore>) => {
  const view = store.getSnapshot();
  if (view.status !== 'ready') throw new Error(`expected ready, got ${view.status}`);
  return view.rates.get(employeeId('emp-1'))?.changes[0]?.hourlyRateEur;
};

describe('following People', () => {
  it('reads again when People says rates changed, without going back to loading', async () => {
    let current = ratesAt(1, 80);
    const store = createStaffStore(source({ rates: () => Promise.resolve(current) }));
    await store.load();
    const live = fakeFeed();
    store.follow(live.feed);
    const statuses: string[] = [];
    store.subscribe(() => {
      statuses.push(store.getSnapshot().status);
    });

    current = ratesAt(2, 95);
    live.change();
    await vi.waitFor(() => {
      expect(rateOf(store)).toBe(95);
    });
    expect(statuses.every((status) => status === 'ready')).toBe(true);
  });

  it('reads again each time the stream opens, since events in between may have been missed', async () => {
    const employees = vi.fn(() => Promise.resolve(EMPLOYEES));
    const store = createStaffStore(source({ employees }));
    await store.load();
    const live = fakeFeed();
    store.follow(live.feed);
    live.connect();
    await vi.waitFor(() => {
      expect(employees).toHaveBeenCalledTimes(2);
    });
  });

  it('reads once more when a change is announced during a read, so that it is not lost', async () => {
    let current = ratesAt(1, 80);
    let release: () => void = () => undefined;
    let hold: Promise<void> | null = null;
    const store = createStaffStore(
      source({
        rates: async () => {
          const answer = current;
          if (hold) await hold;
          return answer;
        },
      }),
    );
    hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const live = fakeFeed();
    store.follow(live.feed);
    const first = store.load();
    // The read has the old rate in hand when the change is announced.
    current = ratesAt(2, 95);
    live.change();
    hold = null;
    release();
    await first;
    expect(rateOf(store)).toBe(95);
  });

  it('keeps showing what it has, marked as possibly out of date, when a read fails', async () => {
    let down = false;
    const store = createStaffStore(
      source({
        rates: () => (down ? Promise.reject(new TypeError('down')) : Promise.resolve(RATES)),
      }),
    );
    await store.load();
    down = true;
    const live = fakeFeed();
    store.follow(live.feed);
    live.change();
    await vi.waitFor(() => {
      const view = store.getSnapshot();
      expect(view.status === 'ready' && view.stale).toBe('The People service cannot be reached.');
    });
    expect(rateOf(store)).toBe(80);

    down = false;
    live.connect();
    await vi.waitFor(() => {
      const view = store.getSnapshot();
      expect(view.status === 'ready' && view.stale).toBeNull();
    });
  });

  it('says so when the stream breaks, and is up to date again once it reopens', async () => {
    const store = createStaffStore(source());
    await store.load();
    const live = fakeFeed();
    store.follow(live.feed);
    live.lose();
    const lost = store.getSnapshot();
    expect(lost.status === 'ready' && lost.stale).toContain('Live updates from People stopped');
    live.lose();
    expect(store.getSnapshot()).toBe(lost);

    live.connect();
    await vi.waitFor(() => {
      const view = store.getSnapshot();
      expect(view.status === 'ready' && view.stale).toBeNull();
    });
  });

  it('has nothing to mark before it has read anything', () => {
    const store = createStaffStore(source());
    const live = fakeFeed();
    store.follow(live.feed);
    live.lose();
    expect(store.getSnapshot()).toEqual({ status: 'loading' });
  });

  it('stops listening when told to stop', () => {
    const store = createStaffStore(source());
    const live = fakeFeed();
    const stop = store.follow(live.feed);
    expect(live.isOpen()).toBe(true);
    stop();
    expect(live.isOpen()).toBe(false);
  });
});

describe('why what is shown may be out of date', () => {
  const staleOf = (store: ReturnType<typeof createStaffStore>) => {
    const view = store.getSnapshot();
    return view.status === 'ready' ? view.stale : 'not ready';
  };

  it('keeps a broken stream marked when a read succeeds, since the read does not mend the stream', async () => {
    const store = createStaffStore(source());
    await store.load();
    const live = fakeFeed();
    store.follow(live.feed);
    live.lose();
    await store.load();
    expect(staleOf(store)).toContain('Live updates from People stopped');
  });

  it('marks a stream that breaks while a read is under way, whichever finishes first', async () => {
    let release: () => void = () => undefined;
    const store = createStaffStore(
      source({
        employees: async () => {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return EMPLOYEES;
        },
      }),
    );
    const live = fakeFeed();
    store.follow(live.feed);
    const reading = store.load();
    live.lose();
    release();
    await reading;
    expect(staleOf(store)).toContain('Live updates from People stopped');
  });

  it('keeps a failed read marked when the stream reopens and the read after it fails too', async () => {
    let down = false;
    const store = createStaffStore(
      source({
        rates: () => (down ? Promise.reject(new TypeError('down')) : Promise.resolve(RATES)),
      }),
    );
    await store.load();
    const live = fakeFeed();
    store.follow(live.feed);
    down = true;
    live.change();
    await vi.waitFor(() => {
      expect(staleOf(store)).toBe('The People service cannot be reached.');
    });
    live.lose();
    expect(staleOf(store)).toBe('The People service cannot be reached.');
  });
});

describe('trying again after a failed read', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function flaky() {
    const attempts = { failing: true, count: 0, times: [] as number[] };
    const store = createStaffStore(
      source({
        employees: () => {
          attempts.count += 1;
          attempts.times.push(Date.now());
          return attempts.failing
            ? Promise.reject(new TypeError('down'))
            : Promise.resolve(EMPLOYEES);
        },
      }),
    );
    return { store, attempts };
  }

  it('reads again by itself while following, after a pause that doubles up to a limit', async () => {
    const { store, attempts } = flaky();
    store.follow(fakeFeed().feed);
    await store.load();
    await vi.advanceTimersByTimeAsync(200_000);
    const gaps = attempts.times.slice(1).map((time, index) => time - (attempts.times[index] ?? 0));
    expect(gaps.slice(0, 8)).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000]);
  });

  it('shows the data once a later read succeeds, and starts the pauses over', async () => {
    const { store, attempts } = flaky();
    store.follow(fakeFeed().feed);
    await store.load();
    attempts.failing = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.getSnapshot().status).toBe('ready');
    const view = store.getSnapshot();
    expect(view.status === 'ready' && view.stale).toBeNull();
    const before = attempts.count;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(attempts.count).toBe(before);
  });

  it('starts the pauses over after a good read', async () => {
    const { store, attempts } = flaky();
    const live = fakeFeed();
    store.follow(live.feed);
    await store.load();
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);
    attempts.failing = false;
    await vi.advanceTimersByTimeAsync(8000);
    expect(store.getSnapshot().status).toBe('ready');

    attempts.failing = true;
    live.change();
    await vi.advanceTimersByTimeAsync(0);
    const failedAt = attempts.times.at(-1) ?? 0;
    await vi.advanceTimersByTimeAsync(2000);
    expect((attempts.times.at(-1) ?? 0) - failedAt).toBe(2000);
  });

  it('does not try again by itself when nothing is following, or after it stopped following', async () => {
    const unfollowed = flaky();
    await unfollowed.store.load();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(unfollowed.attempts.count).toBe(1);

    const followed = flaky();
    const stop = followed.store.follow(fakeFeed().feed);
    await followed.store.load();
    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(followed.attempts.count).toBe(1);
  });
});
