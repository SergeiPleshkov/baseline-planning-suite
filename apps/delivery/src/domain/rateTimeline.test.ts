import { describe, expect, it } from 'vitest';
import { isoDate } from './calendar';
import { rateOn, rateTimeline } from './rateTimeline';

const change = (effectiveFrom: string, hourlyRateEur: number) => ({
  effectiveFrom: isoDate(effectiveFrom),
  hourlyRateEur,
});

describe('rateTimeline', () => {
  const timeline = rateTimeline([change('2026-03-12', 95), change('2025-01-01', 80)]);

  it('has no rate before the first change', () => {
    expect(rateOn(timeline, isoDate('2024-12-31'))).toBeNull();
  });

  it('applies a change from its effective date, inclusive', () => {
    expect(rateOn(timeline, isoDate('2026-03-11'))).toBe(80);
    expect(rateOn(timeline, isoDate('2026-03-12'))).toBe(95);
  });

  it('keeps the last change in force with no end date', () => {
    expect(rateOn(timeline, isoDate('2030-01-01'))).toBe(95);
  });

  it('rejects two changes on the same day', () => {
    expect(() => rateTimeline([change('2026-01-01', 80), change('2026-01-01', 90)])).toThrow(
      RangeError,
    );
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects an hourly rate of %d', (rate) => {
    expect(() => rateTimeline([change('2026-01-01', rate)])).toThrow(RangeError);
  });
});
