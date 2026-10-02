import type { IsoDate } from '../domain/calendar';
import type { Employee } from '../domain/employees';
import { employeeId, type EmployeeId, type RateId } from '../domain/ids';
import type { RateHistory } from '../domain/rates';
import { stateFromDocument } from './document';
import type { ChangeFeed, CommandResult, PeopleGateway, WorkloadGateway } from './ports';

export interface MonthLoad {
  readonly month: string;
  readonly personMonths: number;
  readonly status: 'within' | 'over';
}

export interface EmployeeLoad {
  readonly months: readonly MonthLoad[];
  readonly overMonths: number;
}

export type RegisterView =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly message: string }
  | {
      readonly status: 'ready';
      readonly employees: readonly Employee[];
      readonly histories: ReadonlyMap<EmployeeId, RateHistory>;
      /** Set when the last read failed or the stream that announces changes broke: what is shown may be out of date. */
      readonly stale: string | null;
    };

/** Delivery is another team's service: People works without it and says so. */
export type WorkloadView =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable'; readonly message: string }
  | { readonly status: 'ready'; readonly byEmployee: ReadonlyMap<EmployeeId, EmployeeLoad> };

export interface PeopleSnapshot {
  readonly register: RegisterView;
  readonly workload: WorkloadView;
}

export interface PeopleStore {
  /** The same object until something changes, as `useSyncExternalStore` requires. */
  getSnapshot: () => PeopleSnapshot;
  subscribe: (listener: () => void) => () => void;
  /** Reads everything again; also what a Retry button calls. */
  load: () => Promise<void>;
  /** Reads only Delivery's figures again. */
  reloadWorkload: () => Promise<void>;
  /** Reads the register again whenever People says rates changed, in another tab too. Returns how to stop. */
  followRates: (feed: ChangeFeed) => () => void;
  /** Reads Delivery's figures again whenever it says they changed. Returns how to stop. */
  followWorkload: (feed: ChangeFeed) => () => void;
  addRate: (
    employee: EmployeeId,
    input: { readonly validFrom: IsoDate; readonly hourlyRateEur: number },
  ) => Promise<CommandResult>;
  correctRate: (
    rate: RateId,
    change: { readonly validFrom?: IsoDate; readonly hourlyRateEur?: number },
  ) => Promise<CommandResult>;
  removeRate: (rate: RateId) => Promise<CommandResult>;
  clearRates: (employee: EmployeeId) => Promise<CommandResult>;
}

const RATES_STREAM_LOST = 'Live updates from People stopped; trying to reconnect.';
const WORKLOAD_STREAM_LOST = 'Live updates from Delivery stopped; trying to reconnect.';
const FIRST_RETRY_MS = 2_000;
const LONGEST_RETRY_MS = 30_000;

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Reads one at a time, never two at once. A read asked for while one is under way runs after it,
 * since the one under way may not show what changed; the returned promise settles when the last has
 * finished. A read that failed is tried again after a pause that doubles, but only while a stream is
 * being followed: nothing else would prompt it.
 */
function singleFlight(read: () => Promise<boolean>) {
  let running: Promise<void> | null = null;
  let again = false;
  // Reads the compiler cannot see change this, because they happen across an await.
  const askedAgain = () => again;
  let following = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pause = FIRST_RETRY_MS;

  function refresh(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      let succeeded: boolean;
      do {
        again = false;
        succeeded = await read();
      } while (askedAgain());
      if (succeeded) {
        pause = FIRST_RETRY_MS;
      } else if (following) {
        clearTimeout(timer);
        timer = setTimeout(() => void refresh(), pause);
        pause = Math.min(pause * 2, LONGEST_RETRY_MS);
      }
    })().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    refresh,
    follow(on: boolean) {
      following = on;
      if (!on) clearTimeout(timer);
    },
  };
}

