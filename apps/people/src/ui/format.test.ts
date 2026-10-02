import { describe, expect, it } from 'vitest';
import { formatCapacity, formatDate, formatMoney, formatMonth } from './format';

describe('formatMoney', () => {
  it('shows EUR as stored', () => {
    expect(formatMoney(95, { code: 'EUR', ratePerEur: 1 })).toBe('€95.00');
  });

  it('converts into the display currency before formatting', () => {
    expect(formatMoney(100, { code: 'GBP', ratePerEur: 0.86 })).toBe('£86.00');
    expect(formatMoney(100, { code: 'USD', ratePerEur: 1.17 })).toContain('117.00');
  });

  it('keeps the cents of a rate that has them', () => {
    expect(formatMoney(112.35, { code: 'EUR', ratePerEur: 1 })).toBe('€112.35');
  });
});

describe('formatCapacity', () => {
  it.each([
    [0.5, '50.0%'],
    [1.18, '118.0%'],
    [0.333, '33.3%'],
    [1, '100.0%'],
  ])('shows %d person-months as %s', (personMonths, text) => {
    expect(formatCapacity(personMonths)).toBe(text);
  });
});

describe('dates', () => {
  it('names a month and a day in UTC, whatever the local time zone', () => {
    expect(formatMonth('2026-06')).toBe('Jun 2026');
    expect(formatMonth('2027-01')).toBe('Jan 2027');
    expect(formatDate('2026-03-12')).toBe('12 Mar 2026');
    expect(formatDate('2026-01-01')).toBe('1 Jan 2026');
  });
});
