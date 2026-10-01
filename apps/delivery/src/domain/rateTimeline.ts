import type { IsoDate } from './calendar';

export interface RateChange {
  readonly effectiveFrom: IsoDate;
  readonly hourlyRateEur: number;
}

/**
 * An employee's cost rate over time. Each change applies from its `effectiveFrom` (inclusive)
 * until the next one; the last has no end; before the first there is no rate.
 * Only `rateTimeline()` builds one, so it is always sorted with at most one change per day.
 */
export type RateTimeline = { readonly changes: readonly RateChange[] } & {
  readonly __brand: 'RateTimeline';
};

export function rateTimeline(changes: readonly RateChange[]): RateTimeline {
  const sorted: readonly RateChange[] = [...changes].sort((a, b) =>
    a.effectiveFrom.localeCompare(b.effectiveFrom),
  );
  sorted.forEach((change, index) => {
    if (!Number.isFinite(change.hourlyRateEur) || change.hourlyRateEur < 0) {
      throw new RangeError(`Invalid hourly rate on ${change.effectiveFrom}`);
    }
    if (index > 0 && sorted[index - 1]?.effectiveFrom === change.effectiveFrom) {
      throw new RangeError(`Two rate changes on ${change.effectiveFrom}`);
    }
  });
  return { changes: sorted } as RateTimeline;
}

export function rateOn(timeline: RateTimeline, date: IsoDate): number | null {
  let rate: number | null = null;
  for (const change of timeline.changes) {
    if (change.effectiveFrom > date) break;
    rate = change.hourlyRateEur;
  }
  return rate;
}
