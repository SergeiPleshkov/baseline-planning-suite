import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jsonFileStore } from './jsonFileStore';

let directory = '';

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'people-store-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('jsonFileStore', () => {
  it('has nothing to read before the first write', async () => {
    expect(await jsonFileStore(join(directory, 'doc.json')).read()).toBeUndefined();
  });

  it('reads back what was written, in a folder that did not exist', async () => {
    const store = jsonFileStore(join(directory, 'nested', 'doc.json'));
    await store.write({ revision: 3, names: ['Ada'] });
    expect(await store.read()).toEqual({ revision: 3, names: ['Ada'] });
  });

  it('is read by a new store on the same file, as after a restart', async () => {
    const path = join(directory, 'doc.json');
    await jsonFileStore(path).write({ revision: 9 });
    expect(await jsonFileStore(path).read()).toEqual({ revision: 9 });
  });

  it('keeps the last of several simultaneous writes and leaves no temporary file', async () => {
    const path = join(directory, 'doc.json');
    const store = jsonFileStore(path);
    await Promise.all([1, 2, 3, 4, 5, 6].map((revision) => store.write({ revision })));
    expect(await store.read()).toEqual({ revision: 6 });
    expect(await readdir(directory)).toEqual(['doc.json']);
  });

  it('keeps the old document and keeps working after a write that fails', async () => {
    const path = join(directory, 'doc.json');
    const store = jsonFileStore(path);
    await store.write({ revision: 1 });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(store.write(circular)).rejects.toThrow();
    expect(await store.read()).toEqual({ revision: 1 });
    await store.write({ revision: 2 });
    expect(await store.read()).toEqual({ revision: 2 });
    expect(await readdir(directory)).toEqual(['doc.json']);
  });

  it('is idle only after every write accepted before has finished', async () => {
    const path = join(directory, 'doc.json');
    const store = jsonFileStore(path);
    void store.write({ revision: 1 });
    void store.write({ revision: 2 });
    await store.idle();
    expect(await store.read()).toEqual({ revision: 2 });
  });

  it('refuses to read a file that is not JSON instead of starting from nothing', async () => {
    const path = join(directory, 'doc.json');
    await writeFile(path, '{ truncated');
    await expect(jsonFileStore(path).read()).rejects.toThrow();
  });
});
