import { defineConfig } from '@playwright/test';

// The stack under test is the one users get: `docker compose up --build`, reached through its gateway.
// It must hold the seed data (`docker compose down -v` resets it): the tests read figures from it.
const channel = process.env['E2E_BROWSER_CHANNEL'];

export default defineConfig({
  testDir: 'tests',
  // The tests change the stack's data and restore it, so they take turns.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:8080',
    // Locally an installed browser can stand in for the downloaded one: E2E_BROWSER_CHANNEL=msedge.
    ...(channel === undefined ? {} : { channel }),
    trace: 'retain-on-failure',
    // Dates are UTC-only in the product: a browser far from UTC must show the same figures.
    timezoneId: 'Pacific/Auckland',
    locale: 'en-GB',
  },
});
