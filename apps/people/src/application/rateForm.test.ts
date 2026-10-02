import { describe, expect, it } from 'vitest';
import { parseDateInput, parseHourlyRateInput } from './rateForm';

describe('parseHourlyRateInput', () => {
  it.each([
    ['95', 95],
    [' 95.5 ', 95.5],
    ['95,50', 95.5],
    ['0,5', 0.5],
    ['1,25', 1.25],
    ['1250.50', 1250.5],
    ['0.07', 0.07],
    ['10000', 10_000],
    ['112.35', 112.35],
  ])('reads %j as %d', (text, expected) => {
    expect(parseHourlyRateInput(text)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['', /Enter an hourly rate/],
    ['abc', /as a number/],
    ['-5', /as a number/],
    ['1e3', /as a number/],
    ['9 5', /as a number/],
    ['0', /above zero/],
    ['0.00', /above zero/],
    ['10000.01', /at most 10000/],
    ['95.125', /two decimals/],
    ['1,250', /thousands separator/],
    ['1,250.50', /thousands separator/],
    ['12,345,678', /thousands separator/],
    ['1.005', /two decimals/],
  ])('refuses %j, saying why', (text, message) => {
    const result = parseHourlyRateInput(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
  });
});

describe('parseDateInput', () => {
  it('accepts a real date, a leap day included', () => {
    expect(parseDateInput('2028-02-29')).toEqual({ ok: true, value: '2028-02-29' });
  });

  it.each([
    ['', /Choose the day/],
    ['2026-02-30', /real date/],
    ['26-01-01', /real date/],
    ['1899-12-31', /before 1900/],
  ])('refuses %j, saying why', (text, message) => {
    const result = parseDateInput(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
  });
});
