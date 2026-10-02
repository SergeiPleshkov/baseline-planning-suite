import { describe, expect, it } from 'vitest';
import { DISPLAY_UNITS } from '../domain/units';
import { DISPLAY_DECIMALS, capacityPercentSteps, formatSteps, roundedColumn } from './figures';

describe('formatSteps', () => {
  it.each([
    [50, 'personMonths', '0.50'],
    [8800, 'hours', '88.00'],
    [500, 'capacityPercent', '50.0'],
    [788000, 'cost', '7,880.00'],
    [0, 'personMonths', '0.00'],
    [0, 'capacityPercent', '0.0'],
    [123456789, 'cost', '1,234,567.89'],
  ] as const)('shows %d steps of %s as %s', (steps, unit, expected) => {
    expect(formatSteps(steps, unit)).toBe(expected);
  });

  it('shows exactly the decimals of the precision table', () => {
    for (const unit of DISPLAY_UNITS) {
      const shown = formatSteps(1, unit);
      expect(shown.split('.')[1]).toHaveLength(DISPLAY_DECIMALS[unit]);
    }
  });
});

describe('roundedColumn', () => {
  it('shows parts that add up to the total, giving the leftover step to one of them', () => {
    const { parts, total } = roundedColumn([1 / 3, 1 / 3, 1 / 3], 2);
    expect(total).toBe(100);
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(100);
    expect([...parts].sort()).toEqual([33, 33, 34]);
  });

  it('is zero for nothing', () => {
    expect(roundedColumn([], 2)).toEqual({ parts: [], total: 0 });
  });
});

describe('capacityPercentSteps', () => {
  it('counts tenths of a percent of a person-month', () => {
    expect(capacityPercentSteps(0.5)).toBe(500);
    expect(capacityPercentSteps(1.18)).toBe(1180);
    expect(capacityPercentSteps(0)).toBe(0);
  });

  it('rounds to nearest, halves up', () => {
    expect(capacityPercentSteps(0.3333)).toBe(333);
    expect(capacityPercentSteps(0.6666)).toBe(667);
    expect(capacityPercentSteps(0.0005)).toBe(1);
    expect(capacityPercentSteps(0.0004)).toBe(0);
  });
});
