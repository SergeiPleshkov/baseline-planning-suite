import { REMOTE_APP_EXPOSE, type RemoteAppProps } from '@baseline/host-contract';
import { loadRemote, registerRemotes } from '@module-federation/enhanced/runtime';
import type { ComponentType } from 'react';

const REMOTE_NAMES = ['people', 'delivery'] as const;
export type RemoteName = (typeof REMOTE_NAMES)[number];
export type RemoteEntries = Readonly<Record<RemoteName, string>>;

const LOAD_TIMEOUT_MS = 10_000;

function isRemoteName(value: string): value is RemoteName {
  return REMOTE_NAMES.some((name) => name === value);
}

/** `?break=people,delivery` — the remotes whose outage should be rehearsed. */
export function simulatedOutages(search: string): ReadonlySet<RemoteName> {
  const requested = new URLSearchParams(search).get('break')?.split(',') ?? [];
  return new Set(requested.filter(isRemoteName));
}

/** A remote under simulated outage gets an entry that does not exist, like a missing deployment. */
export function resolveEntries(
  configured: RemoteEntries,
  outages: ReadonlySet<RemoteName>,
  origin: string,
): RemoteEntries {
  const resolve = (name: RemoteName): string => {
    const entry = new URL(configured[name], origin);
    return outages.has(name) ? new URL('__unavailable__/mf-manifest.json', entry).href : entry.href;
  };
  return { people: resolve('people'), delivery: resolve('delivery') };
}

function isRemoteAppModule(value: unknown): value is { default: ComponentType<RemoteAppProps> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'default' in value &&
    typeof value.default === 'function'
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(message));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

export function createRemoteLoader(entries: RemoteEntries) {
  registerRemotes(REMOTE_NAMES.map((name) => ({ name, entry: entries[name] })));
  const exposedPath = REMOTE_APP_EXPOSE.replace(/^\.\//, '');

  return {
    entryOf(name: RemoteName): string {
      return entries[name];
    },

    async load(
      name: RemoteName,
      { afterFailure }: { afterFailure: boolean },
    ): Promise<ComponentType<RemoteAppProps>> {
      if (afterFailure) {
        // The runtime caches a failed entry; re-registering clears it so a retry really refetches.
        registerRemotes([{ name, entry: entries[name] }], { force: true });
      }
      const module = await withTimeout(
        loadRemote<unknown>(`${name}/${exposedPath}`),
        LOAD_TIMEOUT_MS,
        `No answer within ${String(LOAD_TIMEOUT_MS / 1000)} s`,
      );
      if (!isRemoteAppModule(module)) {
        throw new Error(`${name} does not expose a component as ${REMOTE_APP_EXPOSE}`);
      }
      return module.default;
    },
  };
}

export type RemoteLoader = ReturnType<typeof createRemoteLoader>;
