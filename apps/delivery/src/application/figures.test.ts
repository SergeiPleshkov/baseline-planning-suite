import { describe, expect, it } from 'vitest';
import { DISPLAY_UNITS } from '../domain/units';
import { DISPLAY_DECIMALS, formatSteps } from './figures';

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
