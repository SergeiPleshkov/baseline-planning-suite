import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  createPeopleStore,
  type PeopleSnapshot,
  type PeopleStore,
} from '../application/peopleStore';
import { createPeopleGateway } from '../infrastructure/peopleGateway';
import { loadRemoteConfig } from '../infrastructure/remoteConfig';
import { createWorkloadGateway } from '../infrastructure/workloadGateway';

export type Runtime =
  | { readonly status: 'starting' }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'ready'; readonly store: PeopleStore };

/** Reads this remote's `config.json`, then builds the store on the services it names. */
export function usePeopleRuntime(): { runtime: Runtime; restart: () => void } {
  const [runtime, setRuntime] = useState<Runtime>({ status: 'starting' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setRuntime({ status: 'starting' });
    const fetchImpl = (input: string, init?: RequestInit) => fetch(input, init);
    loadRemoteConfig(fetchImpl, __webpack_public_path__, window.location.href).then(
      (config) => {
        if (cancelled) return;
        const store = createPeopleStore({
          people: createPeopleGateway({ baseUrl: config.peopleApi }),
          workload: createWorkloadGateway({ baseUrl: config.deliveryApi }),
        });
        setRuntime({ status: 'ready', store });
        void store.load();
      },
      (error: unknown) => {
        if (cancelled) return;
        setRuntime({
          status: 'failed',
          message: `People could not read its configuration: ${error instanceof Error ? error.message : String(error)}`,
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return {
    runtime,
    restart: () => {
      setAttempt((count) => count + 1);
    },
  };
}

export function usePeopleSnapshot(store: PeopleStore): PeopleSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
