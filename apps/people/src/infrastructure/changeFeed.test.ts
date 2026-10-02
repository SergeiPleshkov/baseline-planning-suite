import { DELIVERY_API_PATHS } from '@baseline/delivery-contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedHandlers } from '../application/ports';
import { createChangeFeed, type EventSourceLike } from './changeFeed';

const CONNECTING = 0;
const CLOSED = 2;

class FakeSource implements EventSourceLike {
  readonly listeners = new Map<string, ((event: Event) => void)[]>();
  readyState = CONNECTING;
  closed = false;
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
    this.readyState = CLOSED;
  }
  emit(type: string, data?: string) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(data === undefined ? new Event(type) : Object.assign(new Event(type), { data }));
    }
  }
}

function setup() {
  const sources: FakeSource[] = [];
  const handlers: FeedHandlers = { onChange: vi.fn(), onConnected: vi.fn(), onLost: vi.fn() };
  const feed = createChangeFeed({
    url: `/api/delivery/v1${DELIVERY_API_PATHS.events}`,
    eventName: 'workload-changed',
    eventSource: (url) => {
      const source = new FakeSource(url);
      sources.push(source);
      return source;
    },
  });
  const close = feed.open(handlers);
  const first = sources[0];
  if (!first) throw new Error('no stream was opened');
  return { sources, source: first, handlers, close };
}

const EVENT = JSON.stringify({
  type: 'workload-changed',
  version: 1,
  employeeIds: ['emp-001'],
  revision: 4,
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createChangeFeed', () => {
  it('opens the stream at the address it was given', () => {
    expect(setup().source.url).toBe('/api/delivery/v1/events');
  });

  it('reports a change for an event, whatever it carries, since it only says that something changed', () => {
    const { source, handlers } = setup();
    source.emit('workload-changed', EVENT);
    source.emit('workload-changed', 'not json');
    source.emit('workload-changed', JSON.stringify({ type: 'workload-changed', version: 2 }));
    source.emit('workload-changed');
    expect(handlers.onChange).toHaveBeenCalledTimes(4);
  });

  it('does not take an event of another name for a change', () => {
    const { source, handlers } = setup();
    source.emit('other-event', EVENT);
    expect(handlers.onChange).not.toHaveBeenCalled();
  });

  it('reports every opening, including the ones after a break, and every break', () => {
    const { source, handlers } = setup();
    source.emit('open');
    source.emit('error');
    source.emit('error');
    source.emit('open');
    expect(handlers.onConnected).toHaveBeenCalledTimes(2);
    expect(handlers.onLost).toHaveBeenCalledTimes(2);
  });

  it('leaves a stream that is only reconnecting to the browser', () => {
    const { sources, source } = setup();
    source.emit('error');
    vi.advanceTimersByTime(60_000);
    expect(sources).toHaveLength(1);
    expect(source.closed).toBe(false);
  });

  it('closes the stream when it is closed, and reports nothing more', () => {
    const { source, handlers, close } = setup();
    close();
    expect(source.closed).toBe(true);
    source.emit('open');
    source.emit('error');
    source.emit('workload-changed', EVENT);
    expect(handlers.onConnected).not.toHaveBeenCalled();
    expect(handlers.onLost).not.toHaveBeenCalled();
    expect(handlers.onChange).not.toHaveBeenCalled();
  });
});

describe('a stream the server refused', () => {
  function refuse(source: FakeSource) {
    source.readyState = CLOSED;
    source.emit('error');
  }

  it('is opened again after a pause, and the new stream is reported when it opens', () => {
    const { sources, source, handlers } = setup();
    refuse(source);
    expect(handlers.onLost).toHaveBeenCalledTimes(1);
    expect(sources).toHaveLength(1);
    vi.advanceTimersByTime(999);
    expect(sources).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sources).toHaveLength(2);
    sources[1]?.emit('open');
    expect(handlers.onConnected).toHaveBeenCalledTimes(1);
    sources[1]?.emit('workload-changed', EVENT);
    expect(handlers.onChange).toHaveBeenCalledTimes(1);
  });

  it('waits twice as long each time, up to a limit, and starts over once a stream opens', () => {
    const { sources, source } = setup();
    refuse(source);
    const pauses: number[] = [];
    for (let attempt = 1; attempt <= 7; attempt += 1) {
      const before = sources.length;
      let waited = 0;
      while (sources.length === before && waited < 20_000) {
        vi.advanceTimersByTime(500);
        waited += 500;
      }
      pauses.push(waited);
      const latest = sources.at(-1);
      if (!latest) throw new Error('no stream');
      refuse(latest);
    }
    expect(pauses).toEqual([1000, 2000, 4000, 8000, 15000, 15000, 15000]);

    const latest = sources.at(-1);
    if (!latest) throw new Error('no stream');
    latest.readyState = CONNECTING;
    latest.emit('open');
    refuse(latest);
    const before = sources.length;
    vi.advanceTimersByTime(1000);
    expect(sources).toHaveLength(before + 1);
  });

  it('is not opened again once the feed was closed', () => {
    const { sources, source, close } = setup();
    refuse(source);
    close();
    vi.advanceTimersByTime(60_000);
    expect(sources).toHaveLength(1);
  });

  it('is not opened again by an error that arrives after the feed was closed', () => {
    const { sources, source, close } = setup();
    close();
    source.emit('error');
    vi.advanceTimersByTime(60_000);
    expect(sources).toHaveLength(1);
  });
});
