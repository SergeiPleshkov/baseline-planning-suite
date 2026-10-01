import { HOST_CONTRACT_VERSION, type HostContext } from '@baseline/host-contract';
import { useMemo, useState } from 'react';
import type { RuntimeConfig } from './runtimeConfig';

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts for this page only.
  }
}

function usePersistentChoice(key: string) {
  const [value, setValue] = useState(() => readStored(key));
  const choose = (next: string) => {
    store(key, next);
    setValue(next);
  };
  return [value, choose] as const;
}

export function useHostContext(config: RuntimeConfig) {
  const [currencyCode, selectCurrency] = usePersistentChoice('baseline.shell.currency');
  const [userId, selectUser] = usePersistentChoice('baseline.shell.user');

  const displayCurrency =
    config.currencies.find((currency) => currency.code === currencyCode) ?? config.currencies[0];
  const activeUser = config.users.find((user) => user.id === userId) ?? config.users[0];

  const host = useMemo<HostContext>(
    () => ({ contractVersion: HOST_CONTRACT_VERSION, displayCurrency, activeUser }),
    [displayCurrency, activeUser],
  );

  return { host, selectCurrency, selectUser };
}
