import { describe, expect, it } from 'vitest';
import { isoDate } from '../domain/calendar';
import { employee } from '../domain/employees';
import { employeeId, rateId, type EmployeeId } from '../domain/ids';
import { rateHistory, type RateHistory } from '../domain/rates';
import type { EmployeeLoad } from './peopleStore';
import { currentRate, registerRows, rolesOf } from './registerView';

const person = (id: string, name: string, role: string) =>
  employee({ id: employeeId(id), name, role, weeklyHours: 40 });

const employees = [
  person('e1', 'Adaeze Okafor', 'Tech Lead'),
  person('e2', 'Lena Okafor', 'Frontend Engineer'),
  person('e3', 'Zoë Müller', 'Frontend Engineer'),
];

const history = (id: string, ...records: [string, string, number][]) =>
  rateHistory(
    employeeId(id),
    records.map(([rid, from, rate]) => ({
      id: rateId(rid),
      validFrom: isoDate(from),
      hourlyRateEur: rate,
    })),
  );

const veteran = history('e1', ['a', '2025-01-01', 80], ['b', '2026-03-12', 95]);
const newcomer = history('e2', ['c', '2027-01-01', 70]);
const histories = new Map<EmployeeId, RateHistory>([
  [employeeId('e1'), veteran],
  [employeeId('e2'), newcomer],
  [employeeId('e3'), history('e3')],
]);

const today = isoDate('2026-10-02');

describe('currentRate', () => {
  it('is the rate in force today', () => {
    expect(currentRate(veteran, today)).toEqual({ kind: 'rate', hourlyRateEur: 95 });
  });

  it('is the day a rate begins when none applies yet, and nothing without records', () => {
    expect(currentRate(newcomer, today)).toEqual({ kind: 'starts-later', from: '2027-01-01' });
    expect(currentRate(history('e3'), today)).toEqual({ kind: 'none' });
  });

  it('changes on the very day a rate starts', () => {
    expect(currentRate(veteran, isoDate('2026-03-11'))).toMatchObject({ hourlyRateEur: 80 });
    expect(currentRate(veteran, isoDate('2026-03-12'))).toMatchObject({ hourlyRateEur: 95 });
  });
});

describe('registerRows', () => {
  const load = new Map<EmployeeId, EmployeeLoad>([
    [employeeId('e2'), { months: [], overMonths: 2 }],
  ]);
  const ids = (query: string, role: string | null, withLoad = true) =>
    registerRows({ employees, histories, load: withLoad ? load : null, query, role, today });

  it('lists everyone in register order for an empty query', () => {
    expect(ids('', null).map((row) => row.employee.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('searches name and role together, ignoring accents', () => {
    expect(ids('okafor', null).map((row) => row.employee.id)).toEqual(['e1', 'e2']);
    expect(ids('zoe muller', null).map((row) => row.employee.id)).toEqual(['e3']);
  });

  it('narrows by role, with or without a query', () => {
    expect(ids('', 'Frontend Engineer').map((row) => row.employee.id)).toEqual(['e2', 'e3']);
    expect(ids('okafor', 'Frontend Engineer').map((row) => row.employee.id)).toEqual(['e2']);
  });

  it('counts months over capacity, zero for someone not listed, null while unknown', () => {
    expect(ids('', null).map((row) => row.overMonths)).toEqual([0, 2, 0]);
    expect(ids('', null, false).map((row) => row.overMonths)).toEqual([null, null, null]);
  });
});

describe('rolesOf', () => {
  it('lists each role once, sorted', () => {
    expect(rolesOf(employees)).toEqual(['Frontend Engineer', 'Tech Lead']);
  });
});
