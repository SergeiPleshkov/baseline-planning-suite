import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isoDate, type IsoDate } from './calendar';
import { employeeId, rateId } from './ids';
import {
  addRate,
  clearRates,
  correctRate,
  effectivePeriods,
  isValidHourlyRate,
  rateHistory,
  rateOn,
  removeRate,
  type RateHistory,
  type RateRecord,
} from './rates';
import { err, ok, type Result } from './result';

const EMPLOYEE = employeeId('emp-001');

const record = (id: string, validFrom: string, hourlyRateEur: number): RateRecord => ({
  id: rateId(id),
  validFrom: isoDate(validFrom),
  hourlyRateEur,
});

const history = (...records: RateRecord[]) => rateHistory(EMPLOYEE, records);

const unwrap = <T>(result: Result<T, string>): T => {
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

const rateAt = (of: RateHistory, date: string) => rateOn(of, isoDate(date));

describe('isValidHourlyRate', () => {
  it.each([80, 0.01, 0.07, 95.5, 112.35, 10_000])('accepts %d', (rate) => {
    expect(isValidHourlyRate(rate)).toBe(true);
  });

  it.each([
    0,
    -80,
    1.005,
    80.001,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MIN_VALUE,
    10_000.01,
    1e21,
  ])('rejects %d', (rate) => {
    expect(isValidHourlyRate(rate)).toBe(false);
  });

  it('accepts exactly the amounts written with at most two decimals', () => {
    const cents = fc.integer({ min: 1, max: 1_000_000 });
    fc.assert(
      fc.property(cents, (amount) => {
        expect(isValidHourlyRate(amount / 100)).toBe(true);
        expect(isValidHourlyRate((amount * 10 + 5) / 1000)).toBe(false);
      }),
    );
  });
});

describe('rateHistory', () => {
  it('sorts records by start date', () => {
    const sorted = history(record('b', '2026-03-12', 95), record('a', '2025-01-01', 80));
    expect(sorted.records.map((each) => each.id)).toEqual(['a', 'b']);
  });

  it('accepts an employee without records', () => {
    expect(history().records).toEqual([]);
  });

  it.each([
    [
      'two records starting the same day',
      [record('a', '2026-01-01', 80), record('b', '2026-01-01', 90)],
    ],
    ['a repeated id', [record('a', '2026-01-01', 80), record('a', '2026-02-01', 90)]],
    ['a rate of zero', [record('a', '2026-01-01', 0)]],
    ['a rate with three decimals', [record('a', '2026-01-01', 80.125)]],
  ])('rejects %s', (_label, records) => {
    expect(() => history(...records)).toThrow(RangeError);
  });
});

describe('rateOn', () => {
  const rates = history(record('a', '2025-01-01', 80), record('b', '2026-03-12', 95));

  it('has no rate before the first record', () => {
    expect(rateAt(rates, '2024-12-31')).toBeNull();
  });

  it('applies a record from its start date, inclusive, until the next one starts', () => {
    expect(rateAt(rates, '2025-01-01')).toBe(80);
    expect(rateAt(rates, '2026-03-11')).toBe(80);
    expect(rateAt(rates, '2026-03-12')).toBe(95);
  });

  it('keeps the last record in force with no end', () => {
    expect(rateAt(rates, '2099-12-31')).toBe(95);
  });
});

describe('effectivePeriods', () => {
  it('ends each period the day before the next record and leaves the last open', () => {
    const periods = effectivePeriods(
      history(
        record('a', '2025-01-01', 80),
        record('b', '2026-03-01', 90),
        record('c', '2028-03-01', 95),
      ),
    );
    expect(periods.map((period) => [period.from, period.to])).toEqual([
      ['2025-01-01', '2026-02-28'],
      ['2026-03-01', '2028-02-29'],
      ['2028-03-01', null],
    ]);
  });

  it('is empty without records', () => {
    expect(effectivePeriods(history())).toEqual([]);
  });
});

describe('addRate', () => {
  const base = history(record('a', '2025-01-01', 80), record('b', '2026-03-12', 95));

  it('adds a record in the past, between and after the existing ones', () => {
    const added = unwrap(addRate(base, record('c', '2024-06-01', 70)));
    expect(rateAt(added, '2024-06-01')).toBe(70);
    expect(rateAt(added, '2024-12-31')).toBe(70);
    expect(rateAt(added, '2025-01-01')).toBe(80);

    const between = unwrap(addRate(base, record('d', '2025-09-01', 85)));
    expect(rateAt(between, '2025-08-31')).toBe(80);
    expect(rateAt(between, '2025-09-01')).toBe(85);
    expect(rateAt(between, '2026-03-12')).toBe(95);

    const later = unwrap(addRate(base, record('e', '2027-01-01', 100)));
    expect(rateAt(later, '2026-12-31')).toBe(95);
    expect(rateAt(later, '2027-01-01')).toBe(100);
  });

  it('does not change the history it was given', () => {
    unwrap(addRate(base, record('c', '2024-06-01', 70)));
    expect(base.records).toHaveLength(2);
  });

  it('refuses a second record on a start date, whatever its rate', () => {
    expect(addRate(base, record('c', '2026-03-12', 95))).toEqual(err('duplicate-valid-from'));
  });

  it('refuses a repeated id', () => {
    expect(addRate(base, record('a', '2030-01-01', 99))).toEqual(err('duplicate-id'));
  });

  it.each([0, -1, 80.125, Number.NaN])('refuses a rate of %d', (rate) => {
    expect(addRate(base, record('c', '2030-01-01', rate))).toEqual(err('invalid-rate'));
  });
});

describe('correctRate', () => {
  const base = history(
    record('a', '2025-01-01', 80),
    record('b', '2026-03-12', 95),
    record('c', '2027-01-01', 100),
  );

  it('changes a rate in place', () => {
    const corrected = unwrap(correctRate(base, rateId('b'), { hourlyRateEur: 92.5 }));
    expect(rateAt(corrected, '2026-03-12')).toBe(92.5);
    expect(rateAt(corrected, '2026-12-31')).toBe(92.5);
    expect(rateAt(corrected, '2027-01-01')).toBe(100);
  });

  it('moves a start date, and with it the periods around it', () => {
    const moved = unwrap(correctRate(base, rateId('b'), { validFrom: isoDate('2026-02-01') }));
    expect(rateAt(moved, '2026-01-31')).toBe(80);
    expect(rateAt(moved, '2026-02-01')).toBe(95);
  });

  it('may move a record before or after its neighbours', () => {
    const first = unwrap(correctRate(base, rateId('c'), { validFrom: isoDate('2024-01-01') }));
    expect(first.records.map((each) => each.id)).toEqual(['c', 'a', 'b']);
    expect(rateAt(first, '2024-06-01')).toBe(100);
  });

  it('accepts a correction that changes nothing', () => {
    const same = unwrap(
      correctRate(base, rateId('b'), { validFrom: isoDate('2026-03-12'), hourlyRateEur: 95 }),
    );
    expect(same.records).toEqual(base.records);
  });

  it('refuses a start date another record already has', () => {
    expect(correctRate(base, rateId('b'), { validFrom: isoDate('2027-01-01') })).toEqual(
      err('duplicate-valid-from'),
    );
  });

  it('refuses an unknown record and an invalid rate', () => {
    expect(correctRate(base, rateId('zzz'), { hourlyRateEur: 90 })).toEqual(err('unknown-rate'));
    expect(correctRate(base, rateId('b'), { hourlyRateEur: 0 })).toEqual(err('invalid-rate'));
    expect(correctRate(base, rateId('b'), { hourlyRateEur: 90.001 })).toEqual(err('invalid-rate'));
  });
});

describe('removeRate', () => {
  const base = history(
    record('a', '2025-01-01', 80),
    record('b', '2026-03-12', 95),
    record('c', '2027-01-01', 100),
  );

  it('lets the previous record run on over a removed middle one', () => {
    const removed = unwrap(removeRate(base, rateId('b')));
    expect(rateAt(removed, '2026-12-31')).toBe(80);
    expect(rateAt(removed, '2027-01-01')).toBe(100);
  });

  it('leaves the days before the next record without a rate when the first is removed', () => {
    const removed = unwrap(removeRate(base, rateId('a')));
    expect(rateAt(removed, '2026-03-11')).toBeNull();
    expect(rateAt(removed, '2026-03-12')).toBe(95);
  });

  it('removes the last record: the one before it then has no end', () => {
    const removed = unwrap(removeRate(base, rateId('c')));
    expect(rateAt(removed, '2099-01-01')).toBe(95);
  });

  it('refuses an unknown record', () => {
    expect(removeRate(base, rateId('zzz'))).toEqual(err('unknown-rate'));
  });

  it('refuses to remove the only record, which clearRates does on purpose', () => {
    const single = history(record('a', '2025-01-01', 80));
    expect(removeRate(single, rateId('a'))).toEqual(err('only-rate'));
    const cleared = clearRates(single);
    expect(cleared.records).toEqual([]);
    expect(rateAt(cleared, '2026-01-01')).toBeNull();
  });
});

describe('rate history commands', () => {
  const day = (offset: number): IsoDate => {
    const date = new Date(Date.UTC(2026, 0, 1 + offset));
    return isoDate(date.toISOString().slice(0, 10));
  };
  const ids = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5'];
  const cents = fc.integer({ min: 1, max: 20_000 });
  const rate = fc.oneof(
    { weight: 4, arbitrary: cents.map((amount) => amount / 100) },
    { weight: 1, arbitrary: cents.map((amount) => (amount * 10 + 5) / 1000) },
    { weight: 1, arbitrary: fc.constantFrom(0, -3) },
  );
  const someDay = fc.integer({ min: 0, max: 30 });

  type Command =
    | { kind: 'add'; id: string; day: number; rate: number }
    | { kind: 'correct'; id: string; day: number | null; rate: number | null }
    | { kind: 'remove'; id: string }
    | { kind: 'clear' };

  const command: fc.Arbitrary<Command> = fc.oneof(
    fc.record({
      kind: fc.constant('add' as const),
      id: fc.constantFrom(...ids),
      day: someDay,
      rate,
    }),
    fc.record({
      kind: fc.constant('correct' as const),
      id: fc.constantFrom(...ids),
      day: fc.option(someDay, { nil: null }),
      rate: fc.option(rate, { nil: null }),
    }),
    fc.record({ kind: fc.constant('remove' as const), id: fc.constantFrom(...ids) }),
    fc.record({ kind: fc.constant('clear' as const) }),
  );

  /** The same rules written the obvious way, over a plain array. */
  function applyToModel(
    model: readonly RateRecord[],
    each: Command,
  ): { next: readonly RateRecord[]; errors: readonly string[] } {
    switch (each.kind) {
      case 'add': {
        const errors = [
          ...(isValidHourlyRate(each.rate) ? [] : ['invalid-rate']),
          ...(model.some((existing) => existing.id === each.id) ? ['duplicate-id'] : []),
          ...(model.some((existing) => existing.validFrom === day(each.day))
            ? ['duplicate-valid-from']
            : []),
        ];
        return {
          next: errors.length > 0 ? model : [...model, record(each.id, day(each.day), each.rate)],
          errors,
        };
      }
      case 'correct': {
        const current = model.find((existing) => existing.id === each.id);
        if (!current) return { next: model, errors: ['unknown-rate'] };
        const corrected = record(
          each.id,
          each.day === null ? current.validFrom : day(each.day),
          each.rate ?? current.hourlyRateEur,
        );
        const errors = [
          ...(isValidHourlyRate(corrected.hourlyRateEur) ? [] : ['invalid-rate']),
          ...(model.some(
            (existing) => existing.id !== each.id && existing.validFrom === corrected.validFrom,
          )
            ? ['duplicate-valid-from']
            : []),
        ];
        return {
          next:
            errors.length > 0
              ? model
              : model.map((existing) => (existing.id === each.id ? corrected : existing)),
          errors,
        };
      }
      case 'remove': {
        if (!model.some((existing) => existing.id === each.id)) {
          return { next: model, errors: ['unknown-rate'] };
        }
        if (model.length === 1) return { next: model, errors: ['only-rate'] };
        return { next: model.filter((existing) => existing.id !== each.id), errors: [] };
      }
      case 'clear':
        return { next: [], errors: [] };
    }
  }

  function run(current: RateHistory, each: Command): Result<RateHistory, string> {
    switch (each.kind) {
      case 'add':
        return addRate(current, record(each.id, day(each.day), each.rate));
      case 'correct':
        return correctRate(current, rateId(each.id), {
          ...(each.day === null ? {} : { validFrom: day(each.day) }),
          ...(each.rate === null ? {} : { hourlyRateEur: each.rate }),
        });
      case 'remove':
        return removeRate(current, rateId(each.id));
      case 'clear':
        return ok(clearRates(current));
    }
  }

  const byStart = (records: readonly RateRecord[]) =>
    [...records].sort((a, b) => a.validFrom.localeCompare(b.validFrom));

  it('agrees with a plain model after any sequence, and refused commands change nothing', () => {
    fc.assert(
      fc.property(fc.array(command, { maxLength: 40 }), (commands) => {
        let current = history();
        let model: readonly RateRecord[] = [];
        for (const each of commands) {
          const expected = applyToModel(model, each);
          const result = run(current, each);
          if (expected.errors.length === 0) {
            expect(result.ok).toBe(true);
          } else {
            expect(result.ok).toBe(false);
            if (!result.ok) expect(expected.errors).toContain(result.error);
          }
          if (result.ok) current = result.value;
          model = expected.next;

          expect(current.records).toEqual(byStart(model));
          for (let offset = -1; offset <= 31; offset++) {
            const naive = byStart(model.filter((each) => each.validFrom <= day(offset))).at(-1);
            expect(rateOn(current, day(offset))).toBe(naive?.hourlyRateEur ?? null);
          }
        }
      }),
    );
  });

  it('only changes the days of the period a new record opens', () => {
    const records = fc.uniqueArray(fc.tuple(someDay, cents), {
      selector: ([offset]) => offset,
      maxLength: 6,
    });
    fc.assert(
      fc.property(records, someDay, cents, (existing, offset, amount) => {
        fc.pre(!existing.some(([taken]) => taken === offset));
        const before = history(
          ...existing.map(([each, value], index) =>
            record(`x${String(index)}`, day(each), value / 100),
          ),
        );
        const after = unwrap(addRate(before, record('new', day(offset), amount / 100)));
        const nextStart = Math.min(
          ...existing.map(([each]) => each).filter((each) => each > offset),
          Number.POSITIVE_INFINITY,
        );
        for (let probe = -1; probe <= 31; probe++) {
          const touched = probe >= offset && probe < nextStart;
          expect(rateOn(after, day(probe))).toBe(
            touched ? amount / 100 : rateOn(before, day(probe)),
          );
        }
      }),
    );
  });

  it('tiles the days from the first record on, each period ending the day before the next', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.tuple(someDay, cents), { selector: ([offset]) => offset, minLength: 1 }),
        (existing) => {
          const records = existing.map(([each, value], index) =>
            record(`x${String(index)}`, day(each), value / 100),
          );
          const starts = existing.map(([each]) => each).sort((a, b) => a - b);
          expect(
            effectivePeriods(history(...records)).map((period) => [period.from, period.to]),
          ).toEqual(
            starts.map((start, index) => {
              const next = starts[index + 1];
              return [day(start), next === undefined ? null : day(next - 1)];
            }),
          );
        },
      ),
    );
  });
});
