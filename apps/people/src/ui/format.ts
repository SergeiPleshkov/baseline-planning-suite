import type { DisplayCurrency } from '@baseline/host-contract';

const LOCALE = 'en-GB';

const moneyFormats = new Map<string, Intl.NumberFormat>();

const moneyFormat = (code: string): Intl.NumberFormat => {
  const known = moneyFormats.get(code);
  if (known) return known;
  const made = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: code });
  moneyFormats.set(code, made);
  return made;
};

const capacity = new Intl.NumberFormat(LOCALE, {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const month = new Intl.DateTimeFormat(LOCALE, { month: 'short', year: 'numeric', timeZone: 'UTC' });

const day = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export const formatMoney = (amountEur: number, currency: DisplayCurrency): string =>
  moneyFormat(currency.code).format(amountEur * currency.ratePerEur);

/** A share of one person-month, as a percentage of the person's capacity. */
export const formatCapacity = (personMonths: number): string => capacity.format(personMonths);

/** `2026-06` as `Jun 2026`. */
export const formatMonth = (yearMonth: string): string =>
  month.format(new Date(`${yearMonth}-01T00:00:00Z`));

/** `2026-03-12` as `12 Mar 2026`. */
export const formatDate = (date: string): string => day.format(new Date(`${date}T00:00:00Z`));
