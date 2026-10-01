import { workingDaysIn, type IsoDate, type YearMonth } from './calendar';
import { rateOn, type RateTimeline } from './rateTimeline';

/** Consecutive working days priced at the same rate; `null` means no rate existed yet. */
export interface RateSlice {
  readonly firstDay: IsoDate;
  readonly lastDay: IsoDate;
  readonly workingDays: number;
  readonly hourlyRateEur: number | null;
}

/** Everything about one employee-month that does not depend on how much they are allocated. */
export interface MonthPricing {
  readonly month: YearMonth;
  readonly workingDays: number;
  readonly hoursPerPersonMonth: number;
  readonly slices: readonly RateSlice[];
  readonly unpricedWorkingDays: number;
  /** Average hourly rate over the month's working days; unpriced days count as zero. */
  readonly blendedRateEur: number;
}

export interface AllocationCost {
  readonly hours: number;
  readonly hoursPerWorkingDay: number;
  readonly costEur: number;
}

export function priceMonth(
  month: YearMonth,
  weeklyHours: number,
  rates: RateTimeline,
): MonthPricing {
  const days = workingDaysIn(month);
  const slices: RateSlice[] = [];
  for (const day of days) {
    const hourlyRateEur = rateOn(rates, day);
    const current = slices.at(-1);
    if (current?.hourlyRateEur === hourlyRateEur) {
      slices[slices.length - 1] = {
        ...current,
        lastDay: day,
        workingDays: current.workingDays + 1,
      };
    } else {
      slices.push({ firstDay: day, lastDay: day, workingDays: 1, hourlyRateEur });
    }
  }

  const pricedDayRates = slices.reduce(
    (sum, slice) => sum + slice.workingDays * (slice.hourlyRateEur ?? 0),
    0,
  );
  return {
    month,
    workingDays: days.length,
    hoursPerPersonMonth: (weeklyHours * days.length) / 5,
    slices,
    unpricedWorkingDays: slices
      .filter((slice) => slice.hourlyRateEur === null)
      .reduce((sum, slice) => sum + slice.workingDays, 0),
    blendedRateEur: pricedDayRates / days.length,
  };
}

/** Effort is spread evenly over the working days; each slice is priced at its own rate. */
export function costOf(personMonths: number, pricing: MonthPricing): AllocationCost {
  const hours = personMonths * pricing.hoursPerPersonMonth;
  const hoursPerWorkingDay = hours / pricing.workingDays;
  const costEur = pricing.slices.reduce(
    (sum, slice) => sum + slice.workingDays * hoursPerWorkingDay * (slice.hourlyRateEur ?? 0),
    0,
  );
  return { hours, hoursPerWorkingDay, costEur };
}
