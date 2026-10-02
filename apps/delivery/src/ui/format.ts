const LOCALE = 'en-GB';

const dateFormat = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(LOCALE, { ...options, timeZone: 'UTC' });

const month = dateFormat({ month: 'short', year: 'numeric' });
const monthShort = dateFormat({ month: 'short', year: '2-digit' });
const day = dateFormat({ day: 'numeric', month: 'short' });

const euroRate = (decimals: number) =>
  new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

const euroRates = { 2: euroRate(2), 4: euroRate(4) };

const decimal = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const startOfMonth = (yearMonth: string): Date => new Date(`${yearMonth}-01T00:00:00Z`);

/** `2026-06` as `Jun 2026`. */
export const formatMonth = (yearMonth: string): string => month.format(startOfMonth(yearMonth));

/** `2026-06` as `Jun 26`: a column heading. */
export const formatMonthShort = (yearMonth: string): string =>
  monthShort.format(startOfMonth(yearMonth));

export const formatDay = (date: string): string => day.format(new Date(`${date}T00:00:00Z`));

/** A rate in EUR an hour, as stored: `€95.00`, or with 4 decimals for a blended rate. */
export const formatEuroRate = (rate: number, decimals: 2 | 4 = 2): string =>
  euroRates[decimals].format(rate);

export const formatDecimal = (value: number): string => decimal.format(value);
