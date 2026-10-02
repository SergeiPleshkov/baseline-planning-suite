import { describe, expect, it } from 'vitest';
import type { Fetch } from './http';
import { createPeopleSource } from './peopleGateway';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('createPeopleSource', () => {
  it('reads employees and rates from the configured base and hands back the bodies untouched', async () => {
    const urls: string[] = [];
    const fetchImpl: Fetch = (url) => {
      urls.push(url);
      return json({ revision: 3, anything: ['at', 'all'] });
    };
    const source = createPeopleSource({ baseUrl: '/api/people/v1/', fetch: fetchImpl });
    expect(await source.employees()).toEqual({ revision: 3, anything: ['at', 'all'] });
    await source.rates();
    expect(urls).toEqual(['/api/people/v1/employees', '/api/people/v1/rates']);
  });

  it('throws when People answers an error status', async () => {
    const source = createPeopleSource({ baseUrl: '/x', fetch: () => json({}, 503) });
    await expect(source.rates()).rejects.toThrow(/HTTP 503/);
  });
});
