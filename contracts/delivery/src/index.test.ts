import { describe, expect, it } from 'vitest';
import { WorkloadChangedEventSchema, WorkloadEntrySchema, WorkloadResponseSchema } from './index';

const within = { employeeId: 'emp-1', month: '2026-06', personMonths: 0.59, status: 'within' };
const over = { ...within, personMonths: 1.18, status: 'over', cause: 'alloc-073' };

describe('WorkloadEntrySchema', () => {
  it('accepts both statuses', () => {
    expect(WorkloadEntrySchema.safeParse(within).success).toBe(true);
    expect(WorkloadEntrySchema.safeParse(over).success).toBe(true);
  });

  it('insists on a cause for an over-allocation', () => {
    expect(WorkloadEntrySchema.safeParse({ ...within, status: 'over' }).success).toBe(false);
  });

  it.each([
    ['an unknown status', { status: 'full' }],
    ['month 13', { month: '2026-13' }],
    ['a date instead of a month', { month: '2026-06-01' }],
    ['a negative load', { personMonths: -0.1 }],
    ['a load of nothing', { personMonths: 0 }],
    ['a blank employee id', { employeeId: ' ' }],
  ])('rejects %s', (_label, override) => {
    expect(WorkloadEntrySchema.safeParse({ ...within, ...override }).success).toBe(false);
  });
});

describe('WorkloadResponseSchema', () => {
  it('accepts an empty workload', () => {
    expect(WorkloadResponseSchema.safeParse({ revision: 0, entries: [] }).success).toBe(true);
  });
});

describe('WorkloadChangedEventSchema', () => {
  const event = { type: 'workload-changed', version: 1, employeeIds: ['emp-1'], revision: 3 };

  it('accepts a well-formed event and rejects another version', () => {
    expect(WorkloadChangedEventSchema.safeParse(event).success).toBe(true);
    expect(WorkloadChangedEventSchema.safeParse({ ...event, version: 2 }).success).toBe(false);
  });
});
