import { roundForDisplay, type GridRow } from '../domain/rounding/roundForDisplay';
import type { DisplayUnit } from '../domain/units';

/**
 * How many decimals each unit shows. Shown figures are whole counts of this step (105 is 1.05), so
 * that the sums the grid displays can be checked with integers.
 */
export const DISPLAY_DECIMALS: Readonly<Record<DisplayUnit, number>> = {
  personMonths: 2,
  hours: 2,
  capacityPercent: 1,
  cost: 2,
};

const LOCALE = 'en-GB';

// One formatter per unit: a grid shows hundreds of figures and building one is the slow part.
const formatters = new Map<DisplayUnit, Intl.NumberFormat>();

function formatterFor(unit: DisplayUnit): Intl.NumberFormat {
  const known = formatters.get(unit);
  if (known) return known;
  const decimals = DISPLAY_DECIMALS[unit];
  const made = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  formatters.set(unit, made);
  return made;
}

/** A count of display steps as the person reads it: 788000 steps of a cent is `7,880.00`. */
export const formatSteps = (steps: number, unit: DisplayUnit): string =>
  formatterFor(unit).format(steps / 10 ** DISPLAY_DECIMALS[unit]);

/** Rounds `values` as the rows of one column, so that the shown parts add up to the shown total. */
export function roundedColumn(
  values: readonly number[],
  decimals: number,
): { readonly parts: readonly number[]; readonly total: number } {
  const rows: GridRow[] = values.map((value, index) => ({
    kind: 'leaf',
    id: String(index),
    cells: [value],
  }));
  const figures = roundForDisplay(
    { kind: 'group', id: 'column', children: rows },
    { columns: 1, decimals },
  );
  const at = (id: string) => {
    const found = figures.get(id);
    if (!found) throw new Error(`No figures for ${id}`);
    return found;
  };
  return { parts: values.map((_, index) => at(String(index)).total), total: at('column').total };
}

/** Person-months as display steps of percent of capacity: 1.18 is 1180 steps, 118.0 %. */
export const capacityPercentSteps = (personMonths: number): number =>
  roundedColumn([personMonths * 100], DISPLAY_DECIMALS.capacityPercent).total;
