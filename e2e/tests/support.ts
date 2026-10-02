import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/** Adaeze Okafor's second rate: €95.00 an hour from 12 March 2026. */
const OKAFOR_SECOND_RATE = { id: 'rate-002', from: '12 Mar 2026', eur: 95 } as const;

const staffingGrid = (page: Page): Locator => page.getByRole('treegrid');

export async function openStaffing(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.getByRole('button', { name: 'Staffing' }).click();
  await expect(staffingGrid(page)).toBeVisible();
}

/** The unit's radio button is covered by its label, which is what a person clicks. */
export async function showUnit(page: Page, unit: string): Promise<void> {
  await page.locator('label', { hasText: unit }).click();
  await expect(staffingGrid(page)).toHaveAccessibleName(new RegExp(`, ${RegExp.escape(unit)}$`));
}

/**
 * The case study's reference calculation: Adaeze Okafor, March 2026, half a person-month. Her first
 * row in the grid is the only one with an allocation that month, under Discovery › Design.
 */
export async function referenceCell(page: Page): Promise<Locator> {
  const grid = staffingGrid(page);
  await expect(grid.getByRole('columnheader').nth(1)).toHaveText('Mar 26');
  return grid
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: 'Adaeze Okafor' }) })
    .first()
    .locator('td[data-column="1"]');
}

/** Corrects the rate in People's own screen, the way a person would. */
export async function correctOkaforRate(page: Page, eur: number): Promise<void> {
  await page.getByRole('button', { name: 'Adaeze Okafor', exact: true }).click();
  const rates = page.getByRole('region', { name: 'Hourly rates' });
  await rates
    .getByRole('button', { name: `Edit the rate from ${OKAFOR_SECOND_RATE.from}` })
    .click();
  await rates.getByLabel('Hourly rate, EUR').fill(String(eur));
  await rates.getByRole('button', { name: 'Save' }).click();
  await expect(
    rates.getByRole('row', { name: new RegExp(`${OKAFOR_SECOND_RATE.from}.*${eur.toFixed(2)}`) }),
  ).toBeVisible();
}

/** Types into a cell through its editor, which is how a character with no key of its own (€) arrives. */
export async function typeInto(page: Page, cell: Locator, text: string): Promise<void> {
  await cell.click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

const REFERENCE_CELL = { breakdownItemId: 'wbs-012', employeeId: 'emp-001', month: '2026-03' };

export async function setReferenceCell(
  request: APIRequestContext,
  personMonths: number,
): Promise<void> {
  const response = await request.put('/api/delivery/v1/allocations', {
    data: { ...REFERENCE_CELL, personMonths },
  });
  expect(response.ok()).toBe(true);
}

/**
 * Puts the stack's data back, whatever state a failed run left it in: Adaeze Okafor's two rates and
 * her half person-month in March 2026. What is already right is not written again.
 */
export async function restoreReference(request: APIRequestContext): Promise<void> {
  const { rates } = (await (await request.get('/api/people/v1/rates')).json()) as {
    rates: { id: string; employeeId: string; validFrom: string; hourlyRateEur: number }[];
  };
  const first = rates.find((r) => r.employeeId === 'emp-001' && r.validFrom === '2025-01-01');
  if (first === undefined) {
    const added = await request.post('/api/people/v1/employees/emp-001/rates', {
      data: { validFrom: '2025-01-01', hourlyRateEur: 80 },
    });
    expect(added.ok()).toBe(true);
  } else if (first.hourlyRateEur !== 80) {
    expect(
      (
        await request.patch(`/api/people/v1/rates/${first.id}`, { data: { hourlyRateEur: 80 } })
      ).ok(),
    ).toBe(true);
  }
  const second = await request.patch(`/api/people/v1/rates/${OKAFOR_SECOND_RATE.id}`, {
    data: { hourlyRateEur: OKAFOR_SECOND_RATE.eur },
  });
  expect(second.ok()).toBe(true);

  const { allocations } = (await (await request.get('/api/delivery/v1/plan')).json()) as {
    allocations: {
      breakdownItemId: string;
      employeeId: string;
      month: string;
      personMonths: number;
    }[];
  };
  const cell = allocations.find(
    (a) =>
      a.breakdownItemId === REFERENCE_CELL.breakdownItemId &&
      a.employeeId === REFERENCE_CELL.employeeId &&
      a.month === REFERENCE_CELL.month,
  );
  if (cell?.personMonths !== 0.5) await setReferenceCell(request, 0.5);
}
