import {
  conflictingRateHistories,
  rateSemanticsVectors,
  VECTOR_EMPLOYEE_ID,
  type RateRecordDto,
} from '@baseline/people-contract';
import { describe, expect, it } from 'vitest';
import { isoDate } from '../domain/calendar';
import { employeeId } from '../domain/ids';
import { rateOn, rateTimeline } from '../domain/rateTimeline';
import { rateTimelinesFromPeople, staffFromPeople } from './peopleContract';

const payload = (rates: readonly RateRecordDto[]) => ({ revision: 1, rates });

const record = (
  id: string,
  employee: string,
  validFrom: string,
  hourlyRateEur: number,
): RateRecordDto => ({ id, employeeId: employee, validFrom, hourlyRateEur });

describe('Delivery reads People rate vectors the way People publishes them', () => {
  it.each(rateSemanticsVectors.map((vector) => [vector.name, vector] as const))(
    '%s',
    (_name, vector) => {
      const mapped = rateTimelinesFromPeople(payload(vector.rates));
      if (!mapped.ok) throw new Error(JSON.stringify(mapped.error));
      for (const expectation of vector.expectations) {
        const timeline = mapped.value.get(employeeId(expectation.employeeId)) ?? rateTimeline([]);
        expect(rateOn(timeline, isoDate(expectation.on))).toBe(expectation.hourlyRateEur);
      }
    },
  );

  it.each(conflictingRateHistories.map((history) => [history.name, history] as const))(
    'refuses the payload where %s',
    (_name, history) => {
      expect(rateTimelinesFromPeople(payload(history.rates))).toMatchObject({
        ok: false,
        error: {
          reason: 'unusable-rates',
          employeeId: VECTOR_EMPLOYEE_ID,
          detail: expect.stringContaining('Two rate changes on 2026-01-01') as unknown,
        },
      });
    },
  );
});

describe('rateTimelinesFromPeople', () => {
  it('keeps employees apart', () => {
    const mapped = rateTimelinesFromPeople(
      payload([
        record('a', 'emp-1', '2026-01-01', 80),
        record('b', 'emp-2', '2026-01-01', 90),
        record('c', 'emp-1', '2026-06-01', 85),
      ]),
    );
    if (!mapped.ok) throw new Error(JSON.stringify(mapped.error));
    const on = (id: string, date: string) =>
      rateOn(mapped.value.get(employeeId(id)) ?? rateTimeline([]), isoDate(date));
    expect(on('emp-1', '2026-07-01')).toBe(85);
    expect(on('emp-2', '2026-07-01')).toBe(90);
  });

  it.each([
    ['not an object', 'rates'],
    ['no rates', { revision: 1 }],
    ['a rate of zero', payload([record('a', 'e', '2026-01-01', 0)])],
    ['an impossible date', payload([record('a', 'e', '2026-02-30', 80)])],
  ])('refuses a payload with %s', (_label, body) => {
    expect(rateTimelinesFromPeople(body)).toMatchObject({
      ok: false,
      error: { reason: 'malformed' },
    });
  });

  it.each([
    ['a blank employee id', record('a', '  ', '2026-01-01', 80)],
    ['a rate with three decimals', record('a', 'e', '2026-01-01', 80.001)],
    ['a rate above the limit', record('a', 'e', '2026-01-01', 10_001)],
  ])('refuses a payload with %s', (_label, bad) => {
    expect(rateTimelinesFromPeople(payload([bad]))).toMatchObject({
      ok: false,
      error: { reason: 'malformed' },
    });
  });

  it('refuses a payload that uses a rate id twice, whoever the records belong to', () => {
    const mapped = rateTimelinesFromPeople(
      payload([record('a', 'emp-1', '2026-01-01', 80), record('a', 'emp-2', '2026-01-01', 90)]),
    );
    expect(mapped).toMatchObject({
      ok: false,
      error: { reason: 'malformed', detail: 'rate id a appears twice' },
    });
  });

  it('says where a payload is wrong', () => {
    const mapped = rateTimelinesFromPeople(payload([record('a', 'e', '2026-02-30', 80)]));
    expect(mapped.ok ? '' : JSON.stringify(mapped.error)).toContain('rates.0.validFrom');
  });
});

describe('staffFromPeople', () => {
  it('maps the register into what Delivery needs', () => {
    const mapped = staffFromPeople({
      revision: 4,
      employees: [{ id: 'emp-001', name: 'Adaeze Okafor', role: 'Tech Lead', weeklyHours: 32 }],
    });
    if (!mapped.ok) throw new Error(JSON.stringify(mapped.error));
    expect(mapped.value.get(employeeId('emp-001'))).toEqual({
      id: 'emp-001',
      name: 'Adaeze Okafor',
      weeklyHours: 32,
    });
  });

  it('refuses a register that lists an employee twice', () => {
    const entry = { id: 'emp-001', name: 'A', role: 'B', weeklyHours: 40 };
    expect(staffFromPeople({ revision: 1, employees: [entry, entry] })).toMatchObject({
      ok: false,
      error: { reason: 'malformed', detail: 'employee id emp-001 appears twice' },
    });
  });

  it('refuses a blank employee id', () => {
    const entry = { id: ' ', name: 'A', role: 'B', weeklyHours: 40 };
    expect(staffFromPeople({ revision: 1, employees: [entry] })).toMatchObject({ ok: false });
  });

  it('refuses working hours that make no sense', () => {
    const mapped = staffFromPeople({
      revision: 4,
      employees: [{ id: 'emp-001', name: 'A', role: 'B', weeklyHours: 0 }],
    });
    expect(mapped).toMatchObject({ ok: false, error: { reason: 'malformed' } });
  });
});
