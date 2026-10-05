import type { EmployeeId } from './ids';

export interface Employee {
  readonly id: EmployeeId;
  readonly name: string;
  readonly role: string;
  readonly weeklyHours: number;
}

export function employee(fields: Employee): Employee {
  if (fields.name.trim() === '') throw new RangeError(`${fields.id}: blank name`);
  if (fields.role.trim() === '') throw new RangeError(`${fields.id}: blank role`);
  if (!Number.isFinite(fields.weeklyHours) || fields.weeklyHours <= 0) {
    throw new RangeError(`${fields.id}: weekly hours must be positive`);
  }
  return { id: fields.id, name: fields.name, role: fields.role, weeklyHours: fields.weeklyHours };
}

/** Letters Unicode does not build from a base letter and a mark, folded the way people type. */
const FOLDED_LETTERS: Readonly<Record<string, string>> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
};

/** Lower case, without accents: what two spellings of a name have in common. */
const foldForSearch = (text: string): string =>
  text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[ßæœøłđðþı]/gu, (letter) => FOLDED_LETTERS[letter] ?? letter);

/**
 * Employees whose name and role together contain every word of the query, ignoring case and
 * accents, in register order. A blank query matches everyone.
 */
export function searchEmployees(
  employees: readonly Employee[],
  query: string,
): readonly Employee[] {
  const words = foldForSearch(query).split(/\s+/u).filter(Boolean);
  return employees.filter((employee) => {
    const haystack = foldForSearch(`${employee.name} ${employee.role}`);
    return words.every((word) => haystack.includes(word));
  });
}
