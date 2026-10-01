/**
 * Hellogram number code format: letter + 6 (later 7) digits + letter, e.g. `A482719K`.
 * Letters are uppercase A–Z without I and O. Generation lives in the domain package;
 * this module only holds the format rules shared by client and server.
 */
export const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export const NUMBER_CODE_PATTERN = /^[A-HJ-NP-Z][0-9]{6,7}[A-HJ-NP-Z]$/;

/** Upper-cases and trims user input (links are case-insensitive). */
export function normalizeNumberCode(input: string): string {
  return input.trim().toUpperCase();
}

export function isValidNumberCode(input: string): boolean {
  return NUMBER_CODE_PATTERN.test(normalizeNumberCode(input));
}
