import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isoDate, monthsBetween, yearMonth } from '../domain/calendar';
import { breakdownItemId, employeeId, type EmployeeId } from '../domain/ids';
import { createPlan, type Plan } from '../domain/plan';
import { allocation, items, ledger, portal, projects, testPlan } from '../domain/plan.fixtures';
import { rateTimeline, type RateTimeline } from '../domain/rateTimeline';
import { DISPLAY_UNITS, type DisplayUnit } from '../domain/units';
import type { StaffMember } from '../infrastructure/peopleContract';
import {
  buildGrid,
  conversionFor,
  projectHorizon,
  REPORTING_YEAR,
  shiftHorizon,
  visibleLines,
  type Grid,
  type GridInput,
  type GridLine,
} from './gridView';

const timeline = (...changes: [string, number][]): RateTimeline =>
  rateTimeline(
    changes.map(([effectiveFrom, hourlyRateEur]) => ({
      effectiveFrom: isoDate(effectiveFrom),
      hourlyRateEur,
    })),
  );

const person = (id: string, name: string, weeklyHours = 40): [EmployeeId, StaffMember] => [
  employeeId(id),
  { id: employeeId(id), name, weeklyHours },
];

const STAFF = new Map([
  person('emp-001', 'Adaeze Okafor'),
  person('emp-002', 'Lena Okafor', 32),
  person('emp-003', 'Mira Brandt', 20),
  person('emp-004', 'Sam Haddad'),
]);

const RATES = new Map<EmployeeId, RateTimeline>([
  [employeeId('emp-001'), timeline(['2025-01-01', 80], ['2026-03-12', 95])],
  [employeeId('emp-002'), timeline(['2026-01-01', 70.5], ['2026-09-10', 64.25])],
  [employeeId('emp-003'), timeline(['2026-08-01', 120])],
]);

const ledgerProject = () => {
  const project = projects.find((each) => each.id === ledger);
  if (!project) throw new Error('fixture without the ledger project');
  return project;
};

function input(plan: Plan, overrides: Partial<GridInput> = {}): GridInput {
  const project = ledgerProject();
  return {
    plan,
    project,
    horizon: projectHorizon(project),
    unit: 'personMonths',
    currencyPerEur: 1,
    staff: STAFF,
    rates: RATES,
    assigned: [],
    ...overrides,
  };
}

function gridOf(plan: Plan, overrides: Partial<GridInput> = {}): Grid {
  const built = buildGrid(input(plan, overrides));
  if (built.status !== 'ready') throw new Error(`expected a grid, got: ${built.message}`);
  return built.grid;
}

const lineFor = (grid: Grid, item: string, person?: string): GridLine => {
  const found = grid.lines.find(
    (line) =>
      line.item.id === item &&
      (person === undefined
        ? line.kind === 'item'
        : line.kind === 'person' && line.employeeId === person),
  );
  if (!found) throw new Error(`no line for ${item} ${person ?? ''}`);
  return found;
};

const referencePlan = () =>
  createPlan({
    projects,
    items,
    allocations: [allocation('alloc-001', 'cutover', 'emp-001', '2026-03', 0.5, 1)],
  });

describe('the reference cell (case study, figure 4) in every unit', () => {
  const cellOf = (unit: DisplayUnit, currencyPerEur = 1) => {
    const grid = gridOf(referencePlan(), { unit, currencyPerEur });
    const cell = lineFor(grid, 'cutover', 'emp-001').cells[0];
    if (!cell) throw new Error('no first cell');
    return cell;
  };

  it('is the first column of the project’s own horizon', () => {
    expect(cellOf('personMonths').month).toBe('2026-03');
  });

  it.each([
    ['personMonths', 50],
    ['hours', 8800],
    ['capacityPercent', 500],
    ['cost', 788000],
  ] as const)('shows %s as %d display steps', (unit, steps) => {
    expect(cellOf(unit).steps).toBe(steps);
  });

  it('shows the cost in the display currency', () => {
    expect(cellOf('cost', 1.17).steps).toBe(921960);
  });
});

