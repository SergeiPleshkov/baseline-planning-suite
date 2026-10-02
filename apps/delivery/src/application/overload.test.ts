import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { setAllocation } from '../domain/allocations';
import { yearMonth } from '../domain/calendar';
import { workload } from '../domain/capacity';
import { allocationId, breakdownItemId, employeeId, projectId } from '../domain/ids';
import { createPlan } from '../domain/plan';
import { allocation, items, projects, testPlan } from '../domain/plan.fixtures';
import { cellInProject, contributionsOf, overloads } from './overload';

describe('contributionsOf', () => {
  it('lists what adds up to a person-month, in every project, newest edit first', () => {
    const contributions = contributionsOf(testPlan(), employeeId('emp-003'), yearMonth('2026-06'));
    expect(
      contributions.map((each) => [
        each.allocation.id,
        each.project.id,
        each.path,
        each.isLatestEdit,
      ]),
    ).toEqual([
      ['alloc-073', 'portal', 'shell › build', true],
      ['alloc-050', 'ledger', 'migration › discovery › design', false],
    ]);
  });

  it('is empty for a month without allocations', () => {
    expect(contributionsOf(testPlan(), employeeId('emp-003'), yearMonth('2026-07'))).toEqual([]);
    expect(contributionsOf(testPlan(), employeeId('nobody'), yearMonth('2026-06'))).toEqual([]);
  });
});

describe('overloads', () => {
  it('finds the person-months above capacity and none that are within it', () => {
    expect(overloads(testPlan())).toMatchObject([
      { employeeId: 'emp-003', month: '2026-06', personMonths: 1.18 },
    ]);
  });

  it('follows an edit: the allocation changed last takes the blame', () => {
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
    if (!edited.ok) throw new Error('edit refused');
    const [entry] = overloads(edited.value);
    expect(entry?.contributions.map((each) => [each.allocation.id, each.isLatestEdit])).toEqual([
      ['alloc-050', true],
      ['alloc-073', false],
    ]);
  });

  it('disappears when the load comes back within capacity', () => {
    const lowered = setAllocation(
      testPlan(),
      {
        breakdownItemId: breakdownItemId('design'),
        employeeId: employeeId('emp-003'),
        month: yearMonth('2026-06'),
      },
      0.4,
      allocationId('unused'),
    );
    if (!lowered.ok) throw new Error('edit refused');
    expect(overloads(lowered.value)).toEqual([]);
  });

  it('agrees with the capacity check on who is to blame, for any plan', () => {
    const cell = fc.record({
      item: fc.constantFrom('design', 'review', 'docs', 'cutover', 'build'),
      employee: fc.constantFrom('e1', 'e2', 'e3'),
      month: fc.constantFrom('2026-06', '2026-07', '2026-08'),
      tenths: fc.integer({ min: 1, max: 12 }),
    });
    fc.assert(
      fc.property(
        fc.uniqueArray(cell, {
          selector: (c) => `${c.item}|${c.employee}|${c.month}`,
          maxLength: 30,
        }),
        (drawn) => {
          const plan = createPlan({
            projects,
            items,
            allocations: drawn.map((c, index) =>
              allocation(
                `a-${String(index)}`,
                c.item,
                c.employee,
                c.month,
                c.tenths / 10,
                index + 1,
              ),
            ),
          });
          const found = overloads(plan);
          for (const entry of found) {
            const load = workload(plan).get(entry.employeeId)?.get(entry.month);
            expect(load?.status === 'over' && load.cause).toBe(
              entry.contributions[0]?.allocation.id,
            );
            expect(entry.contributions.filter((each) => each.isLatestEdit)).toHaveLength(1);
          }
          const overCount = [...workload(plan).values()].reduce(
            (sum, months) => sum + [...months.values()].filter((l) => l.status === 'over').length,
            0,
          );
          expect(found).toHaveLength(overCount);
        },
      ),
    );
  });
});

describe('cellInProject', () => {
  const [entry] = overloads(testPlan());
  if (!entry) throw new Error('fixture without an over-capacity month');

  it('is the allocation edited last when it is in the project', () => {
    expect(cellInProject(entry, projectId('portal'))).toEqual({
      item: 'build',
      employee: 'emp-003',
      month: '2026-06',
    });
  });

  it('is the project’s own allocation when the one edited last is elsewhere', () => {
    expect(cellInProject(entry, projectId('ledger'))).toEqual({
      item: 'design',
      employee: 'emp-003',
      month: '2026-06',
    });
  });

  it('is nothing for a project that has no part in the month', () => {
    expect(cellInProject(entry, projectId('other'))).toBeNull();
  });
});
