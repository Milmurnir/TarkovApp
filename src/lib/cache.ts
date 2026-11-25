/**
 * localStorage entries that know how old they are.
 *
 * Wiki data used to be cached forever, so a quest added or edited after the
 * first launch never showed up. Entries now carry `fetchedAt`; past their
 * age they are refetched, but still returned when that refetch fails, so an
 * offline start keeps working from whatever it had.
 */

interface Stamped<T> {
  value: T;
  fetchedAt: number;
}

export const DAY_MS = 1000 * 60 * 60 * 24;

export interface CacheHit<T> {
  value: T;
  fresh: boolean;
}

export function readStamped<T>(key: string, maxAgeMs: number): CacheHit<T> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stamped<T>>;
    // Entries written before stamping existed have no wrapper: unusable, refetch.
    if (!parsed || typeof parsed.fetchedAt !== 'number' || !('value' in parsed)) return null;
    return { value: parsed.value as T, fresh: Date.now() - parsed.fetchedAt < maxAgeMs };
  } catch {
    return null;
  }
}

export function writeStamped<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify({ value, fetchedAt: Date.now() } satisfies Stamped<T>));
  } catch { /* caching is best-effort */ }
}

/**
 * Fresh cache, else a fetch, else stale cache, else the fetch's error.
 * `keep` lets a caller refuse a cached value (e.g. an index built from a
 * shorter quest list) without losing the offline fallback entirely.
 */
export async function cachedFetch<T>(
  key: string,
  maxAgeMs: number,
  fetcher: () => Promise<T>,
  options: { force?: boolean; keep?: (value: T) => boolean } = {},
): Promise<T> {
  const hit = readStamped<T>(key, maxAgeMs);
  const usable = hit && (!options.keep || options.keep(hit.value));
  if (usable && hit.fresh && !options.force) return hit.value;
  try {
    const value = await fetcher();
    writeStamped(key, value);
    return value;
  } catch (error) {
    if (hit) return hit.value;
    throw error;
  }
}

/** Prefixes of everything "Refresh game data" throws away. */
const REFRESHABLE_PREFIXES = [
  'eft-quest-list-',
  'eft-quest-index-',
  'eft-quest-page-',
  'eft-quest-guide-',
  'tarkov-json-slice-',
];

/** Drops every cached wiki and map-data entry so the next load refetches them. */
export function clearGameDataCaches(): number {
  let removed = 0;
  for (const key of Object.keys(localStorage)) {
    if (REFRESHABLE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      localStorage.removeItem(key);
      removed += 1;
    }
  }
  return removed;
}
