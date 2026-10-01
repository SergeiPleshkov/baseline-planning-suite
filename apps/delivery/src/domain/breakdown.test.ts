import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { setAllocation, type AllocationCell } from './allocations';
import { addItem, deleteItem, deletionSummary, moveItem, renameItem } from './breakdown';
import { yearMonth } from './calendar';
import { allocationId, breakdownItemId, employeeId, type BreakdownItemId } from './ids';
import { allocationsOn, cellKey, childrenOf, type Plan } from './plan';
import { ledger, portal, testPlan } from './plan.fixtures';
import type { Result } from './result';

const id = breakdownItemId;
const totalPersonMonths = (plan: Plan) =>
  [...plan.allocations.values()].reduce((sum, each) => sum + each.personMonths, 0);
const amounts = (plan: Plan) =>
  new Map([...plan.allocations.values()].map((each) => [cellKey(each), each.personMonths]));

function value<T>(result: Result<T, string>): T {
  if (!result.ok) throw new Error(`expected success, got ${result.error}`);
  return result.value;
}

describe('addItem', () => {
  it('adds an item under a parent and trims its name', () => {
    const { plan } = value(
      addItem(testPlan(), {
        id: id('qa'),
        projectId: ledger,
        parentId: id('discovery'),
        name: ' QA ',
      }),
    );
    expect(plan.items.get(id('qa'))).toEqual({
      id: 'qa',
      projectId: 'ledger',
      parentId: 'discovery',
      name: 'QA',
    });
  });

  it("moves a leaf's allocations onto its first child instead of losing them", () => {
    const before = testPlan();
    const { plan, movedAllocations } = value(
      addItem(before, {
        id: id('dry-run'),
        projectId: ledger,
        parentId: id('cutover'),
        name: 'Dry run',
      }),
    );
    expect(movedAllocations).toBe(1);
    expect(allocationsOn(plan, id('cutover'))).toEqual([]);
    expect(allocationsOn(plan, id('dry-run')).map((each) => each.id)).toEqual(['alloc-cutover']);
    expect(totalPersonMonths(plan)).toBe(totalPersonMonths(before));
  });

  it.each([
    ['too-deep', { id: id('x'), projectId: ledger, parentId: id('design'), name: 'x' }],
    ['unknown-parent', { id: id('x'), projectId: ledger, parentId: id('nowhere'), name: 'x' }],
    [
      'parent-in-other-project',
      { id: id('x'), projectId: portal, parentId: id('discovery'), name: 'x' },
    ],
    ['duplicate-id', { id: id('design'), projectId: ledger, parentId: null, name: 'x' }],
    ['blank-name', { id: id('x'), projectId: ledger, parentId: null, name: '  ' }],
  ] as const)('refuses with %s', (error, input) => {
    expect(addItem(testPlan(), input)).toEqual({ ok: false, error });
  });
});

describe('renameItem', () => {
  it('trims the new name, leaves an unchanged name alone and refuses a blank one', () => {
    const plan = testPlan();
    expect(value(renameItem(plan, id('design'), ' UX ')).items.get(id('design'))?.name).toBe('UX');
    expect(value(renameItem(plan, id('design'), 'design'))).toBe(plan);
    expect(renameItem(plan, id('design'), ' ')).toEqual({ ok: false, error: 'blank-name' });
    expect(renameItem(plan, id('nowhere'), 'x')).toEqual({ ok: false, error: 'unknown-item' });
  });
});

describe('moveItem', () => {
  it('moves an item with its subtree, or to the top level', () => {
    expect(
      value(moveItem(testPlan(), id('review'), id('docs'))).items.get(id('review'))?.parentId,
    ).toBe('docs');
    expect(
      value(moveItem(testPlan(), id('discovery'), null)).items.get(id('discovery'))?.parentId,
    ).toBe(null);
  });

  it.each([
    ['into-own-subtree', 'migration', 'design'],
    ['too-deep', 'discovery', 'docs'],
    ['parent-in-other-project', 'review', 'shell'],
    ['parent-has-allocations', 'review', 'cutover'],
    ['unknown-parent', 'review', 'nowhere'],
    ['unknown-item', 'nowhere', 'docs'],
  ] as const)('refuses with %s', (error, moved, parent) => {
    expect(moveItem(testPlan(), id(moved), id(parent))).toEqual({ ok: false, error });
  });
});

