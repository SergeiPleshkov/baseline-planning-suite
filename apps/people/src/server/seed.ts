import { z } from 'zod';
import type { PeopleDocument } from '../application/document';

/** The part of the shipped seed that People owns; field names there are not prescriptive. */
const SeedSchema = z.object({
  employees: z.array(
    z.object({ id: z.string(), name: z.string(), role: z.string(), weeklyHours: z.number() }),
  ),
  rateRecords: z.array(
    z.object({
      id: z.string(),
      employeeId: z.string(),
      validFrom: z.string(),
      hourlyCost: z.number(),
    }),
  ),
});

/** Ids and values are kept as they are; only the names of the fields change. */
export function peopleDocumentFromSeed(raw: unknown): PeopleDocument {
  const seed = SeedSchema.parse(raw);
  return {
    revision: 1,
    employees: seed.employees,
    rates: seed.rateRecords.map((record) => ({
      id: record.id,
      employeeId: record.employeeId,
      validFrom: record.validFrom,
      hourlyRateEur: record.hourlyCost,
    })),
  };
}
