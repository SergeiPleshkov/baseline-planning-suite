import { costOf, type MonthPricing } from './pricing';
import { err, ok, type Result } from './result';

/**
 * Allocations are stored in person-months only. Every other unit is a view of that value for one
 * employee-month, computed on the way out and converted back on the way in.
 */
export const DISPLAY_UNITS = ['personMonths', 'hours', 'capacityPercent', 'cost'] as const;
export type DisplayUnit = (typeof DISPLAY_UNITS)[number];

export interface ConversionContext {
  readonly pricing: MonthPricing;
  /** Display currency per EUR; costs are computed in EUR. */
  readonly currencyPerEur: number;
}

export type ConversionError = 'no-rate-in-month';

export function toDisplayUnit(
  personMonths: number,
  unit: DisplayUnit,
  { pricing, currencyPerEur }: ConversionContext,
): number {
  switch (unit) {
    case 'personMonths':
      return personMonths;
    case 'hours':
      return personMonths * pricing.hoursPerPersonMonth;
    case 'capacityPercent':
      return personMonths * 100;
    case 'cost':
      return costOf(personMonths, pricing).costEur * currencyPerEur;
  }
}

export function fromDisplayUnit(
  value: number,
  unit: DisplayUnit,
  { pricing, currencyPerEur }: ConversionContext,
): Result<number, ConversionError> {
  switch (unit) {
    case 'personMonths':
      return ok(value);
    case 'hours':
      return ok(value / pricing.hoursPerPersonMonth);
    case 'capacityPercent':
      return ok(value / 100);
    case 'cost': {
      if (pricing.blendedRateEur === 0) return err('no-rate-in-month');
      const hours = value / currencyPerEur / pricing.blendedRateEur;
      return ok(hours / pricing.hoursPerPersonMonth);
    }
  }
}
