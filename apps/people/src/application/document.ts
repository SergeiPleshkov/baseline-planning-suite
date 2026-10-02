import {
  EmployeeSchema,
  RateRecordSchema,
  type EmployeeDto,
  type RateRecordDto,
} from '@baseline/people-contract';
import { z } from 'zod';
import { isoDate } from '../domain/calendar';
import { employee, type Employee } from '../domain/employees';
import { employeeId, rateId, type EmployeeId } from '../domain/ids';
import { rateHistory, type RateHistory } from '../domain/rates';
import { employeeToContract, rateToContract } from '../infrastructure/contract';

/** What the service keeps on disk: the register and every rate, in the shape it publishes them. */
const PeopleDocumentSchema = z.object({
  revision: z.int().nonnegative(),
  employees: z.array(EmployeeSchema),
  rates: z.array(RateRecordSchema),
});

export interface PeopleDocument {
  readonly revision: number;
  readonly employees: readonly EmployeeDto[];
  readonly rates: readonly RateRecordDto[];
}

export interface PeopleState {
  readonly revision: number;
  readonly employees: readonly Employee[];
  /** One entry per employee, empty for someone without rates, in register order. */
  readonly histories: ReadonlyMap<EmployeeId, RateHistory>;
}

/** Throws a `RangeError` for data that parses but breaks a People rule; start-up should stop. */
export function stateFromDocument(input: unknown): PeopleState {
  const document = PeopleDocumentSchema.parse(input);
  const employees = document.employees.map((each) =>
    employee({
      id: employeeId(each.id),
      name: each.name,
      role: each.role,
      weeklyHours: each.weeklyHours,
    }),
  );

  const ratesOf = new Map<EmployeeId, RateRecordDto[]>(employees.map((each) => [each.id, []]));
  if (ratesOf.size !== employees.length) throw new RangeError('An employee is listed twice');
  const rateIds = new Set<string>();
  for (const rate of document.rates) {
    const own = ratesOf.get(employeeId(rate.employeeId));
    if (!own) throw new RangeError(`${rate.id}: unknown employee ${rate.employeeId}`);
    if (rateIds.has(rate.id)) throw new RangeError(`Rate ${rate.id} is listed twice`);
    rateIds.add(rate.id);
    own.push(rate);
  }

  return {
    revision: document.revision,
    employees,
    histories: new Map(
      [...ratesOf].map(([id, records]) => [
        id,
        rateHistory(
          id,
          records.map((record) => ({
            id: rateId(record.id),
            validFrom: isoDate(record.validFrom),
            hourlyRateEur: record.hourlyRateEur,
          })),
        ),
      ]),
    ),
  };
}

export const documentFromState = (state: PeopleState): PeopleDocument => ({
  revision: state.revision,
  employees: state.employees.map(employeeToContract),
  rates: [...state.histories].flatMap(([id, history]) =>
    history.records.map((record) => rateToContract(id, record)),
  ),
});
