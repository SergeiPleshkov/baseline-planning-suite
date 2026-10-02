import { expect, test, type Page } from '@playwright/test';

const unavailable = (page: Page, name: string) =>
  page.getByRole('alert').filter({ hasText: `${name} is unavailable.` });

test.describe('a remote that cannot be loaded', () => {
  test('People fails alone: its panel says so and Delivery keeps working', async ({ page }) => {
    await page.goto('/side-by-side?break=people');
    await expect(unavailable(page, 'People')).toBeVisible();
    await expect(unavailable(page, 'People').getByRole('button', { name: 'Retry' })).toBeVisible();
    await page.getByRole('button', { name: 'Staffing' }).click();
    await expect(page.getByRole('treegrid')).toBeVisible();
  });

  test('Delivery fails alone: its panel says so and People keeps working', async ({ page }) => {
    await page.goto('/side-by-side?break=delivery');
    await expect(unavailable(page, 'Delivery')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Adaeze Okafor', exact: true })).toBeVisible();
  });

  test('stays down while navigating, until the person restores the remotes', async ({ page }) => {
    await page.goto('/people?break=people');
    await expect(unavailable(page, 'People')).toBeVisible();

    await page
      .getByRole('navigation', { name: 'Applications' })
      .getByRole('link', { name: 'Delivery' })
      .click();
    await expect(page).toHaveURL(/\/delivery\?break=people$/);
    await expect(page.getByRole('button', { name: 'Staffing' })).toBeVisible();

    await page.getByText('Diagnostics').click();
    await page.getByRole('link', { name: 'Restore all remotes' }).click();
    await expect(page).toHaveURL(/\/delivery$/);
    await expect(page.getByText('simulating outage')).toHaveCount(0);
    await page
      .getByRole('navigation', { name: 'Applications' })
      .getByRole('link', { name: 'People' })
      .click();
    await expect(page.getByRole('button', { name: 'Adaeze Okafor', exact: true })).toBeVisible();
    await expect(unavailable(page, 'People')).toHaveCount(0);
  });
});
