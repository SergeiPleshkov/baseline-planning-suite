import { z } from 'zod';
import type { PlanDocument } from '../application/planDocument';

/** The part of the shipped seed that Delivery owns; field names there are not prescriptive. */
const SeedSchema = z.object({
  projects: z.array(
    z.object({ id: z.string(), name: z.string(), startDate: z.string(), endDate: z.string() }),
  ),
  breakdownItems: z.array(
    z.object({
      id: z.string(),
      projectId: z.string(),
      parentId: z.string().nullable(),
      name: z.string(),
    }),
  ),
  allocations: z.array(
    z.object({
      id: z.string(),
      breakdownItemId: z.string(),
      employeeId: z.string(),
      month: z.string(),
      amount: z.number(),
    }),
  ),
});

/**
 * Ids and values are kept as they are. The seed has no timestamps, so the order of the file stands
 * in for the order of edits: an allocation listed later counts as edited more recently.
 */
export function deliveryDocumentFromSeed(raw: unknown): PlanDocument {
  const seed = SeedSchema.parse(raw);
  return {
    revision: 1,
    projects: seed.projects.map((project) => ({
      id: project.id,
      name: project.name,
      firstMonth: project.startDate.slice(0, 7),
      lastMonth: project.endDate.slice(0, 7),
    })),
    items: seed.breakdownItems,
    allocations: seed.allocations.map((allocation, index) => ({
      id: allocation.id,
      breakdownItemId: allocation.breakdownItemId,
      employeeId: allocation.employeeId,
      month: allocation.month,
      personMonths: allocation.amount,
      revision: index + 1,
    })),
  };
}
