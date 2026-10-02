import { isoDate, yearMonth } from './calendar';
import { allocationId, breakdownItemId, employeeId, projectId, type ProjectId } from './ids';
import { createPlan, type Allocation, type BreakdownItem, type Project } from './plan';

export const ledger = projectId('ledger');
export const portal = projectId('portal');

export const projects: Project[] = [
  { id: ledger, name: 'Ledger', startDate: isoDate('2026-03-01'), endDate: isoDate('2027-02-28') },
  { id: portal, name: 'Portal', startDate: isoDate('2026-06-01'), endDate: isoDate('2027-03-31') },
];

export const item = (id: string, project: ProjectId, parent: string | null): BreakdownItem => ({
  id: breakdownItemId(id),
  projectId: project,
  parentId: parent === null ? null : breakdownItemId(parent),
  name: id,
});

export const allocation = (
  id: string,
  on: string,
  employee: string,
  month: string,
  personMonths: number,
  revision: number,
): Allocation => ({
  id: allocationId(id),
  breakdownItemId: breakdownItemId(on),
  employeeId: employeeId(employee),
  month: yearMonth(month),
  personMonths,
  revision,
});

export const items: BreakdownItem[] = [
  item('migration', ledger, null),
  item('discovery', ledger, 'migration'),
  item('design', ledger, 'discovery'),
  item('review', ledger, 'discovery'),
  item('handover', ledger, null),
  item('docs', ledger, 'handover'),
  item('cutover', ledger, null),
  item('shell', portal, null),
  item('build', portal, 'shell'),
];

/** M. Brandt, June 2026: 0.59 on each of two projects, as in the seed (alloc-050, alloc-073). */
export const allocations: Allocation[] = [
  allocation('alloc-050', 'design', 'emp-003', '2026-06', 0.59, 50),
  allocation('alloc-073', 'build', 'emp-003', '2026-06', 0.59, 73),
  allocation('alloc-cutover', 'cutover', 'emp-001', '2026-04', 0.5, 10),
];

export const testPlan = () => createPlan({ projects, items, allocations });
