import { describe, expect, it } from 'vitest';
import { yearMonth } from './calendar';
import { breakdownItemId, projectId } from './ids';
import {
  createPlan,
  depthOf,
  heightOf,
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
      firstMonth: yearMonth('2027-01'),
      lastMonth: yearMonth('2026-01'),
    };
    expect(() => createPlan({ projects: [backwards], items: [], allocations: [] })).toThrow(
      /ends before it starts/,
    );
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
