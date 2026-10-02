import { describe, expect, it } from 'vitest';
import { breakdownItemId } from '../domain/ids';
import { ledger, portal, testPlan } from '../domain/plan.fixtures';
import { moveItem } from '../domain/breakdown';
import type { Result } from '../domain/result';
import {
  canHaveChildren,
  expandPathTo,
  isAncestor,
  moveTargets,
  nextTreeAction,
  pathOf,
  treeRows,
} from './treeView';

const id = breakdownItemId;

function value<T>(result: Result<T, string>): T {
  if (!result.ok) throw new Error(`expected success, got ${result.error}`);
  return result.value;
}
const none = new Set<ReturnType<typeof id>>();

describe('treeRows', () => {
  it('lists a project’s items in tree order with their depth', () => {
    const rows = treeRows(testPlan(), ledger, none);
    expect(rows.map((row) => [row.item.id, row.depth])).toEqual([
      ['migration', 1],
      ['discovery', 2],
      ['design', 3],
      ['review', 3],
      ['handover', 1],
      ['docs', 2],
      ['cutover', 1],
    ]);
  });

  it('keeps projects apart', () => {
    expect(treeRows(testPlan(), portal, none).map((row) => row.item.id)).toEqual([
      'shell',
      'build',
    ]);
  });

  it('hides the descendants of a collapsed item and says it is collapsed', () => {
    const rows = treeRows(testPlan(), ledger, new Set([id('migration')]));
    expect(rows.map((row) => row.item.id)).toEqual(['migration', 'handover', 'docs', 'cutover']);
    expect(rows[0]).toMatchObject({ hasChildren: true, expanded: false });
  });

  it('counts the allocations an item holds', () => {
    const rows = new Map(treeRows(testPlan(), ledger, none).map((row) => [row.item.id, row]));
    expect(rows.get(id('design'))?.allocationCount).toBe(1);
    expect(rows.get(id('review'))?.allocationCount).toBe(0);
    expect(rows.get(id('discovery'))?.allocationCount).toBe(0);
    expect(rows.get(id('cutover'))?.allocationCount).toBe(1);
  });
});

describe('pathOf', () => {
  it('names the item with everything above it', () => {
    expect(pathOf(testPlan(), id('design'))).toBe('migration › discovery › design');
    expect(pathOf(testPlan(), id('migration'))).toBe('migration');
  });
});

describe('canHaveChildren', () => {
  it('is false on the third level, the deepest there is', () => {
    expect(canHaveChildren(testPlan(), id('design'))).toBe(false);
    expect(canHaveChildren(testPlan(), id('discovery'))).toBe(true);
    expect(canHaveChildren(testPlan(), id('migration'))).toBe(true);
  });
});

describe('moveTargets', () => {
  it('offers only places the domain accepts, and not where the item already is', () => {
    // design: not under itself's own place (discovery), review (a fourth level) or cutover (holds
    // allocations), nor in another project.
    expect(moveTargets(testPlan(), id('design')).map((target) => target.label)).toEqual([
      'Top level',
      'migration',
      'handover',
      'handover › docs',
    ]);
  });

  it('offers the top level as `null`', () => {
    expect(moveTargets(testPlan(), id('design'))[0]).toEqual({ parent: null, label: 'Top level' });
  });

  it('offers nothing for an item that fits nowhere else', () => {
    // migration is three levels tall: anywhere below the top would be a fourth level or a leaf
    // with allocations, and it is already at the top.
    expect(moveTargets(testPlan(), id('migration'))).toEqual([]);
  });

  it('offers nothing for an item that does not exist', () => {
    expect(moveTargets(testPlan(), id('nope'))).toEqual([]);
  });
});

describe('expandPathTo', () => {
  it('opens every ancestor of the item and nothing else', () => {
    const collapsed = new Set([id('migration'), id('discovery'), id('handover')]);
    const opened = expandPathTo(testPlan(), id('design'), collapsed);
    expect([...opened]).toEqual(['handover']);
  });

  it('leaves the item itself as it was, and a top-level item has nothing to open', () => {
    const collapsed = new Set([id('design'), id('migration')]);
    expect([...expandPathTo(testPlan(), id('design'), collapsed)]).toEqual(['design']);
    expect([...expandPathTo(testPlan(), id('migration'), collapsed)]).toEqual([
      'design',
      'migration',
    ]);
  });

  it('does not change the set it was given', () => {
    const collapsed = new Set([id('migration')]);
    expandPathTo(testPlan(), id('design'), collapsed);
    expect([...collapsed]).toEqual(['migration']);
  });
});

