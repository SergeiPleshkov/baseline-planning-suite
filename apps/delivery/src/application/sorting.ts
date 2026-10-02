// One locale for everyone, so that lists of people come out the same in every browser: Ä next to
// A, a 2 before a 10.
const names = new Intl.Collator('en-GB', { numeric: true });

export const byName = (a: string, b: string): number => names.compare(a, b);

/** Ids and months have fixed formats: by code unit, two different keys never compare equal. */
export const byKey = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
