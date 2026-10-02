import type { RatesChangedEvent } from '@baseline/people-contract';
import { describe, expect, it } from 'vitest';
import { isoDate } from '../domain/calendar';
import { employeeId } from '../domain/ids';
import { stateFromDocument, type PeopleDocument } from './document';
import { createPeopleService } from './peopleService';

const document = (): PeopleDocument => ({
  revision: 4,
  employees: [
    { id: 'emp-1', name: 'Adaeze Okafor', role: 'Tech Lead', weeklyHours: 40 },
    { id: 'emp-2', name: 'Lena Okafor', role: 'Frontend Engineer', weeklyHours: 32 },
  ],
  rates: [
    { id: 'r1', employeeId: 'emp-1', validFrom: '2025-01-01', hourlyRateEur: 80 },
    { id: 'r2', employeeId: 'emp-1', validFrom: '2026-03-12', hourlyRateEur: 95 },
  ],
});

function setup(options: { failWrites?: boolean } = {}) {
  const written: PeopleDocument[] = [];
  const events: RatesChangedEvent[] = [];
  let counter = 0;
  const service = createPeopleService({
    initial: stateFromDocument(document()),
    write: (next) => {
      if (options.failWrites) return Promise.reject(new Error('disk full'));
      written.push(next);
      return Promise.resolve();
    },
    newRateId: () => `new-${String((counter += 1))}`,
    notify: (event) => events.push(event),
  });
  return { service, written, events };
}

const EMP_1 = employeeId('emp-1');
const EMP_2 = employeeId('emp-2');

describe('reading', () => {
  it('publishes the register and every rate with the current revision', () => {
    const { service } = setup();
    expect(service.employees()).toMatchObject({
      revision: 4,
      employees: [{ id: 'emp-1' }, { id: 'emp-2' }],
    });
    expect(service.rates().rates.map((rate) => rate.id)).toEqual(['r1', 'r2']);
  });
});

describe('addRate', () => {
  it('adds a rate, raises the revision, stores the document and announces who changed', async () => {
    const { service, written, events } = setup();
    const added = await service.addRate(EMP_2, {
      validFrom: isoDate('2026-01-01'),
      hourlyRateEur: 70.5,
    });
    expect(added).toEqual({
      ok: true,
      value: {
        revision: 5,
        rate: { id: 'new-1', employeeId: 'emp-2', validFrom: '2026-01-01', hourlyRateEur: 70.5 },
      },
    });
    expect(service.rates()).toMatchObject({ revision: 5 });
    expect(service.rates().rates.map((rate) => rate.id)).toEqual(['r1', 'r2', 'new-1']);
    expect(written.at(-1)?.revision).toBe(5);
    expect(events).toEqual([
      { type: 'rates-changed', version: 1, employeeIds: ['emp-2'], revision: 5 },
    ]);
  });

  it('refuses an unknown employee and a start date already taken, changing nothing', async () => {
    const { service, written, events } = setup();
    expect(
      await service.addRate(employeeId('nobody'), {
        validFrom: isoDate('2026-01-01'),
        hourlyRateEur: 70,
      }),
    ).toEqual({ ok: false, error: 'unknown-employee' });
    expect(
      await service.addRate(EMP_1, { validFrom: isoDate('2026-03-12'), hourlyRateEur: 70 }),
    ).toEqual({ ok: false, error: 'duplicate-valid-from' });
    expect(service.rates().revision).toBe(4);
    expect(written).toEqual([]);
    expect(events).toEqual([]);
  });
});

describe('correctRate', () => {
  it('changes a rate found by its id, whoever it belongs to', async () => {
    const { service, events } = setup();
    const corrected = await service.correctRate('r2', { hourlyRateEur: 99 });
    expect(corrected).toMatchObject({
      ok: true,
      value: { revision: 5, rate: { hourlyRateEur: 99 } },
    });
    expect(events[0]?.employeeIds).toEqual(['emp-1']);
  });

  it('says nothing changed when the correction is the current value', async () => {
    const { service, written, events } = setup();
    const same = await service.correctRate('r2', { hourlyRateEur: 95 });
    expect(same).toMatchObject({ ok: true, value: { revision: 4 } });
    expect(written).toEqual([]);
    expect(events).toEqual([]);
  });

  it('refuses an unknown rate and a date another rate has', async () => {
    const { service } = setup();
    expect(await service.correctRate('nope', { hourlyRateEur: 1 })).toEqual({
      ok: false,
      error: 'unknown-rate',
    });
    expect(await service.correctRate('r2', { validFrom: isoDate('2025-01-01') })).toEqual({
      ok: false,
      error: 'duplicate-valid-from',
    });
  });
});

