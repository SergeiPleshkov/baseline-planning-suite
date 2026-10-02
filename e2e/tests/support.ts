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
  await expect(staffingGrid(page)).toHaveAccessibleName(new RegExp(`, ${escapeRegExp(unit)}$`));
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

/** Puts the stack's data back, whatever state a failed run left it in: repeating the call changes nothing. */
export async function restoreOkaforRate(request: APIRequestContext): Promise<void> {
  const response = await request.patch(`/api/people/v1/rates/${OKAFOR_SECOND_RATE.id}`, {
    data: { hourlyRateEur: OKAFOR_SECOND_RATE.eur },
  });
  expect(response.ok()).toBe(true);
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
