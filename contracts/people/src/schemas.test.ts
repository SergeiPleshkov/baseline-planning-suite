import { describe, expect, it } from 'vitest';
import {
  conflictingRateHistories,
  MAX_HOURLY_RATE_EUR,
  RateRecordSchema,
  RatesChangedEventSchema,
  RatesResponseSchema,
  rateSemanticsVectors,
} from './index';

const record = { id: 'r1', employeeId: 'emp-1', validFrom: '2026-03-12', hourlyRateEur: 95 };

describe('RateRecordSchema', () => {
  it('accepts a well-formed record', () => {
    expect(RateRecordSchema.safeParse(record).success).toBe(true);
  });

  it.each([0.01, 0.07, 112.35, MAX_HOURLY_RATE_EUR])('accepts a rate of %d', (hourlyRateEur) => {
    expect(RateRecordSchema.safeParse({ ...record, hourlyRateEur }).success).toBe(true);
  });

  it('ignores fields a later minor version adds', () => {
    expect(RateRecordSchema.parse({ ...record, note: 'new' })).toEqual(record);
  });

  it.each([
    ['a rate of zero', { hourlyRateEur: 0 }],
    ['a negative rate', { hourlyRateEur: -5 }],
    ['a rate that is not a number', { hourlyRateEur: '95' }],
    ['a date that does not exist', { validFrom: '2026-02-30' }],
    ['a date with a time', { validFrom: '2026-03-12T00:00:00Z' }],
    ['a month instead of a date', { validFrom: '2026-03' }],
    ['an empty id', { id: '' }],
    ['a blank employee id', { employeeId: '  ' }],
    ['a rate with three decimals', { hourlyRateEur: 80.001 }],
    ['a rate above the limit', { hourlyRateEur: MAX_HOURLY_RATE_EUR + 0.01 }],
    ['a date before 1900', { validFrom: '1850-01-01' }],
  ])('rejects %s', (_label, override) => {
    expect(RateRecordSchema.safeParse({ ...record, ...override }).success).toBe(false);
  });
});

describe('RatesChangedEventSchema', () => {
  const event = { type: 'rates-changed', version: 1, employeeIds: ['emp-1'], revision: 7 };

  it('accepts a well-formed event', () => {
    expect(RatesChangedEventSchema.safeParse(event).success).toBe(true);
  });

  it.each([
    ['another version', { version: 2 }],
    ['another type', { type: 'employees-changed' }],
    ['nobody named', { employeeIds: [] }],
    ['a fractional revision', { revision: 1.5 }],
  ])('rejects %s', (_label, override) => {
    expect(RatesChangedEventSchema.safeParse({ ...event, ...override }).success).toBe(false);
  });
});

describe('rate vectors', () => {
  it.each(rateSemanticsVectors.map((vector) => [vector.name, vector] as const))(
    'are valid payloads: %s',
    (_name, vector) => {
      expect(RatesResponseSchema.safeParse({ revision: 1, rates: vector.rates }).success).toBe(
        true,
      );
    },
  );

  it('have distinct names and cover a date before the first record', () => {
    const names = rateSemanticsVectors.map((vector) => vector.name);
    expect(new Set(names).size).toBe(names.length);
    expect(
      rateSemanticsVectors.some((vector) =>
        vector.expectations.some((expectation) => expectation.hourlyRateEur === null),
      ),
    ).toBe(true);
  });

  it('keep the conflicting histories shape-valid, so only their meaning is wrong', () => {
    for (const history of conflictingRateHistories) {
      expect(RatesResponseSchema.safeParse({ revision: 1, rates: history.rates }).success).toBe(
        true,
      );
    }
  });
});
