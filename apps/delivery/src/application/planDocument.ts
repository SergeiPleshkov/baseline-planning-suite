import { z } from 'zod';
import { isoDate, yearMonth } from '../domain/calendar';
import { allocationId, breakdownItemId, employeeId, projectId } from '../domain/ids';
import { createPlan, type BreakdownItem, type Plan } from '../domain/plan';

export const Id = z.string().refine((value) => value.trim() !== '', 'must not be blank');
export const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

const ProjectSchema = z.object({
  id: Id,
  name: z.string(),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
});

const ItemSchema = z.object({
  id: Id,
  projectId: Id,
  parentId: Id.nullable(),
  name: z.string(),
});

const AllocationSchema = z.object({
  id: Id,
  breakdownItemId: Id,
  employeeId: Id,
  month: Month,
  personMonths: z.number(),
  /** Edit order: a higher number was edited later. */
  revision: z.int(),
});

/** The whole plan as the service stores it and as `GET /plan` returns it. */
export const PlanDocumentSchema = z.object({
  revision: z.int().nonnegative(),
  projects: z.array(ProjectSchema),
  items: z.array(ItemSchema),
  allocations: z.array(AllocationSchema),
});

export type PlanDocument = z.infer<typeof PlanDocumentSchema>;
export type ItemDto = z.infer<typeof ItemSchema>;
export type AllocationDto = z.infer<typeof AllocationSchema>;

/** What deleting an item would take, as shown to the person and sent back as the confirmation. */
export interface DeletionSummaryDto {
  readonly root: string;
  readonly items: readonly string[];
  readonly allocations: readonly { readonly id: string; readonly personMonths: number }[];
  readonly personMonths: number;
}

export interface PlanState {
  /** Raised by every change to the plan; not to be confused with an allocation's own revision. */
  readonly revision: number;
  readonly plan: Plan;
}

/** Throws a `RangeError` for data that parses but breaks a plan rule; start-up should stop. */
export function stateFromDocument(input: unknown): PlanState {
  const document = PlanDocumentSchema.parse(input);
  return {
    revision: document.revision,
    plan: createPlan({
      projects: document.projects.map((project) => ({
        id: projectId(project.id),
        name: project.name,
        startDate: isoDate(project.startDate),
        endDate: isoDate(project.endDate),
      })),
      items: document.items.map(itemFromDto),
      allocations: document.allocations.map((each) => ({
        id: allocationId(each.id),
        breakdownItemId: breakdownItemId(each.breakdownItemId),
        employeeId: employeeId(each.employeeId),
        month: yearMonth(each.month),
        personMonths: each.personMonths,
        revision: each.revision,
      })),
    }),
  };
}

function itemFromDto(item: ItemDto) {
  return {
    id: breakdownItemId(item.id),
    projectId: projectId(item.projectId),
    parentId: item.parentId === null ? null : breakdownItemId(item.parentId),
    name: item.name,
  };
}

export const itemToDto = (item: BreakdownItem): ItemDto => ({
  id: item.id,
  projectId: item.projectId,
  parentId: item.parentId,
  name: item.name,
});

export const documentFromState = (state: PlanState): PlanDocument => ({
  revision: state.revision,
  projects: [...state.plan.projects.values()].map((project) => ({
    id: project.id,
    name: project.name,
    startDate: project.startDate,
    endDate: project.endDate,
  })),
  items: [...state.plan.items.values()].map(itemToDto),
  allocations: [...state.plan.allocations.values()].map((each) => ({
    id: each.id,
    breakdownItemId: each.breakdownItemId,
    employeeId: each.employeeId,
    month: each.month,
    personMonths: each.personMonths,
    revision: each.revision,
  })),
});
