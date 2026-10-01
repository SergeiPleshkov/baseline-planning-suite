import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { roundForDisplay, type GridGroup, type GridRow, type RowFigures } from './roundForDisplay';

const leaf = (id: string, cells: number[]): GridRow => ({ kind: 'leaf', id, cells });
const group = (id: string, children: GridRow[]): GridGroup => ({ kind: 'group', id, children });

function shown(rows: ReadonlyMap<string, RowFigures>, id: string): RowFigures {
  const row = rows.get(id);
  if (!row) throw new Error(`no row ${id}`);
  return row;
}

describe('roundForDisplay', () => {
  it('reproduces the case study grid, whose figures are already at display precision', () => {
    const ledger = group('ledger', [
      leaf('l-okafor', [0.8, 1.0, 1.15, 0.9, 0.6, 0.25]),
      leaf('m-brandt', [0.7, 0.95, 1.18, 0.8, 0.65, 0.4]),
      leaf('s-haddad', [0.6, 0.9, 0.72, 0.7, 0.5, 0.25]),
    ]);
    const rows = roundForDisplay(ledger, { columns: 6, decimals: 2 });
    expect(shown(rows, 'ledger')).toEqual({ cells: [210, 285, 305, 240, 175, 90], total: 1305 });
    expect(shown(rows, 'l-okafor').total).toBe(470);
    expect(shown(rows, 'm-brandt').total).toBe(468);
    expect(shown(rows, 's-haddad').total).toBe(367);
  });

  it('gives the one leftover cent of three thirds to exactly one child', () => {
    const rows = roundForDisplay(
      group('parent', [leaf('a', [1 / 3]), leaf('b', [1 / 3]), leaf('c', [1 / 3])]),
      { columns: 1, decimals: 2 },
    );
    expect(shown(rows, 'parent').total).toBe(100);
    expect(['a', 'b', 'c'].map((id) => shown(rows, id).total).sort()).toEqual([33, 33, 34]);
  });

  it('keeps every total at its nearest rounding and lets a cell take the error', () => {
    // Exact totals: A 3.006, B 9.0046, columns 5.0076 and 7.003, overall 12.0106.
    const rows = roundForDisplay(group('p', [leaf('A', [1.003, 2.003]), leaf('B', [4.0046, 5])]), {
      columns: 2,
      decimals: 2,
    });
    expect(shown(rows, 'A').total).toBe(301);
    expect(shown(rows, 'B').total).toBe(900);
    expect(shown(rows, 'p')).toEqual({ cells: [501, 700], total: 1201 });
  });

  it('reconciles rows and columns where rounding each row on its own would not', () => {
    // Every cell is half a cent. Each row needs one cent and each column needs one cent,
    // so the two rounded-up cells must sit on a diagonal.
    const rows = roundForDisplay(
      group('p', [leaf('a', [0.005, 0.005]), leaf('b', [0.005, 0.005])]),
      { columns: 2, decimals: 2 },
    );
    expect(shown(rows, 'p').cells).toEqual([1, 1]);
    const a = shown(rows, 'a');
    const b = shown(rows, 'b');
    expect(a.cells.map((value, column) => value + (b.cells[column] ?? 0))).toEqual([1, 1]);
    expect([a.total, b.total]).toEqual([1, 1]);
  });

  it('counts a written half as exactly half, so the grand total rounds it up', () => {
    // In doubles, 1.005 * 100 is 100.49999999999999 and 2.675 * 100 is 267.49999999999997.
    for (const [value, expected] of [
      [1.005, 101],
      [2.675, 268],
    ] as const) {
      const rows = roundForDisplay(group('p', [leaf('a', [value])]), { columns: 1, decimals: 2 });
      expect(shown(rows, 'a').total).toBe(expected);
    }
  });

  it('rounds percentages to one decimal', () => {
    const rows = roundForDisplay(group('p', [leaf('a', [100 / 3, 100 / 3, 100 / 3])]), {
      columns: 3,
      decimals: 1,
    });
    expect(shown(rows, 'a').total).toBe(1000);
    expect([...shown(rows, 'a').cells].sort()).toEqual([333, 333, 334]);
  });

  it.each([
    ['a row with the wrong number of cells', group('p', [leaf('a', [1, 2, 3])])],
    ['two siblings with one id', group('p', [leaf('a', [1, 2]), leaf('a', [3, 4])])],
    ['a row sharing an ancestor id', group('p', [group('g', [leaf('g', [1, 2])])])],
    ['a negative value', group('p', [leaf('a', [1, -2])])],
    ['values too large to round exactly', group('p', [leaf('a', [1e13, 1e13])])],
  ])('rejects %s', (_, root) => {
    expect(() => roundForDisplay(root, { columns: 2, decimals: 2 })).toThrow(RangeError);
  });
});

