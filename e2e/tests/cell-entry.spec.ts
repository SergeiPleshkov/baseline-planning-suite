import { expect, test } from '@playwright/test';
import {
  openStaffing,
  referenceCell,
  restoreReference,
  setReferenceCell,
  showUnit,
  typeInto,
} from './support';

test.beforeEach(async ({ request }) => {
  await restoreReference(request);
});

test.afterEach(async ({ request }) => {
  await restoreReference(request);
});

test.describe('the reference figure typed into its cell', () => {
  for (const [unit, text] of [
    ['Person-months', '0.5'],
    ['Hours', '88'],
    ['% of capacity', '50'],
    ['Cost (EUR)', '7,880.00'],
    ['Cost (EUR)', '€7,880'],
    ['Person-months', '88 h'],
    ['Hours', '50%'],
  ] as const) {
    test(`${text} in ${unit} is half a person-month`, async ({ page, request }) => {
      await setReferenceCell(request, 0.25);
      await openStaffing(page, '/delivery');
      await showUnit(page, unit);
      const cell = await referenceCell(page);
      await typeInto(page, cell, text);

      await showUnit(page, 'Person-months');
      await expect(cell).toHaveText('0.50');
      await showUnit(page, 'Cost (EUR)');
      await expect(cell).toHaveText('7,880.00');
    });
  }

  test('a negative figure is refused with the reason, and nothing is saved', async ({ page }) => {
    await openStaffing(page, '/delivery');
    const cell = await referenceCell(page);
    await typeInto(page, cell, '-1');
    await expect(page.getByRole('alert').filter({ hasText: 'cannot be negative' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(cell).toHaveText('0.50');
  });
});

test('the first key pressed on a cell starts the figure, a minus included', async ({ page }) => {
  await openStaffing(page, '/delivery');
  const cell = await referenceCell(page);
  await cell.click();
  await page.keyboard.type('-1');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'cannot be negative' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(cell).toHaveText('0.50');
});

test('text left in a cell that cannot be saved is reported for that cell', async ({ page }) => {
  await openStaffing(page, '/delivery');
  const cell = await referenceCell(page);
  await cell.click();
  await page.keyboard.type('abc');
  await page.getByRole('button', { name: 'Project span' }).click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'A figure for Adaeze Okafor, Mar 2026 was not saved' }),
  ).toBeVisible();
  await expect(cell).toHaveText('0.50');
});

test('days before the first rate cost nothing, and the cell says so', async ({ page }) => {
  await openStaffing(page, '/side-by-side');
  await showUnit(page, 'Cost (EUR)');
  const cell = await referenceCell(page);
  await expect(cell).toHaveText('7,880.00');

  await page.getByRole('button', { name: 'Adaeze Okafor', exact: true }).click();
  const rates = page.getByRole('region', { name: 'Hourly rates' });
  await rates.getByRole('button', { name: 'Remove the rate from 1 Jan 2025' }).click();
  await rates.getByRole('button', { name: 'Remove rate' }).click();

  // 8 days before 12 March have no rate; the 14 days from it are 56 h at €95.00.
  await expect(cell).toHaveText(/^5,320\.00◇/);
  await expect(cell).toHaveAttribute('title', /No rate for 8 of 22 working days/);
});
