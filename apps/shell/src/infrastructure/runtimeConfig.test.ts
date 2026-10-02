import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { loadRuntimeConfig } from './runtimeConfig';

const CONFIG = {
  remotes: { people: '/mf/people/mf-manifest.json', delivery: '/mf/delivery/mf-manifest.json' },
  currencies: [
    { code: 'EUR', ratePerEur: 1 },
    { code: 'USD', ratePerEur: 1.17 },
  ],
  users: [{ id: 'lukas.fischer', displayName: 'Lukas Fischer' }],
};

const serve = (status: number, body: unknown) => {
  const fetch = vi.fn(() => Promise.resolve(Response.json(body, { status })));
  vi.stubGlobal('fetch', fetch);
  return fetch;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadRuntimeConfig', () => {
  it('reads /config.json afresh at start-up', async () => {
    const fetch = serve(200, CONFIG);
    await expect(loadRuntimeConfig()).resolves.toEqual(CONFIG);
    expect(fetch).toHaveBeenCalledWith('/config.json', { cache: 'no-store' });
  });

  it('refuses an answer that is not a success', async () => {
    serve(404, {});
    await expect(loadRuntimeConfig()).rejects.toThrow('GET /config.json answered HTTP 404');
  });

  it.each([
    ['a missing remote', { ...CONFIG, remotes: { people: '/mf/people/mf-manifest.json' } }],
    ['no currency', { ...CONFIG, currencies: [] }],
    [
      'a currency code that is not ISO 4217',
      { ...CONFIG, currencies: [{ code: 'eur', ratePerEur: 1 }] },
    ],
    ['a rate of zero', { ...CONFIG, currencies: [{ code: 'EUR', ratePerEur: 0 }] }],
    ['no user', { ...CONFIG, users: [] }],
  ])('refuses a configuration with %s', async (_, config) => {
    serve(200, config);
    await expect(loadRuntimeConfig()).rejects.toBeInstanceOf(ZodError);
  });
});
