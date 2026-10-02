import { isoDate, type IsoDate } from '../domain/calendar';
import { MAX_HOURLY_RATE_EUR, isValidHourlyRate } from '../domain/rates';
import { err, ok, type Result } from '../domain/result';

const EARLIEST_DATE = '1900-01-01';

/** What a person typed into the rate field, in EUR per hour; a comma may stand for the point. */
export function parseHourlyRateInput(text: string): Result<number, string> {
  const typed = text.trim();
  if (typed === '') return err('Enter an hourly rate.');
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(typed)) {
    return err('Write the rate without a thousands separator, for example 1250.50.');
  }
  const trimmed = typed.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return err('Enter the rate as a number, for example 95.50.');
  const rate = Number(trimmed);
  if (rate <= 0) return err('A rate is above zero.');
  if (rate > MAX_HOURLY_RATE_EUR) {
    return err(`A rate is at most ${String(MAX_HOURLY_RATE_EUR)} EUR an hour.`);
  }
  return isValidHourlyRate(rate)
    ? ok(rate)
    : err('A rate has at most two decimals: it is stored to the cent.');
}

/** What a date field holds: `YYYY-MM-DD`, or nothing. */
export function parseDateInput(text: string): Result<IsoDate, string> {
  if (text.trim() === '') return err('Choose the day the rate starts.');
  try {
    const date = isoDate(text.trim());
    return date < EARLIEST_DATE ? err('The rate cannot start before 1900.') : ok(date);
  } catch {
    return err('Enter a real date.');
  }
}
