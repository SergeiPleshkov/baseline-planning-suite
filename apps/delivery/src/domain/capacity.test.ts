import { describe, expect, it } from 'vitest';
import { setAllocation } from './allocations';
import { yearMonth } from './calendar';
import { workload } from './capacity';
import { allocationId, breakdownItemId, employeeId } from './ids';
import { createPlan, type Allocation, type Plan } from './plan';
import { allocation, items, projects, testPlan } from './plan.fixtures';

const loadOf = (plan: Plan, employee: string, month: string) =>
  workload(plan).get(employeeId(employee))?.get(yearMonth(month));

const planWith = (allocations: Allocation[]) => createPlan({ projects, items, allocations });

describe('workload sums', () => {
  it('give the same figure whatever order the allocations are stored in', () => {
    const parts = [
      allocation('a', 'design', 'e', '2026-06', 0.1, 1),
      allocation('b', 'review', 'e', '2026-06', 0.2, 2),
      allocation('c', 'build', 'e', '2026-06', 0.3, 3),
    ];
    // In doubles 0.1 + 0.2 + 0.3 is 0.6000000000000001, but 0.3 + 0.2 + 0.1 is 0.6.
    const loads = [parts, [...parts].reverse(), [parts[1], parts[2], parts[0]]].map(
      (order) => loadOf(planWith(order as Allocation[]), 'e', '2026-06')?.personMonths,
    );
    expect(new Set(loads).size).toBe(1);
  });
});

describe('workload', () => {
  it('sums a person-month across projects and names the latest edit as the cause', () => {
    // M. Brandt, June 2026: 0.59 on Ledger (alloc-050) and 0.59 on Portal (alloc-073).
    expect(loadOf(testPlan(), 'emp-003', '2026-06')).toEqual({
      status: 'over',
      personMonths: 1.18,
      cause: 'alloc-073',
    });
  });

  it('moves the blame to whichever contributing allocation was edited last', () => {
    const edited = setAllocation(
      testPlan(),
      {
        breakdownItemId: breakdownItemId('design'),
        employeeId: employeeId('emp-003'),
        month: yearMonth('2026-06'),
      },
      0.6,
      allocationId('unused'),
    );
    if (!edited.ok) throw new Error(edited.error);
    expect(loadOf(edited.value, 'emp-003', '2026-06')).toMatchObject({
      status: 'over',
      cause: 'alloc-050',
    });
  });

  it('treats exactly one person-month, including float noise around it, as within capacity', () => {
    // In doubles, 0.33 + 0.56 + 0.11 is 1.0000000000000002.
    const exactlyOne = [
      allocation('a', 'design', 'e', '2026-06', 0.33, 1),
      allocation('b', 'review', 'e', '2026-06', 0.56, 2),
      allocation('c', 'build', 'e', '2026-06', 0.11, 3),
    ];
    expect(loadOf(planWith(exactlyOne), 'e', '2026-06')?.status).toBe('within');
    const justOver = [...exactlyOne, allocation('d', 'docs', 'e', '2026-06', 0.01, 4)];
    expect(loadOf(planWith(justOver), 'e', '2026-06')).toMatchObject({
      status: 'over',
      cause: 'd',
    });
  });

  it('flags a single allocation above one person-month on its own', () => {
    const plan = planWith([allocation('a', 'design', 'e', '2026-06', 1.2, 1)]);
    expect(loadOf(plan, 'e', '2026-06')).toEqual({ status: 'over', personMonths: 1.2, cause: 'a' });
  });

  it('keeps people and months apart', () => {
    const plan = planWith([
      allocation('a', 'design', 'e1', '2026-06', 0.8, 1),
      allocation('b', 'review', 'e1', '2026-07', 0.8, 2),
      allocation('c', 'build', 'e2', '2026-06', 0.8, 3),
    ]);
    expect(
      [...workload(plan).values()].flatMap((months) => [...months.values()].map((m) => m.status)),
    ).toEqual(['within', 'within', 'within']);
  });
});
