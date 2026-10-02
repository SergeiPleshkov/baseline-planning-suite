import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isoDate, yearMonth } from './calendar';
import { priceMonth } from './pricing';
import { rateTimeline } from './rateTimeline';
import {
  DISPLAY_UNITS,
  fromDisplayUnit,
  fromPlainUnit,
  isPlainUnit,
  toDisplayUnit,
  toPlainUnit,
  type ConversionContext,
} from './units';

const okafor = (currencyPerEur = 1): ConversionContext => ({
  pricing: priceMonth(
    yearMonth('2026-03'),
    40,
    rateTimeline([
      { effectiveFrom: isoDate('2025-01-01'), hourlyRateEur: 80 },
      { effectiveFrom: isoDate('2026-03-12'), hourlyRateEur: 95 },
    ]),
  ),
  currencyPerEur,
});

describe('reference cell in every unit (case study, figure 4)', () => {
  it.each([
    ['personMonths', 0.5],
    ['hours', 88],
    ['capacityPercent', 50],
    ['cost', 7880],
  ] as const)('0.50 person-months is %s %d', (unit, expected) => {
    expect(toDisplayUnit(0.5, unit, okafor())).toBe(expected);
    expect(fromDisplayUnit(expected, unit, okafor())).toEqual({ ok: true, value: 0.5 });
  });

  it('converts cost into the display currency and back', () => {
    expect(toDisplayUnit(0.5, 'cost', okafor(1.17))).toBeCloseTo(9219.6, 9);
    const entered = fromDisplayUnit(9219.6, 'cost', okafor(1.17));
    expect(entered.ok && entered.value).toBeCloseTo(0.5, 12);
  });
});

describe('plain units', () => {
  it('are the units that need no pricing', () => {
    expect(DISPLAY_UNITS.filter(isPlainUnit)).toEqual(['personMonths', 'capacityPercent']);
    expect(toPlainUnit(0.5, 'capacityPercent')).toBe(50);
    expect(toPlainUnit(0.5, 'personMonths')).toBe(0.5);
    expect(fromPlainUnit(50, 'capacityPercent')).toBe(0.5);
    expect(fromPlainUnit(0.5, 'personMonths')).toBe(0.5);
  });
});

describe('cost input', () => {
  it('divides by the blended rate, so it is refused in a month without any rate', () => {
    const noRate: ConversionContext = {
      pricing: priceMonth(
        yearMonth('2024-12'),
        40,
        rateTimeline([{ effectiveFrom: isoDate('2025-01-01'), hourlyRateEur: 80 }]),
      ),
      currencyPerEur: 1,
    };
    expect(fromDisplayUnit(1000, 'cost', noRate)).toEqual({
      ok: false,
      error: 'no-rate-in-month',
    });
    expect(toDisplayUnit(0.5, 'cost', noRate)).toBe(0);
  });
});

const closeTo = (actual: number, expected: number) =>
  Math.abs(actual - expected) <= 1e-12 * Math.max(1, Math.abs(expected));

// fc.double is uniform over bit patterns, so most of its values are vanishingly small;
// realistic figures are uniform over the range instead.
const upTo = (max: number) => fc.integer({ min: 0, max: max * 1e6 }).map((n) => n / 1e6);

const anyContext = fc
  .record({
    year: fc.integer({ min: 2024, max: 2028 }),
    month: fc.integer({ min: 1, max: 12 }),
    weeklyHours: fc.constantFrom(40, 32, 20),
    // Days relative to the 1st of the month, so changes often fall inside it and split it.
    changes: fc.uniqueArray(
      fc.record({
        dayOffset: fc.integer({ min: -40, max: 30 }),
        hourlyRateEur: fc.integer({ min: 5000, max: 15000 }).map((cents) => cents / 100),
      }),
      { selector: (change) => change.dayOffset, minLength: 1, maxLength: 4 },
    ),
    currencyPerEur: fc.double({ min: 0.5, max: 2, noNaN: true }),
  })
  .map(({ year, month, weeklyHours, changes, currencyPerEur }) => ({
    pricing: priceMonth(
      yearMonth(`${String(year)}-${String(month).padStart(2, '0')}`),
      weeklyHours,
      rateTimeline(
        changes.map(({ dayOffset, hourlyRateEur }) => ({
          effectiveFrom: isoDate(
            new Date(Date.UTC(year, month - 1, 1 + dayOffset)).toISOString().slice(0, 10),
          ),
          hourlyRateEur,
        })),
      ),
    ),
    currencyPerEur,
  }));

describe('unit conversions', () => {
  it('leave a stored value unchanged after a round trip through any unit', () => {
    fc.assert(
      fc.property(
        upTo(3),
        fc.constantFrom(...DISPLAY_UNITS),
        anyContext,
        (personMonths, unit, context) => {
          fc.pre(unit !== 'cost' || context.pricing.blendedRateEur > 0);
          const back = fromDisplayUnit(toDisplayUnit(personMonths, unit, context), unit, context);
          return back.ok && closeTo(back.value, personMonths);
        },
      ),
    );
  });

  it('show an entered value back exactly as entered', () => {
    fc.assert(
      fc.property(
        upTo(50_000),
        fc.constantFrom(...DISPLAY_UNITS),
        anyContext,
        (entered, unit, context) => {
          const stored = fromDisplayUnit(entered, unit, context);
          fc.pre(stored.ok);
          return closeTo(toDisplayUnit(stored.value, unit, context), entered);
        },
      ),
    );
  });
});
