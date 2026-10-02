import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addMonths, isoDate, monthsBetween, workingDaysIn, yearMonth } from './calendar';

describe('isoDate', () => {
  it('accepts real calendar dates, including leap days', () => {
    expect(isoDate('2026-03-12')).toBe('2026-03-12');
    expect(isoDate('2028-02-29')).toBe('2028-02-29');
  });

  it.each(['2026-02-29', '2026-02-30', '2026-3-12', '2026-03-12T00:00', ''])(
    'rejects %j',
    (value) => {
      expect(() => isoDate(value)).toThrow(RangeError);
    },
  );
});

describe('yearMonth', () => {
  it.each(['2026-13', '2026-00', '2026-3', '2026-03-01'])('rejects %j', (value) => {
    expect(() => yearMonth(value)).toThrow(RangeError);
  });
});

describe('addMonths', () => {
  it('moves across year ends in both directions', () => {
    expect(addMonths(yearMonth('2026-11'), 3)).toBe('2027-02');
    expect(addMonths(yearMonth('2027-02'), -3)).toBe('2026-11');
    expect(addMonths(yearMonth('2026-12'), 1)).toBe('2027-01');
    expect(addMonths(yearMonth('2027-01'), -1)).toBe('2026-12');
    expect(addMonths(yearMonth('2026-05'), 0)).toBe('2026-05');
    expect(addMonths(yearMonth('2026-05'), 24)).toBe('2028-05');
  });

  it('refuses a part of a month', () => {
    expect(() => addMonths(yearMonth('2026-05'), 0.5)).toThrow(RangeError);
  });

  it('is undone by the opposite shift', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1900, max: 2200 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: -500, max: 500 }),
        (year, month, delta) => {
          const start = yearMonth(`${String(year)}-${String(month).padStart(2, '0')}`);
          expect(addMonths(addMonths(start, delta), -delta)).toBe(start);
        },
      ),
    );
  });
});

describe('monthsBetween', () => {
  it('lists both ends and every month between', () => {
    expect(monthsBetween(yearMonth('2026-11'), yearMonth('2027-02'))).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
    expect(monthsBetween(yearMonth('2026-03'), yearMonth('2026-03'))).toEqual(['2026-03']);
  });

  it('is empty when the end is before the start', () => {
    expect(monthsBetween(yearMonth('2026-04'), yearMonth('2026-03'))).toEqual([]);
  });
});

describe('workingDaysIn', () => {
  it.each([
    ['2026-03', 22],
    ['2026-04', 22],
    ['2026-05', 21],
    ['2026-06', 22],
    ['2026-07', 23],
    ['2026-08', 21],
    ['2026-09', 22],
    ['2026-10', 22],
    ['2026-11', 21],
    ['2026-12', 23],
    ['2027-01', 21],
    ['2027-02', 20],
    ['2027-03', 23],
  ])('%s has %i working days', (month, expected) => {
    expect(workingDaysIn(yearMonth(month))).toHaveLength(expected);
  });

  it('skips weekends and ignores public holidays', () => {
    const march = workingDaysIn(yearMonth('2026-03'));
    expect(march[0]).toBe('2026-03-02'); // 1 March 2026 is a Sunday
    expect(march).not.toContain('2026-03-07');
    expect(march).not.toContain('2026-03-08');
    expect(workingDaysIn(yearMonth('2026-12'))).toContain('2026-12-25');
  });
});
