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

/** Figures are shown with `,` grouping thousands, and the first group never starts with a zero. */
const GROUPED = /^[1-9]\d{0,2}(,\d{3})+(\.\d*)?$/;
const NUMBER = /^(\d+(\.\d*)?|\.\d+)$/;

/**
 * What a person typed into a cell, as a number in the unit shown. The grouping a cell is displayed
 * with is accepted back, so is a comma for the point (`0,5`), and blank means zero. `0,333` is a
 * third, not 333: a group of thousands does not start with a zero.
 */
export function parseFigure(text: string): Result<number, string> {
  const typed = text.trim();
  if (typed === '') return ok(0);
  const plain = GROUPED.test(typed) ? typed.replaceAll(',', '') : typed.replace(',', '.');
  return NUMBER.test(plain) ? ok(Number(plain)) : err('Enter a number, for example 0.5.');
}

/**
 * The person-months that a typed figure stands for. Person-months and percent need nothing else;
 * hours and cost are converted for the person and month of the cell, so `context` is null only when
 * that is not known.
 */
export function personMonthsFromEntry(
  text: string,
  unit: DisplayUnit,
  context: ConversionContext | null,
): Result<number, string> {
  const typed = parseFigure(text);
  if (!typed.ok) return typed;
  // Zero clears a cell in every unit, whatever the month costs: it needs no conversion.
  if (typed.value === 0) return ok(0);
  const personMonths = convert(typed.value, unit, context);
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
 * What a key does to a cell that is not being edited: Enter and F2 open it on its current text, the
 * first character of a number replaces the text, Delete and Backspace clear it. A combination with
 * Ctrl, Alt or Cmd is a shortcut, not typing.
 */
export function entryStartedBy(key: string, modifiers: Modifiers): EntryStart | null {
  if (key === 'Enter' || key === 'F2') return { kind: 'open' };
  if (key === 'Delete' || key === 'Backspace') return { kind: 'clear' };
  const shortcut = modifiers.ctrl || modifiers.alt || modifiers.meta;
  return !shortcut && /^[0-9.,]$/.test(key) ? { kind: 'type', text: key } : null;
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
 * figure: committing the same text again would replace the exact stored value (a third shown as
 * 0.33) with the rounded one, and could change which edit is the latest.
 */
export const isChange = (typed: string, shown: string): boolean => typed.trim() !== shown;
