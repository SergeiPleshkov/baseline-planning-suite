const LOCALE = 'en-GB';

/** `2026-06` as `Jun 2026`. */
export const formatMonth = (month: string): string =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString(LOCALE, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** `2026-06` as `Jun 26`: a column heading. */
export const formatMonthShort = (month: string): string =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString(LOCALE, {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });

export const formatDay = (date: string): string =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(LOCALE, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

/** A rate in EUR an hour, as stored: `€95.00`, or with more decimals for a blended rate. */
export const formatEuroRate = (rate: number, decimals = 2): string =>
  new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(rate);

export const formatDecimal = (value: number, decimals = 2): string =>
  new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
