/** A calendar date, `YYYY-MM-DD`. Lexicographic order is chronological order. */
export type IsoDate = string & { readonly __brand: 'IsoDate' };

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

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

export function dayBefore(date: IsoDate): IsoDate {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const previous = new Date(Date.UTC(year, month - 1, day - 1));
  const [y, m, d] = [previous.getUTCFullYear(), previous.getUTCMonth() + 1, previous.getUTCDate()];
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}` as IsoDate;
}
