/** A calendar date, `YYYY-MM-DD`. Lexicographic order is chronological order. */
export type IsoDate = string & { readonly __brand: 'IsoDate' };

/** A calendar month, `YYYY-MM`. */
export type YearMonth = string & { readonly __brand: 'YearMonth' };

const pad = (value: number): string => String(value).padStart(2, '0');

function isCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function isoDate(value: string): IsoDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match || !isCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))) {
    throw new RangeError(`Not a calendar date (YYYY-MM-DD): ${value}`);
  }
  return value as IsoDate;
}

export function yearMonth(value: string): YearMonth {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match || !isCalendarDate(Number(match[1]), Number(match[2]), 1)) {
    throw new RangeError(`Not a calendar month (YYYY-MM): ${value}`);
  }
  return value as YearMonth;
}

export function addMonths(month: YearMonth, delta: number): YearMonth {
  if (!Number.isInteger(delta))
    throw new RangeError(`Not a whole number of months: ${String(delta)}`);
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + delta;
  return yearMonth(`${String(Math.floor(index / 12)).padStart(4, '0')}-${pad((index % 12) + 1)}`);
}

/** The months from `first` to `last`, both included. */
export interface MonthSpan {
  readonly first: YearMonth;
  readonly last: YearMonth;
}

export const monthOf = (date: IsoDate): YearMonth => yearMonth(date.slice(0, 7));

/** Every month from `first` to `last`, both included; none when `last` is before `first`. */
export function monthsBetween(first: YearMonth, last: YearMonth): readonly YearMonth[] {
  const months: YearMonth[] = [];
  for (let month = first; month <= last; month = addMonths(month, 1)) months.push(month);
  return months;
}

/** Monday to Friday. Public holidays are ignored by design. */
export function workingDaysIn(month: YearMonth): readonly IsoDate[] {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const days: IsoDate[] = [];
  for (let day = 1; isCalendarDate(year, monthIndex + 1, day); day++) {
    const weekday = new Date(Date.UTC(year, monthIndex, day)).getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      days.push(`${month}-${pad(day)}` as IsoDate);
    }
  }
  return days;
}
