import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isoDate, yearMonth } from '../domain/calendar';
import { priceMonth } from '../domain/pricing';
import { rateTimeline } from '../domain/rateTimeline';
import { DISPLAY_UNITS, type ConversionContext, type DisplayUnit } from '../domain/units';
import { formatSteps } from './figures';
import {
  entryEndedBy,
  entryStartedBy,
  isChange,
  parseFigure,
  personMonthsFromEntry,
  type ShownUnit,
} from './cellEntry';

const okafor: ConversionContext = {
  pricing: priceMonth(
    yearMonth('2026-03'),
    40,
    rateTimeline([
      { effectiveFrom: isoDate('2025-01-01'), hourlyRateEur: 80 },
      { effectiveFrom: isoDate('2026-03-12'), hourlyRateEur: 95 },
    ]),
  ),
  currencyPerEur: 1,
};

const EUR = (unit: DisplayUnit): ShownUnit => ({ unit, currency: 'EUR' });

describe('parseFigure', () => {
  it.each([
    ['0.5', 0.5],
    ['.5', 0.5],
    ['5.', 5],
    ['  12 ', 12],
    ['0,5', 0.5],
    ['0,333', 0.333],
    ['1,250', 1250],
    ['1,250.50', 1250.5],
    ['7,880.00', 7880],
    ['1,234,567.89', 1234567.89],
    ['7 880', 7880],
    ['7 880,50', 7880.5],
    ['7.880,00', 7880],
    ['1.250', 1.25],
    ['', 0],
    ['   ', 0],
  ])('reads %j as %d', (text, expected) => {
    expect(parseFigure(text, 'personMonths')).toEqual({ value: expected, unit: null });
  });

  it.each([
    ['88h', 88, 'hours'],
    ['88 hours', 88, 'hours'],
    ['88 Hrs', 88, 'hours'],
    ['50%', 50, 'capacityPercent'],
    ['50 %', 50, 'capacityPercent'],
    ['0.5 pm', 0.5, 'personMonths'],
  ] as const)('reads %j as %d with its unit', (text, value, unit) => {
    expect(parseFigure(text, 'personMonths')).toEqual({ value, unit });
  });

  it.each([
    ['€7,880.00', 7880, 'EUR'],
    ['€ 7,880', 7880, 'EUR'],
    ['7.880,00 €', 7880, 'EUR'],
    ['EUR 7880', 7880, 'EUR'],
    ['9,219.60 usd', 9219.6, 'USD'],
    ['$9,219.60', 9219.6, 'USD'],
    ['US$9,219.60', 9219.6, 'USD'],
    ['£100', 100, 'GBP'],
    ['100 CHF', 100, 'CHF'],
  ] as const)('reads %j as %d of money in %s', (text, value, currency) => {
    expect(parseFigure(text, 'personMonths')).toEqual({ value, unit: 'cost', currency });
  });

  it('keeps a minus before or after a leading unit, so that a negative is refused, not read as positive', () => {
    expect(parseFigure('-1', 'personMonths')).toEqual({ value: -1, unit: null });
    expect(parseFigure('−0.5', 'personMonths')).toEqual({ value: -0.5, unit: null });
    for (const text of ['-€5', '€-5', '−€ 5', '-5 €']) {
      expect(parseFigure(text, 'cost')).toEqual({ value: -5, unit: 'cost', currency: 'EUR' });
    }
  });

  it('refuses money written as 7.880, which reads as 7.88 in English and 7880 in German', () => {
    expect(parseFigure('7.880', 'cost')).toBeNull();
    expect(parseFigure('7.880 €', 'personMonths')).toBeNull();
    expect(parseFigure('€1.000.000', 'cost')).toBeNull();
    expect(parseFigure('7.880', 'personMonths')).toEqual({ value: 7.88, unit: null });
    expect(parseFigure('7.88', 'cost')).toEqual({ value: 7.88, unit: null });
  });

  it.each([
    'abc',
    '1e3',
    '+1',
    '1.2.3',
    '1,5,0',
    '12,34,567',
    '1  000',
    '--',
    '--5',
    '.',
    '€',
    '%5%',
    '88 km',
    '5 day',
    '50 pct',
    '€5 h',
    '1/2',
  ])('refuses %j', (text) => {
    expect(parseFigure(text, 'personMonths')).toBeNull();
  });

  it('reads back whatever a cell shows, in every unit', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.constantFrom(...DISPLAY_UNITS),
        (steps, unit) => {
          const shown = formatSteps(steps, unit);
          const read = parseFigure(shown, unit);
          const decimals = shown.split('.')[1]?.length ?? 0;
          expect(read && Math.round(read.value * 10 ** decimals)).toBe(steps);
        },
      ),
    );
  });
});