const SUBSTEPS = 10_000;

// fc.double is uniform over bit patterns, so most of its values are vanishingly small;
// realistic figures are uniform over the range instead.
const upTo = (max: number) => fc.integer({ min: 0, max: max * 1e4 }).map((n) => n / 1e4);

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

interface Spec {
  readonly cells?: readonly number[];
  readonly children?: readonly Spec[];
}

function toGrid(spec: Spec, ids = { next: 0 }): GridRow {
  const id = `r${String(ids.next++)}`;
  return spec.cells
    ? { kind: 'leaf', id, cells: spec.cells }
    : { kind: 'group', id, children: (spec.children ?? []).map((child) => toGrid(child, ids)) };
}

function anyGrid({
  maxColumns,
  depth,
  breadth,
  value,
}: {
  maxColumns: number;
  depth: number;
  breadth: number;
  value: fc.Arbitrary<number>;
}) {
  return fc
    .record({ columns: fc.integer({ min: 1, max: maxColumns }), decimals: fc.constantFrom(1, 2) })
    .chain(({ columns, decimals }) => {
      const anySpec = (level: number): fc.Arbitrary<Spec> => {
        const asLeaf = fc
          .array(value, { minLength: columns, maxLength: columns })
          .map((cells) => ({ cells }));
        return level === 0
          ? asLeaf
          : fc.oneof(
              asLeaf,
              fc
                .array(anySpec(level - 1), { maxLength: breadth })
                .map((children) => ({ children })),
            );
      };
      return fc
        .array(anySpec(depth), { minLength: 1, maxLength: breadth })
        .map((children) => ({ root: toGrid({ children }) as GridGroup, columns, decimals }));
    });
}

function rowsOf(row: GridRow): GridRow[] {
  return row.kind === 'leaf' ? [row] : [row, ...row.children.flatMap(rowsOf)];
}

/** Every row's figures, summed bottom-up from whatever the leaf cells are. */
function rollUp(
  root: GridRow,
  columns: number,
  leafCell: (row: Extract<GridRow, { kind: 'leaf' }>, column: number) => number,
): Map<string, RowFigures> {
  const figures = new Map<string, RowFigures>();
  const visit = (row: GridRow): RowFigures => {
    const cells =
      row.kind === 'leaf'
        ? Array.from({ length: columns }, (_, column) => leafCell(row, column))
        : row.children.map(visit).reduce(
            (acc, child) => acc.map((value, column) => value + (child.cells[column] ?? 0)),
            Array.from({ length: columns }, () => 0),
          );
    const own = { cells, total: sum(cells) };
    figures.set(row.id, own);
    return own;
  };
  visit(root);
  return figures;
}

const exactSubsteps = (root: GridRow, columns: number, decimals: number) =>
  rollUp(root, columns, (row, column) =>
    Math.round((row.cells[column] ?? 0) * 10 ** decimals * SUBSTEPS),
  );

const nearest = (substeps: number) => Math.floor((substeps + SUBSTEPS / 2) / SUBSTEPS);

const largeGrid = anyGrid({
  maxColumns: 6,
  depth: 3,
  breadth: 4,
  value: fc.oneof(
    upTo(200),
    upTo(500_000),
    fc.integer({ min: 0, max: 20_000 }).map((cents) => cents / 100),
    fc.constantFrom(0, 1 / 3, 2 / 3, 0.005, 1.005),
  ),
});

