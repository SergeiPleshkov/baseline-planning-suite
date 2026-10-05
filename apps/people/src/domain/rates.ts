import type { IsoDate } from './calendar';
import { dayBefore } from './calendar';
import type { EmployeeId, RateId } from './ids';
import { err, ok, type Result } from './result';

export interface RateRecord {
  readonly id: RateId;
  readonly validFrom: IsoDate;
  readonly hourlyRateEur: number;
}

/**
 * One employee's rates over time. A record applies from its `validFrom` (inclusive) until the
 * next one starts; the last has no end; before the first there is no rate.
 * Only `rateHistory()` and the commands below build one, so it always holds records sorted by
 * `validFrom`, with unique ids, unique `validFrom` dates and valid rates.
 */
export type RateHistory = RateHistoryContents & { readonly __brand: 'RateHistory' };

interface RateHistoryContents {
  readonly employeeId: EmployeeId;
  readonly records: readonly RateRecord[];
}

/** Repeated from the contract, which the domain cannot import; a test keeps the two equal. */
export const MAX_HOURLY_RATE_EUR = 10_000;

/** A positive amount in whole cents: 1.005 is refused, not rounded to a rate nobody entered. */
export const isValidHourlyRate = (rate: number): boolean =>
  Number.isFinite(rate) &&
  rate > 0 &&
  rate <= MAX_HOURLY_RATE_EUR &&
  Math.round(rate * 100) / 100 === rate;

export function rateHistory(employeeId: EmployeeId, records: readonly RateRecord[]): RateHistory {
  const sorted = records.toSorted((a, b) =>
    a.validFrom < b.validFrom ? -1 : a.validFrom > b.validFrom ? 1 : 0,
  );
  const ids = new Set<RateId>();
  sorted.forEach((record, index) => {
    if (!isValidHourlyRate(record.hourlyRateEur)) {
      throw new RangeError(`${record.id}: hourly rate must be positive with at most two decimals`);
    }
    if (ids.has(record.id)) throw new RangeError(`Duplicate rate ${record.id}`);
    ids.add(record.id);
    if (sorted[index - 1]?.validFrom === record.validFrom) {
      throw new RangeError(`Two rates start on ${record.validFrom}`);
    }
  });
  const contents: RateHistoryContents = { employeeId, records: sorted };
  return contents as RateHistory;
}

/** Commands rebuild through `rateHistory`: a bug in one throws rather than store a bad history. */
const rebuilt = (history: RateHistory, records: readonly RateRecord[]): RateHistory =>
  rateHistory(history.employeeId, records);

const startsOn = (history: RateHistory, validFrom: IsoDate, except?: RateId): boolean =>
  history.records.some((record) => record.validFrom === validFrom && record.id !== except);

export type AddRateError = 'invalid-rate' | 'duplicate-id' | 'duplicate-valid-from';

export function addRate(
  history: RateHistory,
  record: RateRecord,
): Result<RateHistory, AddRateError> {
  if (!isValidHourlyRate(record.hourlyRateEur)) return err('invalid-rate');
  if (history.records.some((existing) => existing.id === record.id)) return err('duplicate-id');
  if (startsOn(history, record.validFrom)) return err('duplicate-valid-from');
  return ok(rebuilt(history, [...history.records, record]));
}

export type CorrectRateError = 'unknown-rate' | 'invalid-rate' | 'duplicate-valid-from';

export function correctRate(
  history: RateHistory,
  id: RateId,
  change: { readonly validFrom?: IsoDate; readonly hourlyRateEur?: number },
): Result<RateHistory, CorrectRateError> {
  const current = history.records.find((record) => record.id === id);
  if (!current) return err('unknown-rate');
  const corrected: RateRecord = {
    id,
    validFrom: change.validFrom ?? current.validFrom,
    hourlyRateEur: change.hourlyRateEur ?? current.hourlyRateEur,
  };
  if (!isValidHourlyRate(corrected.hourlyRateEur)) return err('invalid-rate');
  if (startsOn(history, corrected.validFrom, id)) return err('duplicate-valid-from');
  return ok(
    rebuilt(
      history,
      history.records.map((record) => (record.id === id ? corrected : record)),
    ),
  );
}

export type RemoveRateError = 'unknown-rate' | 'only-rate';

/**
 * Removes a record; the previous one then runs on until the next. The only record is not removed
 * here: that leaves the employee without any rate, which `clearRates` does on purpose.
 */
export function removeRate(history: RateHistory, id: RateId): Result<RateHistory, RemoveRateError> {
  if (!history.records.some((record) => record.id === id)) return err('unknown-rate');
  if (history.records.length === 1) return err('only-rate');
  return ok(
    rebuilt(
      history,
      history.records.filter((record) => record.id !== id),
    ),
  );
}

/** Leaves the employee with no rate, so their days cost nothing and are reported as unpriced. */
export const clearRates = (history: RateHistory): RateHistory => rebuilt(history, []);

export interface EffectivePeriod {
  readonly record: RateRecord;
  readonly from: IsoDate;
  /** The last day the record applies, inclusive; `null` for the last record. */
  readonly to: IsoDate | null;
}

export const effectivePeriods = (history: RateHistory): readonly EffectivePeriod[] =>
  history.records.map((record, index) => {
    const next = history.records[index + 1];
    return { record, from: record.validFrom, to: next ? dayBefore(next.validFrom) : null };
  });

export function rateOn(history: RateHistory, date: IsoDate): number | null {
  let rate: number | null = null;
  for (const record of history.records) {
    if (record.validFrom > date) break;
    rate = record.hourlyRateEur;
  }
  return rate;
}
