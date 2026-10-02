import type { IsoDate } from '../domain/calendar';
import type { Employee } from '../domain/employees';
import { employeeId, type EmployeeId, type RateId } from '../domain/ids';
import type { RateHistory } from '../domain/rates';
import { stateFromDocument } from './document';
import type { CommandResult, PeopleGateway, WorkloadGateway } from './ports';

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
      /** Set when the last attempt to refresh failed: what is shown may be out of date. */
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

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

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
  // Only the latest read may apply: a slow answer to an old one must not undo a newer state.
  let readCounter = 0;
  let workloadCounter = 0;

  const publish = (next: Partial<PeopleSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    for (const listener of [...listeners]) listener();
  };

  async function readRegister(): Promise<void> {
    const mine = (readCounter += 1);
    try {
      const [employees, rates] = await Promise.all([people.employees(), people.rates()]);
      if (mine !== readCounter) return;
      const state = stateFromDocument({
        revision: rates.revision,
        employees: employees.employees,
        rates: rates.rates,
      });
      publish({
        register: {
          status: 'ready',
          employees: state.employees,
          histories: state.histories,
          stale: null,
        },
      });
    } catch (error) {
      if (mine !== readCounter) return;
      const { register } = snapshot;
      // Data already on screen stays: a failed refresh must not throw away what the person is using.
      publish({
        register:
          register.status === 'ready'
            ? { ...register, stale: reason(error) }
            : { status: 'failed', message: reason(error) },
      });
    }
  }

  async function readWorkload(): Promise<void> {
    const mine = (workloadCounter += 1);
    try {
      const response = await workload.workload();
      if (mine !== workloadCounter) return;
      const grouped = new Map<EmployeeId, MonthLoad[]>();
      for (const entry of response.entries) {
        const id = employeeId(entry.employeeId);
        grouped.set(id, [
          ...(grouped.get(id) ?? []),
          { month: entry.month, personMonths: entry.personMonths, status: entry.status },
        ]);
      }
      publish({
        workload: {
          status: 'ready',
          byEmployee: new Map(
            [...grouped].map(([id, months]) => {
              const sorted = [...months].sort((a, b) => (a.month < b.month ? -1 : 1));
              return [
                id,
                { months: sorted, overMonths: sorted.filter((m) => m.status === 'over').length },
              ];
            }),
          ),
        },
      });
    } catch (error) {
      if (mine !== workloadCounter) return;
      publish({ workload: { status: 'unavailable', message: reason(error) } });
    }
  }

  /** After a command the service is the source of truth: read the rates again, also when a command's outcome is unknown. */
  async function afterCommand(result: CommandResult): Promise<CommandResult> {
    if (result.ok || result.outcomeUnknown === true) await readRegister();
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
      await readWorkload();
    },

    async load() {
      publish({ workload: { status: 'loading' } });
      if (snapshot.register.status !== 'ready') publish({ register: { status: 'loading' } });
      await Promise.all([readRegister(), readWorkload()]);
    },

    addRate: async (employee, input) => afterCommand(await people.addRate(employee, input)),
    correctRate: async (rate, change) => afterCommand(await people.correctRate(rate, change)),
    removeRate: async (rate) => afterCommand(await people.removeRate(rate)),
    clearRates: async (employee) => afterCommand(await people.clearRates(employee)),
  };
}
