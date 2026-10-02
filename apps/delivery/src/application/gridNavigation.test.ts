import { describe, expect, it } from 'vitest';
import { movedFocus, rememberFocus, tabStopOf, type Modifiers } from './gridNavigation';

const size = { rows: 4, columns: 5 };
const none: Modifiers = { ctrl: false, alt: false, shift: false, meta: false };
const move = (row: number, column: number, key: string, modifiers: Partial<Modifiers> = {}) =>
  movedFocus({ row, column }, key, { ...none, ...modifiers }, size);

describe('movedFocus', () => {
  it('moves one cell with the arrows', () => {
    expect(move(1, 2, 'ArrowUp')).toEqual({ row: 0, column: 2 });
    expect(move(1, 2, 'ArrowDown')).toEqual({ row: 2, column: 2 });
    expect(move(1, 2, 'ArrowLeft')).toEqual({ row: 1, column: 1 });
    expect(move(1, 2, 'ArrowRight')).toEqual({ row: 1, column: 3 });
  });

  it('stops at the edges instead of wrapping', () => {
    expect(move(0, 0, 'ArrowUp')).toEqual({ row: 0, column: 0 });
    expect(move(0, 0, 'ArrowLeft')).toEqual({ row: 0, column: 0 });
    expect(move(3, 4, 'ArrowDown')).toEqual({ row: 3, column: 4 });
    expect(move(3, 4, 'ArrowRight')).toEqual({ row: 3, column: 4 });
  });

  it('goes to the ends of the row with Home and End, and to the corners with Ctrl', () => {
    expect(move(2, 3, 'Home')).toEqual({ row: 2, column: 0 });
    expect(move(2, 3, 'End')).toEqual({ row: 2, column: 4 });
    expect(move(2, 3, 'Home', { ctrl: true })).toEqual({ row: 0, column: 0 });
    expect(move(2, 3, 'End', { ctrl: true })).toEqual({ row: 3, column: 4 });
    expect(move(2, 3, 'End', { meta: true })).toEqual({ row: 3, column: 4 });
  });

  it('leaves other keys alone', () => {
    expect(move(1, 1, 'Enter')).toBeNull();
    expect(move(1, 1, 'a')).toBeNull();
    expect(move(1, 1, 'Tab')).toBeNull();
  });

  it('leaves alone what the browser or system does with a modifier', () => {
    expect(move(1, 1, 'ArrowLeft', { alt: true })).toBeNull();
    expect(move(1, 1, 'ArrowRight', { meta: true })).toBeNull();
    expect(move(1, 1, 'ArrowRight', { ctrl: true })).toBeNull();
    expect(move(1, 1, 'ArrowDown', { shift: true })).toBeNull();
    expect(move(1, 1, 'Home', { alt: true })).toBeNull();
  });
});

describe('the remembered tab stop', () => {
  const keys = ['a', 'b', 'c'];

  it('is the first cell before the grid has had the focus', () => {
    expect(tabStopOf({ key: null, column: 0 }, keys, 5)).toEqual({ row: 0, column: 0 });
  });

  it('follows its row when rows above it come and go', () => {
    const focus = rememberFocus({ row: 2, column: 3 }, keys);
    expect(tabStopOf(focus, keys, 5)).toEqual({ row: 2, column: 3 });
    expect(tabStopOf(focus, ['b', 'c'], 5)).toEqual({ row: 1, column: 3 });
  });

  it('falls back to the first row when its row is hidden', () => {
    const focus = rememberFocus({ row: 1, column: 2 }, keys);
    expect(tabStopOf(focus, ['a', 'c'], 5)).toEqual({ row: 0, column: 2 });
  });

  it('knows the totals row, which comes after the lines', () => {
    const focus = rememberFocus({ row: 3, column: 1 }, keys);
    expect(focus.key).not.toBeNull();
    expect(tabStopOf(focus, keys, 5)).toEqual({ row: 3, column: 1 });
    expect(tabStopOf(focus, ['a'], 5)).toEqual({ row: 1, column: 1 });
  });

  it('keeps the column inside the grid', () => {
    expect(tabStopOf({ key: 'a', column: 9 }, keys, 5)).toEqual({ row: 0, column: 4 });
  });
});
