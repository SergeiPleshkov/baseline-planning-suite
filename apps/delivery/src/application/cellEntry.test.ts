import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isoDate, yearMonth } from '../domain/calendar';
import { priceMonth } from '../domain/pricing';
import { rateTimeline } from '../domain/rateTimeline';
import { DISPLAY_UNITS, type ConversionContext } from '../domain/units';
import { formatSteps } from './figures';
import {
  entryEndedBy,
  entryStartedBy,
  isChange,
  parseFigure,
  personMonthsFromEntry,
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
    ['', 0],
    ['   ', 0],
  ])('reads %j as %d', (text, expected) => {
    expect(parseFigure(text)).toEqual({ ok: true, value: expected });
  });

  it.each(['abc', '1e3', '-1', '+1', '1.2.3', '1,5,0', '12,34,567', '0.5%', '1 000', '--', '.'])(
    'refuses %j',
    (text) => {
      expect(parseFigure(text)).toEqual({ ok: false, error: 'Enter a number, for example 0.5.' });
    },
  );

  it('reads back whatever a cell shows, in every unit', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.constantFrom(...DISPLAY_UNITS),
        (steps, unit) => {
          const shown = formatSteps(steps, unit);
          const read = parseFigure(shown);
          const decimals = shown.split('.')[1]?.length ?? 0;
          expect(read.ok && Math.round(read.value * 10 ** decimals)).toBe(steps);
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
    expect(personMonthsFromEntry(text, unit, okafor)).toEqual({ ok: true, value: 0.5 });
  });

  it('needs no context for person-months and percent', () => {
    expect(personMonthsFromEntry('50', 'capacityPercent', null)).toEqual({ ok: true, value: 0.5 });
    expect(personMonthsFromEntry('0.25', 'personMonths', null)).toEqual({ ok: true, value: 0.25 });
  });

  it('cannot convert hours or cost without it', () => {
    for (const unit of ['hours', 'cost'] as const) {
      const result = personMonthsFromEntry('10', unit, null);
      expect(result.ok).toBe(false);
    }
  });

  it('refuses money in a month without any rate, and says what to do', () => {
    const noRate: ConversionContext = {
      pricing: priceMonth(yearMonth('2024-12'), 40, rateTimeline([])),
      currencyPerEur: 1,
    };
    const result = personMonthsFromEntry('1000', 'cost', noRate);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('no rate');
    expect(personMonthsFromEntry('88', 'hours', noRate).ok).toBe(true);
  });

  it('passes a parse error through', () => {
    expect(personMonthsFromEntry('x', 'hours', okafor)).toEqual({
      ok: false,
      error: 'Enter a number, for example 0.5.',
    });
  });

  it('reads blank and zero as zero in any unit, which clears the cell', () => {
    for (const unit of DISPLAY_UNITS) {
      expect(personMonthsFromEntry('', unit, okafor)).toEqual({ ok: true, value: 0 });
      expect(personMonthsFromEntry('0', unit, okafor)).toEqual({ ok: true, value: 0 });
    }
  });

  it('clears a cell in money too where the month has no rate, or the register is unknown', () => {
    const noRate: ConversionContext = {
      pricing: priceMonth(yearMonth('2024-12'), 40, rateTimeline([])),
      currencyPerEur: 1,
    };
    for (const context of [noRate, null]) {
      expect(personMonthsFromEntry('0', 'cost', context)).toEqual({ ok: true, value: 0 });
      expect(personMonthsFromEntry('', 'hours', context)).toEqual({ ok: true, value: 0 });
    }
  });

  it('refuses more than a cell can hold while the text is still being edited', () => {
    const tooMuch = 'An allocation is between 0 and 100 person-months.';
    expect(personMonthsFromEntry('1,500', 'personMonths', okafor)).toEqual({
      ok: false,
      error: tooMuch,
    });
    expect(personMonthsFromEntry('100000', 'hours', okafor)).toEqual({ ok: false, error: tooMuch });
    expect(personMonthsFromEntry('100', 'personMonths', okafor)).toEqual({ ok: true, value: 100 });
    expect(personMonthsFromEntry('1000000000', 'capacityPercent', okafor).ok).toBe(false);
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

  it('starts typing with a digit, a point or a comma', () => {
    for (const key of ['0', '5', '9', '.', ',']) {
      expect(entryStartedBy(key, none)).toEqual({ kind: 'type', text: key });
    }
    expect(entryStartedBy('5', { ...none, shift: true })).toEqual({ kind: 'type', text: '5' });
  });

  it('leaves letters, other keys and shortcuts alone', () => {
    for (const key of ['a', 'x', '-', '%', ' ', 'Tab', 'Escape', 'ArrowDown', '10']) {
      expect(entryStartedBy(key, none)).toBeNull();
    }
    for (const modifier of ['ctrl', 'alt', 'meta'] as const) {
      expect(entryStartedBy('5', { ...none, [modifier]: true })).toBeNull();
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
  it('is false for the text the cell showed, however it is padded', () => {
    expect(isChange('0.33', '0.33')).toBe(false);
    expect(isChange(' 0.33 ', '0.33')).toBe(false);
    expect(isChange('', '')).toBe(false);
  });

  it('is true for anything else, even an equal number written differently', () => {
    expect(isChange('0.330', '0.33')).toBe(true);
    expect(isChange('0', '')).toBe(true);
    expect(isChange('', '0.33')).toBe(true);
  });
});
