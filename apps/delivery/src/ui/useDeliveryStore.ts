import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  createDeliveryStore,
  type DeliverySnapshot,
  type DeliveryStore,
} from '../application/deliveryStore';
import { createStaffStore, type StaffStore, type StaffView } from '../application/staffStore';
import { createDeliveryGateway } from '../infrastructure/deliveryGateway';
import { createPeopleFeed, createPeopleSource } from '../infrastructure/peopleGateway';
import { loadRemoteConfig } from '../infrastructure/remoteConfig';

export type Runtime =
  | { readonly status: 'starting' }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'ready'; readonly store: DeliveryStore; readonly staff: StaffStore };

/** Reads this remote's `config.json`, then builds the stores on the services it names. */
export function useDeliveryRuntime(): { runtime: Runtime; restart: () => void } {
  const [runtime, setRuntime] = useState<Runtime>({ status: 'starting' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let stopFollowing: () => void = () => undefined;
    setRuntime({ status: 'starting' });
    const fetchImpl = (input: string, init?: RequestInit) => fetch(input, init);
    loadRemoteConfig(fetchImpl, __webpack_public_path__, window.location.href).then(
      (config) => {
        if (cancelled) return;
        const store = createDeliveryStore(createDeliveryGateway({ baseUrl: config.deliveryApi }));
        const staff = createStaffStore(createPeopleSource({ baseUrl: config.peopleApi }));
        setRuntime({ status: 'ready', store, staff });
        void store.load();
        void staff.load();
        stopFollowing = staff.follow(createPeopleFeed({ baseUrl: config.peopleApi }));
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
      stopFollowing();
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

export function useStaffView(store: StaffStore): StaffView {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
