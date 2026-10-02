import { costOf, type MonthPricing } from './pricing';
import { err, ok, type Result } from './result';

/**
 * Allocations are stored in person-months only. Every other unit is a view of that value for one
 * employee-month, computed on the way out and converted back on the way in.
 */
export const DISPLAY_UNITS = ['personMonths', 'hours', 'capacityPercent', 'cost'] as const;
export type DisplayUnit = (typeof DISPLAY_UNITS)[number];

/** Units that scale person-months by a constant, so that they need neither the person nor the month. */
export type PlainUnit = Extract<DisplayUnit, 'personMonths' | 'capacityPercent'>;

const PLAIN_SCALE: Readonly<Record<PlainUnit, number>> = { personMonths: 1, capacityPercent: 100 };

export const isPlainUnit = (unit: DisplayUnit): unit is PlainUnit => unit in PLAIN_SCALE;

export const toPlainUnit = (personMonths: number, unit: PlainUnit): number =>
  personMonths * PLAIN_SCALE[unit];

export const fromPlainUnit = (value: number, unit: PlainUnit): number => value / PLAIN_SCALE[unit];

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
    case 'capacityPercent':
      return toPlainUnit(personMonths, unit);
    case 'hours':
      return personMonths * pricing.hoursPerPersonMonth;
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
    case 'capacityPercent':
      return ok(fromPlainUnit(value, unit));
    case 'hours':
      return ok(value / pricing.hoursPerPersonMonth);
    case 'cost': {
      if (pricing.blendedRateEur === 0) return err('no-rate-in-month');
      const hours = value / currencyPerEur / pricing.blendedRateEur;
      return ok(hours / pricing.hoursPerPersonMonth);
    }
  }
}
