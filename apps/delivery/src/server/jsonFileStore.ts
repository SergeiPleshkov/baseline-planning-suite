import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import process from 'node:process';

export interface JsonFileStore {
  /** `undefined` while nothing has been stored yet. */
  read: () => Promise<unknown>;
  write: (document: unknown) => Promise<void>;
  /** Resolves once every write accepted so far has finished, successfully or not. */
  idle: () => Promise<void>;
}

const isErrno = (error: unknown, ...codes: string[]): boolean =>
  error instanceof Error &&
  'code' in error &&
  typeof error.code === 'string' &&
  codes.includes(error.code);

/** Flushes the rename itself: without it, power loss can bring back the previous document. */
async function syncDirectory(directory: string): Promise<void> {
  try {
    const handle = await open(directory, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    // Windows cannot open a directory for this; anywhere else a failure is real.
    if (!(process.platform === 'win32' && isErrno(error, 'EISDIR', 'EPERM', 'EINVAL'))) throw error;
  }
}

/**
 * One JSON document in a file. A write goes to a temporary file that is flushed and then renamed
 * over the real one, so a crash leaves either the old document or the new, never half of one.
 * Writes run one after another, and one that fails does not stop the ones after it.
 */
export function jsonFileStore(path: string): JsonFileStore {
  let queue: Promise<unknown> = Promise.resolve();
  const temporary = `${path}.${String(process.pid)}.tmp`;

  async function replaceFile(document: unknown): Promise<void> {
    const text = `${JSON.stringify(document, null, 2)}\n`;
    await mkdir(dirname(path), { recursive: true });
    try {
      const file = await open(temporary, 'w');
      try {
        await file.writeFile(text);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    await syncDirectory(dirname(path));
  }

  return {
    async read() {
      try {
        return JSON.parse(await readFile(path, 'utf8')) as unknown;
      } catch (error) {
        if (isErrno(error, 'ENOENT')) return undefined;
        throw error;
      }
    },

    write(document) {
      const run = queue.then(() => replaceFile(document));
      queue = run.catch(() => undefined);
      return run;
    },

    idle: async () => {
      await queue;
    },
  };
}
