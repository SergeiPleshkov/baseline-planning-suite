import { describe, expect, it } from 'vitest';
import { isoDate, yearMonth } from './calendar';
import { costOf, priceMonth } from './pricing';
import { rateTimeline } from './rateTimeline';

const rates = (...changes: [string, number][]) =>
  rateTimeline(
    changes.map(([effectiveFrom, hourlyRateEur]) => ({
      effectiveFrom: isoDate(effectiveFrom),
      hourlyRateEur,
    })),
  );

describe('reference calculation (case study, figure 4)', () => {
  // A. Okafor, 40 h/week, €80/h from 2025-01-01, €95/h from 2026-03-12, 0.50 PM in March 2026.
  const pricing = priceMonth(
    yearMonth('2026-03'),
    40,
    rates(['2025-01-01', 80], ['2026-03-12', 95]),
  );
  const cost = costOf(0.5, pricing);

  it('splits March 2026 into 8 working days at the old rate and 14 at the new one', () => {
    expect(pricing.workingDays).toBe(22);
    expect(pricing.slices).toEqual([
      { firstDay: '2026-03-02', lastDay: '2026-03-11', workingDays: 8, hourlyRateEur: 80 },
      { firstDay: '2026-03-12', lastDay: '2026-03-31', workingDays: 14, hourlyRateEur: 95 },
    ]);
  });

  it('prices one person-month at 176 h and the allocation at 88 h, 4 h per working day', () => {
    expect(pricing.hoursPerPersonMonth).toBe(176);
    expect(cost.hours).toBe(88);
    expect(cost.hoursPerWorkingDay).toBe(4);
  });

  it('costs €7,880.00 at a blended €89.5455/h', () => {
    expect(cost.costEur).toBe(7880);
    expect(pricing.blendedRateEur).toBeCloseTo(89.5455, 4);
  });
});

describe('priceMonth', () => {
  it('prices a whole month at the new rate when the change falls on a weekend', () => {
    const august = priceMonth(
      yearMonth('2026-08'),
      40,
      rates(['2026-01-01', 87], ['2026-08-01', 93]),
    );
    expect(august.slices).toEqual([
      { firstDay: '2026-08-03', lastDay: '2026-08-31', workingDays: 21, hourlyRateEur: 93 },
    ]);
  });

  it('yields one slice per rate when a month holds two changes', () => {
    const june = priceMonth(
      yearMonth('2026-06'),
      40,
      rates(['2025-01-01', 100], ['2026-06-10', 110], ['2026-06-22', 120]),
    );
    expect(june.slices.map((slice) => [slice.workingDays, slice.hourlyRateEur])).toEqual([
      [7, 100],
      [8, 110],
      [7, 120],
    ]);
    expect(costOf(1, june).costEur).toBe(8 * (7 * 100 + 8 * 110 + 7 * 120));
    expect(june.blendedRateEur).toBe(110);
  });

  it('handles a rate that goes down', () => {
    const may = priceMonth(
      yearMonth('2026-05'),
      32,
      rates(['2026-01-01', 125], ['2026-05-14', 122]),
    );
    expect(may.slices.map((slice) => [slice.workingDays, slice.hourlyRateEur])).toEqual([
      [9, 125],
      [12, 122],
    ]);
    expect(costOf(0.25, may).costEur).toBeCloseTo(1.6 * (9 * 125 + 12 * 122), 9);
  });

  it('costs nothing in a month before the first rate, and marks every day unpriced', () => {
    const december = priceMonth(yearMonth('2024-12'), 40, rates(['2025-01-01', 80]));
    expect(december.unpricedWorkingDays).toBe(22);
    expect(december.blendedRateEur).toBe(0);
    expect(costOf(0.5, december).costEur).toBe(0);
  });

  it('prices only the days from a first rate that starts mid-month', () => {
    const march = priceMonth(yearMonth('2026-03'), 40, rates(['2026-03-12', 95]));
    expect(march.unpricedWorkingDays).toBe(8);
    expect(costOf(0.5, march).costEur).toBe(14 * 4 * 95);
  });

  it('scales a person-month with weekly hours and working days', () => {
    expect(
      priceMonth(yearMonth('2027-02'), 20, rates(['2025-01-01', 80])).hoursPerPersonMonth,
    ).toBe(80);
    expect(
      priceMonth(yearMonth('2026-07'), 32, rates(['2025-01-01', 80])).hoursPerPersonMonth,
    ).toBe(147.2);
  });

  it('covers every working day exactly once and costs hours × blended rate, 2024–2028', () => {
    const timeline = rates(['2025-01-01', 80], ['2026-03-12', 95], ['2027-07-17', 101]);
    for (let year = 2024; year <= 2028; year++) {
      for (let month = 1; month <= 12; month++) {
        const pricing = priceMonth(
          yearMonth(`${String(year)}-${String(month).padStart(2, '0')}`),
          40,
          timeline,
        );
        const sliced = pricing.slices.reduce((sum, slice) => sum + slice.workingDays, 0);
        expect(sliced).toBe(pricing.workingDays);
        expect(pricing.workingDays).toBeGreaterThanOrEqual(20);
        expect(pricing.workingDays).toBeLessThanOrEqual(23);
        const cost = costOf(0.37, pricing);
        expect(cost.costEur).toBeCloseTo(cost.hours * pricing.blendedRateEur, 9);
      }
    }
  });
});
