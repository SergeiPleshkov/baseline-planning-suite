import { expect, test } from '@playwright/test';
import { openStaffing, referenceCell, restoreReference, showUnit } from './support';

test.describe('the reference calculation: Adaeze Okafor, March 2026', () => {
  test.beforeEach(async ({ page, request }) => {
    await restoreReference(request);
    await openStaffing(page, '/delivery');
  });

  test('reads 0.50 · 88.00 · 50.0 · 7,880.00 in the four units', async ({ page }) => {
    const cell = await referenceCell(page);
    for (const [unit, figure] of [
      ['Person-months', '0.50'],
      ['Hours', '88.00'],
      ['% of capacity', '50.0'],
      ['Cost (EUR)', '7,880.00'],
    ] as const) {
      await showUnit(page, unit);
      await expect(cell).toHaveText(figure);
    }
  });

  test('explains the cost: 8 days at €80.00 and 14 days at €95.00 make 88.00 h and €7,880.00', async ({
    page,
  }) => {
    await showUnit(page, 'Cost (EUR)');
    await (await referenceCell(page)).click();
    const calculation = page.getByRole('region', { name: /^Calculation: Adaeze Okafor, Mar 2026/ });
    const slices = calculation.getByRole('table', { name: 'The month split by rate' });
    await expect(slices.getByRole('row')).toHaveText([
      /Period.*Cost \(EUR\)/,
      /2 Mar – 11 Mar\s*8\s*€80\.00\s*32\.00\s*2,560\.00/,
      /12 Mar – 31 Mar\s*14\s*€95\.00\s*56\.00\s*5,320\.00/,
      /Total\s*22\s*88\.00\s*7,880\.00/,
    ]);
    await expect(calculation).toContainText('€89.5455 an hour');
  });

  test('is shown in the currency the shell chose', async ({ page }) => {
    await page.getByLabel('Currency').selectOption('USD');
    await showUnit(page, 'Cost (USD)');
    await expect(await referenceCell(page)).toHaveText('9,219.60');
  });
});
