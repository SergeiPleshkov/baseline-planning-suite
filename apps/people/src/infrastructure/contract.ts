import type { EmployeeDto, RateRecordDto } from '@baseline/people-contract';
import type { Employee } from '../domain/employees';
import type { EmployeeId } from '../domain/ids';
import type { RateRecord } from '../domain/rates';

export const employeeToContract = (employee: Employee): EmployeeDto => ({
  id: employee.id,
  name: employee.name,
  role: employee.role,
  weeklyHours: employee.weeklyHours,
});

export const rateToContract = (employee: EmployeeId, rate: RateRecord): RateRecordDto => ({
  id: rate.id,
  employeeId: employee,
  validFrom: rate.validFrom,
  hourlyRateEur: rate.hourlyRateEur,
});
