import { moveItem } from '../domain/breakdown';
import type { BreakdownItemId, ProjectId } from '../domain/ids';
import {
  MAX_DEPTH,
  allocationsOn,
  childrenOf,
  depthOf,
  type BreakdownItem,
  type Plan,
} from '../domain/plan';

export interface TreeRow {
  readonly item: BreakdownItem;
  /** 1 for a top-level item. */
  readonly depth: number;
  /** Place among its siblings, from 1, and how many there are: what a screen reader announces. */
  readonly position: number;
  readonly setSize: number;
  readonly hasChildren: boolean;
  readonly allocationCount: number;
  readonly expanded: boolean;
}

export const topLevelOf = (plan: Plan, project: ProjectId): BreakdownItem[] =>
  [...plan.items.values()].filter((item) => item.projectId === project && item.parentId === null);

/** The items of one project in tree order, children hidden below a collapsed parent. */
export function treeRows(
  plan: Plan,
  project: ProjectId,
  collapsed: ReadonlySet<BreakdownItemId>,
): TreeRow[] {
  const rows: TreeRow[] = [];
  const visit = (item: BreakdownItem, depth: number, position: number, setSize: number) => {
    const children = childrenOf(plan, item.id);
    const expanded = !collapsed.has(item.id);
    rows.push({
      item,
      depth,
      position,
      setSize,
      hasChildren: children.length > 0,
      allocationCount: allocationsOn(plan, item.id).length,
      expanded,
    });
    if (expanded) {
      children.forEach((child, index) => {
        visit(child, depth + 1, index + 1, children.length);
      });
    }
  };
  const roots = topLevelOf(plan, project);
  roots.forEach((root, index) => {
    visit(root, 1, index + 1, roots.length);
  });
  return rows;
}

export type TreeAction =
  | { readonly kind: 'select'; readonly id: BreakdownItemId }
  | { readonly kind: 'toggle'; readonly id: BreakdownItemId };

/**
 * What a key does in the tree, by the ARIA tree pattern: Up and Down move between rows, Home and
 * End jump, Right opens a closed item or steps into an open one, Left closes an open item or goes
 * to its parent, Enter and Space select. `null` for a key the tree does not use.
 */
export function nextTreeAction(
  rows: readonly TreeRow[],
  index: number,
  key: string,
): TreeAction | null {
  const row = rows[index];
  if (!row) return null;
  const select = (target: TreeRow | undefined): TreeAction | null =>
    target ? { kind: 'select', id: target.item.id } : null;
  switch (key) {
    case 'ArrowDown':
      return select(rows[index + 1]);
    case 'ArrowUp':
      return select(rows[index - 1]);
    case 'Home':
      return select(rows[0]);
    case 'End':
      return select(rows.at(-1));
    case 'ArrowRight':
      if (!row.hasChildren) return null;
      return row.expanded ? select(rows[index + 1]) : { kind: 'toggle', id: row.item.id };
    case 'ArrowLeft':
      if (row.hasChildren && row.expanded) return { kind: 'toggle', id: row.item.id };
      return select(
        rows
          .slice(0, index)
          .reverse()
          .find((above) => above.depth === row.depth - 1),
      );
    case 'Enter':
    case ' ':
      return select(row);
    default:
      return null;
  }
}

/** `Migration › Discovery › Design`. */
export function pathOf(plan: Plan, id: BreakdownItemId): string {
  const names: string[] = [];
  for (let current = plan.items.get(id); current;) {
    names.unshift(current.name);
    current = current.parentId === null ? undefined : plan.items.get(current.parentId);
  }
  return names.join(' › ');
}

export const canHaveChildren = (plan: Plan, id: BreakdownItemId): boolean =>
  depthOf(plan, id) < MAX_DEPTH;

export interface MoveTarget {
  /** `null` is the top level of the project. */
  readonly parent: BreakdownItemId | null;
  readonly label: string;
}

/**
 * Where an item may go, in tree order: only places the domain accepts, so the person cannot choose
 * one that would be refused. The place it already is in is left out.
 */
export function moveTargets(plan: Plan, id: BreakdownItemId): MoveTarget[] {
  const item = plan.items.get(id);
  if (!item) return [];
  const inTreeOrder: BreakdownItem[] = [];
  const visit = (each: BreakdownItem) => {
    inTreeOrder.push(each);
    for (const child of childrenOf(plan, each.id)) visit(child);
  };
  for (const root of topLevelOf(plan, item.projectId)) visit(root);

  const candidates: (BreakdownItem | null)[] = [null, ...inTreeOrder];
  return candidates
    .filter((candidate) => (candidate?.id ?? null) !== item.parentId)
    .filter((candidate) => moveItem(plan, id, candidate?.id ?? null).ok)
    .map((candidate) => ({
      parent: candidate?.id ?? null,
      label: candidate === null ? 'Top level' : pathOf(plan, candidate.id),
    }));
}

export interface LeafOption {
  readonly id: BreakdownItemId;
  readonly label: string;
}

/** The items of a project that hold allocations, because they have no children, in tree order. */
export function leafOptions(plan: Plan, project: ProjectId): LeafOption[] {
  const leaves: LeafOption[] = [];
  const visit = (item: BreakdownItem) => {
    const children = childrenOf(plan, item.id);
    if (children.length === 0) leaves.push({ id: item.id, label: pathOf(plan, item.id) });
    for (const child of children) visit(child);
  };
  for (const root of topLevelOf(plan, project)) visit(root);
  return leaves;
}

/** The collapsed set with every ancestor of the item opened, so that the item is visible. */
export function expandPathTo(
  plan: Plan,
  id: BreakdownItemId,
  collapsed: ReadonlySet<BreakdownItemId>,
): ReadonlySet<BreakdownItemId> {
  const next = new Set(collapsed);
  let parent = plan.items.get(id)?.parentId ?? null;
  while (parent !== null) {
    next.delete(parent);
    parent = plan.items.get(parent)?.parentId ?? null;
  }
  return next;
}

export function isAncestor(plan: Plan, ancestor: BreakdownItemId, id: BreakdownItemId): boolean {
  let parent = plan.items.get(id)?.parentId ?? null;
  while (parent !== null) {
    if (parent === ancestor) return true;
    parent = plan.items.get(parent)?.parentId ?? null;
  }
  return false;
}
