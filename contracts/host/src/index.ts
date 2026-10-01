/** Host contract v1 — what the shell pushes into every remote. Owned by the shell team. */

/** Bumped on any breaking change; a remote refuses a host it was not built for. */
export const HOST_CONTRACT_VERSION = 1;

export const REMOTE_APP_EXPOSE = './App';

/** Money is stored in EUR everywhere; a displayed amount is `amountEur * ratePerEur`. */
export interface DisplayCurrency {
  /** ISO 4217 code, usable with `Intl.NumberFormat`. */
  readonly code: string;
  readonly ratePerEur: number;
}

export interface ActiveUser {
  readonly id: string;
  readonly displayName: string;
}

export interface HostContext {
  /** Checked at runtime: shell and remotes are deployed independently. */
  readonly contractVersion: number;
  readonly displayCurrency: DisplayCurrency;
  readonly activeUser: ActiveUser;
}

export interface RemoteAppProps {
  readonly host: HostContext;
}
