import { WorkloadResponseSchema } from '@baseline/delivery-contract';
import { describe, expect, it } from 'vitest';
import { testPlan } from '../domain/plan.fixtures';
import { workloadToContract } from './workloadContract';

describe('workloadToContract', () => {
  const published = workloadToContract(testPlan(), 12);

  it('publishes a payload that satisfies the contract', () => {
    expect(WorkloadResponseSchema.parse(published)).toEqual(published);
    expect(published.revision).toBe(12);
  });

  it('names the cause of an over-allocation and only of those', () => {
    expect(published.entries).toContainEqual({
      employeeId: 'emp-003',
      month: '2026-06',
      personMonths: 1.18,
      status: 'over',
      cause: 'alloc-073',
    });
    expect(published.entries.filter((entry) => 'cause' in entry)).toHaveLength(1);
  });

  it('lists every employee-month that has allocations, in a stable order', () => {
    expect(published.entries.map((entry) => [entry.employeeId, entry.month])).toEqual([
      ['emp-001', '2026-04'],
      ['emp-003', '2026-06'],
    ]);
  });
});
