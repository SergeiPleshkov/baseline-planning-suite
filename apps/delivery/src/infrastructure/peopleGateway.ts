import { PEOPLE_API_PATHS } from '@baseline/people-contract';
import { z } from 'zod';
import type { PeopleSource } from '../application/ports';
import { browserFetch, getJson, joinUrl, type Fetch } from './http';

/**
 * Hands back People's answers as received: `peopleContract.ts` is where they are validated against
 * the published contract and turned into Delivery's own types.
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
