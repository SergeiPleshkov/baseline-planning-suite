/**
 * Delivery contract v1 — what the Delivery service publishes. Owned by the Delivery team.
 *
 * Schemas, types and the meaning of the data; no behaviour. Compatibility rules are those of the
 * People contract: additive changes keep v1, consumers ignore what they do not know.
 */
import { z } from 'zod';

export const DELIVERY_CONTRACT_VERSION = 1;

/** Relative to the service's `/api/delivery/v1` base, which each consumer reads from its config. */
export const DELIVERY_API_PATHS = {
  workload: '/workload',
  events: '/events',
} as const;

const Id = z.string().refine((value) => value.trim() !== '', 'must not be blank');

const WorkloadBase = {
  employeeId: Id,
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  /** Share of the employee's capacity in the month, summed over every project: 1 is 100 %. */
  personMonths: z.number().positive(),
};

/**
 * One employee-month that has allocations. Months without any are left out.
 *
 * `over` means the sum exceeds one person-month beyond float noise; the producer decides, so
 * consumers show the status rather than comparing `personMonths` with 1 themselves. `cause` is the
 * allocation edited last among those that add up to the month.
 */
export const WorkloadEntrySchema = z.discriminatedUnion('status', [
  z.object({ ...WorkloadBase, status: z.literal('within') }),
  z.object({ ...WorkloadBase, status: z.literal('over'), cause: Id }),
]);

export const WorkloadResponseSchema = z.object({
  revision: z.int().nonnegative(),
  entries: z.array(WorkloadEntrySchema),
});

/**
 * Sent on the SSE stream (`event: workload-changed`, `data:` the JSON below) after an allocation
 * change. It only says who changed: the consumer re-reads `/workload`, and does so unconditionally
 * after a reconnect.
 */
export const WorkloadChangedEventSchema = z.object({
  type: z.literal('workload-changed'),
  version: z.literal(1),
  employeeIds: z.array(Id).min(1),
  revision: z.int().nonnegative(),
});

export type WorkloadEntry = z.infer<typeof WorkloadEntrySchema>;
export type WorkloadResponse = z.infer<typeof WorkloadResponseSchema>;
export type WorkloadChangedEvent = z.infer<typeof WorkloadChangedEventSchema>;
