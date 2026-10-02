import type { ChangeFeed } from '../application/ports';

/** The part of the browser's `EventSource` that the feed uses, so that tests can stand one in. */
export interface EventSourceLike {
  readonly readyState: number;
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  close: () => void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

const browserEventSource: EventSourceFactory = (url) => new EventSource(url);

/** `EventSource.CLOSED`: the browser has given up on the stream. */
const CLOSED = 2;
const FIRST_RETRY_MS = 1_000;
const LONGEST_RETRY_MS = 15_000;

/**
 * Server-sent events of one name. An event only says that something changed: what it carries is
 * not read, so one from a producer on another version still makes the consumer read again. Each
 * opening is reported, because what happened in between is not known. The browser reopens a stream
 * that broke while it was open, but not one that the server or a proxy in front of it refused (a
 * 502 while the service restarts): that one is reopened here, after a pause that doubles up to a
 * limit. A feed that was closed reports nothing more.
 */
export function createChangeFeed(options: {
  readonly url: string;
  readonly eventName: string;
  readonly eventSource?: EventSourceFactory;
}): ChangeFeed {
  const connect = options.eventSource ?? browserEventSource;
  return {
    open(handlers) {
      let current: EventSourceLike | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let pause = FIRST_RETRY_MS;
      let stopped = false;

      const start = () => {
        const source = connect(options.url);
        current = source;
        source.addEventListener('open', () => {
          if (stopped) return;
          pause = FIRST_RETRY_MS;
          handlers.onConnected();
        });
        source.addEventListener('error', () => {
          if (stopped) return;
          handlers.onLost();
          if (source.readyState !== CLOSED) return;
          timer = setTimeout(start, pause);
          pause = Math.min(pause * 2, LONGEST_RETRY_MS);
        });
        source.addEventListener(options.eventName, () => {
          if (!stopped) handlers.onChange();
        });
      };
      start();

      return () => {
        stopped = true;
        clearTimeout(timer);
        current?.close();
      };
    },
  };
}
