import type { JsonFileStore } from './jsonFileStore';

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The state to start from: what the store holds, or on the very first start the service's part of
 * the seed, which is then stored. A file that cannot be read or is not a valid document stops the
 * service with its path in the message rather than quietly starting from the seed and overwriting
 * what was there.
 */
export async function startFromStore<State>(options: {
  readonly store: JsonFileStore;
  readonly file: string;
  readonly seed: () => Promise<unknown>;
  readonly parse: (document: unknown) => State;
  readonly toDocument: (state: State) => unknown;
  readonly onImport: () => void;
}): Promise<State> {
  const { store, file, seed, parse, toDocument, onImport } = options;
  let stored: unknown;
  try {
    stored = await store.read();
  } catch (error) {
    throw new Error(`Cannot read ${file}: ${reason(error)}`, { cause: error });
  }

  if (stored === undefined) {
    const state = parse(await seed());
    await store.write(toDocument(state));
    onImport();
    return state;
  }
  try {
    return parse(stored);
  } catch (error) {
    throw new Error(`${file} does not hold a valid document: ${reason(error)}`, { cause: error });
  }
}
