import type { IsoDate, YearMonth } from '../domain/calendar';
import { workload } from '../domain/capacity';
import type { BreakdownItemId, EmployeeId } from '../domain/ids';
import type { Plan } from '../domain/plan';
import { priceMonth } from '../domain/pricing';
import { rateTimeline, type RateTimeline } from '../domain/rateTimeline';
import { err, ok, type Result } from '../domain/result';
import type { StaffMember } from '../infrastructure/peopleContract';
import { DISPLAY_DECIMALS, capacityPercentSteps, roundedColumn } from './figures';
import { contributionsOf, type Contribution } from './overload';

export interface CalculationInput {
  readonly plan: Plan;
  readonly item: BreakdownItemId;
  readonly employee: EmployeeId;
  readonly month: YearMonth;
  readonly staff: ReadonlyMap<EmployeeId, StaffMember> | null;
  readonly rates: ReadonlyMap<EmployeeId, RateTimeline> | null;
  /** Display currency per EUR. */
  readonly currencyPerEur: number;
}

interface SliceCalculation {
  readonly firstDay: IsoDate;
  readonly lastDay: IsoDate;
  readonly workingDays: number;
  /** `null`: the person had no rate yet, so these days cost nothing. */
  readonly hourlyRateEur: number | null;
  /** Shown figures, in display steps (see `DISPLAY_DECIMALS`); null without an allocation. */
  readonly hoursSteps: number | null;
  readonly costSteps: number | null;
}

interface ContributionFigure extends Contribution {
  readonly personMonthsSteps: number;
}

/** How one person-month is worked out, as figure 4 of the case study lays it out. */
export interface CellCalculation {
  readonly employee: StaffMember;
  readonly month: YearMonth;
  readonly workingDays: number;
  readonly hoursPerPersonMonth: number;
  /** Average hourly rate over the month's working days, unpriced days counting as zero. */
  readonly blendedRateEur: number;
  readonly unpricedWorkingDays: number;
  readonly slices: readonly SliceCalculation[];
  readonly allocation: {
    readonly personMonths: number;
    readonly hoursPerWorkingDay: number;
    readonly capacityPercentSteps: number;
    readonly totalHoursSteps: number;
    readonly totalCostSteps: number;
  } | null;
  /** The person's load in the month from every project, which is what capacity is checked on. */
  readonly load: {
    readonly over: boolean;
    readonly totalPersonMonthsSteps: number;
    readonly totalCapacityPercentSteps: number;
    readonly contributions: readonly ContributionFigure[];
  };
}

export type CalculationError = 'people-unavailable' | 'rates-unavailable' | 'unknown-person';

export function explainCell(input: CalculationInput): Result<CellCalculation, CalculationError> {
  const { plan, item, employee, month, staff, rates, currencyPerEur } = input;
  if (staff === null) return err('people-unavailable');
  if (rates === null) return err('rates-unavailable');
  const person = staff.get(employee);
  if (!person) return err('unknown-person');

  const pricing = priceMonth(month, person.weeklyHours, rates.get(employee) ?? rateTimeline([]));
  const contributions = contributionsOf(plan, employee, month);
  const own = [...plan.allocations.values()].find(
    (each) => each.breakdownItemId === item && each.employeeId === employee && each.month === month,
  );

  const hoursPerWorkingDay = own
    ? (own.personMonths * pricing.hoursPerPersonMonth) / pricing.workingDays
    : null;
  const exactHours = pricing.slices.map((slice) =>
    hoursPerWorkingDay === null ? 0 : slice.workingDays * hoursPerWorkingDay,
  );
  const exactCost = pricing.slices.map((slice, index) => {
    const hours = exactHours[index] ?? 0;
    return hours * (slice.hourlyRateEur ?? 0) * currencyPerEur;
  });
  const hours = roundedColumn(exactHours, DISPLAY_DECIMALS.hours);
  const cost = roundedColumn(exactCost, DISPLAY_DECIMALS.cost);

  const shares = roundedColumn(
    contributions.map((each) => each.allocation.personMonths),
    DISPLAY_DECIMALS.personMonths,
  );
  const totalLoad = contributions.reduce((sum, each) => sum + each.allocation.personMonths, 0);
  const loadPercent = capacityPercentSteps(totalLoad);

  return ok({
    employee: person,
    month,
    workingDays: pricing.workingDays,
    hoursPerPersonMonth: pricing.hoursPerPersonMonth,
    blendedRateEur: pricing.blendedRateEur,
    unpricedWorkingDays: pricing.unpricedWorkingDays,
    slices: pricing.slices.map((slice, index) => ({
      firstDay: slice.firstDay,
      lastDay: slice.lastDay,
      workingDays: slice.workingDays,
      hourlyRateEur: slice.hourlyRateEur,
      hoursSteps: own ? (hours.parts[index] ?? 0) : null,
      costSteps: own ? (cost.parts[index] ?? 0) : null,
    })),
    allocation:
      own && hoursPerWorkingDay !== null
        ? {
            personMonths: own.personMonths,
            hoursPerWorkingDay,
            capacityPercentSteps: capacityPercentSteps(own.personMonths),
            totalHoursSteps: hours.total,
            totalCostSteps: cost.total,
          }
        : null,
    load: {
      over: workload(plan).get(employee)?.get(month)?.status === 'over',
      totalPersonMonthsSteps: shares.total,
      totalCapacityPercentSteps: loadPercent,
      contributions: contributions.map((each, index) => ({
        ...each,
        personMonthsSteps: shares.parts[index] ?? 0,
      })),
    },
  });
}
