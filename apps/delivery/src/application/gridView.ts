import {
  addMonths,
  monthsBetween,
  yearMonth,
  type MonthSpan,
  type YearMonth,
} from '../domain/calendar';
import { workload } from '../domain/capacity';
import type { BreakdownItemId, EmployeeId } from '../domain/ids';
import {
  childrenOf,
  isProjectMonth,
  type Allocation,
  type BreakdownItem,
  type Plan,
  type Project,
} from '../domain/plan';
import { priceMonth, type MonthPricing } from '../domain/pricing';
import { rateTimeline, type RateTimeline } from '../domain/rateTimeline';
import { roundForDisplay, type GridRow } from '../domain/rounding/roundForDisplay';
import {
  isPlainUnit,
  toDisplayUnit,
  toPlainUnit,
  type ConversionContext,
  type DisplayUnit,
} from '../domain/units';
import type { StaffMember } from './peopleContract';
import { DISPLAY_DECIMALS, capacityPercentSteps } from './figures';
import { contributionsOf, type Contribution } from './overload';
import { byKey, byName } from './sorting';
import { topLevelOf } from './treeView';

export const shiftHorizon = (horizon: MonthSpan, months: number): MonthSpan => ({
  first: addMonths(horizon.first, months),
  last: addMonths(horizon.last, months),
});

/** The case study's reporting year, a preset next to the project's own span. */
export const REPORTING_YEAR: MonthSpan = {
  first: yearMonth('2026-04'),
  last: yearMonth('2027-03'),
};

export interface GridCell {
  readonly month: YearMonth;
  /** The month is within the project's dates; outside them nothing can be planned. */
  readonly active: boolean;
  /** The figure to show, in display steps of the unit (see `DISPLAY_DECIMALS`). */
  readonly steps: number;
  /** What is stored for the cell; only person rows have one, and only if something was planned. */
  readonly allocation: Allocation | null;
  /** Set when the cell's allocation is part of a month in which the person is over capacity. */
  readonly overCapacity: OverCapacity | null;
  /** In cost, an allocation in a month some working days of which have no rate. */
  readonly unpriced: Unpriced | null;
}

interface OverCapacity {
  readonly personMonths: number;
  readonly percentSteps: number;
  /** This allocation is the one edited last, so the over-allocation is blamed on it. */
  readonly isLatestEdit: boolean;
  /** Everything the month is made of, in every project, newest edit first. */
  readonly contributions: readonly Contribution[];
}

interface Unpriced {
  readonly days: number;
  readonly workingDays: number;
}

interface LineBase {
  readonly key: string;
  /** 1 for a top-level item; a person is one level below their item. */
  readonly depth: number;
  /** The item rows above this one: while any of them is collapsed this row is hidden. */
  readonly ancestors: readonly BreakdownItemId[];
  readonly cells: readonly GridCell[];
  readonly total: number;
}

/** A node of the breakdown. Its figures are sums of what is below it, so it is read-only. */
interface ItemLine extends LineBase {
  readonly kind: 'item';
  readonly item: BreakdownItem;
  readonly hasChildren: boolean;
}

export interface PersonLine extends LineBase {
  readonly kind: 'person';
  readonly item: BreakdownItem;
  readonly employeeId: EmployeeId;
  readonly name: string;
}

export type GridLine = ItemLine | PersonLine;

export interface Grid {
  readonly months: readonly YearMonth[];
  readonly lines: readonly GridLine[];
  readonly totals: { readonly cells: readonly number[]; readonly total: number };
}

export interface GridInput {
  readonly plan: Plan;
  readonly project: Project;
  readonly horizon: MonthSpan;
  readonly unit: DisplayUnit;
  readonly currencyPerEur: number;
  /** `null` while People cannot be read. */
  readonly staff: ReadonlyMap<EmployeeId, StaffMember> | null;
  readonly rates: ReadonlyMap<EmployeeId, RateTimeline> | null;
  /** People given a row on a leaf before they have any allocation there. */
  readonly assigned: readonly Assignment[];
}

export interface Assignment {
  readonly item: BreakdownItemId;
  readonly employee: EmployeeId;
}

export type GridBuild =
  | { readonly status: 'ready'; readonly grid: Grid }
  | { readonly status: 'unavailable'; readonly message: string };

type AllocationIndex = ReadonlyMap<
  BreakdownItemId,
  ReadonlyMap<EmployeeId, ReadonlyMap<YearMonth, Allocation>>
>;

