import { z } from 'zod';
import type { Fetch } from './http';

/** Where this remote finds the services it talks to; read at start-up, never bundled. */
const RemoteConfigSchema = z.object({
  deliveryApi: z.string().min(1),
  peopleApi: z.string().min(1),
});

export type RemoteConfig = z.infer<typeof RemoteConfigSchema>;

/**
 * `config.json` sits next to the remote's own files, wherever they are served from. The public
 * path may be relative to the page, so the page's own address is needed to resolve it.
 */
export async function loadRemoteConfig(
  fetchImpl: Fetch,
  publicPath: string,
  pageUrl: string,
): Promise<RemoteConfig> {
  const url = new URL('config.json', new URL(publicPath, pageUrl)).href;
  const response = await fetchImpl(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url} answered HTTP ${String(response.status)}.`);
  return RemoteConfigSchema.parse(await response.json());
}
