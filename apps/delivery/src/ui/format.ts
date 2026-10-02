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