describe('deleteItem', () => {
  it('removes exactly what the user confirmed: the subtree and its allocations', () => {
    const before = testPlan();
    const summary = value(deletionSummary(before, id('migration')));
    expect(summary).toEqual({
      root: 'migration',
      items: ['migration', 'discovery', 'design', 'review'],
      allocations: ['alloc-050'],
      personMonths: 0.59,
    });
    const plan = value(deleteItem(before, summary));
    expect([...plan.items.keys()]).not.toContain('design');
    expect([...plan.allocations.keys()]).not.toContain('alloc-050');
  });

  it('deletes nothing when the subtree changed after the user confirmed', () => {
    const shown = testPlan();
    const summary = value(deletionSummary(shown, id('migration')));
    const meanwhile = value(
      setAllocation(
        shown,
        { breakdownItemId: id('review'), employeeId: employeeId('e'), month: yearMonth('2026-07') },
        0.5,
        allocationId('meanwhile'),
      ),
    );
    expect(deleteItem(meanwhile, summary)).toEqual({
      ok: false,
      error: 'changed-since-confirmation',
    });
  });

  it('turns a parent whose last child goes back into a leaf that can hold allocations', () => {
    const plan = value(deleteItem(testPlan(), value(deletionSummary(testPlan(), id('build')))));
    expect(childrenOf(plan, id('shell'))).toEqual([]);
    const cell = {
      breakdownItemId: id('shell'),
      employeeId: employeeId('e'),
      month: yearMonth('2026-07'),
    };
    expect(setAllocation(plan, cell, 0.5, allocationId('new')).ok).toBe(true);
  });
});

type Command =
  | { kind: 'add'; parent: number | null; project: 0 | 1; name: string }
  | { kind: 'move'; target: number; parent: number | null }
  | { kind: 'rename'; target: number; name: string }
  | { kind: 'delete'; target: number }
  | { kind: 'allocate'; target: number; employee: string; month: string; amount: number };

const anyCommand: fc.Arbitrary<Command> = fc.oneof(
  fc.record({
    kind: fc.constant('add' as const),
    parent: fc.option(fc.nat()),
    project: fc.constantFrom(0 as const, 1 as const),
    name: fc.constantFrom('Build', ' ', 'QA'),
  }),
  fc.record({ kind: fc.constant('move' as const), target: fc.nat(), parent: fc.option(fc.nat()) }),
  fc.record({
    kind: fc.constant('rename' as const),
    target: fc.nat(),
    name: fc.constantFrom('x', ''),
  }),
  fc.record({ kind: fc.constant('delete' as const), target: fc.nat() }),
  fc.record({
    kind: fc.constant('allocate' as const),
    target: fc.nat(),
    employee: fc.constantFrom('e1', 'e2', 'emp-003'),
    month: fc.constantFrom('2026-03', '2026-06', '2027-03'),
    amount: fc.constantFrom(0, 0.25, 0.5, 1.2),
  }),
);

describe('plan commands', () => {
  // Every command rebuilds the plan through createPlan, so an invariant broken by a command throws.
  it('keep the plan valid, touch only what they target and never drop allocations silently', () => {
    fc.assert(
      fc.property(fc.array(anyCommand, { maxLength: 40 }), (commands) => {
        let plan = testPlan();
        commands.forEach((command, step) => {
          const ids = [...plan.items.keys()];
          const pick = (n: number): BreakdownItemId => ids[n % ids.length] ?? id('none');
          const before = amounts(plan);
          switch (command.kind) {
            case 'add': {
              const result = addItem(plan, {
                id: id(`new-${String(step)}`),
                projectId: command.project === 0 ? ledger : portal,
                parentId: command.parent === null ? null : pick(command.parent),
                name: command.name,
              });
              if (result.ok) plan = result.value.plan;
              expect(totalPersonMonths(plan)).toBe(sumOf(before));
              break;
            }
            case 'move':
            case 'rename': {
              const result =
                command.kind === 'move'
                  ? moveItem(
                      plan,
                      pick(command.target),
                      command.parent === null ? null : pick(command.parent),
                    )
                  : renameItem(plan, pick(command.target), command.name);
              if (result.ok) plan = result.value;
              expect(amounts(plan)).toEqual(before);
              break;
            }
            case 'delete': {
              const summary = deletionSummary(plan, pick(command.target));
              if (!summary.ok) break;
              plan = value(deleteItem(plan, summary.value));
              expect(plan.allocations.size).toBe(before.size - summary.value.allocations.length);
              expect(totalPersonMonths(plan)).toBeCloseTo(
                sumOf(before) - summary.value.personMonths,
                9,
              );
              break;
            }
            case 'allocate': {
              const cell: AllocationCell = {
                breakdownItemId: pick(command.target),
                employeeId: employeeId(command.employee),
                month: yearMonth(command.month),
              };
              const result = setAllocation(
                plan,
                cell,
                command.amount,
                allocationId(`new-${String(step)}`),
              );
              if (!result.ok) break;
              plan = result.value;
              const expected = new Map(before);
              if (command.amount === 0) expected.delete(cellKey(cell));
              else expected.set(cellKey(cell), command.amount);
              expect(amounts(plan)).toEqual(expected);
              break;
            }
          }
        });
      }),
    );
  });
});

function sumOf(amountsByCell: ReadonlyMap<string, number>): number {
  return [...amountsByCell.values()].reduce((sum, amount) => sum + amount, 0);
}