describe('treeRows positions', () => {
  it('numbers each item among its siblings, for assistive technology', () => {
    const rows = new Map(treeRows(testPlan(), ledger, none).map((row) => [row.item.id, row]));
    expect([rows.get(id('migration'))?.position, rows.get(id('migration'))?.setSize]).toEqual([
      1, 3,
    ]);
    expect([rows.get(id('cutover'))?.position, rows.get(id('cutover'))?.setSize]).toEqual([3, 3]);
    expect([rows.get(id('review'))?.position, rows.get(id('review'))?.setSize]).toEqual([2, 2]);
    expect([rows.get(id('docs'))?.position, rows.get(id('docs'))?.setSize]).toEqual([1, 1]);
  });
});

describe('nextTreeAction', () => {
  const open = treeRows(testPlan(), ledger, none);
  const closed = treeRows(testPlan(), ledger, new Set([id('migration'), id('discovery')]));
  const at = (rows: typeof open, name: string) => rows.findIndex((row) => row.item.id === name);
  const select = (name: string) => ({ kind: 'select', id: name });
  const toggle = (name: string) => ({ kind: 'toggle', id: name });

  it('moves down and up one row, and stops at the ends', () => {
    expect(nextTreeAction(open, at(open, 'migration'), 'ArrowDown')).toEqual(select('discovery'));
    expect(nextTreeAction(open, at(open, 'discovery'), 'ArrowUp')).toEqual(select('migration'));
    expect(nextTreeAction(open, at(open, 'migration'), 'ArrowUp')).toBeNull();
    expect(nextTreeAction(open, at(open, 'cutover'), 'ArrowDown')).toBeNull();
  });

  it('jumps to the first and last row', () => {
    expect(nextTreeAction(open, at(open, 'docs'), 'Home')).toEqual(select('migration'));
    expect(nextTreeAction(open, at(open, 'docs'), 'End')).toEqual(select('cutover'));
  });

  it('opens a closed item on Right and steps into an open one', () => {
    expect(nextTreeAction(closed, at(closed, 'migration'), 'ArrowRight')).toEqual(
      toggle('migration'),
    );
    expect(nextTreeAction(open, at(open, 'migration'), 'ArrowRight')).toEqual(select('discovery'));
    expect(nextTreeAction(open, at(open, 'design'), 'ArrowRight')).toBeNull();
  });

  it('closes an open item on Left and otherwise goes to the parent', () => {
    expect(nextTreeAction(open, at(open, 'migration'), 'ArrowLeft')).toEqual(toggle('migration'));
    expect(nextTreeAction(open, at(open, 'design'), 'ArrowLeft')).toEqual(select('discovery'));
    expect(nextTreeAction(open, at(open, 'docs'), 'ArrowLeft')).toEqual(select('handover'));
    expect(nextTreeAction(open, at(open, 'cutover'), 'ArrowLeft')).toBeNull();
    const nested = treeRows(testPlan(), ledger, new Set([id('discovery')]));
    expect(nextTreeAction(nested, at(nested, 'discovery'), 'ArrowLeft')).toEqual(
      select('migration'),
    );
  });

  it('selects on Enter and Space, and ignores other keys and rows that are not there', () => {
    expect(nextTreeAction(open, at(open, 'docs'), 'Enter')).toEqual(select('docs'));
    expect(nextTreeAction(open, at(open, 'docs'), ' ')).toEqual(select('docs'));
    expect(nextTreeAction(open, at(open, 'docs'), 'x')).toBeNull();
    expect(nextTreeAction(open, 99, 'ArrowDown')).toBeNull();
  });
});

describe('moveTargets order', () => {
  it('lists places in tree order, not in the order the items were stored', () => {
    // docs is stored after handover, but once it is moved it sits under migration.
    const plan = value(moveItem(testPlan(), id('docs'), id('migration')));
    expect(moveTargets(plan, id('cutover')).map((target) => target.label)).toEqual([
      'migration',
      'migration › discovery',
      'migration › docs',
      'handover',
    ]);
  });
});

describe('isAncestor', () => {
  it('is true for any level above, false for itself, siblings and below', () => {
    const plan = testPlan();
    expect(isAncestor(plan, id('migration'), id('design'))).toBe(true);
    expect(isAncestor(plan, id('discovery'), id('design'))).toBe(true);
    expect(isAncestor(plan, id('design'), id('design'))).toBe(false);
    expect(isAncestor(plan, id('review'), id('design'))).toBe(false);
    expect(isAncestor(plan, id('design'), id('migration'))).toBe(false);
  });
});
