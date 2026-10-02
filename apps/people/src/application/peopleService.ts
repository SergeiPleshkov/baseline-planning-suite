import type {
  EmployeesResponse,
  RateRecordDto,
  RatesChangedEvent,
  RatesResponse,
} from '@baseline/people-contract';
import type { IsoDate } from '../domain/calendar';
import { rateId, type EmployeeId } from '../domain/ids';
import {
  addRate,
  clearRates,
  correctRate,
  removeRate,
  type AddRateError,
  type CorrectRateError,
  type RateHistory,
  type RemoveRateError,
} from '../domain/rates';
import { err, ok, type Result } from '../domain/result';
import { rateToContract } from '../infrastructure/contract';
import { documentFromState, type PeopleDocument, type PeopleState } from './document';

export type AddRateFailure = AddRateError | 'unknown-employee';
export type CorrectRateFailure = CorrectRateError;
export type RemoveRateFailure = RemoveRateError;
export type ClearRatesFailure = 'unknown-employee';

interface RateChange {
  readonly revision: number;
  readonly rate: RateRecordDto;
}

export interface PeopleService {
  employees: () => EmployeesResponse;
  rates: () => RatesResponse;
  addRate: (
    employee: EmployeeId,
    input: { readonly validFrom: IsoDate; readonly hourlyRateEur: number },
  ) => Promise<Result<RateChange, AddRateFailure>>;
  correctRate: (
    id: string,
    change: { readonly validFrom?: IsoDate; readonly hourlyRateEur?: number },
  ) => Promise<Result<RateChange, CorrectRateFailure>>;
  removeRate: (id: string) => Promise<Result<{ readonly revision: number }, RemoveRateFailure>>;
  clearRates: (
    employee: EmployeeId,
  ) => Promise<Result<{ readonly revision: number }, ClearRatesFailure>>;
}

export interface PeopleServiceDeps {
  readonly initial: PeopleState;
  /** Resolves once the document is safely stored; a change is not visible before that. */
  readonly write: (document: PeopleDocument) => Promise<void>;
  readonly newRateId: () => string;
  readonly notify: (event: RatesChangedEvent) => void;
}

const sameRecords = (a: RateHistory, b: RateHistory): boolean =>
  JSON.stringify(a.records) === JSON.stringify(b.records);

export function createPeopleService(deps: PeopleServiceDeps): PeopleService {
  let state = deps.initial;
  let queue: Promise<unknown> = Promise.resolve();

  /** One change at a time: each reads the state the previous one left, and stores before it shows. */
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task);
    queue = run.catch(() => undefined);
    return run;
  };

  const ownerOf = (id: string): RateHistory | undefined =>
    [...state.histories.values()].find((history) =>
      history.records.some((record) => record.id === id),
    );

  async function commit(changed: ReadonlyMap<EmployeeId, RateHistory>): Promise<number> {
    const next: PeopleState = {
      revision: state.revision + 1,
      employees: state.employees,
      histories: new Map(
        [...state.histories].map(([id, history]) => [id, changed.get(id) ?? history]),
      ),
    };
    await deps.write(documentFromState(next));
    state = next;
    deps.notify({
      type: 'rates-changed',
      version: 1,
      employeeIds: [...changed.keys()],
      revision: next.revision,
    });
    return next.revision;
  }

  return {
    employees: () => ({
      revision: state.revision,
      employees: documentFromState(state).employees.slice(),
    }),

    rates: () => ({ revision: state.revision, rates: documentFromState(state).rates.slice() }),

    addRate: (employee, input) =>
      serial(async () => {
        const history = state.histories.get(employee);
        if (!history) return err('unknown-employee');
        const record = { id: rateId(deps.newRateId()), ...input };
        const added = addRate(history, record);
        if (!added.ok) return added;
        const revision = await commit(new Map([[employee, added.value]]));
        return ok({ revision, rate: rateToContract(employee, record) });
      }),

    correctRate: (id, change) =>
      serial(async () => {
        const history = ownerOf(id);
        if (!history) return err('unknown-rate');
        const corrected = correctRate(history, rateId(id), change);
        if (!corrected.ok) return corrected;
        const record = corrected.value.records.find((each) => each.id === id);
        if (!record) throw new Error(`Rate ${id} vanished while being corrected`);
        const dto = rateToContract(history.employeeId, record);
        if (sameRecords(history, corrected.value))
          return ok({ revision: state.revision, rate: dto });
        const revision = await commit(new Map([[history.employeeId, corrected.value]]));
        return ok({ revision, rate: dto });
      }),

    removeRate: (id) =>
      serial(async () => {
        const history = ownerOf(id);
        if (!history) return err('unknown-rate');
        const removed = removeRate(history, rateId(id));
        if (!removed.ok) return removed;
        return ok({ revision: await commit(new Map([[history.employeeId, removed.value]])) });
      }),

    clearRates: (employee) =>
      serial(async () => {
        const history = state.histories.get(employee);
        if (!history) return err('unknown-employee');
        if (history.records.length === 0) return ok({ revision: state.revision });
        return ok({ revision: await commit(new Map([[employee, clearRates(history)]])) });
      }),
  };
}
