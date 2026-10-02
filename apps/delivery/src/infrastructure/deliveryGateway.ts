import { z } from 'zod';
import { Id, PlanDocumentSchema, type DeletionSummaryDto } from '../application/planDocument';
import type { DeliveryGateway, Refusal } from '../application/ports';
import { browserFetch, getJson, joinUrl, TIMEOUT_MS, type Fetch } from './http';

const ErrorBodySchema = z.object({ error: z.object({ message: z.string() }) });

const AddedSchema = z.object({
  revision: z.int(),
  item: z.object({ id: Id, projectId: Id, parentId: Id.nullable(), name: z.string() }),
  movedAllocations: z.int().nonnegative(),
});

const SummarySchema = z.object({
  root: Id,
  items: z.array(Id),
  allocations: z.array(z.object({ id: Id, personMonths: z.number() })),
  personMonths: z.number(),
});

export function createDeliveryGateway(options: {
  readonly baseUrl: string;
  readonly fetch?: Fetch;
}): DeliveryGateway {
  const fetchImpl = options.fetch ?? browserFetch;
  const url = (path: string) => joinUrl(options.baseUrl, path);
  const enc = encodeURIComponent;

  /** Sends a command; on success hands back the parsed body, otherwise the service's words. */
  async function send(
    method: string,
    path: string,
    body?: unknown,
    changes = true,
  ): Promise<{ readonly ok: true; readonly body: unknown } | Refusal> {
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
        message: changes
          ? 'The Delivery service did not answer. The change may not have been saved; the plan is read again to show what the service holds.'
          : 'The Delivery service did not answer.',
      };
    }
    const parsed: unknown = await response.json().catch(() => undefined);
    if (response.ok) return { ok: true, body: parsed };
    const refusal = ErrorBodySchema.safeParse(parsed);
    return {
      ok: false,
      message: refusal.success
        ? refusal.data.error.message
        : `The Delivery service answered HTTP ${String(response.status)}.${changes ? ' The change may not have been saved.' : ''}`,
    };
  }

  return {
    plan: () => getJson(fetchImpl, url('/plan'), PlanDocumentSchema),

    async deletionSummary(itemId) {
      const sent = await send('GET', `/items/${enc(itemId)}/deletion-summary`, undefined, false);
      if (!sent.ok) return sent;
      const parsed = SummarySchema.safeParse(sent.body);
      return parsed.success
        ? { ok: true, summary: parsed.data }
        : {
            ok: false,
            message: 'The Delivery service sent a summary this screen does not understand.',
          };
    },

    async addItem(input) {
      const sent = await send('POST', '/items', input);
      if (!sent.ok) return sent;
      const parsed = AddedSchema.safeParse(sent.body);
      return parsed.success
        ? { ok: true, item: parsed.data.item, movedAllocations: parsed.data.movedAllocations }
        : {
            ok: false,
            message:
              'The item was added, but the answer was not understood; the tree is read again.',
          };
    },

    async updateItem(itemId, change) {
      const sent = await send('PATCH', `/items/${enc(itemId)}`, change);
      return sent.ok ? { ok: true } : sent;
    },

    async deleteItem(summary: DeletionSummaryDto) {
      const sent = await send('POST', `/items/${enc(summary.root)}/deletion`, summary);
      return sent.ok ? { ok: true } : sent;
    },

    async setAllocation(cell, personMonths) {
      const sent = await send('PUT', '/allocations', { ...cell, personMonths });
      return sent.ok ? { ok: true } : sent;
    },
  };
}
