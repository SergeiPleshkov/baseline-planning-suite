/**
 * Worked examples of the rate semantics documented on `RateRecordSchema`. The producer and each
 * consumer are expected to run them against their own reading of the contract, so that a consumer
 * that disagrees with People about what a rate history means fails a test.
 */
import type { RateRecordDto } from './schemas';

export interface RateSemanticsVector {
  readonly name: string;
  readonly rates: readonly RateRecordDto[];
  /** The rate in force for an employee on each date, or `null` where there is none. */
  readonly expectations: readonly {
    readonly employeeId: string;
    readonly on: string;
    readonly hourlyRateEur: number | null;
  }[];
}

/** The employee of every vector that does not say otherwise. */
export const VECTOR_EMPLOYEE_ID = 'emp-vector';

const record = (
  id: string,
  validFrom: string,
  hourlyRateEur: number,
  employeeId = VECTOR_EMPLOYEE_ID,
): RateRecordDto => ({ id, employeeId, validFrom, hourlyRateEur });

const rate = (on: string, hourlyRateEur: number | null, employeeId = VECTOR_EMPLOYEE_ID) => ({
  employeeId,
  on,
  hourlyRateEur,
});

export const rateSemanticsVectors: readonly RateSemanticsVector[] = [
  {
    name: 'a record applies from its validFrom, inclusive, and not before',
    rates: [record('r1', '2025-01-01', 80)],
    expectations: [rate('2024-12-31', null), rate('2025-01-01', 80), rate('2025-01-02', 80)],
  },
  {
    name: 'a record holds until the next one starts and the last one never ends',
    rates: [record('r1', '2025-01-01', 80), record('r2', '2026-03-12', 95)],
    expectations: [rate('2026-03-11', 80), rate('2026-03-12', 95), rate('2099-12-31', 95)],
  },
  {
    name: 'a rate may go down',
    rates: [record('r1', '2026-01-01', 100), record('r2', '2026-06-15', 90)],
    expectations: [rate('2026-06-14', 100), rate('2026-06-15', 90)],
  },
  {
    name: 'a record starting on a weekend applies from that very day',
    // 2026-08-01 is a Saturday.
    rates: [record('r1', '2026-01-01', 80), record('r2', '2026-08-01', 90)],
    expectations: [rate('2026-07-31', 80), rate('2026-08-01', 90), rate('2026-08-03', 90)],
  },
  {
    name: 'a record may start on a leap day',
    rates: [record('r1', '2027-01-01', 70), record('r2', '2028-02-29', 75.5)],
    expectations: [rate('2028-02-28', 70), rate('2028-02-29', 75.5)],
  },
  {
    name: 'the order of records in a response means nothing',
    rates: [
      record('r3', '2027-01-01', 110),
      record('r1', '2025-01-01', 80),
      record('r2', '2026-03-12', 95),
    ],
    expectations: [rate('2025-06-01', 80), rate('2026-12-31', 95), rate('2027-01-01', 110)],
  },
  {
    name: 'rates keep their cents',
    rates: [record('r1', '2026-01-01', 112.35), record('r2', '2026-02-01', 0.07)],
    expectations: [rate('2026-01-31', 112.35), rate('2026-02-01', 0.07)],
  },
  {
    name: 'employees are independent of each other',
    rates: [
      record('r1', '2026-01-01', 80),
      record('r2', '2026-06-01', 95, 'emp-other'),
      record('r3', '2026-09-01', 90),
    ],
    expectations: [
      rate('2026-07-01', 80),
      rate('2026-07-01', 95, 'emp-other'),
      rate('2026-05-31', null, 'emp-other'),
      rate('2026-09-01', 90),
      rate('2026-09-01', 95, 'emp-other'),
    ],
  },
  {
    name: 'an employee without records has no rate',
    rates: [],
    expectations: [rate('2026-01-01', null)],
  },
];

export interface ConflictingRateHistory {
  readonly name: string;
  readonly rates: readonly RateRecordDto[];
}

/**
 * Histories People never publishes. A consumer that receives one must refuse it rather than pick
 * a record: there is no right answer for the days they cover.
 */
export const conflictingRateHistories: readonly ConflictingRateHistory[] = [
  {
    name: 'two records start on the same day',
    rates: [record('r1', '2026-01-01', 80), record('r2', '2026-01-01', 90)],
  },
];
