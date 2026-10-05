import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isoDate, yearMonth } from '../domain/calendar';
import { breakdownItemId, employeeId, type EmployeeId } from '../domain/ids';
import { createPlan } from '../domain/plan';
import { allocation, items, projects, testPlan } from '../domain/plan.fixtures';
import { rateTimeline, type RateTimeline } from '../domain/rateTimeline';
import type { StaffMember } from './peopleContract';
import { explainCell, type CalculationInput, type CellCalculation } from './calculation';

const okafor = employeeId('emp-001');
const staff = new Map<EmployeeId, StaffMember>([
  [okafor, { id: okafor, name: 'Adaeze Okafor', weeklyHours: 40 }],
  [employeeId('emp-003'), { id: employeeId('emp-003'), name: 'Mira Brandt', weeklyHours: 20 }],
]);
const timeline = (...changes: [string, number][]): RateTimeline =>
  rateTimeline(
    changes.map(([effectiveFrom, hourlyRateEur]) => ({
      effectiveFrom: isoDate(effectiveFrom),
      hourlyRateEur,
    })),
  );
const rates = new Map<EmployeeId, RateTimeline>([
  [okafor, timeline(['2025-01-01', 80], ['2026-03-12', 95])],
]);

const referencePlan = createPlan({
  projects,
  items,
  allocations: [allocation('alloc-001', 'cutover', 'emp-001', '2026-03', 0.5, 1)],
});

const input = (overrides: Partial<CalculationInput> = {}): CalculationInput => ({
  plan: referencePlan,
  item: breakdownItemId('cutover'),
  employee: okafor,
  month: yearMonth('2026-03'),
  staff,
  rates,
  currencyPerEur: 1,
  ...overrides,
});

function calculation(overrides: Partial<CalculationInput> = {}): CellCalculation {
  const result = explainCell(input(overrides));
  if (!result.ok) throw new Error(`expected a calculation, got ${result.error}`);
  return result.value;
}

describe('the reference calculation (case study, figure 4)', () => {
  const figure = calculation();

  it('splits March 2026 into 8 working days at €80 and 14 at €95', () => {
    expect(figure.workingDays).toBe(22);
    expect(
      figure.slices.map((slice) => [
        slice.firstDay,
        slice.lastDay,
        slice.workingDays,
        slice.hourlyRateEur,
      ]),
    ).toEqual([
      ['2026-03-02', '2026-03-11', 8, 80],
      ['2026-03-12', '2026-03-31', 14, 95],
    ]);
  });

  it('works out 176 h a person-month, 88 h for 0.50, 4 h a day, at a blended €89.5455', () => {
    expect(figure.hoursPerPersonMonth).toBe(176);
    expect(figure.allocation?.personMonths).toBe(0.5);
    expect(figure.allocation?.hoursPerWorkingDay).toBe(4);
    expect(figure.allocation?.totalHoursSteps).toBe(8800);
    expect(figure.blendedRateEur).toBeCloseTo(89.5455, 4);
  });

  it('costs €2,560.00 and €5,320.00 for the slices and €7,880.00 in all, at 50.0 % of capacity', () => {
    expect(figure.slices.map((slice) => slice.costSteps)).toEqual([256000, 532000]);
    expect(figure.slices.map((slice) => slice.hoursSteps)).toEqual([3200, 5600]);
    expect(figure.allocation?.totalCostSteps).toBe(788000);
    expect(figure.allocation?.capacityPercentSteps).toBe(500);
  });

  it('shows the load of the month as that one contribution, within capacity', () => {
    expect(figure.load.over).toBe(false);
    expect(figure.load.totalPersonMonthsSteps).toBe(50);
    expect(
      figure.load.contributions.map((each) => [each.allocation.id, each.personMonthsSteps]),
    ).toEqual([['alloc-001', 50]]);
  });
});

