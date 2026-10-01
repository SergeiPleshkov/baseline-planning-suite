type Id<Kind extends string> = string & { readonly __brand: Kind };

export type EmployeeId = Id<'EmployeeId'>;
export type RateId = Id<'RateId'>;

function nonEmpty(value: string, kind: string): string {
  if (value.trim() === '') throw new RangeError(`Empty ${kind}`);
  return value;
}

export const employeeId = (value: string) => nonEmpty(value, 'employee id') as EmployeeId;
export const rateId = (value: string) => nonEmpty(value, 'rate id') as RateId;
