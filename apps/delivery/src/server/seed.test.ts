import { readFileSync } from 'node:fs';
import { WorkloadResponseSchema } from '@baseline/delivery-contract';
import { describe, expect, it } from 'vitest';
import { documentFromState, stateFromDocument } from '../application/planDocument';
import { workloadToContract } from '../infrastructure/workloadContract';
import { deliveryDocumentFromSeed } from './seed';

interface RawAllocation {
  id: string;
  employeeId: string;
  month: string;
  amount: number;
}

const raw = JSON.parse(
  readFileSync(new URL('../../../../seed/baseline-seed.json', import.meta.url), 'utf8'),
) as { allocations: RawAllocation[] };

describe('the shipped seed, read as Delivery data', () => {
  const document = deliveryDocumentFromSeed(raw);
  const state = stateFromDocument(document);

  it('keeps the counts, ids and amounts of the case study', () => {
    expect(document.projects).toHaveLength(4);
    expect(document.items).toHaveLength(90);
    expect(document.allocations).toHaveLength(720);
    expect(document.allocations[0]).toMatchObject({
      id: 'alloc-001',
      breakdownItemId: 'wbs-012',
      employeeId: 'emp-001',
      month: '2026-03',
      personMonths: 0.5,
    });
    expect(document.projects[0]).toMatchObject({ startDate: '2026-03-01', endDate: '2027-02-28' });
  });

  it('obeys every plan rule: at most three levels, allocations on leaves inside the project', () => {
    expect(state.plan.items.size).toBe(90);
    expect(state.plan.allocations.size).toBe(720);
  });

  it('lets a later entry in the file count as the more recent edit', () => {
    const revisions = document.allocations.map((allocation) => allocation.revision);
    expect(revisions).toEqual(revisions.map((_value, index) => index + 1));
  });

  it('finds the six over-allocated person-months of the case study, whoever the culprit', () => {
    const sums = new Map<string, { total: number; lastInFile: string }>();
    for (const allocation of raw.allocations) {
      const key = `${allocation.employeeId}|${allocation.month}`;
      const sum = sums.get(key);
      sums.set(key, {
        total: (sum?.total ?? 0) + allocation.amount,
        lastInFile: allocation.id,
      });
    }
    const expected = [...sums]
      .filter(([, sum]) => sum.total > 1 + 1e-9)
      .map(([key, sum]) => `${key}|${sum.lastInFile}`)
      .sort();
    expect(expected).toHaveLength(6);

    const published = workloadToContract(state.plan, 1);
    expect(WorkloadResponseSchema.safeParse(published).success).toBe(true);
    const over = published.entries
      .filter((entry) => entry.status === 'over')
      .map((entry) => `${entry.employeeId}|${entry.month}|${entry.cause}`)
      .sort();
    expect(over).toEqual(expected);
  });

  it('shows M. Brandt over capacity in June 2026 at 1.18, the latest edit being to blame', () => {
    const entry = workloadToContract(state.plan, 1).entries.find(
      (each) => each.employeeId === 'emp-003' && each.month === '2026-06',
    );
    expect(entry).toMatchObject({ status: 'over', cause: 'alloc-073' });
    expect(entry?.personMonths).toBeCloseTo(1.18, 10);
  });

  it('is stored and restored unchanged', () => {
    expect(documentFromState(stateFromDocument(document))).toEqual(document);
  });
});
