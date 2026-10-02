import { readFileSync } from 'node:fs';
import { EmployeesResponseSchema, RatesResponseSchema } from '@baseline/people-contract';
import { describe, expect, it } from 'vitest';
import { documentFromState, stateFromDocument } from '../application/document';
import { isoDate } from '../domain/calendar';
import { employeeId } from '../domain/ids';
import { rateOn } from '../domain/rates';
import { peopleDocumentFromSeed } from './seed';

const raw = JSON.parse(
  readFileSync(new URL('../../../../seed/baseline-seed.json', import.meta.url), 'utf8'),
) as unknown;

describe('the shipped seed, read as People data', () => {
  const document = peopleDocumentFromSeed(raw);

  it('keeps the counts and ids of the case study', () => {
    expect(document.employees).toHaveLength(60);
    expect(document.rates).toHaveLength(150);
    expect(document.employees[0]?.id).toBe('emp-001');
    expect(document.rates[0]).toEqual({
      id: 'rate-001',
      employeeId: 'emp-001',
      validFrom: '2025-01-01',
      hourlyRateEur: 80,
    });
  });

  it('obeys every People rule: one rate per day, positive, in cents, known employees', () => {
    const state = stateFromDocument(document);
    const sizes = [...state.histories.values()].map((history) => history.records.length);
    expect(Math.min(...sizes)).toBe(1);
    expect(Math.max(...sizes)).toBe(4);
  });

  it('prices the reference employee as the case study does', () => {
    const history = stateFromDocument(document).histories.get(employeeId('emp-001'));
    if (!history) throw new Error('emp-001 has no history');
    expect(rateOn(history, isoDate('2026-03-11'))).toBe(80);
    expect(rateOn(history, isoDate('2026-03-12'))).toBe(95);
  });

  it('is published in the shape of the contract', () => {
    const published = documentFromState(stateFromDocument(document));
    expect(EmployeesResponseSchema.safeParse(published).success).toBe(true);
    expect(
      RatesResponseSchema.safeParse({ revision: published.revision, rates: published.rates })
        .success,
    ).toBe(true);
  });
});
