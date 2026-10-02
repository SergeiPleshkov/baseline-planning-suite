import {
  PEOPLE_API_PATHS,
  RateRecordSchema,
  type RatesChangedEvent,
} from '@baseline/people-contract';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type {
  AddRateFailure,
  ClearRatesFailure,
  CorrectRateFailure,
  PeopleService,
  RemoveRateFailure,
} from '../application/peopleService';
import { isoDate } from '../domain/calendar';
import { employeeId } from '../domain/ids';
import {
  eventStream,
  firstIssue,
  idParam,
  limitBody,
  problem,
  readJson,
  requireJson,
  type ErrorStatus,
} from './http';

type Failure = AddRateFailure | CorrectRateFailure | RemoveRateFailure | ClearRatesFailure;

const FAILURES = {
  'unknown-employee': { status: 404, message: 'There is no such employee.' },
  'unknown-rate': { status: 404, message: 'There is no such rate.' },
  'invalid-rate': {
    status: 422,
    message: 'A rate is positive, at most 10,000 EUR an hour, with at most two decimals.',
  },
  'duplicate-id': { status: 409, message: 'A rate with this id already exists.' },
  'duplicate-valid-from': {
    status: 409,
    message: 'The employee already has a rate starting on that day.',
  },
  'only-rate': {
    status: 409,
    message: 'This is the employee’s only rate; removing it leaves them without any.',
  },
} as const satisfies Record<Failure, { status: ErrorStatus; message: string }>;

const RateFields = RateRecordSchema.pick({ validFrom: true, hourlyRateEur: true });

const NewRateSchema = z.strictObject(RateFields.shape);

const RateCorrectionSchema = z
  .strictObject(RateFields.partial().shape)
  .refine(
    (change) => change.validFrom !== undefined || change.hourlyRateEur !== undefined,
    'Say what to change: validFrom, hourlyRateEur or both.',
  );

export interface PeopleApiDeps {
  readonly service: PeopleService;
  readonly subscribe: (listener: (event: RatesChangedEvent) => void) => () => void;
  /** Keeps idle event streams from being closed by proxies in between. */
  readonly heartbeatMs?: number;
}

const failure = (context: Context, code: Failure) =>
  problem(context, FAILURES[code].status, code, FAILURES[code].message);

const invalid = (context: Context, issues: readonly { readonly message: string }[]) =>
  problem(context, 400, 'invalid-request', firstIssue(issues));

export function createPeopleApi({ service, subscribe, heartbeatMs = 15_000 }: PeopleApiDeps) {
  const api = new Hono();

  api.onError((error, context) => {
    console.error(error);
    return problem(context, 500, 'internal', 'Something went wrong on our side.');
  });

  api.use('*', requireJson, limitBody);

  api.get(PEOPLE_API_PATHS.employees, (context) => context.json(service.employees()));

  api.get(PEOPLE_API_PATHS.rates, (context) => context.json(service.rates()));

  api.post('/employees/:employeeId/rates', async (context) => {
    const parsed = NewRateSchema.safeParse(await readJson(context));
    if (!parsed.success) return invalid(context, parsed.error.issues);
    const employee = idParam(context, 'employeeId');
    if (employee === undefined) return failure(context, 'unknown-employee');
    const added = await service.addRate(employeeId(employee), {
      validFrom: isoDate(parsed.data.validFrom),
      hourlyRateEur: parsed.data.hourlyRateEur,
    });
    return added.ok ? context.json(added.value, 201) : failure(context, added.error);
  });

  api.patch('/rates/:rateId', async (context) => {
    const parsed = RateCorrectionSchema.safeParse(await readJson(context));
    if (!parsed.success) return invalid(context, parsed.error.issues);
    const rate = idParam(context, 'rateId');
    if (rate === undefined) return failure(context, 'unknown-rate');
    const corrected = await service.correctRate(rate, {
      ...(parsed.data.validFrom === undefined ? {} : { validFrom: isoDate(parsed.data.validFrom) }),
      ...(parsed.data.hourlyRateEur === undefined
        ? {}
        : { hourlyRateEur: parsed.data.hourlyRateEur }),
    });
    return corrected.ok ? context.json(corrected.value) : failure(context, corrected.error);
  });

  api.delete('/rates/:rateId', async (context) => {
    const rate = idParam(context, 'rateId');
    if (rate === undefined) return failure(context, 'unknown-rate');
    const removed = await service.removeRate(rate);
    return removed.ok ? context.json(removed.value) : failure(context, removed.error);
  });

  api.delete('/employees/:employeeId/rates', async (context) => {
    const employee = idParam(context, 'employeeId');
    if (employee === undefined) return failure(context, 'unknown-employee');
    const cleared = await service.clearRates(employeeId(employee));
    return cleared.ok ? context.json(cleared.value) : failure(context, cleared.error);
  });

  api.get(PEOPLE_API_PATHS.events, (context) => eventStream(context, subscribe, heartbeatMs));

  return api;
}
