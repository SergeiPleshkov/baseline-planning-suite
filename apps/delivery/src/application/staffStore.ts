import type { EmployeeId } from '../domain/ids';
import type { RateTimeline } from '../domain/rateTimeline';
import {
  rateTimelinesFromPeople,
  staffFromPeople,
  type PeopleDataError,
  type StaffMember,
} from '../infrastructure/peopleContract';
import type { PeopleSource } from './ports';

/** What Delivery knows of People: who they are and what they cost. */
export type StaffView =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly message: string }
  | {
      readonly status: 'ready';
      readonly staff: ReadonlyMap<EmployeeId, StaffMember>;
      readonly rates: ReadonlyMap<EmployeeId, RateTimeline>;
    };

export interface StaffStore {
  /** The same object until something changes, as `useSyncExternalStore` requires. */
  getSnapshot: () => StaffView;
  subscribe: (listener: () => void) => () => void;
  load: () => Promise<void>;
}

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

  const publish = (view: StaffView) => {
    snapshot = view;
    for (const listener of [...listeners]) listener();
  };

  async function read(): Promise<StaffView> {
    try {
      const [employees, rates] = await Promise.all([source.employees(), source.rates()]);
      const staff = staffFromPeople(employees);
      if (!staff.ok) return { status: 'failed', message: describeDataError(staff.error) };
      const timelines = rateTimelinesFromPeople(rates);
      if (!timelines.ok) return { status: 'failed', message: describeDataError(timelines.error) };
      return { status: 'ready', staff: staff.value, rates: timelines.value };
    } catch (error) {
      return { status: 'failed', message: describeFailure(error) };
    }
  }

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    load() {
      if (loading) return loading;
      publish({ status: 'loading' });
      loading = read()
        .then(publish)
        .finally(() => {
          loading = null;
        });
      return loading;
    },
  };
}
