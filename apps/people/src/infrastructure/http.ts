import type { z } from 'zod';

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export const TIMEOUT_MS = 10_000;

export const browserFetch: Fetch = (input, init) => globalThis.fetch(input, init);

export const joinUrl = (base: string, path: string): string => `${base.replace(/\/+$/, '')}${path}`;

/**
 * A read: anything but a 2xx answer that satisfies the schema is an error. The message is a
 * sentence for the screen; what exactly was wrong goes to the console.
 */
export async function getJson<S extends z.ZodType>(
  fetchImpl: Fetch,
  url: string,
  schema: S,
): Promise<z.infer<S>> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${url} answered HTTP ${String(response.status)}.`);
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    console.error(`${url} answered something unexpected`, parsed.error);
    throw new Error(`${url} answered something this screen does not understand.`);
  }
  return parsed.data;
}
