import { describe, expect, it } from 'vitest';
import { dayBefore, isoDate } from './calendar';

describe('isoDate', () => {
  it('accepts real dates, leap day included', () => {
    expect(isoDate('2028-02-29')).toBe('2028-02-29');
  });

  it.each(['2026-02-29', '2026-13-01', '2026-00-10', '2026-1-1', '2026-03-12T00:00', ''])(
    'rejects %j',
    (value) => {
      expect(() => isoDate(value)).toThrow(RangeError);
    },
  );
});

describe('dayBefore', () => {
  it.each([
    ['2026-03-12', '2026-03-11'],
    ['2026-03-01', '2026-02-28'],
    ['2028-03-01', '2028-02-29'],
    ['2026-01-01', '2025-12-31'],
  ])('%s is preceded by %s', (date, expected) => {
    expect(dayBefore(isoDate(date))).toBe(expected);
  });
});