describe('personMonthsFromEntry', () => {
  it.each([
    ['personMonths', '0.5'],
    ['hours', '88'],
    ['capacityPercent', '50'],
    ['cost', '7,880.00'],
  ] as const)('turns the reference figure typed as %s into half a person-month', (unit, text) => {
    const result = personMonthsFromEntry(text, EUR(unit), okafor);
    expect(result.ok && result.value).toBeCloseTo(0.5, 12);
  });

  it.each(['88h', '50%', '€7,880.00', '7880 EUR', '0.5 pm'])(
    'reads %j in its own unit, whichever unit is shown',
    (text) => {
      for (const unit of DISPLAY_UNITS) {
        const result = personMonthsFromEntry(text, EUR(unit), okafor);
        expect(result.ok && result.value).toBeCloseTo(0.5, 12);
      }
    },
  );

  it('reads money in the display currency, and in EUR when it says so', () => {
    const usd = { ...okafor, currencyPerEur: 1.17 };
    const shown: ShownUnit = { unit: 'cost', currency: 'USD' };
    for (const text of ['9,219.60', '$9,219.60', '9219.6 USD', '€7,880', 'EUR 7880']) {
      const result = personMonthsFromEntry(text, shown, usd);
      expect(result.ok && result.value).toBeCloseTo(0.5, 12);
    }
    expect(personMonthsFromEntry('£100', shown, usd)).toEqual({
      ok: false,
      error: 'Enter money in USD, the currency shown, or in EUR.',
    });
    expect(personMonthsFromEntry('£100', EUR('cost'), okafor)).toEqual({
      ok: false,
      error: 'Enter money in EUR, the currency shown.',
    });
  });

  it('refuses a negative figure in every unit', () => {
    expect(personMonthsFromEntry('-€7,880', EUR('hours'), okafor)).toEqual({
      ok: false,
      error: 'An allocation cannot be negative.',
    });
    for (const unit of DISPLAY_UNITS) {
      expect(personMonthsFromEntry('-1', EUR(unit), okafor)).toEqual({
        ok: false,
        error: 'An allocation cannot be negative.',
      });
    }
  });

  it('needs no context for person-months and percent', () => {
    expect(personMonthsFromEntry('50', EUR('capacityPercent'), null)).toEqual({
      ok: true,
      value: 0.5,
    });
    expect(personMonthsFromEntry('0.25', EUR('personMonths'), null)).toEqual({
      ok: true,
      value: 0.25,
    });
  });

  it('cannot convert hours or cost without it, even when written in a plain column', () => {
    for (const unit of ['hours', 'cost'] as const) {
      expect(personMonthsFromEntry('10', EUR(unit), null).ok).toBe(false);
    }
    expect(personMonthsFromEntry('88 h', EUR('personMonths'), null).ok).toBe(false);
  });

  it('refuses money in a month without any rate, and says what to do', () => {
    const noRate: ConversionContext = {
      pricing: priceMonth(yearMonth('2024-12'), 40, rateTimeline([])),
      currencyPerEur: 1,
    };
    const result = personMonthsFromEntry('1000', EUR('cost'), noRate);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('no rate');
    expect(personMonthsFromEntry('88', EUR('hours'), noRate).ok).toBe(true);
  });

  it('says what a figure looks like in the unit shown', () => {
    expect(personMonthsFromEntry('x', EUR('hours'), okafor)).toEqual({
      ok: false,
      error: 'Enter a number, for example 88.',
    });
    expect(personMonthsFromEntry('x', EUR('personMonths'), okafor)).toEqual({
      ok: false,
      error: 'Enter a number, for example 0.5.',
    });
  });

  it('reads blank and zero as zero in any unit, which clears the cell', () => {
    for (const unit of DISPLAY_UNITS) {
      expect(personMonthsFromEntry('', EUR(unit), okafor)).toEqual({ ok: true, value: 0 });
      expect(personMonthsFromEntry('0', EUR(unit), okafor)).toEqual({ ok: true, value: 0 });
    }
  });

  it('clears a cell in money too where the month has no rate, or the register is unknown', () => {
    const noRate: ConversionContext = {
      pricing: priceMonth(yearMonth('2024-12'), 40, rateTimeline([])),
      currencyPerEur: 1,
    };
    for (const context of [noRate, null]) {
      expect(personMonthsFromEntry('0', EUR('cost'), context)).toEqual({ ok: true, value: 0 });
      expect(personMonthsFromEntry('', EUR('hours'), context)).toEqual({ ok: true, value: 0 });
    }
  });

  it('refuses more than a cell can hold while the text is still being edited', () => {
    const tooMuch = 'An allocation is between 0 and 100 person-months.';
    expect(personMonthsFromEntry('1,500', EUR('personMonths'), okafor)).toEqual({
      ok: false,
      error: tooMuch,
    });
    expect(personMonthsFromEntry('100000', EUR('hours'), okafor)).toEqual({
      ok: false,
      error: tooMuch,
    });
    expect(personMonthsFromEntry('100', EUR('personMonths'), okafor)).toEqual({
      ok: true,
      value: 100,
    });
    expect(personMonthsFromEntry('1000000000', EUR('capacityPercent'), okafor).ok).toBe(false);
  });
});

