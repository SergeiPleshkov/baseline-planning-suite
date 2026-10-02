import { describe, expect, it } from 'vitest';
import { viewFromPath } from './navigation';

describe('viewFromPath', () => {
  it('names the view of each path the shell links to', () => {
    expect(viewFromPath('/people')).toBe('people');
    expect(viewFromPath('/delivery')).toBe('delivery');
    expect(viewFromPath('/side-by-side')).toBe('side-by-side');
  });

  it('opens People for the root and for any path it does not know', () => {
    expect(viewFromPath('/')).toBe('people');
    expect(viewFromPath('/delivery/extra')).toBe('people');
    expect(viewFromPath('/Delivery')).toBe('people');
  });
});
