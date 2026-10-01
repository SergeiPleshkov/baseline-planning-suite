import { z } from 'zod';

const nonEmpty = <T extends z.ZodType>(item: T) => z.tuple([item], item);

const runtimeConfigSchema = z.object({
  remotes: z.object({
    people: z.string().min(1),
    delivery: z.string().min(1),
  }),
  currencies: nonEmpty(
    z.object({
      code: z.string().regex(/^[A-Z]{3}$/),
      ratePerEur: z.number().positive(),
    }),
  ),
  users: nonEmpty(
    z.object({
      id: z.string().min(1),
      displayName: z.string().min(1),
    }),
  ),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

/** Read at start-up rather than bundled, so remote URLs change without a rebuild. */
export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const response = await fetch('/config.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`GET /config.json answered HTTP ${String(response.status)}`);
  }
  return runtimeConfigSchema.parse(await response.json());
}
