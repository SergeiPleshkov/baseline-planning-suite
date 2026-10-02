import { describe, expect, it } from 'vitest';
import { byKey, byName } from './sorting';

describe('byName', () => {
  it('orders names as an English reader does, accented letters next to their base letter', () => {
    expect(['Zeynep', 'Ömer', 'Oskar', 'Ana', 'Ägnes'].sort(byName)).toEqual([
      'Ägnes',
      'Ana',
      'Ömer',
      'Oskar',
      'Zeynep',
    ]);
  });

  it('orders a number inside a name by its value', () => {
    expect(['Team 10', 'Team 2'].sort(byName)).toEqual(['Team 2', 'Team 10']);
  });
});

describe('byKey', () => {
  it('orders months chronologically and ids by code unit', () => {
    expect(['2027-01', '2026-12', '2026-03'].sort(byKey)).toEqual([
      '2026-03',
      '2026-12',
      '2027-01',
    ]);
    expect(['emp-010', 'emp-002', 'emp-001'].sort(byKey)).toEqual([
      'emp-001',
      'emp-002',
      'emp-010',
    ]);
  });

  it('tells apart keys that a collator would take for equal', () => {
    expect(byKey('emp-01', 'emp-1')).not.toBe(0);
    expect(byKey('emp-1', 'emp-1')).toBe(0);
  });
});
