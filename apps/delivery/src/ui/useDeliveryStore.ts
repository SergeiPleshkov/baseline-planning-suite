import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  createDeliveryStore,
  type DeliverySnapshot,
  type DeliveryStore,
} from '../application/deliveryStore';
import { createDeliveryGateway } from '../infrastructure/deliveryGateway';
import { loadRemoteConfig } from '../infrastructure/remoteConfig';

export type Runtime =
  | { readonly status: 'starting' }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'ready'; readonly store: DeliveryStore };

/** Reads this remote's `config.json`, then builds the store on the service it names. */
export function useDeliveryRuntime(): { runtime: Runtime; restart: () => void } {
  const [runtime, setRuntime] = useState<Runtime>({ status: 'starting' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setRuntime({ status: 'starting' });
    const fetchImpl = (input: string, init?: RequestInit) => fetch(input, init);
    loadRemoteConfig(fetchImpl, __webpack_public_path__, window.location.href).then(
      (config) => {
        if (cancelled) return;
        const store = createDeliveryStore(createDeliveryGateway({ baseUrl: config.deliveryApi }));
        setRuntime({ status: 'ready', store });
        void store.load();
      },
      (error: unknown) => {
        if (cancelled) return;
        setRuntime({
          status: 'failed',
          message: `Delivery could not read its configuration: ${error instanceof Error ? error.message : String(error)}`,
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

export function useDeliverySnapshot(store: DeliveryStore): DeliverySnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
