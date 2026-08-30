/**
 * Flea-market prices for the price-check overlay.
 *
 * api.tarkov.dev's GraphQL endpoint -- the usual place to ask for this -- has
 * been returning "GraphQL server unavailable" since 2026-07-21 (see
 * jsonApi.ts, which hit the same wall for map and task data). This uses the
 * same json.tarkov.dev replacement the rest of the app already switched to,
 * which carries the identical fields the GraphQL schema does: `lastLowPrice`,
 * `low24hPrice`, `avg24hPrice`, `types` (checked for `noFlea`), `sellToTrader`.
 *
 * `lastLowPrice` -- the lowest offer at the most recent market scan -- is what
 * is shown as *the* price: it is the closest thing to "what would I see on
 * the flea right now". `low24hPrice` and `avg24hPrice` are the fallbacks when
 * a thinly-traded item has no current scan, in that order, and the UI always
 * says which one it ended up showing.
 */

const BASE = '/api/json';
const CACHE_KEY = 'tarkov-flea-items-v1';
// Prices move fast -- offers come and go inside minutes -- so this is short
// enough that the overlay is re-syncing with the live market on essentially
// every raid, not showing you a table frozen from whenever you last launched
// the app. It is a ceiling on staleness, not a poll: nothing refetches while
// the overlay sits unopened.
const CACHE_TTL_MS = 1000 * 60 * 2;
const LANGUAGE = 'en';

export interface FleaItem {
  id: string;
  name: string;
  short: string;
  icon: string | null;
  width: number;
  height: number;
  /** Lowest offer at the last market scan. */
  lastLow: number | null;
  low24h: number | null;
  avg24h: number | null;
  /** The game itself blocks selling this on the flea (e.g. roubles). */
  noFlea: boolean;
  /** Best trader payout in roubles, shown as a fallback when noFlea. */
  bestTraderRUB: number | null;
}

export class PriceCheckError extends Error {}

interface Cache {
  items: FleaItem[];
  fetchedAt: number;
}

function readCache(): Cache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Cache) : null;
  } catch {
    return null;
  }
}

function writeCache(cache: Cache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // A full quota just means every open refetches; not fatal.
  }
}

function asList<T>(value: Record<string, T> | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : Object.values(value);
}

async function getJson(path: string): Promise<any> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`);
  } catch (error) {
    throw new PriceCheckError('Could not reach json.tarkov.dev.');
  }
  if (!response.ok) throw new PriceCheckError(`json.tarkov.dev returned ${response.status}.`);
  return response.json();
}

/** Same trick jsonApi.ts uses: names/descriptions are translation keys. */
function translate(translations: Record<string, string>, key: unknown): string {
  if (typeof key !== 'string') return '';
  const value = translations[key];
  return value && value.length > 0 ? value : key;
}

// Concurrent callers (the overlay opening while the main window's prefetch is
// still in flight) share one request rather than firing two 18 MB fetches.
let inFlight: Promise<FleaItem[]> | null = null;

/** Told about every successful fetch, so an open overlay can pick up a price
 *  that changed while it was sitting there rather than only on next open. */
type Listener = (items: FleaItem[]) => void;
const listeners = new Set<Listener>();

export function onFleaItemsUpdated(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function fetchAndCache(): Promise<FleaItem[]> {
  const [itemsPayload, itemsLang] = await Promise.all([
    getJson('/regular/items'),
    getJson(`/regular/items_${LANGUAGE}`),
  ]);

  const text: Record<string, string> = itemsLang?.data ?? {};
  const raw = asList<any>(itemsPayload?.data?.items);

  const items: FleaItem[] = raw
    .map((it: any): FleaItem | null => {
      const name = translate(text, it.name);
      if (!name) return null;

      const noFlea = Array.isArray(it.types) && it.types.includes('noFlea');
      const traderPrices: number[] = Array.isArray(it.sellToTrader)
        ? it.sellToTrader.map((s: any) => s.priceRUB).filter((n: unknown): n is number => typeof n === 'number')
        : [];

      return {
        id: String(it.id),
        name,
        short: translate(text, it.shortName) || name,
        icon: typeof it.iconLink === 'string' ? it.iconLink : null,
        width: typeof it.width === 'number' && it.width > 0 ? it.width : 1,
        height: typeof it.height === 'number' && it.height > 0 ? it.height : 1,
        lastLow: typeof it.lastLowPrice === 'number' ? it.lastLowPrice : null,
        low24h: typeof it.low24hPrice === 'number' ? it.low24hPrice : null,
        avg24h: typeof it.avg24hPrice === 'number' ? it.avg24hPrice : null,
        noFlea,
        bestTraderRUB: traderPrices.length > 0 ? Math.max(...traderPrices) : null,
      };
    })
    .filter((item): item is FleaItem => item !== null);

  writeCache({ items, fetchedAt: Date.now() });
  listeners.forEach((listener) => listener(items));
  return items;
}

function refresh(): Promise<FleaItem[]> {
  if (!inFlight) inFlight = fetchAndCache().finally(() => { inFlight = null; });
  return inFlight;
}

/**
 * The flea-sellable item catalogue. Cache-first and near-instant when a copy
 * already exists, even a stale one: a stale cache is returned immediately
 * *and* triggers a background refresh, so the caller never blocks on a fresh
 * fetch just because the two-minute window lapsed while the overlay was
 * closed. `onFleaItemsUpdated` is how a caller that is still on screen learns
 * the background refresh landed.
 *
 * Called both by the main window on startup, to warm the cache before the
 * hotkey is ever pressed, and by the overlay itself on every open, so a check
 * mid-raid is never working from a catalogue no one has looked at in hours.
 */
export async function loadFleaItems(): Promise<FleaItem[]> {
  const cached = readCache();
  if (cached) {
    if (Date.now() - cached.fetchedAt >= CACHE_TTL_MS) refresh().catch(() => {});
    return cached.items;
  }

  try {
    return await refresh();
  } catch (error) {
    throw error instanceof PriceCheckError ? error : new PriceCheckError('Could not load the item list.');
  }
}

/** The number to headline, and which field backs it -- always shown together. */
export function lowestPrice(item: FleaItem): { value: number; label: string } | null {
  if (item.lastLow !== null) return { value: item.lastLow, label: 'last scan' };
  if (item.low24h !== null) return { value: item.low24h, label: '24h low' };
  if (item.avg24h !== null) return { value: item.avg24h, label: '24h avg' };
  return null;
}

/**
 * Partial-name matching for a search box you are typing into mid-fight:
 * matched on the short name too (mirrors lootRun.ts's searchItems), and a
 * name that starts with what you typed outranks one that merely contains it.
 */
export function searchFleaItems(items: FleaItem[], query: string, limit = 8): FleaItem[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];

  const haystack = (item: FleaItem) => `${item.name} ${item.short}`.toLowerCase();
  const starts = (item: FleaItem) =>
    item.name.toLowerCase().startsWith(needle) || item.short.toLowerCase().startsWith(needle);

  return items
    .filter((item) => haystack(item).includes(needle))
    .sort((a, b) => (starts(a) ? 0 : 1) - (starts(b) ? 0 : 1) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function formatRUB(value: number): string {
  return `${Math.round(value).toLocaleString('en-US')} ₽`;
}
