import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { employee as buildEmployee, searchEmployees } from './employees';
import { employeeId } from './ids';

const employee = (id: string, name: string, role: string) =>
  buildEmployee({ id: employeeId(id), name, role, weeklyHours: 40 });

describe('employee', () => {
  it.each([
    ['a blank name', { name: ' ' }],
    ['a blank role', { role: '' }],
    ['no working hours', { weeklyHours: 0 }],
    ['negative working hours', { weeklyHours: -8 }],
    ['working hours that are not a number', { weeklyHours: Number.NaN }],
  ])('rejects %s', (_label, override) => {
    expect(() =>
      buildEmployee({
        id: employeeId('emp-1'),
        name: 'A',
        role: 'B',
        weeklyHours: 40,
        ...override,
      }),
    ).toThrow(RangeError);
  });
});

const register = [
  employee('emp-001', 'Adaeze Okafor', 'Tech Lead'),
  employee('emp-002', 'Lena Okafor', 'Frontend Engineer'),
  employee('emp-003', 'Zoë Müller', 'Data Engineer'),
  employee('emp-004', 'Łukasz Nowak', 'QA Engineer'),
  employee('emp-005', 'Søren Ødegård', 'Backend Engineer'),
  employee('emp-006', 'José Álvarez', 'Product Designer'),
];

const idsFor = (query: string) => searchEmployees(register, query).map((found) => found.id);

describe('searchEmployees', () => {
  it('matches a name in any case', () => {
    expect(idsFor('OKAFOR')).toEqual(['emp-001', 'emp-002']);
    expect(idsFor('okafor')).toEqual(['emp-001', 'emp-002']);
  });

  it('matches a role', () => {
    expect(idsFor('engineer')).toEqual(['emp-002', 'emp-003', 'emp-004', 'emp-005']);
  });

  it('needs every word, across name and role', () => {
    expect(idsFor('okafor lead')).toEqual(['emp-001']);
    expect(idsFor('lead okafor')).toEqual(['emp-001']);
    expect(idsFor('okafor designer')).toEqual([]);
  });

  it('finds accented names from plain letters and the other way round', () => {
    expect(idsFor('zoe muller')).toEqual(['emp-003']);
    expect(idsFor('josé alvarez')).toEqual(['emp-006']);
    expect(idsFor('ZOË')).toEqual(['emp-003']);
  });

  it('folds letters that are not an accent on another letter', () => {
    expect(idsFor('lukasz')).toEqual(['emp-004']);
    expect(idsFor('soren odegard')).toEqual(['emp-005']);
  });

  it('matches inside words and ignores extra spaces', () => {
    expect(idsFor('  kafo   ')).toEqual(['emp-001', 'emp-002']);
  });

  it('returns everyone for a blank query', () => {
    expect(searchEmployees(register, '')).toEqual(register);
    expect(searchEmployees(register, '   ')).toEqual(register);
  });

  it('returns nobody for text that appears nowhere', () => {
    expect(idsFor('nobody')).toEqual([]);
  });

  it('finds every employee by any piece of their own name, in any case', () => {
    const piece = fc
      .tuple(fc.constantFrom(...register), fc.nat(), fc.nat(), fc.boolean())
      .map(([found, a, b, upper]) => {
        const [from, to] = [a % found.name.length, b % found.name.length].sort((x, y) => x - y);
        const text = found.name.slice(from, (to ?? 0) + 1).trim();
        return { found, text: upper ? text.toUpperCase() : text.toLowerCase() };
      })
      .filter(({ text }) => text !== '');
    fc.assert(
      fc.property(piece, ({ found, text }) => {
        expect(searchEmployees(register, text)).toContain(found);
      }),
    );
  });

  it('keeps register order and never invents employees', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 8 }), (query) => {
        const found = searchEmployees(register, query);
        expect(found.every((each) => register.includes(each))).toBe(true);
        expect(found).toEqual(register.filter((each) => found.includes(each)));
      }),
    );
  });
});
