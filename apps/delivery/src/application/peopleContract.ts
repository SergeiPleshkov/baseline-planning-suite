import { EmployeesResponseSchema, RatesResponseSchema } from '@baseline/people-contract';
import { isoDate } from '../domain/calendar';
import { employeeId, type EmployeeId } from '../domain/ids';
import { rateTimeline, type RateTimeline } from '../domain/rateTimeline';
import { err, ok, type Result } from '../domain/result';

/** Delivery's view of a person: what it needs from the register, in its own terms. */
export interface StaffMember {
  readonly id: EmployeeId;
  readonly name: string;
  readonly weeklyHours: number;
}

export type PeopleDataError =
  | { readonly reason: 'malformed'; readonly detail: string }
  | { readonly reason: 'unusable-rates'; readonly employeeId: EmployeeId; readonly detail: string };

interface Issue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

const malformed = (issues: readonly Issue[]): PeopleDataError => ({
  reason: 'malformed',
  detail: issues.map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`).join('; '),
});

/** The first id that appears twice, which no honest producer sends. */
const firstRepeated = (ids: readonly string[]): string | undefined =>
  ids.find((id, index) => ids.indexOf(id) !== index);

/**
 * Where Delivery validates People's data. A payload that parses but makes no sense (two records on
 * one day, one id used twice) is refused as a whole: guessing which record counts would silently
 * misprice every allocation of that person.
 */
export function rateTimelinesFromPeople(
  payload: unknown,
): Result<ReadonlyMap<EmployeeId, RateTimeline>, PeopleDataError> {
  const parsed = RatesResponseSchema.safeParse(payload);
  if (!parsed.success) return err(malformed(parsed.error.issues));

  const repeatedRate = firstRepeated(parsed.data.rates.map((rate) => rate.id));
  if (repeatedRate !== undefined) {
    return err({ reason: 'malformed', detail: `rate id ${repeatedRate} appears twice` });
  }

  const byEmployee = Map.groupBy(parsed.data.rates, (rate) => employeeId(rate.employeeId));

  const timelines = new Map<EmployeeId, RateTimeline>();
  for (const [id, rates] of byEmployee) {
    try {
      timelines.set(
        id,
        rateTimeline(
          rates.map((rate) => ({
            effectiveFrom: isoDate(rate.validFrom),
            hourlyRateEur: rate.hourlyRateEur,
          })),
        ),
      );
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return err({ reason: 'unusable-rates', employeeId: id, detail: error.message });
    }
  }
  return ok(timelines);
}

export function staffFromPeople(
  payload: unknown,
): Result<ReadonlyMap<EmployeeId, StaffMember>, PeopleDataError> {
  const parsed = EmployeesResponseSchema.safeParse(payload);
  if (!parsed.success) return err(malformed(parsed.error.issues));
  const repeated = firstRepeated(parsed.data.employees.map((employee) => employee.id));
  if (repeated !== undefined) {
    return err({ reason: 'malformed', detail: `employee id ${repeated} appears twice` });
  }
  const staff = new Map<EmployeeId, StaffMember>();
  for (const employee of parsed.data.employees) {
    const id = employeeId(employee.id);
    staff.set(id, { id, name: employee.name, weeklyHours: employee.weeklyHours });
  }
  return ok(staff);
}
