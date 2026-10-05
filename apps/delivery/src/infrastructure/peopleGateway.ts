import { PEOPLE_API_PATHS, RatesChangedEventSchema } from '@baseline/people-contract';
import { z } from 'zod';
import type { ChangeFeed, PeopleSource } from '../application/ports';
import { createChangeFeed, type EventSourceFactory } from './changeFeed';
import { browserFetch, getJson, joinUrl, type Fetch } from './http';

/**
 * Hands back People's answers as received: `application/peopleContract.ts` is where they are
 * validated against the published contract and turned into Delivery's own types.
 */
export function createPeopleSource(options: {
  readonly baseUrl: string;
  readonly fetch?: Fetch;
}): PeopleSource {
  const fetchImpl = options.fetch ?? browserFetch;
  const url = (path: string) => joinUrl(options.baseUrl, path);
  return {
    employees: () => getJson(fetchImpl, url(PEOPLE_API_PATHS.employees), z.unknown()),
    rates: () => getJson(fetchImpl, url(PEOPLE_API_PATHS.rates), z.unknown()),
  };
}

/** People's `rates-changed` notices, which say whose rates changed and nothing more. */
export const createPeopleFeed = (options: {
  readonly baseUrl: string;
  readonly eventSource?: EventSourceFactory;
}): ChangeFeed =>
  createChangeFeed({
    url: joinUrl(options.baseUrl, PEOPLE_API_PATHS.events),
    eventName: RatesChangedEventSchema.shape.type.value,
    ...(options.eventSource ? { eventSource: options.eventSource } : {}),
  });
