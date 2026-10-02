import { expect, test } from '@playwright/test';
import {
  correctOkaforRate,
  openStaffing,
  referenceCell,
  restoreOkaforRate,
  showUnit,
} from './support';

// The reference cell costs 8 days at €80.00 and 14 days at €95.00. Raising the second rate to
// €100.00 makes it 2,560.00 + 56.00 h × 100 = 8,160.00.
const BEFORE = '7,880.00';
const AFTER = '8,160.00';

test.beforeEach(async ({ request }) => {
  await restoreOkaforRate(request);
});

test.afterEach(async ({ request }) => {
  await restoreOkaforRate(request);
});

test('a rate corrected in People reprices Delivery on the same page, without a reload', async ({
  page,
}) => {
  await openStaffing(page, '/side-by-side');
  await showUnit(page, 'Cost (EUR)');
  const cell = await referenceCell(page);
  await expect(cell).toHaveText(BEFORE);

  let reloads = 0;
  page.on('load', () => {
    reloads += 1;
  });
  await correctOkaforRate(page, 100);
  await expect(cell).toHaveText(AFTER);
  await correctOkaforRate(page, 95);
  await expect(cell).toHaveText(BEFORE);
  expect(reloads).toBe(0);
});

test('a rate corrected in another tab reprices an open Delivery tab', async ({ page, context }) => {
  await openStaffing(page, '/delivery');
  await showUnit(page, 'Cost (EUR)');
  const cell = await referenceCell(page);
  await expect(cell).toHaveText(BEFORE);

  const people = await context.newPage();
  await people.goto('/people');
  await correctOkaforRate(people, 100);

  await expect(cell).toHaveText(AFTER);
});
