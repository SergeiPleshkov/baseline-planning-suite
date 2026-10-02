import type { DeletionSummaryDto, ItemDto, PlanDocument } from './planDocument';

/** What a command that did not go through says: the service's own explanation when it refused. */
export interface Refusal {
  readonly ok: false;
  readonly message: string;
}

export type CommandResult = { readonly ok: true } | Refusal;

/** What Delivery reads from the People service. Reads throw when it cannot be reached. */
export interface PeopleSource {
  employees: () => Promise<unknown>;
  rates: () => Promise<unknown>;
}

/** Reads throw when the service cannot be reached or answers something that breaks its contract. */
export interface DeliveryGateway {
  plan: () => Promise<PlanDocument>;
  deletionSummary: (
    itemId: string,
  ) => Promise<{ readonly ok: true; readonly summary: DeletionSummaryDto } | Refusal>;
  addItem: (input: {
    readonly projectId: string;
    readonly parentId: string | null;
    readonly name: string;
  }) => Promise<
    { readonly ok: true; readonly item: ItemDto; readonly movedAllocations: number } | Refusal
  >;
  updateItem: (
    itemId: string,
    change: { readonly name?: string; readonly parentId?: string | null },
  ) => Promise<CommandResult>;
  deleteItem: (summary: DeletionSummaryDto) => Promise<CommandResult>;
  /** Zero removes the allocation. */
  setAllocation: (
    cell: { readonly breakdownItemId: string; readonly employeeId: string; readonly month: string },
    personMonths: number,
  ) => Promise<CommandResult>;
}
