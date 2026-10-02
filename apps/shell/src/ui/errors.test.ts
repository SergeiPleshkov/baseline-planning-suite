import { describe, expect, it } from 'vitest';
import { describeError } from './errors';

describe('describeError', () => {
  it('keeps the first line, without the troubleshooting text federation errors append', () => {
    const error = new Error(
      '[ Federation Runtime ]: Failed to get manifest. #RUNTIME-003\nargs: {...}\nhttps://module-federation.io/guide/troubleshooting',
    );
    expect(describeError(error)).toBe(
      '[ Federation Runtime ]: Failed to get manifest. #RUNTIME-003',
    );
  });

  it('describes something thrown that is not an Error', () => {
    expect(describeError('timed out')).toBe('timed out');
  });
});
