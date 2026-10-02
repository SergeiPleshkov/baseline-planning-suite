import { describe, expect, it } from 'vitest';
import { resolveEntries, simulatedOutages } from './remotes';

describe('simulatedOutages', () => {
  it('reads the remotes named in ?break=, and nothing else', () => {
    expect(simulatedOutages('?break=people')).toEqual(new Set(['people']));
    expect(simulatedOutages('?break=people,delivery')).toEqual(new Set(['people', 'delivery']));
    expect(simulatedOutages('?break=shell,nobody')).toEqual(new Set());
    expect(simulatedOutages('?other=1')).toEqual(new Set());
    expect(simulatedOutages('')).toEqual(new Set());
  });
});

describe('resolveEntries', () => {
  const configured = {
    people: '/mf/people/mf-manifest.json',
    delivery: 'https://delivery.example/mf-manifest.json',
  };
  const origin = 'http://localhost:8080';

  it('resolves each entry against the page, keeping absolute ones as they are', () => {
    expect(resolveEntries(configured, new Set(), origin)).toEqual({
      people: 'http://localhost:8080/mf/people/mf-manifest.json',
      delivery: 'https://delivery.example/mf-manifest.json',
    });
  });

  it('points a remote under rehearsed outage at an entry that does not exist, on its own host', () => {
    expect(resolveEntries(configured, new Set(['people', 'delivery'] as const), origin)).toEqual({
      people: 'http://localhost:8080/mf/people/__unavailable__/mf-manifest.json',
      delivery: 'https://delivery.example/__unavailable__/mf-manifest.json',
    });
  });
});
