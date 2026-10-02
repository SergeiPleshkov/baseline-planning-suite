/** Orders text by code unit, the same in every locale, for lists that must come out the same everywhere. */
export const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
