import {
  fromDisplayUnit,
  fromPlainUnit,
  isPlainUnit,
  type ConversionContext,
  type DisplayUnit,
} from '../domain/units';
import { isValidAllocationAmount } from '../domain/plan';
import { err, ok, type Result } from '../domain/result';
import type { Modifiers } from './gridNavigation';
import { messageFor } from './messages';

/** What a column shows: its unit, and the display currency that money is shown in. */
export interface ShownUnit {
  readonly unit: DisplayUnit;
  readonly currency: string;
}

/** A typed figure: a plain number, a number with its unit (`88 h`, `50%`), or money (`€7,880`). */
export type TypedFigure =
  | { readonly value: number; readonly unit: null }
  | { readonly value: number; readonly unit: Exclude<DisplayUnit, 'cost'> }
  | { readonly value: number; readonly unit: 'cost'; readonly currency: string };

const SHAPE = /^([-−])?\s*([\p{L}%€$£]*)\s*([-−])?\s*([\d.,\s]*?)\s*([\p{L}%€$£]*)$/u;
const NUMBER = /^(\d+(\.\d*)?|\.\d+)$/;
/** `7,880.00`, as cells show figures. `0,333` is a third: grouped figures never begin with 0. */
const GROUPED_EN = /^[1-9]\d{0,2}(,\d{3})+(\.\d*)?$/;
/** `7.880,00`: unambiguous only with the decimal comma. */
const GROUPED_DE = /^[1-9]\d{0,2}(\.\d{3})+,\d*$/;
const GROUPED_SPACES = /^[1-9]\d{0,2}(\s\d{3})+([.,]\d*)?$/;
/** `7.880` is seven point eight eight to a reader of English and 7880 to a reader of German. */
const DOT_GROUPS = /^[1-9]\d{0,2}(\.\d{3})+$/;

const HOURS = new Set(['h', 'hr', 'hrs', 'hour', 'hours']);
const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  '€': 'EUR',
  $: 'USD',
  us$: 'USD',
  '£': 'GBP',
};
const CURRENCY_CODES = new Set(Intl.supportedValuesOf('currency'));

const EXAMPLE: Readonly<Record<DisplayUnit, string>> = {
  personMonths: '0.5',
  hours: '88',
  capacityPercent: '50',
  cost: '7,880.00',
};

type Marker =
  | { readonly unit: null }
  | { readonly unit: Exclude<DisplayUnit, 'cost'> }
  | { readonly unit: 'cost'; readonly currency: string };

function markerOf(written: string): Marker | null {
  const name = written.toLowerCase();
  if (name === '') return { unit: null };
  if (name === '%') return { unit: 'capacityPercent' };
  if (name === 'pm') return { unit: 'personMonths' };
  if (HOURS.has(name)) return { unit: 'hours' };
  const code = CURRENCY_SYMBOLS[name] ?? name.toUpperCase();
  return CURRENCY_CODES.has(code) ? { unit: 'cost', currency: code } : null;
}

function numberIn(body: string): number | null {
  const plain = GROUPED_EN.test(body)
    ? body.replaceAll(',', '')
    : GROUPED_DE.test(body)
      ? body.replaceAll('.', '').replace(',', '.')
      : GROUPED_SPACES.test(body)
        ? body.replace(/\s/g, '').replace(',', '.')
        : body.replace(',', '.');
  return NUMBER.test(plain) ? Number(plain) : null;
}

/**
 * What a person typed into a cell of a column in `shown`, or `null` if it is not a figure. The
 * grouping a cell is shown with is accepted back, so are a comma for the point (`0,5`), spaces
 * between thousands and `7.880,00`; `7.880` is refused as money, where it could mean either. A unit
 * may stand before or after the number, a minus before either; blank means zero.
 */
export function parseFigure(text: string, shown: DisplayUnit): TypedFigure | null {
  const typed = text.trim();
  if (typed === '') return { value: 0, unit: null };
  const [, leading, before = '', inner, body = '', after = ''] = SHAPE.exec(typed) ?? [];
  const signs = [leading, inner].filter((sign) => sign !== undefined).length;
  if (body === '' || (before !== '' && after !== '') || signs > 1) return null;
  const marker = markerOf(before || after);
  if (marker === null) return null;
  if ((marker.unit ?? shown) === 'cost' && DOT_GROUPS.test(body)) return null;
  const number = numberIn(body);
  if (number === null) return null;
  return { ...marker, value: signs === 1 ? -number : number };
}

const moneyIn = (currency: string): string =>
  currency === 'EUR'
    ? 'Enter money in EUR, the currency shown.'
    : `Enter money in ${currency}, the currency shown, or in EUR.`;