describe('removeRate and clearRates', () => {
  it('removes one rate of several', async () => {
    const { service } = setup();
    expect(await service.removeRate('r1')).toEqual({ ok: true, value: { revision: 5 } });
    expect(service.rates().rates.map((rate) => rate.id)).toEqual(['r2']);
  });

  it('refuses to remove the only rate, which clearRates does on purpose', async () => {
    const { service, events } = setup();
    await service.removeRate('r1');
    expect(events.at(-1)?.employeeIds).toEqual(['emp-1']);
    expect(await service.removeRate('r2')).toEqual({ ok: false, error: 'only-rate' });
    expect(await service.clearRates(EMP_1)).toEqual({ ok: true, value: { revision: 6 } });
    expect(service.rates().rates).toEqual([]);
    expect(events.map((event) => event.revision)).toEqual([5, 6]);
    expect(events.at(-1)?.employeeIds).toEqual(['emp-1']);
  });

  it('leaves the revision alone when there is nothing to clear', async () => {
    const { service, events } = setup();
    expect(await service.clearRates(EMP_2)).toEqual({ ok: true, value: { revision: 4 } });
    expect(events).toEqual([]);
    expect(await service.clearRates(employeeId('nobody'))).toEqual({
      ok: false,
      error: 'unknown-employee',
    });
  });
});

describe('storing', () => {
  it('keeps what is shown identical to what was last stored', async () => {
    const { service, written } = setup();
    await service.addRate(EMP_2, { validFrom: isoDate('2026-01-01'), hourlyRateEur: 70 });
    await service.removeRate('r1');
    const stored = written.at(-1);
    expect(stored?.revision).toBe(6);
    expect(stored?.rates).toEqual(service.rates().rates);
    expect(stateFromDocument(stored).revision).toBe(6);
  });

  it('does not show or announce a change that could not be stored', async () => {
    const { service, events } = setup({ failWrites: true });
    await expect(
      service.addRate(EMP_2, { validFrom: isoDate('2026-01-01'), hourlyRateEur: 70 }),
    ).rejects.toThrow('disk full');
    expect(service.rates()).toMatchObject({ revision: 4 });
    expect(service.rates().rates).toHaveLength(2);
    expect(events).toEqual([]);
  });

  it('keeps accepting changes after one could not be stored', async () => {
    let failing = true;
    const events: RatesChangedEvent[] = [];
    const service = createPeopleService({
      initial: stateFromDocument(document()),
      write: () => (failing ? Promise.reject(new Error('disk full')) : Promise.resolve()),
      newRateId: () => 'later',
      notify: (event) => events.push(event),
    });
    const rate = { validFrom: isoDate('2026-01-01'), hourlyRateEur: 70 };
    await expect(service.addRate(EMP_2, rate)).rejects.toThrow('disk full');
    failing = false;
    expect(await service.addRate(EMP_2, rate)).toMatchObject({ ok: true, value: { revision: 5 } });
    expect(events).toHaveLength(1);
  });

  it('shows and announces a change only once it is stored', async () => {
    let finish = () => {};
    const events: RatesChangedEvent[] = [];
    const service = createPeopleService({
      initial: stateFromDocument(document()),
      write: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      newRateId: () => 'later',
      notify: (event) => events.push(event),
    });
    const pending = service.addRate(EMP_2, { validFrom: isoDate('2026-01-01'), hourlyRateEur: 70 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(service.rates().revision).toBe(4);
    expect(events).toEqual([]);
    finish();
    await pending;
    expect(service.rates().revision).toBe(5);
    expect(events).toHaveLength(1);
  });

  it('applies simultaneous changes one after another without losing any', async () => {
    const { service, events } = setup();
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((month) =>
        service.addRate(EMP_2, {
          validFrom: isoDate(`2026-0${String(month)}-01`),
          hourlyRateEur: 60 + month,
        }),
      ),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    expect(service.rates().rates.filter((rate) => rate.employeeId === 'emp-2')).toHaveLength(5);
    expect(events.map((event) => event.revision)).toEqual([5, 6, 7, 8, 9]);
  });
});

describe('stateFromDocument', () => {
  it.each([
    [
      'an unknown employee on a rate',
      { rates: [{ id: 'x', employeeId: 'ghost', validFrom: '2026-01-01', hourlyRateEur: 1 }] },
    ],
    [
      'a rate id used twice',
      {
        rates: [
          { id: 'r1', employeeId: 'emp-1', validFrom: '2025-01-01', hourlyRateEur: 80 },
          { id: 'r1', employeeId: 'emp-2', validFrom: '2025-01-01', hourlyRateEur: 80 },
        ],
      },
    ],
    [
      'two rates on one day',
      {
        rates: [
          { id: 'a', employeeId: 'emp-1', validFrom: '2025-01-01', hourlyRateEur: 80 },
          { id: 'b', employeeId: 'emp-1', validFrom: '2025-01-01', hourlyRateEur: 90 },
        ],
      },
    ],
    [
      'an employee listed twice',
      {
        employees: [
          { id: 'emp-1', name: 'A', role: 'B', weeklyHours: 40 },
          { id: 'emp-1', name: 'C', role: 'D', weeklyHours: 40 },
        ],
      },
    ],
  ])('refuses a document with %s', (_label, override) => {
    expect(() => stateFromDocument({ ...document(), ...override })).toThrow();
  });
});