describe('roundForDisplay properties', () => {
  it('shows totals that equal the sum of the figures they total, across rows and columns', () => {
    fc.assert(
      fc.property(largeGrid, ({ root, columns, decimals }) => {
        const rows = roundForDisplay(root, { columns, decimals });
        for (const row of rowsOf(root)) {
          const own = shown(rows, row.id);
          expect(own.total).toBe(sum(own.cells));
          if (row.kind === 'group') {
            own.cells.forEach((value, column) => {
              expect(value).toBe(
                sum(row.children.map((child) => shown(rows, child.id).cells[column] ?? 0)),
              );
            });
          }
        }
      }),
    );
  });

  it('rounds every figure down or up from its exact value, and the grand total to nearest', () => {
    fc.assert(
      fc.property(largeGrid, ({ root, columns, decimals }) => {
        const rows = roundForDisplay(root, { columns, decimals });
        const exact = exactSubsteps(root, columns, decimals);
        for (const row of rowsOf(root)) {
          const own = shown(rows, row.id);
          const truth = exact.get(row.id);
          if (!truth) throw new Error(`no exact figures for ${row.id}`);
          [...own.cells, own.total].forEach((value, index) => {
            const substeps = index < own.cells.length ? (truth.cells[index] ?? 0) : truth.total;
            expect([Math.floor(substeps / SUBSTEPS), Math.ceil(substeps / SUBSTEPS)]).toContain(
              value,
            );
          });
        }
        expect(shown(rows, root.id).total).toBe(nearest(exact.get(root.id)?.total ?? 0));
      }),
    );
  });

  it('finds the best reconciled rounding, as exhaustive search does on small grids', () => {
    const smallGrid = anyGrid({ maxColumns: 3, depth: 1, breadth: 3, value: upTo(3) });
    fc.assert(
      fc.property(smallGrid, ({ root, columns, decimals }) => {
        const exact = exactSubsteps(root, columns, decimals);
        const rows = rowsOf(root);
        const leaves = rows.filter((row) => row.kind === 'leaf');
        const free = leaves.flatMap((row) =>
          Array.from({ length: columns }, (_, column) => ({ id: row.id, column })).filter(
            ({ id, column }) => (exact.get(id)?.cells[column] ?? 0) % SUBSTEPS !== 0,
          ),
        );
        fc.pre(free.length <= 10);

        const aggregateWeight = leaves.length * columns + 1;
        const error = (figures: ReadonlyMap<string, RowFigures>) =>
          sum(
            rows.map((row) => {
              const own = figures.get(row.id);
              const truth = exact.get(row.id);
              if (!own || !truth) throw new Error(`missing ${row.id}`);
              const cellWeight = row.kind === 'leaf' ? 1 : aggregateWeight;
              return (
                cellWeight *
                  sum(own.cells.map((v, c) => Math.abs(v * SUBSTEPS - (truth.cells[c] ?? 0)))) +
                aggregateWeight * Math.abs(own.total * SUBSTEPS - truth.total)
              );
            }),
          );
        const isRounding = (figures: ReadonlyMap<string, RowFigures>) =>
          rows.every((row) => {
            const own = figures.get(row.id);
            const truth = exact.get(row.id);
            if (!own || !truth) return false;
            return [...own.cells, own.total].every((value, index) => {
              const substeps = index < own.cells.length ? (truth.cells[index] ?? 0) : truth.total;
              return Math.abs(value * SUBSTEPS - substeps) < SUBSTEPS;
            });
          }) && figures.get(root.id)?.total === nearest(exact.get(root.id)?.total ?? 0);

        let best = Infinity;
        for (let mask = 0; mask < 2 ** free.length; mask++) {
          const up = new Set(
            free
              .filter((_, bit) => (mask >> bit) & 1)
              .map(({ id, column }) => `${id}/${String(column)}`),
          );
          const candidate = rollUp(root, columns, (row, column) => {
            const substeps = exact.get(row.id)?.cells[column] ?? 0;
            return Math[up.has(`${row.id}/${String(column)}`) ? 'ceil' : 'floor'](
              substeps / SUBSTEPS,
            );
          });
          if (isRounding(candidate)) best = Math.min(best, error(candidate));
        }
        expect(error(roundForDisplay(root, { columns, decimals }))).toBe(best);
      }),
    );
  });

  it('matches largest-remainder rounding on a single row', () => {
    const largestRemainder = (values: readonly number[]): number[] => {
      const scaled = values.map((value) => Math.round(value * 100 * SUBSTEPS));
      const floors = scaled.map((value) => Math.floor(value / SUBSTEPS));
      const missing = nearest(sum(scaled)) - sum(floors);
      const byRemainder = scaled
        .map((value, index) => ({ index, remainder: value % SUBSTEPS }))
        .sort((a, b) => b.remainder - a.remainder);
      const rounded = [...floors];
      for (const { index } of byRemainder.slice(0, missing)) {
        rounded[index] = (rounded[index] ?? 0) + 1;
      }
      return rounded.map((value, index) => Math.abs(value * SUBSTEPS - (scaled[index] ?? 0)));
    };

    fc.assert(
      fc.property(fc.array(upTo(50), { minLength: 1, maxLength: 12 }), (cells) => {
        const rows = roundForDisplay(group('p', [leaf('a', cells)]), {
          columns: cells.length,
          decimals: 2,
        });
        const shownError = shown(rows, 'a').cells.map((value, index) =>
          Math.abs(value * SUBSTEPS - Math.round((cells[index] ?? 0) * 100 * SUBSTEPS)),
        );
        expect(sum(shownError)).toBe(sum(largestRemainder(cells)));
      }),
    );
  });
});
