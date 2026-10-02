import {
  EmployeesResponseSchema,
  PEOPLE_API_PATHS,
  RatesResponseSchema,
} from '@baseline/people-contract';
import { z } from 'zod';
import type { CommandResult, PeopleGateway } from '../application/ports';
import { browserFetch, getJson, joinUrl, TIMEOUT_MS, type Fetch } from './http';

const ErrorBodySchema = z.object({ error: z.object({ message: z.string() }) });

export function createPeopleGateway(options: {
  readonly baseUrl: string;
  readonly fetch?: Fetch;
}): PeopleGateway {
  const fetchImpl = options.fetch ?? browserFetch;
  const url = (path: string) => joinUrl(options.baseUrl, path);

  async function command(method: string, path: string, body?: unknown): Promise<CommandResult> {
    let response: Response;
    try {
      response = await fetchImpl(url(path), {
        method,
        ...(body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return {
        ok: false,
        outcomeUnknown: true,
        message:
          'The People service did not answer. The change may not have been saved; the list shows what it holds now.',
      };
    }
    if (response.ok) return { ok: true };
    const parsed = ErrorBodySchema.safeParse(await response.json().catch(() => undefined));
    return {
      ok: false,
      message: parsed.success
        ? parsed.data.error.message
        : `The People service answered HTTP ${String(response.status)}. Nothing was saved.`,
    };
  }

  const enc = encodeURIComponent;
  return {
    employees: () => getJson(fetchImpl, url(PEOPLE_API_PATHS.employees), EmployeesResponseSchema),
    rates: () => getJson(fetchImpl, url(PEOPLE_API_PATHS.rates), RatesResponseSchema),
    addRate: (employeeId, input) => command('POST', `/employees/${enc(employeeId)}/rates`, input),
    correctRate: (rateId, change) => command('PATCH', `/rates/${enc(rateId)}`, change),
    removeRate: (rateId) => command('DELETE', `/rates/${enc(rateId)}`),
    clearRates: (employeeId) => command('DELETE', `/employees/${enc(employeeId)}/rates`),
  };
}