describe('explainCell', () => {
  it('prices in the display currency', () => {
    expect(calculation({ currencyPerEur: 1.17 }).allocation?.totalCostSteps).toBe(921960);
  });

  it('shows the month’s pricing, and no figures, for a cell without an allocation', () => {
    const figure = calculation({ month: yearMonth('2026-04') });
    expect(figure.allocation).toBeNull();
    expect(figure.slices).toHaveLength(1);
    expect(figure.slices[0]).toMatchObject({
      workingDays: 22,
      hourlyRateEur: 95,
      hoursSteps: null,
    });
    expect(figure.blendedRateEur).toBe(95);
    expect(figure.load.contributions).toEqual([]);
  });

  it('counts the days without a rate and prices them at nothing', () => {
    const figure = calculation({ rates: new Map([[okafor, timeline(['2026-03-12', 95])]]) });
    expect(figure.unpricedWorkingDays).toBe(8);
    expect(figure.slices[0]).toMatchObject({ hourlyRateEur: null, costSteps: 0 });
    expect(figure.allocation?.totalCostSteps).toBe(532000);
  });

  it('shows what makes up an over-capacity month, newest edit first, across projects', () => {
    const figure = calculation({
      plan: testPlan(),
      item: breakdownItemId('design'),
      employee: employeeId('emp-003'),
      month: yearMonth('2026-06'),
    });
    expect(figure.load.over).toBe(true);
    expect(figure.load.totalPersonMonthsSteps).toBe(118);
    expect(figure.load.totalCapacityPercentSteps).toBe(1180);
    expect(
      figure.load.contributions.map((each) => [
        each.allocation.id,
        each.project.id,
        each.personMonthsSteps,
        each.isLatestEdit,
      ]),
    ).toEqual([
      ['alloc-073', 'portal', 59, true],
      ['alloc-050', 'ledger', 59, false],
    ]);
  });

  it('takes the amount of the cell it is asked about, not of another cell of that month', () => {
    const plan = createPlan({
      projects,
      items,
      allocations: [
        allocation('a1', 'design', 'emp-003', '2026-06', 0.4, 1),
        allocation('a2', 'build', 'emp-003', '2026-06', 0.7, 2),
      ],
    });
    const figure = calculation({
      plan,
      item: breakdownItemId('build'),
      employee: employeeId('emp-003'),
      month: yearMonth('2026-06'),
    });
    expect(figure.allocation?.personMonths).toBe(0.7);
    expect(figure.allocation?.capacityPercentSteps).toBe(700);
    expect(figure.load.totalCapacityPercentSteps).toBe(1100);
    expect(figure.load.over).toBe(true);
  });

  it('says why it cannot, when People is unavailable or does not know the person', () => {
    expect(explainCell(input({ staff: null }))).toEqual({ ok: false, error: 'people-unavailable' });
    expect(explainCell(input({ rates: null }))).toEqual({ ok: false, error: 'rates-unavailable' });
    expect(explainCell(input({ employee: employeeId('emp-099') }))).toEqual({
      ok: false,
      error: 'unknown-person',
    });
  });

  it('shows parts that add up to the total, whatever the rates, amount and currency', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3000 }),
        fc.array(fc.integer({ min: 1, max: 1500 }), { maxLength: 3 }),
        fc.double({ min: 0.5, max: 2, noNaN: true }),
        fc.uniqueArray(
          fc.record({
            offset: fc.integer({ min: -20, max: 30 }),
            rate: fc.integer({ min: 500, max: 20000 }).map((cents) => cents / 100),
          }),
          { selector: (change) => change.offset, minLength: 1, maxLength: 4 },
        ),
        (thousandths, alsoThousandths, currencyPerEur, changes) => {
          const plan = createPlan({
            projects,
            items,
            allocations: [
              allocation('a', 'cutover', 'emp-001', '2026-03', thousandths / 1000, 1),
              ...['review', 'design', 'docs']
                .slice(0, alsoThousandths.length)
                .map((item, index) =>
                  allocation(
                    `b-${String(index)}`,
                    item,
                    'emp-001',
                    '2026-03',
                    (alsoThousandths[index] ?? 1) / 1000,
                    index + 2,
                  ),
                ),
            ],
          });
          const own = rateTimeline(
            changes.map(({ offset, rate }) => ({
              effectiveFrom: isoDate(
                new Date(Date.UTC(2026, 2, 1 + offset)).toISOString().slice(0, 10),
              ),
              hourlyRateEur: rate,
            })),
          );
          const figure = calculation({ plan, currencyPerEur, rates: new Map([[okafor, own]]) });
          const sum = (values: readonly (number | null)[]) =>
            values.reduce<number>((total, value) => total + (value ?? 0), 0);
          expect(sum(figure.slices.map((slice) => slice.costSteps))).toBe(
            figure.allocation?.totalCostSteps,
          );
          expect(sum(figure.slices.map((slice) => slice.hoursSteps))).toBe(
            figure.allocation?.totalHoursSteps,
          );
          expect(sum(figure.load.contributions.map((each) => each.personMonthsSteps))).toBe(
            figure.load.totalPersonMonthsSteps,
          );
        },
      ),
    );
  });
});
