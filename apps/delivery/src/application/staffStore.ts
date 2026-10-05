import type { EmployeeId } from '../domain/ids';
import type { RateTimeline } from '../domain/rateTimeline';
import {
  rateTimelinesFromPeople,
  staffFromPeople,
  type PeopleDataError,
  type StaffMember,
} from './peopleContract';
import type { ChangeFeed, PeopleSource } from './ports';

/** What Delivery knows of People: who they are and what they cost. */
export type StaffView =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly message: string }
  | {
      readonly status: 'ready';
      readonly staff: ReadonlyMap<EmployeeId, StaffMember>;
      readonly rates: ReadonlyMap<EmployeeId, RateTimeline>;
      /** Set when People could not be read again, or its stream broke: what is shown may be out of date. */
      readonly stale: string | null;
    };

export interface StaffStore {
  /** The same object until something changes, as `useSyncExternalStore` requires. */
  getSnapshot: () => StaffView;
  subscribe: (listener: () => void) => () => void;
  /** Reads People again; what is on screen stays meanwhile. Also what a Retry button calls. */
  load: () => Promise<void>;
  /** Reads People again whenever it says its rates changed. Returns how to stop. */
  follow: (feed: ChangeFeed) => () => void;
}

type Outcome =
  | {
      readonly ok: true;
      readonly staff: ReadonlyMap<EmployeeId, StaffMember>;
      readonly rates: ReadonlyMap<EmployeeId, RateTimeline>;
    }
  | { readonly ok: false; readonly message: string };

const STREAM_LOST = 'Live updates from People stopped; trying to reconnect.';
const FIRST_RETRY_MS = 2_000;
const LONGEST_RETRY_MS = 30_000;

function describeDataError(error: PeopleDataError): string {
  const where = error.reason === 'unusable-rates' ? ` (rates of ${error.employeeId})` : '';
  return `The People service sent data this screen cannot use${where}: ${error.detail}`;
}

function describeFailure(error: unknown): string {
  console.error(error);
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return 'The People service did not answer in time.';
  }
  if (error instanceof TypeError) return 'The People service cannot be reached.';
  return error instanceof Error ? error.message : String(error);
}

export function createStaffStore(source: PeopleSource): StaffStore {
  let snapshot: StaffView = { status: 'loading' };
  const listeners = new Set<() => void>();
  let loading: Promise<void> | null = null;
  // Something changed while a read was under way: that read may not show it, so one more follows.
  let readAgain = false;
  // Reads the compiler cannot see change this, because they happen across an await.
  const askedAgain = () => readAgain;
  // Why the last read failed, and whether the stream is broken, are kept apart: one being cleared
  // must not clear the other.
  let readError: string | null = null;
  let streamDown = false;
  let following = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryPause = FIRST_RETRY_MS;

  const staleNow = (): string | null => readError ?? (streamDown ? STREAM_LOST : null);

  /** Marks what is shown as out of date, or not, once the reasons have changed. */
  function refreshMark() {
    if (snapshot.status === 'ready' && snapshot.stale !== staleNow()) {
      publish({ ...snapshot, stale: staleNow() });
    }
  }

  // A read that failed while following is tried again, since no event will come to prompt it.
  function scheduleRetry() {
    if (!following) return;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => void load(), retryPause);
    retryPause = Math.min(retryPause * 2, LONGEST_RETRY_MS);
  }

  const publish = (view: StaffView) => {
    snapshot = view;
    for (const listener of [...listeners]) listener();
  };

  async function read(): Promise<Outcome> {
    try {
      const [employees, rates] = await Promise.all([source.employees(), source.rates()]);
      const staff = staffFromPeople(employees);
      if (!staff.ok) return { ok: false, message: describeDataError(staff.error) };
      const timelines = rateTimelinesFromPeople(rates);
      if (!timelines.ok) return { ok: false, message: describeDataError(timelines.error) };
      return { ok: true, staff: staff.value, rates: timelines.value };
    } catch (error) {
      return { ok: false, message: describeFailure(error) };
    }
  }

  function apply(outcome: Outcome) {
    if (outcome.ok) {
      readError = null;
      retryPause = FIRST_RETRY_MS;
      publish({ status: 'ready', staff: outcome.staff, rates: outcome.rates, stale: staleNow() });
      return;
    }
    readError = outcome.message;
    if (snapshot.status === 'ready') {
      // What is on screen stays: a failed refresh must not take away what the person is using.
      publish({ ...snapshot, stale: staleNow() });
    } else {
      publish({ status: 'failed', message: outcome.message });
    }
    scheduleRetry();
  }

  function load(): Promise<void> {
    if (loading) {
      readAgain = true;
      return loading;
    }
    if (snapshot.status !== 'ready') publish({ status: 'loading' });
    loading = (async () => {
      do {
        readAgain = false;
        apply(await read());
      } while (askedAgain());
    })().finally(() => {
      loading = null;
    });
    return loading;
  }

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    load,

    follow(feed) {
      following = true;
      const close = feed.open({
        onChange: () => void load(),
        onConnected: () => {
          streamDown = false;
          refreshMark();
          void load();
        },
        onLost: () => {
          streamDown = true;
          refreshMark();
        },
      });
      return () => {
        following = false;
        clearTimeout(retryTimer);
        close();
      };
    },
  };
}