/**
 * The person-months that a typed figure stands for. A figure is read in the unit shown unless
 * another is written with it, so `88 h` is hours in any column; money is in the display currency,
 * or in EUR when written so. Person-months and percent need nothing else; hours and cost are
 * converted for the person and month of the cell, so `context` is null only when that is not known.
 */
export function personMonthsFromEntry(
  text: string,
  shown: ShownUnit,
  context: ConversionContext | null,
): Result<number, string> {
  const typed = parseFigure(text, shown.unit);
  if (typed === null) return err(`Enter a number, for example ${EXAMPLE[shown.unit]}.`);
  if (typed.value < 0) return err('An allocation cannot be negative.');
  // Zero clears a cell in every unit, whatever the month costs: it needs no conversion.
  if (typed.value === 0) return ok(0);
  let conversion = context;
  if (typed.unit === 'cost' && typed.currency !== shown.currency) {
    if (typed.currency !== 'EUR') return err(moneyIn(shown.currency));
    conversion = context && { ...context, currencyPerEur: 1 };
  }
  const personMonths = convert(typed.value, typed.unit ?? shown.unit, conversion);
  if (!personMonths.ok) return personMonths;
  return isValidAllocationAmount(personMonths.value)
    ? personMonths
    : err(messageFor('invalid-amount'));
}

function convert(
  value: number,
  unit: DisplayUnit,
  context: ConversionContext | null,
): Result<number, string> {
  if (isPlainUnit(unit)) return ok(fromPlainUnit(value, unit));
  if (context === null) return err('This amount cannot be converted without the People register.');
  const converted = fromDisplayUnit(value, unit, context);
  return converted.ok
    ? converted
    : err(
        'This person has no rate in that month, so an amount of money cannot be converted. Enter person-months, hours or a percentage instead.',
      );
}

export type EntryStart =
  | { readonly kind: 'open' }
  | { readonly kind: 'type'; readonly text: string }
  | { readonly kind: 'clear' };

/**
 * What a key does to a cell that is not being edited: Enter and F2 open it on its current text, a
 * printable character replaces the text (so a minus or a currency sign is kept, and a figure that
 * is not one is refused with a reason), Delete and Backspace clear it. Space is left to the grid.
 * Ctrl or Cmd with a key is a shortcut, but Ctrl with Alt is AltGr, which types € on a German
 * keyboard. Alt alone types characters on a Mac, while with a letter or digit elsewhere it is the
 * browser's shortcut.
 */
export function entryStartedBy(key: string, modifiers: Modifiers): EntryStart | null {
  if (key === 'Enter' || key === 'F2') return { kind: 'open' };
  if (key === 'Delete' || key === 'Backspace') return { kind: 'clear' };
  const shortcut =
    modifiers.meta ||
    (modifiers.ctrl && !modifiers.alt) ||
    (modifiers.alt && !modifiers.ctrl && /^[a-z0-9]$/i.test(key));
  return !shortcut && /^\S$/u.test(key) ? { kind: 'type', text: key } : null;
}

export interface EntryExit {
  /** Whether the text is committed; Escape leaves it as it was. */
  readonly commit: boolean;
  /** Where the focus goes: Enter moves down and Shift+Enter up, Tab right and Shift+Tab left. */
  readonly step: 'down' | 'up' | 'right' | 'left' | 'stay';
}

export function entryEndedBy(key: string, shift: boolean): EntryExit | null {
  switch (key) {
    case 'Enter':
      return { commit: true, step: shift ? 'up' : 'down' };
    case 'Tab':
      return { commit: true, step: shift ? 'left' : 'right' };
    case 'Escape':
      return { commit: false, step: 'stay' };
    default:
      return null;
  }
}

/**
 * Whether what was typed is something other than what the cell showed. A cell shows a rounded
 * figure: committing the same figure again, however it is written (`€7,880`, `7880.0`), would
 * replace the exact stored value (a third shown as 0.33) with the rounded one, and could change
 * which edit is the latest. Blank or zero over a figure is a change even where the figure shows as
 * zero (`0.00` for days without a rate): it removes the allocation.
 */
export function isChange(typed: string, shownText: string, shown: ShownUnit): boolean {
  if (typed.trim() === shownText) return false;
  const now = parseFigure(typed, shown.unit);
  if (now?.value === 0) return shownText !== '';
  const before = parseFigure(shownText, shown.unit);
  if (now === null || before === null) return true;
  const sameUnit =
    (now.unit ?? shown.unit) === shown.unit &&
    (now.unit !== 'cost' || now.currency === shown.currency);
  return !sameUnit || now.value !== before.value;
}
