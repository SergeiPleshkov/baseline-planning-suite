/**
 * People contract v1 — what the People service publishes. Owned by the People team.
 *
 * Schemas, types and the meaning of the data; no behaviour. A consumer validates what it receives
 * with these schemas and maps the result into its own model.
 *
 * Compatibility: adding an optional field keeps v1, and so does a new event type, since a consumer
 * dispatches on the SSE event name and ignores names it does not know. Consumers ignore unknown
 * fields. Anything else, including a change to the rate semantics below, is a new contract version.
 */
import { z } from 'zod';

export const PEOPLE_CONTRACT_VERSION = 1;

/** Relative to the service's `/api/people/v1` base, which each consumer reads from its config. */
export const PEOPLE_API_PATHS = {
  employees: '/employees',
  rates: '/rates',
  events: '/events',
} as const;

const Id = z.string().refine((value) => value.trim() !== '', 'must not be blank');

/** Hourly cost above this is a typo, not a rate. */
export const MAX_HOURLY_RATE_EUR = 10_000;

/** A counter the service raises on every change; equal revisions mean equal data. */
const Revision = z.int().nonnegative();

export const EmployeeSchema = z.object({
  id: Id,
  name: z.string().min(1),
  role: z.string().min(1),
  /** Contracted hours per week; one person-month is `weeklyHours * workingDays / 5` hours. */
  weeklyHours: z.number().positive().max(168),
});

/**
 * One entry of an employee's hourly cost history.
 *
 * - `validFrom` is inclusive: the rate applies on that calendar day, weekend or not.
 * - It holds until the day before the employee's next record; the last record has no end.
 * - Before the first record the employee has no rate. That is a gap, not a rate of zero.
 * - An employee has at most one record per `validFrom`.
 * - Records are in EUR, above zero and up to `MAX_HOURLY_RATE_EUR`, with at most two decimals.
 *   Consumers must not round them.
 * - `validFrom` is from 1900-01-01 on.
 * - The order of records in a response means nothing.
 */
export const RateRecordSchema = z.object({
  id: Id,
  employeeId: Id,
  validFrom: z.iso.date().refine((date) => date >= '1900-01-01', 'must not be before 1900'),
  hourlyRateEur: z
    .number()
    .positive()
    .max(MAX_HOURLY_RATE_EUR)
    .refine((rate) => Math.round(rate * 100) / 100 === rate, 'at most two decimals'),
});

export const EmployeesResponseSchema = z.object({
  revision: Revision,
  employees: z.array(EmployeeSchema),
});

/** Every record of every employee. */
export const RatesResponseSchema = z.object({
  revision: Revision,
  rates: z.array(RateRecordSchema),
});

/**
 * Sent on the SSE stream (`event: rates-changed`, `data:` the JSON below) after any change to
 * rates. It only says who changed: the consumer re-reads `/rates`. After a reconnect it re-reads
 * unconditionally, since events may have been missed.
 */
export const RatesChangedEventSchema = z.object({
  type: z.literal('rates-changed'),
  version: z.literal(1),
  employeeIds: z.array(Id).min(1),
  /** The revision of `/rates` with the change in; a read at this revision or later includes it. */
  revision: Revision,
});

export type EmployeeDto = z.infer<typeof EmployeeSchema>;
export type RateRecordDto = z.infer<typeof RateRecordSchema>;
export type EmployeesResponse = z.infer<typeof EmployeesResponseSchema>;
export type RatesResponse = z.infer<typeof RatesResponseSchema>;
export type RatesChangedEvent = z.infer<typeof RatesChangedEventSchema>;