describe('buildGrid', () => {
  it('lists the breakdown in tree order with each person under their leaf', () => {
    const grid = gridOf(testPlan());
    expect(grid.lines.map((line) => [line.kind, line.item.id, line.depth])).toEqual([
      ['item', 'migration', 1],
      ['item', 'discovery', 2],
      ['item', 'design', 3],
      ['person', 'design', 4],
      ['item', 'review', 3],
      ['item', 'handover', 1],
      ['item', 'docs', 2],
      ['item', 'cutover', 1],
      ['person', 'cutover', 2],
    ]);
    const design = lineFor(grid, 'design');
    expect(design).toMatchObject({ hasChildren: true });
    expect(lineFor(grid, 'review')).toMatchObject({ hasChildren: false });
    expect(lineFor(grid, 'design', 'emp-003')).toMatchObject({
      name: 'Mira Brandt',
      ancestors: ['migration', 'discovery', 'design'],
    });
  });

  it('puts the allocation into its month and leaves the other cells empty', () => {
    const grid = gridOf(testPlan());
    const row = lineFor(grid, 'design', 'emp-003');
    const june = row.cells.find((cell) => cell.month === '2026-06');
    expect(june?.allocation?.id).toBe('alloc-050');
    expect(june?.steps).toBe(59);
    expect(row.cells.filter((cell) => cell.allocation !== null)).toHaveLength(1);
    expect(row.total).toBe(59);
    expect(lineFor(grid, 'design').cells.every((cell) => cell.allocation === null)).toBe(true);
  });

  it('sums a parent from what is below it, and the project from its top-level items', () => {
    const grid = gridOf(testPlan());
    const monthly = (line: GridLine, month: string) =>
      line.cells.find((cell) => cell.month === month)?.steps;
    expect(monthly(lineFor(grid, 'migration'), '2026-06')).toBe(59);
    expect(monthly(lineFor(grid, 'discovery'), '2026-06')).toBe(59);
    expect(monthly(lineFor(grid, 'cutover'), '2026-04')).toBe(50);
    expect(grid.totals.total).toBe(109);
    expect(grid.totals.cells.reduce((sum, steps) => sum + steps, 0)).toBe(109);
  });

  it('orders people by name, then by id', () => {
    const plan = createPlan({
      projects,
      items,
      allocations: [
        allocation('a1', 'review', 'emp-004', '2026-04', 0.1, 1),
        allocation('a2', 'review', 'emp-002', '2026-04', 0.1, 2),
        allocation('a3', 'review', 'emp-001', '2026-04', 0.1, 3),
      ],
    });
    const names = gridOf(plan).lines.flatMap((line) => (line.kind === 'person' ? [line.name] : []));
    expect(names).toEqual(['Adaeze Okafor', 'Lena Okafor', 'Sam Haddad']);

    const reversed = new Map([
      person('emp-001', 'Zoe'),
      person('emp-002', 'Amy'),
      person('emp-004', 'Mo'),
    ]);
    const byName = gridOf(plan, { staff: reversed });
    expect(
      byName.lines.flatMap((line) => (line.kind === 'person' ? [line.employeeId] : [])),
    ).toEqual(['emp-002', 'emp-004', 'emp-001']);

    const sameName = new Map([person('emp-b', 'Twin'), person('emp-a', 'Twin')]);
    const twins = createPlan({
      projects,
      items,
      allocations: [
        allocation('a1', 'review', 'emp-b', '2026-04', 0.1, 1),
        allocation('a2', 'review', 'emp-a', '2026-04', 0.1, 2),
      ],
    });
    const ids = gridOf(twins, { staff: sameName }).lines.flatMap((line) =>
      line.kind === 'person' ? [line.employeeId] : [],
    );
    expect(ids).toEqual(['emp-a', 'emp-b']);
  });

  it('shows only the project’s own items', () => {
    const project = projects.find((each) => each.id === portal);
    if (!project) throw new Error('fixture without the portal project');
    const grid = gridOf(testPlan(), { project, horizon: projectHorizon(project) });
    expect(grid.lines.map((line) => line.item.id)).toEqual(['shell', 'build', 'build']);
  });

  it('marks months outside the project as inactive and shows nothing in them', () => {
    const grid = gridOf(testPlan(), {
      horizon: { first: yearMonth('2026-01'), last: yearMonth('2026-04') },
    });
    expect(grid.months).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
    const row = lineFor(grid, 'cutover', 'emp-001');
    expect(row.cells.map((cell) => cell.active)).toEqual([false, false, true, true]);
    expect(row.cells.map((cell) => cell.steps)).toEqual([0, 0, 0, 50]);

    const after = gridOf(testPlan(), {
      horizon: { first: yearMonth('2027-01'), last: yearMonth('2027-04') },
    });
    expect(lineFor(after, 'cutover', 'emp-001').cells.map((cell) => cell.active)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it('counts only the visible months in the totals', () => {
    const grid = gridOf(testPlan(), {
      horizon: { first: yearMonth('2026-03'), last: yearMonth('2026-05') },
    });
    expect(lineFor(grid, 'design', 'emp-003').total).toBe(0);
    expect(lineFor(grid, 'cutover', 'emp-001').total).toBe(50);
    expect(grid.totals.total).toBe(50);
  });

  it('is an empty grid, with zero totals, for a project without a breakdown', () => {
    const empty = createPlan({ projects, items: [], allocations: [] });
    const grid = gridOf(empty);
    expect(grid.lines).toEqual([]);
    expect(grid.totals.total).toBe(0);
    expect(grid.totals.cells).toHaveLength(12);
  });

  it('refuses a horizon with no month', () => {
    expect(() =>
      buildGrid(
        input(testPlan(), { horizon: { first: yearMonth('2026-05'), last: yearMonth('2026-04') } }),
      ),
    ).toThrow(RangeError);
  });

  it('converts each person by their own contracted hours, even in the same month', () => {
    const plan = createPlan({
      projects,
      items,
      allocations: [
        allocation('a1', 'review', 'emp-001', '2026-04', 0.5, 1),
        allocation('a2', 'review', 'emp-002', '2026-04', 0.5, 2),
      ],
    });
    const grid = gridOf(plan, { unit: 'hours' });
    // April 2026 has 22 working days: 176 h a month at 40 h a week, 140.8 h at 32.
    expect(lineFor(grid, 'review', 'emp-001').cells[1]?.steps).toBe(8800);
    expect(lineFor(grid, 'review', 'emp-002').cells[1]?.steps).toBe(7040);
  });

  it('prices a month without a rate at zero in cost, and keeps its effort', () => {
    const plan = createPlan({
      projects,
      items,
      allocations: [allocation('a1', 'review', 'emp-004', '2026-04', 0.5, 1)],
    });
    const cost = lineFor(gridOf(plan, { unit: 'cost' }), 'review', 'emp-004').cells[1];
    const hours = lineFor(gridOf(plan, { unit: 'hours' }), 'review', 'emp-004').cells[1];
    expect(cost?.steps).toBe(0);
    expect(hours?.steps).toBe(88 * 100);
  });
});

describe('assigned people', () => {
  const assign = (item: string, employee: string) => ({
    item: breakdownItemId(item),
    employee: employeeId(employee),
  });

  it('get an empty row on their leaf, in name order with the people who have allocations', () => {
    const grid = gridOf(testPlan(), { assigned: [assign('review', 'emp-002')] });
    const row = lineFor(grid, 'review', 'emp-002');
    expect(row).toMatchObject({ kind: 'person', name: 'Lena Okafor', total: 0 });
    expect(row.cells.every((cell) => cell.allocation === null && cell.steps === 0)).toBe(true);
    expect(lineFor(grid, 'review')).toMatchObject({ hasChildren: true });

    const both = gridOf(testPlan(), {
      assigned: [assign('design', 'emp-001'), assign('design', 'emp-003')],
    });
    const names = both.lines.flatMap((line) =>
      line.kind === 'person' && line.item.id === 'design' ? [line.name] : [],
    );
    expect(names).toEqual(['Adaeze Okafor', 'Mira Brandt']);
  });

  it('do not appear twice once they hold an allocation, and need no register entry for hours', () => {
    const grid = gridOf(testPlan(), {
      assigned: [assign('design', 'emp-003'), assign('review', 'emp-099')],
      unit: 'hours',
    });
    expect(
      grid.lines.filter((line) => line.kind === 'person' && line.item.id === 'design'),
    ).toHaveLength(1);
    expect(lineFor(grid, 'design', 'emp-003').cells.some((cell) => cell.allocation !== null)).toBe(
      true,
    );
    expect(lineFor(grid, 'review', 'emp-099')).toMatchObject({ name: 'emp-099' });
  });

  it('are ignored on an item that has children', () => {
    const grid = gridOf(testPlan(), { assigned: [assign('discovery', 'emp-001')] });
    expect(grid.lines.some((line) => line.kind === 'person' && line.item.id === 'discovery')).toBe(
      false,
    );
  });

  it('leave the figures as they were', () => {
    const plain = gridOf(testPlan());
    const assigned = gridOf(testPlan(), { assigned: [assign('review', 'emp-002')] });
    expect(assigned.totals).toEqual(plain.totals);
  });
});

describe('conversionFor', () => {
  const context = { staff: STAFF, rates: RATES, currencyPerEur: 1.17 };

  it('prices the person’s own month', () => {
    const conversion = conversionFor(employeeId('emp-001'), yearMonth('2026-03'), context);
    expect(conversion?.pricing.hoursPerPersonMonth).toBe(176);
    expect(conversion?.pricing.blendedRateEur).toBeCloseTo(89.5455, 4);
    expect(conversion?.currencyPerEur).toBe(1.17);
  });

  it('is nothing for someone the register does not know, or while it cannot be read', () => {
    expect(conversionFor(employeeId('emp-099'), yearMonth('2026-03'), context)).toBeNull();
    expect(
      conversionFor(employeeId('emp-001'), yearMonth('2026-03'), { ...context, staff: null }),
    ).toBeNull();
  });

  it('converts hours without rates, with a blended rate of zero', () => {
    const conversion = conversionFor(employeeId('emp-001'), yearMonth('2026-03'), {
      ...context,
      rates: null,
    });
    expect(conversion?.pricing.hoursPerPersonMonth).toBe(176);
    expect(conversion?.pricing.blendedRateEur).toBe(0);
  });
});

describe('when People cannot be read', () => {
  it('still shows person-months and percent, naming people by id', () => {
    for (const unit of ['personMonths', 'capacityPercent'] as const) {
      const grid = gridOf(testPlan(), { unit, staff: null, rates: null });
      expect(lineFor(grid, 'cutover', 'emp-001')).toMatchObject({ name: 'emp-001' });
    }
  });

  it('cannot show hours or cost, and says why', () => {
    const messageOf = (overrides: Partial<GridInput>): string => {
      const built = buildGrid(input(testPlan(), overrides));
      if (built.status !== 'unavailable') throw new Error('expected no grid');
      return built.message;
    };
    expect(messageOf({ unit: 'hours', staff: null, rates: null })).toContain('People register');
    expect(messageOf({ unit: 'cost', rates: null })).toContain('rate history');
  });

  it('shows hours without rates, since they do not depend on them', () => {
    expect(buildGrid(input(testPlan(), { unit: 'hours', rates: null })).status).toBe('ready');
  });

  it('does not ask the register about people who work only on another project', () => {
    const plan = createPlan({
      projects,
      items,
      allocations: [
        allocation('a1', 'review', 'emp-001', '2026-04', 0.5, 1),
        allocation('a2', 'build', 'emp-099', '2026-07', 0.5, 2),
      ],
    });
    expect(buildGrid(input(plan, { unit: 'hours' })).status).toBe('ready');
  });

  it('cannot show hours for someone the register does not know, and names them', () => {
    const stranger = new Map([person('emp-001', 'Adaeze Okafor')]);
    const built = buildGrid(input(testPlan(), { unit: 'hours', staff: stranger }));
    expect(built).toMatchObject({ status: 'unavailable' });
    expect(built.status === 'unavailable' && built.message).toContain('emp-003');
    expect(buildGrid(input(testPlan(), { unit: 'personMonths', staff: stranger })).status).toBe(
      'ready',
    );
  });
});

describe('visibleLines', () => {
  it('hides everything below a collapsed item, people included', () => {
    const lines = gridOf(testPlan()).lines;
    const shown = (collapsed: string[]) =>
      visibleLines(lines, new Set(collapsed.map(breakdownItemId))).map(
        (line) => `${line.kind}:${line.item.id}`,
      );
    expect(shown(['design'])).toContain('item:design');
    expect(shown(['design'])).not.toContain('person:design');
    expect(shown(['migration'])).toEqual([
      'item:migration',
      'item:handover',
      'item:docs',
      'item:cutover',
      'person:cutover',
    ]);
    expect(shown([])).toHaveLength(lines.length);
  });
});

describe('horizons', () => {
  it('start as the project’s own span and shift by whole months', () => {
    const project = ledgerProject();
    expect(projectHorizon(project)).toEqual({ first: '2026-03', last: '2027-02' });
    expect(shiftHorizon(projectHorizon(project), 1)).toEqual({ first: '2026-04', last: '2027-03' });
    expect(shiftHorizon(projectHorizon(project), -3)).toEqual({
      first: '2025-12',
      last: '2026-11',
    });
  });

  it('include the reporting year of the case study', () => {
    expect(monthsBetween(REPORTING_YEAR.first, REPORTING_YEAR.last)).toHaveLength(12);
    expect(REPORTING_YEAR).toEqual({ first: '2026-04', last: '2027-03' });
  });
});

describe('what the grid shows adds up', () => {
  interface DrawnCell {
    readonly item: string;
    readonly employee: string;
    readonly month: string;
    readonly thousandths: number;
  }
  const MONTHS = monthsBetween(yearMonth('2026-03'), yearMonth('2027-02'));
  const cells = fc.uniqueArray(
    fc.record({
      item: fc.constantFrom('design', 'review', 'docs', 'cutover'),
      employee: fc.constantFrom('emp-001', 'emp-002', 'emp-003', 'emp-004'),
      month: fc.constantFrom(...MONTHS),
      // Thousandths, so that halves of a displayed step come up often.
      thousandths: fc.integer({ min: 1, max: 3000 }),
    }),
    { selector: (cell) => `${cell.item}|${cell.employee}|${cell.month}`, maxLength: 80 },
  );

  const planOf = (drawn: readonly DrawnCell[]) =>
    createPlan({
      projects,
      items,
      allocations: drawn.map((cell, index) =>
        allocation(
          `a-${String(index)}`,
          cell.item,
          cell.employee,
          cell.month,
          cell.thousandths / 1000,
          index + 1,
        ),
      ),
    });

  const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

  it('holds for rows, for parents and for the project, in every unit', () => {
    fc.assert(
      fc.property(
        cells,
        fc.constantFrom(...DISPLAY_UNITS),
        fc.double({ min: 0.5, max: 2, noNaN: true }),
        fc.integer({ min: -2, max: 2 }),
        (drawn, unit, currencyPerEur, shift) => {
          const grid = gridOf(planOf(drawn), {
            unit,
            currencyPerEur,
            horizon: shiftHorizon(projectHorizon(ledgerProject()), shift),
          });
          for (const line of grid.lines) {
            expect(sum(line.cells.map((cell) => cell.steps))).toBe(line.total);
            if (line.kind === 'item' && line.hasChildren) {
              const below = grid.lines.filter((other) => other.ancestors.at(-1) === line.item.id);
              line.cells.forEach((cell, column) => {
                expect(sum(below.map((other) => other.cells[column]?.steps ?? NaN))).toBe(
                  cell.steps,
                );
              });
            }
          }
          const roots = grid.lines.filter((line) => line.ancestors.length === 0);
          grid.totals.cells.forEach((steps, column) => {
            expect(sum(roots.map((line) => line.cells[column]?.steps ?? NaN))).toBe(steps);
          });
          expect(sum(grid.totals.cells)).toBe(grid.totals.total);
          expect(sum(roots.map((line) => line.total))).toBe(grid.totals.total);
        },
      ),
    );
  });

  it('keeps each person-month figure within one step of the stored value', () => {
    fc.assert(
      fc.property(cells, (drawn) => {
        const grid = gridOf(planOf(drawn));
        for (const line of grid.lines) {
          if (line.kind !== 'person') continue;
          for (const cell of line.cells) {
            const stored = cell.allocation?.personMonths ?? 0;
            expect(Math.abs(cell.steps - stored * 100)).toBeLessThan(1);
          }
        }
      }),
    );
  });
});
