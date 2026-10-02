import { describe, expect, it } from 'vitest';
import { byText } from './sorting';

describe('byText', () => {
  it('orders by code unit, so capitals come before lower case in every locale', () => {
    expect(['b', 'B', 'a', 'A'].sort(byText)).toEqual(['A', 'B', 'a', 'b']);
  });

  it('is zero for equal text and orders digits before letters', () => {
    expect(byText('emp-1', 'emp-1')).toBe(0);
    expect(['x', '9', 'emp-10', 'emp-2'].sort(byText)).toEqual(['9', 'emp-10', 'emp-2', 'x']);
  });
});
