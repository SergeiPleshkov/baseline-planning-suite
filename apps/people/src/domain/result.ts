export type Result<T, E> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T) => ({ ok: true, value }) as const;

export const err = <E>(error: E) => ({ ok: false, error }) as const;
