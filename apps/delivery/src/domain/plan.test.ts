import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addMonths, isoDate, yearMonth, type IsoDate, type YearMonth } from './calendar';
import { breakdownItemId, projectId } from './ids';
import {
  createPlan,
  depthOf,
  heightOf,
  isProjectMonth,
  projectMonths,
  subtreeOf,
  type Allocation,
  type BreakdownItem,
  type Project,
} from './plan';
import {
  allocation,
  allocations,
  item,
  items,
  ledger,
  portal,
  projects,
  testPlan,
} from './plan.fixtures';

describe('createPlan', () => {
  it('accepts a valid plan and continues revisions after the highest one', () => {
    const plan = testPlan();
    expect(plan.lastRevision).toBe(73);
    expect(depthOf(plan, breakdownItemId('design'))).toBe(3);
    expect(heightOf(plan, breakdownItemId('migration'))).toBe(3);
    expect(subtreeOf(plan, breakdownItemId('migration'))).toEqual([
      'migration',
      'discovery',
      'design',
      'review',
    ]);
  });

  const extraAllocation = (extra: Allocation) => ({ allocations: [...allocations, extra] });
  const variants: [RegExp, { items?: BreakdownItem[]; allocations?: Allocation[] }][] = [
    [/deeper than 3 levels/, { items: [...items, item('too-deep', ledger, 'review')] }],
    [/parent in another project/, { items: [...items, item('stray', portal, 'migration')] }],
    [/unknown parent/, { items: [...items, item('orphan', ledger, 'nowhere')] }],
    [/unknown project/, { items: [...items, item('lost', projectId('nowhere'), null)] }],
    [/blank name/, { items: [...items, { ...item('nameless', ledger, null), name: ' ' }] }],
    [/Duplicate breakdown item/, { items: [...items, item('design', ledger, null)] }],
    [
      /cycle/,
      {
        items: [
          ...items.filter((each) => each.id !== 'migration'),
          item('migration', ledger, 'design'),
        ],
      },
    ],
    [/not on a leaf/, extraAllocation(allocation('a', 'discovery', 'e', '2026-06', 0.1, 99))],
    [
      /unknown breakdown item/,
      extraAllocation(allocation('a', 'nowhere', 'e', '2026-06', 0.1, 99)),
    ],
    [
      /outside its project's months/,
      extraAllocation(allocation('a', 'design', 'e', '2026-02', 0.1, 99)),
    ],
    [
      /second allocation for one cell/,
      extraAllocation(allocation('a', 'design', 'emp-003', '2026-06', 0.1, 99)),
    ],
    [
      /unique positive integer/,
      extraAllocation(allocation('a', 'review', 'e', '2026-06', 0.1, 50)),
    ],
    [
      /unique positive integer/,
      extraAllocation(allocation('a', 'review', 'e', '2026-06', 0.1, 1.5)),
    ],
    [/amount must be positive/, extraAllocation(allocation('a', 'review', 'e', '2026-06', 0, 99))],
    [
      /amount must be positive/,
      extraAllocation(allocation('a', 'review', 'e', '2026-06', Number.NaN, 99)),
    ],
    [
      /Duplicate allocation/,
      extraAllocation(allocation('alloc-050', 'review', 'e', '2026-06', 0.1, 99)),
    ],
  ];
  it.each(variants)('rejects a plan with %s', (message, overrides) => {
    expect(() => createPlan({ projects, items, allocations, ...overrides })).toThrow(message);
  });

  it('rejects a project that ends before it starts', () => {
    const backwards: Project = {
      id: ledger,
      name: 'Ledger',
      startDate: isoDate('2027-01-01'),
      endDate: isoDate('2026-12-31'),
    };
    expect(() => createPlan({ projects: [backwards], items: [], allocations: [] })).toThrow(
      /ends before it starts/,
    );
  });

  it('plans exactly the months that share at least one day with the project', () => {
    const dayOf = (offset: number): IsoDate =>
      isoDate(new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10));
    const daysOf = (month: YearMonth): IsoDate[] => {
      const days: IsoDate[] = [];
      for (let day = 1; ; day += 1) {
        const date = new Date(`${month}-01T00:00:00Z`);
        date.setUTCDate(day);
        if (date.toISOString().slice(0, 7) !== month) return days;
        days.push(isoDate(date.toISOString().slice(0, 10)));
      }
    };
    const day = fc.integer({ min: 0, max: 800 }).map(dayOf);
    fc.assert(
      fc.property(day, day, fc.integer({ min: 0, max: 30 }), (a, b, shift) => {
        const [startDate, endDate] = a <= b ? [a, b] : [b, a];
        const project: Project = { id: ledger, name: 'Ledger', startDate, endDate };
        const month = addMonths(yearMonth('2025-12'), shift);
        const sharesADay = daysOf(month).some((date) => date >= startDate && date <= endDate);
        expect(isProjectMonth(project, month)).toBe(sharesADay);
      }),
    );
  });

  it('plans every month a project runs on at least one day, its first and last month included', () => {
    const midMonth: Project = {
      id: ledger,
      name: 'Ledger',
      startDate: isoDate('2026-03-12'),
      endDate: isoDate('2026-05-03'),
    };
    expect(projectMonths(midMonth)).toEqual({ first: '2026-03', last: '2026-05' });
    expect(
      ['2026-02', '2026-03', '2026-05', '2026-06'].map((month) =>
        isProjectMonth(midMonth, yearMonth(month)),
      ),
    ).toEqual([false, true, true, false]);
    const plan = createPlan({
      projects: [midMonth],
      items: [item('a', ledger, null)],
      allocations: [allocation('x', 'a', 'emp-001', '2026-03', 0.5, 1)],
    });
    expect(plan.allocations.size).toBe(1);
  });

  it('tells cells apart whatever characters their ids contain', () => {
    const plan = createPlan({
      projects,
      items: [item('a|b', ledger, null), item('a', ledger, null)],
      allocations: [
        allocation('one', 'a|b', 'c', '2026-06', 0.1, 1),
        allocation('two', 'a', 'b|c', '2026-06', 0.1, 2),
      ],
    });
    expect(plan.allocations.size).toBe(2);
  });
});
