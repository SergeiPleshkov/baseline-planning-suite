import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jsonFileStore } from './jsonFileStore';
import { startFromStore } from './startup';

let directory = '';
let file = '';

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'startup-'));
  file = join(directory, 'doc.json');
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

interface State {
  readonly revision: number;
}

function start(seed: () => Promise<unknown>) {
  let imports = 0;
  const parse = (document: unknown): State => {
    if (typeof document !== 'object' || document === null || !('revision' in document)) {
      throw new RangeError('no revision');
    }
    return { revision: Number(document.revision) };
  };
  return {
    imports: () => imports,
    run: () =>
      startFromStore({
        store: jsonFileStore(file),
        file,
        seed,
        parse,
        toDocument: (state: State) => state,
        onImport: () => {
          imports += 1;
        },
      }),
  };
}

describe('startFromStore', () => {
  it('imports the seed on the first start, stores it, and uses the file from then on', async () => {
    let seeds = 0;
    const first = start(() => {
      seeds += 1;
      return Promise.resolve({ revision: 1 });
    });
    expect(await first.run()).toEqual({ revision: 1 });
    expect(first.imports()).toBe(1);

    await jsonFileStore(file).write({ revision: 7 });
    const second = start(() => {
      seeds += 1;
      return Promise.resolve({ revision: 1 });
    });
    expect(await second.run()).toEqual({ revision: 7 });
    expect(second.imports()).toBe(0);
    expect(seeds).toBe(1);
  });

  it.each([
    ['an empty file', ''],
    ['a truncated file', '{ "revision": '],
    ['a file holding null', 'null'],
    ['a file that is not a document', '{ "something": "else" }'],
  ])('stops, naming the file, for %s, instead of starting from the seed', async (_label, text) => {
    await writeFile(file, text);
    const { run, imports } = start(() => Promise.resolve({ revision: 1 }));
    await expect(run()).rejects.toThrow(file);
    expect(imports()).toBe(0);
  });

  it('stops when the seed itself is not a valid document, storing nothing', async () => {
    const { run } = start(() => Promise.resolve({ nonsense: true }));
    await expect(run()).rejects.toThrow('no revision');
    expect(await jsonFileStore(file).read()).toBeUndefined();
  });
});