/** The project's allocations by item, person and month: one pass, then a lookup per cell. */
function indexAllocations(plan: Plan, project: Project): AllocationIndex {
  const index = new Map<BreakdownItemId, Map<EmployeeId, Map<YearMonth, Allocation>>>();
  for (const allocation of plan.allocations.values()) {
    if (plan.items.get(allocation.breakdownItemId)?.projectId !== project.id) continue;
    const people =
      index.get(allocation.breakdownItemId) ?? new Map<EmployeeId, Map<YearMonth, Allocation>>();
    index.set(allocation.breakdownItemId, people);
    const months = people.get(allocation.employeeId) ?? new Map<YearMonth, Allocation>();
    people.set(allocation.employeeId, months);
    months.set(allocation.month, allocation);
  }
  return index;
}

function whyUnavailable(
  unit: DisplayUnit,
  people: readonly EmployeeId[],
  staff: GridInput['staff'],
  rates: GridInput['rates'],
): string | null {
  if (isPlainUnit(unit)) return null;
  if (staff === null) return 'Hours and cost need the People register, which cannot be read now.';
  if (unit === 'cost' && rates === null) {
    return 'Cost needs the rate history from People, which cannot be read now.';
  }
  const unknown = people.filter((person) => !staff.has(person));
  return unknown.length === 0
    ? null
    : `Hours and cost need each person’s contracted hours, and the People register has no record of ${unknown.join(', ')}.`;
}

interface ItemNode {
  readonly kind: 'item';
  readonly key: string;
  readonly item: BreakdownItem;
  readonly depth: number;
  readonly ancestors: readonly BreakdownItemId[];
  readonly children: readonly GridNode[];
}

interface PersonNode {
  readonly kind: 'person';
  readonly key: string;
  readonly item: BreakdownItem;
  readonly employeeId: EmployeeId;
  readonly name: string;
  readonly depth: number;
  readonly ancestors: readonly BreakdownItemId[];
  /** Exact figures in the unit, before rounding. */
  readonly exact: readonly number[];
  readonly allocations: readonly (Allocation | null)[];
}

type GridNode = ItemNode | PersonNode;

const ROOT_KEY = JSON.stringify(['project']);
const itemKey = (id: BreakdownItemId): string => JSON.stringify(['item', id]);
export const personKey = (item: BreakdownItemId, employee: EmployeeId): string =>
  JSON.stringify(['person', item, employee]);

/**
 * What converts a figure typed for one person in one month, or `null` if the register has no
 * record of the person. Without rates the month converts hours, not money.
 */
export function conversionFor(
  employee: EmployeeId,
  month: YearMonth,
  { staff, rates, currencyPerEur }: Pick<GridInput, 'staff' | 'rates' | 'currencyPerEur'>,
): ConversionContext | null {
  const member = staff?.get(employee);
  if (!member) return null;
  return {
    pricing: priceMonth(month, member.weeklyHours, rates?.get(employee) ?? rateTimeline([])),
    currencyPerEur,
  };
}

/**
 * The staffing grid of one project over a horizon, in one unit: the breakdown with the people
 * allocated to each leaf. Sums are taken on exact values and rounded together, so every shown
 * figure is the sum of the figures below and beside it.
 */
