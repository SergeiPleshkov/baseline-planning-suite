import { cheapestCirculation, type FlowEdge, type FlowNode } from './cheapestCirculation';

export type GridRow =
  | { readonly kind: 'leaf'; readonly id: string; readonly cells: readonly number[] }
  | { readonly kind: 'group'; readonly id: string; readonly children: readonly GridRow[] };

export type GridGroup = Extract<GridRow, { kind: 'group' }>;

export interface RowFigures {
  readonly cells: readonly number[];
  readonly total: number;
}

/** Exact values are kept as integers in 1/10,000 of a display step, so every sum is exact. */
const SUBSTEPS = 10_000;

const sum = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0);

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new RangeError(`Nothing at index ${String(index)}`);
  return item;
}

function exactSubsteps(
  row: GridRow,
  { columns, scale }: { readonly columns: number; readonly scale: number },
  seen: Set<string>,
  into: Map<string, RowFigures>,
): RowFigures {
  if (seen.has(row.id)) throw new RangeError(`Duplicate row id ${row.id}`);
  seen.add(row.id);
  let figures: RowFigures;
  if (row.kind === 'leaf') {
    if (row.cells.length !== columns) {
      throw new RangeError(`Row ${row.id} needs ${String(columns)} cells`);
    }
    if (row.cells.some((value) => !Number.isFinite(value) || value < 0)) {
      throw new RangeError(`Row ${row.id} has a negative or non-finite cell`);
    }
    const cells = row.cells.map((value) => Math.round(value * scale * SUBSTEPS));
    figures = { cells, total: sum(cells) };
  } else {
    const children = row.children.map((child) =>
      exactSubsteps(child, { columns, scale }, seen, into),
    );
    figures = {
      cells: Array.from({ length: columns }, (_, column) =>
        sum(children.map((child) => at(child.cells, column))),
      ),
      total: sum(children.map((child) => child.total)),
    };
  }
  into.set(row.id, figures);
  return figures;
}

const leafRows = (row: GridRow): number =>
  row.kind === 'leaf' ? 1 : sum(row.children.map(leafRows));

/**
 * Rounds a tree of rows × columns for display so that every shown figure reconciles: a group's
 * cell is the sum of its children's cells and a row's total is the sum of its cells. Each figure is
 * its exact value rounded down or up, and the grand total is rounded to nearest, halves up. Of all
 * such roundings it takes the one with the least error on totals and group figures, then the least
 * error on leaf cells — on a single row, that is largest-remainder rounding. The result counts
 * display steps: with 2 decimals, 105 means 1.05.
 */
export function roundForDisplay(
  root: GridGroup,
  { columns, decimals }: { readonly columns: number; readonly decimals: number },
): ReadonlyMap<string, RowFigures> {
  if (!Number.isInteger(columns) || columns < 1) throw new RangeError('columns must be ≥ 1');
  if (!Number.isInteger(decimals) || decimals < 0) throw new RangeError('decimals must be ≥ 0');
  const exact = new Map<string, RowFigures>();
  const grand = exactSubsteps(root, { columns, scale: 10 ** decimals }, new Set(), exact);
  if (!Number.isSafeInteger(grand.total)) throw new RangeError('Values too large to round exactly');

  // An error on any total or group figure outweighs the errors on all leaf cells together.
  const aggregateWeight = leafRows(root) * columns + 1;

  const edges: FlowEdge[] = [];
  const figure = (from: FlowNode, to: FlowNode, substeps: number, weight: number): FlowEdge => {
    const lower = Math.floor(substeps / SUBSTEPS);
    const upper = Math.ceil(substeps / SUBSTEPS);
    const extraErrorIfRoundedUp = (upper + lower) * SUBSTEPS - 2 * substeps;
    const edge = { from, to, lower, upper, cost: weight * extraErrorIfRoundedUp };
    edges.push(edge);
    return edge;
  };
  const fixed = (from: FlowNode, to: FlowNode, steps: number): FlowEdge => {
    const edge = { from, to, lower: steps, upper: steps, cost: 0 };
    edges.push(edge);
    return edge;
  };

  // Each figure is an edge. A group's cells flow down column by column into its children; a leaf's
  // cells flow into its total, and totals flow up into the parent's total. Flow conservation at
  // every node is then exactly "a figure equals the sum of its parts".
  const source: FlowNode = {};
  const sink: FlowNode = {};
  const grandTotal = Math.floor((grand.total + SUBSTEPS / 2) / SUBSTEPS);
  fixed(sink, source, grandTotal);

  const figuresOf = new Map<string, { cells: FlowEdge[]; total: FlowEdge }>();
  const link = (row: GridRow, parentColumns: readonly FlowNode[], parentTotal: FlowNode) => {
    const sums = exact.get(row.id);
    if (!sums) throw new Error(`No exact figures for ${row.id}`);
    const totalNode: FlowNode = {};
    const columnNodes: FlowNode[] = Array.from({ length: columns }, () =>
      row.kind === 'leaf' ? totalNode : {},
    );
    const weight = row.kind === 'leaf' ? 1 : aggregateWeight;
    const cells = columnNodes.map((columnNode, column) =>
      figure(at(parentColumns, column), columnNode, at(sums.cells, column), weight),
    );
    if (row.kind === 'group') {
      for (const child of row.children) link(child, columnNodes, totalNode);
    }
    const total =
      row === root
        ? fixed(totalNode, parentTotal, grandTotal)
        : figure(totalNode, parentTotal, sums.total, aggregateWeight);
    figuresOf.set(row.id, { cells, total });
  };
  link(
    root,
    Array.from({ length: columns }, () => source),
    sink,
  );

  const flow = cheapestCirculation(edges);
  if (!flow) throw new Error('Display rounding has no reconciled solution');
  const steps = (edge: FlowEdge): number => {
    const value = flow.get(edge);
    if (value === undefined) throw new Error('Figure without flow');
    return value;
  };
  return new Map(
    [...figuresOf].map(([id, { cells, total }]) => [
      id,
      { cells: cells.map(steps), total: steps(total) },
    ]),
  );
}
