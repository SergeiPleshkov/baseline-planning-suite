import { describe, expect, it } from 'vitest';
import { isoDate, workingDaysIn, yearMonth } from './calendar';

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
