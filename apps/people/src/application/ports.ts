import type { EmployeesResponse, RatesResponse } from '@baseline/people-contract';
import type { WorkloadResponse } from '@baseline/delivery-contract';

/** The outcome of a command: the service's own explanation when it refused. */
export type CommandResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly message: string;
      /** The request may have reached the service before it failed: what it holds is unknown. */
      readonly outcomeUnknown?: boolean;
    };

/** Reads throw when the service cannot be reached or answers something that breaks its contract. */
export interface PeopleGateway {
  employees: () => Promise<EmployeesResponse>;
  rates: () => Promise<RatesResponse>;
  addRate: (
    employeeId: string,
    input: { readonly validFrom: string; readonly hourlyRateEur: number },
  ) => Promise<CommandResult>;
  correctRate: (
    rateId: string,
    change: { readonly validFrom?: string; readonly hourlyRateEur?: number },
  ) => Promise<CommandResult>;
  removeRate: (rateId: string) => Promise<CommandResult>;
  clearRates: (employeeId: string) => Promise<CommandResult>;
}

export interface WorkloadGateway {
  workload: () => Promise<WorkloadResponse>;
}

export interface FeedHandlers {
  /** An event arrived that says the data changed: read it again. */
  readonly onChange: () => void;
  /** The stream opened, now or again after a break; events in between may have been missed. */
  readonly onConnected: () => void;
  /** The stream broke; it keeps trying to reopen, and `onConnected` follows when it does. */
  readonly onLost: () => void;
}

/** A stream of "this changed" notices from another service. Opening returns how to close it. */
export interface ChangeFeed {
  open: (handlers: FeedHandlers) => () => void;
}
