type Id<Kind extends string> = string & { readonly __brand: Kind };

export type ProjectId = Id<'ProjectId'>;
export type BreakdownItemId = Id<'BreakdownItemId'>;
export type EmployeeId = Id<'EmployeeId'>;
export type AllocationId = Id<'AllocationId'>;

function nonEmpty(value: string, kind: string): string {
  if (value.trim() === '') throw new RangeError(`Empty ${kind}`);
  return value;
}

export const projectId = (value: string) => nonEmpty(value, 'project id') as ProjectId;
export const breakdownItemId = (value: string) =>
  nonEmpty(value, 'breakdown item id') as BreakdownItemId;
export const employeeId = (value: string) => nonEmpty(value, 'employee id') as EmployeeId;
export const allocationId = (value: string) => nonEmpty(value, 'allocation id') as AllocationId;