describe('entryStartedBy', () => {
  const none = { ctrl: false, alt: false, shift: false, meta: false };

  it('opens a cell with Enter or F2, and clears it with Delete or Backspace', () => {
    expect(entryStartedBy('Enter', none)).toEqual({ kind: 'open' });
    expect(entryStartedBy('F2', none)).toEqual({ kind: 'open' });
    expect(entryStartedBy('Delete', none)).toEqual({ kind: 'clear' });
    expect(entryStartedBy('Backspace', none)).toEqual({ kind: 'clear' });
  });

  it('starts typing with any printable character, so that nothing typed is lost', () => {
    for (const key of ['0', '5', '.', ',', '-', '€', '$', '%', 'a']) {
      expect(entryStartedBy(key, none)).toEqual({ kind: 'type', text: key });
    }
    expect(entryStartedBy('5', { ...none, shift: true })).toEqual({ kind: 'type', text: '5' });
  });

  it('leaves Alt with a letter or digit to the browser, outside a Mac', () => {
    expect(entryStartedBy('d', { ...none, alt: true })).toBeNull();
    expect(entryStartedBy('0', { ...none, alt: true })).toBeNull();
  });

  it('types what AltGr or Option makes, such as € on a German keyboard', () => {
    expect(entryStartedBy('€', { ...none, ctrl: true, alt: true })).toEqual({
      kind: 'type',
      text: '€',
    });
    expect(entryStartedBy('€', { ...none, alt: true })).toEqual({ kind: 'type', text: '€' });
  });

  it('leaves Space, other keys and shortcuts alone', () => {
    for (const key of [' ', 'Tab', 'Escape', 'ArrowDown', 'Home', 'F5']) {
      expect(entryStartedBy(key, none)).toBeNull();
    }
    for (const modifier of ['ctrl', 'meta'] as const) {
      expect(entryStartedBy('c', { ...none, [modifier]: true })).toBeNull();
    }
  });
});

describe('entryEndedBy', () => {
  it('commits and moves down on Enter, right on Tab, left on Shift+Tab', () => {
    expect(entryEndedBy('Enter', false)).toEqual({ commit: true, step: 'down' });
    expect(entryEndedBy('Enter', true)).toEqual({ commit: true, step: 'up' });
    expect(entryEndedBy('Tab', false)).toEqual({ commit: true, step: 'right' });
    expect(entryEndedBy('Tab', true)).toEqual({ commit: true, step: 'left' });
  });

  it('abandons the text on Escape and stays', () => {
    expect(entryEndedBy('Escape', false)).toEqual({ commit: false, step: 'stay' });
  });

  it('treats every other key as typing', () => {
    expect(entryEndedBy('5', false)).toBeNull();
    expect(entryEndedBy('ArrowLeft', false)).toBeNull();
  });
});

describe('isChange', () => {
  it('is false for the figure the cell showed, however it is written', () => {
    expect(isChange('0.33', '0.33', EUR('personMonths'))).toBe(false);
    expect(isChange(' 0.33 ', '0.33', EUR('personMonths'))).toBe(false);
    expect(isChange('0.330', '0.33', EUR('personMonths'))).toBe(false);
    expect(isChange('', '', EUR('personMonths'))).toBe(false);
    expect(isChange('0', '', EUR('personMonths'))).toBe(false);
    expect(isChange('€7,880', '7,880.00', EUR('cost'))).toBe(false);
    expect(isChange('7880 EUR', '7,880.00', EUR('cost'))).toBe(false);
    expect(isChange('50 %', '50.0', EUR('capacityPercent'))).toBe(false);
    expect(isChange('0.00', '0.00', EUR('cost'))).toBe(false);
  });

  it('is true for blank or zero over a figure, also one that shows as zero, since that removes it', () => {
    expect(isChange('', '0.00', EUR('cost'))).toBe(true);
    expect(isChange('0', '0.00', EUR('cost'))).toBe(true);
    expect(isChange('0', '0.50', EUR('personMonths'))).toBe(true);
  });

  it('is true for another figure, another unit or another currency', () => {
    expect(isChange('0.34', '0.33', EUR('personMonths'))).toBe(true);
    expect(isChange('', '0.33', EUR('personMonths'))).toBe(true);
    expect(isChange('0.33 h', '0.33', EUR('personMonths'))).toBe(true);
    expect(isChange('$7,880', '7,880.00', EUR('cost'))).toBe(true);
    expect(isChange('x', '0.33', EUR('personMonths'))).toBe(true);
  });
});
