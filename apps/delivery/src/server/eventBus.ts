export interface EventBus<T> {
  publish: (event: T) => void;
  /** Returns the function that stops listening. */
  subscribe: (listener: (event: T) => void) => () => void;
}

export function createEventBus<T>(): EventBus<T> {
  const listeners = new Set<(event: T) => void>();
  return {
    publish(event) {
      for (const listener of [...listeners]) listener(event);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
