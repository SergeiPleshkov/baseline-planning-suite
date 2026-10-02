import { DELIVERY_API_PATHS, WorkloadResponseSchema } from '@baseline/delivery-contract';
import type { WorkloadGateway } from '../application/ports';
import { browserFetch, getJson, joinUrl, type Fetch } from './http';

export function createWorkloadGateway(options: {
  readonly baseUrl: string;
  readonly fetch?: Fetch;
}): WorkloadGateway {
  const fetchImpl = options.fetch ?? browserFetch;
  return {
    workload: () =>
      getJson(
        fetchImpl,
        joinUrl(options.baseUrl, DELIVERY_API_PATHS.workload),
        WorkloadResponseSchema,
      ),
  };
}
