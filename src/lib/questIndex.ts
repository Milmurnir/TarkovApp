import { cleanWikitext, wikiGet } from './wiki';

const INDEX_CACHE_KEY = 'eft-quest-index-v1';
const BATCH_SIZE = 50;

export interface QuestIndexEntry {
  title: string;
  /** Maps named in the quest infobox `location` field. */
  locations: string[];
  /** Quest requires moving between maps mid-raid. */
  transit: boolean;
}

export type QuestIndex = Record<string, QuestIndexEntry>;

function parseLocations(wikitext: string): string[] {
  const match = /^\|[ \t]*location[ \t]*=[ \t]*(.*)$/im.exec(wikitext);
  if (!match) return [];
  return cleanWikitext(match[1])
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function mentionsTransit(wikitext: string): boolean {
  return /\btransit(ing|ed|s)?\b/i.test(wikitext);
}

/**
 * Builds a title -> locations index for every quest.
 *
 * The infobox `location` field is the per-quest map list, but fetching 850+
 * pages one at a time is far too slow. MediaWiki accepts up to 50 titles per
 * revisions query, which brings this down to roughly 18 requests, cached after
 * the first run.
 */
export async function fetchQuestIndex(
  titles: string[],
  onProgress?: (done: number, total: number) => void,
  force = false,
): Promise<QuestIndex> {
  if (!force) {
    try {
      const raw = localStorage.getItem(INDEX_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { index: QuestIndex; count: number };
        // Reuse only if it still covers the current quest list.
        if (parsed.index && parsed.count >= titles.length) return parsed.index;
      }
    } catch { /* fall through and rebuild */ }
  }

  const index: QuestIndex = {};

  for (let start = 0; start < titles.length; start += BATCH_SIZE) {
    const batch = titles.slice(start, start + BATCH_SIZE);
    const data = await wikiGet({
      action: 'query',
      titles: batch.join('|'),
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
    });

    const pages = data?.query?.pages ?? {};
    for (const page of Object.values<any>(pages)) {
      const title = page?.title;
      if (!title) continue;
      const content = page?.revisions?.[0]?.slots?.main?.['*'];
      if (typeof content !== 'string') {
        index[title] = { title, locations: [], transit: false };
        continue;
      }
      index[title] = {
        title,
        locations: parseLocations(content),
        transit: mentionsTransit(content),
      };
    }

    onProgress?.(Math.min(start + BATCH_SIZE, titles.length), titles.length);
  }

  try {
    localStorage.setItem(INDEX_CACHE_KEY, JSON.stringify({ index, count: titles.length }));
  } catch { /* cache is best-effort */ }

  return index;
}

/**
 * Quests that touch the given map. Multi-map quests are included because the
 * infobox lists every map the quest can be completed on, and quests that move
 * between maps are kept when they mention transiting.
 */
export function questsForMap(index: QuestIndex, mapName: string, includeTransit = true): QuestIndexEntry[] {
  const target = mapName.toLowerCase();
  return Object.values(index)
    .filter((entry) => {
      const onMap = entry.locations.some((location) => location.toLowerCase() === target);
      return onMap || (includeTransit && entry.transit && entry.locations.length === 0);
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}
