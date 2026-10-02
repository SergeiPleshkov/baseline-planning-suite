import type { DisplayCurrency } from '@baseline/host-contract';

const LOCALE = 'en-GB';

/** Money is stored in EUR; what the person sees is `amountEur * ratePerEur` in the shell's currency. */
export const formatMoney = (amountEur: number, currency: DisplayCurrency): string =>
  new Intl.NumberFormat(LOCALE, { style: 'currency', currency: currency.code }).format(
    amountEur * currency.ratePerEur,
  );

/** A share of one person-month, as a percentage of the person's capacity. */
export const formatCapacity = (personMonths: number): string =>
  new Intl.NumberFormat(LOCALE, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(personMonths);

/** `2026-06` as `Jun 2026`. */
export const formatMonth = (month: string): string =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString(LOCALE, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** `2026-03-12` as `12 Mar 2026`. */
export const formatDate = (date: string): string =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