export function createPeopleStore(gateways: {
  readonly people: PeopleGateway;
  readonly workload: WorkloadGateway;
}): PeopleStore {
  const { people, workload } = gateways;
  let snapshot: PeopleSnapshot = {
    register: { status: 'loading' },
    workload: { status: 'loading' },
  };
  const listeners = new Set<() => void>();
  // Why the last read failed, and whether a stream is broken, are kept apart: one being cleared
  // must not clear the other.
  let registerError: string | null = null;
  let ratesStreamDown = false;
  let workloadStreamDown = false;

  const publish = (next: Partial<PeopleSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    for (const listener of [...listeners]) listener();
  };

  const registerStale = (): string | null =>
    registerError ?? (ratesStreamDown ? RATES_STREAM_LOST : null);

  function markRegister() {
    const { register } = snapshot;
    if (register.status === 'ready' && register.stale !== registerStale()) {
      publish({ register: { ...register, stale: registerStale() } });
    }
  }

  async function readRegister(): Promise<boolean> {
    try {
      const [employees, rates] = await Promise.all([people.employees(), people.rates()]);
      const state = stateFromDocument({
        revision: rates.revision,
        employees: employees.employees,
        rates: rates.rates,
      });
      registerError = null;
      publish({
        register: {
          status: 'ready',
          employees: state.employees,
          histories: state.histories,
          stale: registerStale(),
        },
      });
      return true;
    } catch (error) {
      registerError = reason(error);
      const { register } = snapshot;
      // Data already on screen stays: a failed refresh must not throw away what the person is using.
      publish({
        register:
          register.status === 'ready'
            ? { ...register, stale: registerStale() }
            : { status: 'failed', message: registerError },
      });
      return false;
    }
  }

  async function readWorkload(): Promise<boolean> {
    try {
      const response = await workload.workload();
      const grouped = new Map<EmployeeId, MonthLoad[]>();
      for (const entry of response.entries) {
        const id = employeeId(entry.employeeId);
        grouped.set(id, [
          ...(grouped.get(id) ?? []),
          { month: entry.month, personMonths: entry.personMonths, status: entry.status },
        ]);
      }
      // Without the stream the figures cannot be trusted to follow Delivery: capacity is unknown.
      publish({
        workload: workloadStreamDown
          ? { status: 'unavailable', message: WORKLOAD_STREAM_LOST }
          : {
              status: 'ready',
              byEmployee: new Map(
                [...grouped].map(([id, months]) => {
                  const sorted = [...months].sort((a, b) => (a.month < b.month ? -1 : 1));
                  return [
                    id,
                    {
                      months: sorted,
                      overMonths: sorted.filter((m) => m.status === 'over').length,
                    },
                  ];
                }),
              ),
            },
      });
      return true;
    } catch (error) {
      publish({ workload: { status: 'unavailable', message: reason(error) } });
      return false;
    }
  }

  const registerReads = singleFlight(readRegister);
  const workloadReads = singleFlight(readWorkload);

  /** After a command the service is the source of truth: read the rates again, also when a command's outcome is unknown. */
  async function afterCommand(result: CommandResult): Promise<CommandResult> {
    if (result.ok || result.outcomeUnknown === true) await registerReads.refresh();
    return result;
  }

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async reloadWorkload() {
      publish({ workload: { status: 'loading' } });
      await workloadReads.refresh();
    },

    followRates(feed) {
      registerReads.follow(true);
      const close = feed.open({
        onChange: () => void registerReads.refresh(),
        onConnected: () => {
          ratesStreamDown = false;
          markRegister();
          void registerReads.refresh();
        },
        onLost: () => {
          ratesStreamDown = true;
          markRegister();
        },
      });
      return () => {
        registerReads.follow(false);
        close();
      };
    },

    followWorkload(feed) {
      workloadReads.follow(true);
      const close = feed.open({
        onChange: () => void workloadReads.refresh(),
        onConnected: () => {
          workloadStreamDown = false;
          void workloadReads.refresh();
        },
        onLost: () => {
          workloadStreamDown = true;
          if (snapshot.workload.status === 'ready') {
            publish({ workload: { status: 'unavailable', message: WORKLOAD_STREAM_LOST } });
          }
        },
      });
      return () => {
        workloadReads.follow(false);
        close();
      };
    },

    async load() {
      publish({ workload: { status: 'loading' } });
      if (snapshot.register.status !== 'ready') publish({ register: { status: 'loading' } });
      await Promise.all([registerReads.refresh(), workloadReads.refresh()]);
    },

    addRate: async (employee, input) => afterCommand(await people.addRate(employee, input)),
    correctRate: async (rate, change) => afterCommand(await people.correctRate(rate, change)),
    removeRate: async (rate) => afterCommand(await people.removeRate(rate)),
    clearRates: async (employee) => afterCommand(await people.clearRates(employee)),
  };
}
