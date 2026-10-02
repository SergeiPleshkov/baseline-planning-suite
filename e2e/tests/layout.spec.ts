import { expect, test } from '@playwright/test';
import { openStaffing } from './support';

test('a wide staffing grid in Delivery does not squeeze People side by side', async ({ page }) => {
  await page.goto('/side-by-side');
  const people = page.getByRole('region', { name: 'Employees' });
  await expect(people).toBeVisible();
  const before = (await people.boundingBox())?.width ?? 0;

  await openStaffing(page, '/side-by-side');
  await expect(page.getByRole('region', { name: 'Employees' })).toBeVisible();
  const after = (await page.getByRole('region', { name: 'Employees' }).boundingBox())?.width ?? 0;

  expect(before).toBeGreaterThan(300);
  expect(after).toBe(before);
});
