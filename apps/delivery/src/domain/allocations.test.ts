import { describe, expect, it } from 'vitest';
import { setAllocation, type AllocationCell } from './allocations';
import { yearMonth } from './calendar';
import { allocationId, breakdownItemId, employeeId } from './ids';
import type { Plan } from './plan';
import { testPlan } from './plan.fixtures';
import type { Result } from './result';

const cell = (on: string, employee: string, month: string): AllocationCell => ({
  breakdownItemId: breakdownItemId(on),
  employeeId: employeeId(employee),
  month: yearMonth(month),
});
const fresh = allocationId('fresh');

function planOf(result: Result<Plan, string>): Plan {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('setAllocation', () => {
  it('creates an allocation under the given id with the next revision', () => {
    const plan = planOf(
      setAllocation(testPlan(), cell('review', 'emp-002', '2026-07'), 0.25, fresh),
    );
    expect(plan.allocations.get(fresh)).toEqual({
      id: 'fresh',
      breakdownItemId: 'review',
      employeeId: 'emp-002',
      month: '2026-07',
      personMonths: 0.25,
      revision: 74,
    });
  });

  it('updates an existing cell in place, keeping its id, as the most recent edit', () => {
    const plan = planOf(
      setAllocation(testPlan(), cell('design', 'emp-003', '2026-06'), 0.6, fresh),
    );
    expect(plan.allocations.get(allocationId('alloc-050'))).toMatchObject({
      personMonths: 0.6,
      revision: 74,
    });
    expect(plan.allocations.has(fresh)).toBe(false);
  });

  it('keeps the same person and month on another item as a separate cell', () => {
    const plan = planOf(
      setAllocation(testPlan(), cell('review', 'emp-003', '2026-06'), 0.2, fresh),
    );
    expect(plan.allocations.get(allocationId('alloc-050'))).toMatchObject({
      breakdownItemId: 'design',
      personMonths: 0.59,
    });
    expect(plan.allocations.get(fresh)).toMatchObject({
      breakdownItemId: 'review',
      personMonths: 0.2,
    });
  });

  it('removes a cell set to zero and ignores changes that change nothing', () => {
    const plan = testPlan();
    const cleared = planOf(setAllocation(plan, cell('design', 'emp-003', '2026-06'), 0, fresh));
    expect(cleared.allocations.has(allocationId('alloc-050'))).toBe(false);
    expect(setAllocation(plan, cell('review', 'emp-002', '2026-07'), 0, fresh)).toEqual({
      ok: true,
      value: plan,
    });
    expect(setAllocation(plan, cell('design', 'emp-003', '2026-06'), 0.59, fresh)).toEqual({
      ok: true,
      value: plan,
    });
  });

  it.each([
    ['invalid-amount', cell('review', 'e', '2026-07'), -0.1, fresh],
    ['invalid-amount', cell('review', 'e', '2026-07'), Number.NaN, fresh],
    ['unknown-item', cell('nowhere', 'e', '2026-07'), 0.5, fresh],
    ['not-a-leaf', cell('discovery', 'e', '2026-07'), 0.5, fresh],
    ['outside-project', cell('review', 'e', '2026-02'), 0.5, fresh],
    ['duplicate-id', cell('review', 'e', '2026-07'), 0.5, allocationId('alloc-073')],
  ] as const)('refuses with %s', (error, target, amount, id) => {
    expect(setAllocation(testPlan(), target, amount, id)).toEqual({ ok: false, error });
  });
});
