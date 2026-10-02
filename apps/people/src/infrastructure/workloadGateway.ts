import {
  DELIVERY_API_PATHS,
  WorkloadChangedEventSchema,
  WorkloadResponseSchema,
} from '@baseline/delivery-contract';
import type { ChangeFeed, WorkloadGateway } from '../application/ports';
import { createChangeFeed, type EventSourceFactory } from './changeFeed';
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

/** Delivery's `workload-changed` notices, which say whose load changed and nothing more. */
export const createWorkloadFeed = (options: {
  readonly baseUrl: string;
  readonly eventSource?: EventSourceFactory;
}): ChangeFeed =>
  createChangeFeed({
    url: joinUrl(options.baseUrl, DELIVERY_API_PATHS.events),
    eventName: WorkloadChangedEventSchema.shape.type.value,
    ...(options.eventSource ? { eventSource: options.eventSource } : {}),
  });
