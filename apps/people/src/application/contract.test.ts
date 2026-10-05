import fc from 'fast-check';
import {
  conflictingRateHistories,
  EmployeeSchema,
  RateRecordSchema,
  rateSemanticsVectors,
  VECTOR_EMPLOYEE_ID,
  type RateRecordDto,
} from '@baseline/people-contract';
import { describe, expect, it } from 'vitest';
import { isoDate } from '../domain/calendar';
import { employeeId, rateId } from '../domain/ids';
import { isValidHourlyRate, rateHistory, rateOn } from '../domain/rates';
import { employeeToContract, rateToContract } from './contract';

const historyFrom = (rates: readonly RateRecordDto[], employee: string) =>
  rateHistory(
    employeeId(employee),
    rates
      .filter((rate) => rate.employeeId === employee)
      .map((rate) => ({
        id: rateId(rate.id),
        validFrom: isoDate(rate.validFrom),
        hourlyRateEur: rate.hourlyRateEur,
      })),
  );

describe('People reads its own rate vectors the way it publishes them', () => {
  it.each(rateSemanticsVectors.map((vector) => [vector.name, vector] as const))(
    '%s',
    (_name, vector) => {
      for (const expectation of vector.expectations) {
        const history = historyFrom(vector.rates, expectation.employeeId);
        expect(rateOn(history, isoDate(expectation.on))).toBe(expectation.hourlyRateEur);
      }
    },
  );

  it.each(conflictingRateHistories.map((history) => [history.name, history] as const))(
    'refuses to build a history where %s',
    (_name, history) => {
      expect(() => historyFrom(history.rates, VECTOR_EMPLOYEE_ID)).toThrow(/Two rates start on/);
    },
  );

  it('publishes a history back as the records it was built from', () => {
    for (const vector of rateSemanticsVectors) {
      const published = historyFrom(vector.rates, VECTOR_EMPLOYEE_ID).records.map((rate) =>
        rateToContract(employeeId(VECTOR_EMPLOYEE_ID), rate),
      );
      const original = vector.rates.filter((rate) => rate.employeeId === VECTOR_EMPLOYEE_ID);
      expect(published).toHaveLength(original.length);
      for (const record of published) {
        expect(original).toContainEqual(record);
        expect(RateRecordSchema.safeParse(record).success).toBe(true);
      }
    }
  });
});

describe('employeeToContract', () => {
  it('publishes the register fields and nothing else', () => {
    const published = employeeToContract({
      id: employeeId('emp-001'),
      name: 'Adaeze Okafor',
      role: 'Tech Lead',
      weeklyHours: 40,
    });
    expect(EmployeeSchema.parse(published)).toEqual(published);
    expect(Object.keys(published).sort()).toEqual(['id', 'name', 'role', 'weeklyHours']);
  });
});

describe('the rate rule in the domain and in the contract', () => {
  const asRecord = (hourlyRateEur: number) => ({
    id: 'r',
    employeeId: 'e',
    validFrom: '2026-01-01',
    hourlyRateEur,
  });

  it.each([0, -1, 0.001, 1.005, 80, 112.35, 10_000, 10_000.01, 1e21, Number.NaN])(
    'agree on %d',
    (rate) => {
      expect(RateRecordSchema.safeParse(asRecord(rate)).success).toBe(isValidHourlyRate(rate));
    },
  );

  it('agree on any amount of cents and on amounts between cents', () => {
    const amounts = fc.oneof(
      fc.integer({ min: -100, max: 1_100_000 }).map((cents) => cents / 100),
      fc.integer({ min: 0, max: 1_100_000_000 }).map((tenthsOfCents) => tenthsOfCents / 1000),
    );
    fc.assert(
      fc.property(amounts, (rate) => {
        expect(RateRecordSchema.safeParse(asRecord(rate)).success).toBe(isValidHourlyRate(rate));
      }),
    );
  });
});