export function buildGrid(input: GridInput): GridBuild {
  const { plan, project, horizon, unit, currencyPerEur, staff, rates } = input;
  const months = monthsBetween(horizon.first, horizon.last);
  if (months.length === 0) throw new RangeError('A horizon has at least one month');

  const index = indexAllocations(plan, project);
  const people = [...new Set([...index.values()].flatMap((byPerson) => [...byPerson.keys()]))];
  const unavailable = whyUnavailable(unit, people, staff, rates);
  if (unavailable !== null) return { status: 'unavailable', message: unavailable };

  const noRates = rateTimeline([]);
  const priced = new Map<string, MonthPricing>();
  const pricingFor = (employee: EmployeeId, month: YearMonth): MonthPricing => {
    const key = JSON.stringify([employee, month]);
    const known = priced.get(key);
    if (known) return known;
    const member = staff?.get(employee);
    if (!member) throw new Error(`No staff record for ${employee}`);
    const pricing = priceMonth(month, member.weeklyHours, rates?.get(employee) ?? noRates);
    priced.set(key, pricing);
    return pricing;
  };
  const exactFigure = (personMonths: number, employee: EmployeeId, month: YearMonth): number =>
    isPlainUnit(unit)
      ? toPlainUnit(personMonths, unit)
      : toDisplayUnit(personMonths, unit, { pricing: pricingFor(employee, month), currencyPerEur });

  const nameOf = (employee: EmployeeId): string => staff?.get(employee)?.name ?? employee;

  const personNodes = (
    item: BreakdownItem,
    depth: number,
    ancestors: readonly BreakdownItemId[],
  ): PersonNode[] => {
    const planned = new Map<EmployeeId, ReadonlyMap<YearMonth, Allocation>>(index.get(item.id));
    for (const { item: on, employee } of input.assigned) {
      if (on === item.id && !planned.has(employee)) planned.set(employee, new Map());
    }
    return [...planned]
      .map(([employeeId, byMonth]) => ({ employeeId, byMonth, name: nameOf(employeeId) }))
      .sort((a, b) => byName(a.name, b.name) || byKey(a.employeeId, b.employeeId))
      .map(({ employeeId, byMonth, name }) => {
        const allocations = months.map((month) => byMonth.get(month) ?? null);
        return {
          kind: 'person',
          key: personKey(item.id, employeeId),
          item,
          employeeId,
          name,
          depth,
          ancestors,
          allocations,
          exact: months.map((month, column) => {
            const allocation = allocations[column];
            return allocation ? exactFigure(allocation.personMonths, employeeId, month) : 0;
          }),
        };
      });
  };

  const itemNode = (
    item: BreakdownItem,
    depth: number,
    ancestors: readonly BreakdownItemId[],
  ): ItemNode => {
    const below = [...ancestors, item.id];
    const subItems = childrenOf(plan, item.id);
    return {
      kind: 'item',
      key: itemKey(item.id),
      item,
      depth,
      ancestors,
      children:
        subItems.length > 0
          ? subItems.map((child) => itemNode(child, depth + 1, below))
          : personNodes(item, depth + 1, below),
    };
  };
  const roots = topLevelOf(plan, project.id).map((item) => itemNode(item, 1, []));

  const zeros = months.map(() => 0);
  const rowOf = (node: GridNode): GridRow =>
    node.kind === 'person'
      ? { kind: 'leaf', id: node.key, cells: node.exact }
      : node.children.length === 0
        ? { kind: 'leaf', id: node.key, cells: zeros }
        : { kind: 'group', id: node.key, children: node.children.map(rowOf) };
  const figures = roundForDisplay(
    { kind: 'group', id: ROOT_KEY, children: roots.map(rowOf) },
    { columns: months.length, decimals: DISPLAY_DECIMALS[unit] },
  );
  const figuresOf = (key: string) => {
    const found = figures.get(key);
    if (!found) throw new Error(`No figures for ${key}`);
    return found;
  };

  const active = months.map((month) => isProjectMonth(project, month));
  const loads = workload(plan);
  const overCapacityOf = (
    employee: EmployeeId,
    month: YearMonth,
    allocation: Allocation,
  ): OverCapacity | null => {
    const load = loads.get(employee)?.get(month);
    return load?.status === 'over'
      ? {
          personMonths: load.personMonths,
          percentSteps: capacityPercentSteps(load.personMonths),
          isLatestEdit: load.cause === allocation.id,
          contributions: contributionsOf(plan, employee, month),
        }
      : null;
  };
  const lines: GridLine[] = [];
  const addLines = (node: GridNode) => {
    const { cells, total } = figuresOf(node.key);
    const gridCells = months.map((month, column): GridCell => {
      const allocation = node.kind === 'person' ? (node.allocations[column] ?? null) : null;
      return {
        month,
        active: active[column] ?? false,
        steps: cells[column] ?? 0,
        allocation,
        overCapacity:
          node.kind === 'person' && allocation
            ? overCapacityOf(node.employeeId, month, allocation)
            : null,
        unpriced:
          node.kind === 'person' && allocation && unit === 'cost'
            ? unpricedIn(pricingFor(node.employeeId, month))
            : null,
      };
    });
    if (node.kind === 'person') {
      lines.push({
        kind: 'person',
        key: node.key,
        item: node.item,
        employeeId: node.employeeId,
        name: node.name,
        depth: node.depth,
        ancestors: node.ancestors,
        cells: gridCells,
        total,
      });
      return;
    }
    lines.push({
      kind: 'item',
      key: node.key,
      item: node.item,
      depth: node.depth,
      ancestors: node.ancestors,
      hasChildren: node.children.length > 0,
      cells: gridCells,
      total,
    });
    for (const child of node.children) addLines(child);
  };
  for (const root of roots) addLines(root);

  return { status: 'ready', grid: { months, lines, totals: figuresOf(ROOT_KEY) } };
}

const unpricedIn = (pricing: MonthPricing): Unpriced | null =>
  pricing.unpricedWorkingDays === 0
    ? null
    : { days: pricing.unpricedWorkingDays, workingDays: pricing.workingDays };

export const visibleLines = (
  lines: readonly GridLine[],
  collapsed: ReadonlySet<BreakdownItemId>,
): GridLine[] =>
  lines.filter((line) => line.ancestors.every((ancestor) => !collapsed.has(ancestor)));
