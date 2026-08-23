/**
 * Where the co-op relay lives.
 *
 * Empty means co-op is switched off: the panel says so and nothing tries to
 * connect. Set it to the `wss://` URL that `npx wrangler deploy` prints for
 * relay/worker.js — see relay/README.md.
 */
export const RELAY_URL = '';

/** A run code is short enough to read out over voice chat. */
export const CODE_LENGTH = 6;

/** Ambiguous characters are left out: no O/0, no I/1. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeRunCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export function normalizeRunCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}
