import { cleanWikitext, wikiGet } from './wiki';
import { cachedFetch, DAY_MS } from './cache';

const INDEX_CACHE_KEY = 'eft-quest-index-v1';
/** Rebuilding is ~19 wiki requests, so weekly is plenty for map changes. */
const INDEX_MAX_AGE_MS = 7 * DAY_MS;
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
  return cachedFetch(INDEX_CACHE_KEY, INDEX_MAX_AGE_MS, () => buildIndex(titles, onProgress), {
    force,
    // A list that gained quests since the index was built needs a rebuild,
    // or the new ones would never be found on any map.
    keep: (index) => titles.every((title) => title in index),
  });
}

async function buildIndex(
  titles: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<QuestIndex> {
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
