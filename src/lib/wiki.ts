import type { WikiQuest } from './types';

const WIKI = '/api/wiki';
const LIST_CACHE_KEY = 'eft-quest-list-v1';
const PAGE_CACHE_PREFIX = 'eft-quest-page-v4:';

/** Strip wiki markup down to readable plain text. */
export function cleanWikitext(input: string): string {
  let out = input;
  out = out.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  out = out.replace(/<ref[^>]*\/>/gi, '');
  // [[Page|Label]] -> Label ; [[Page]] -> Page
  out = out.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
  out = out.replace(/\[\[([^\]]+)\]\]/g, '$1');
  // Keep the readable argument of simple templates, drop the rest.
  out = out.replace(/\{\{([^{}]*)\}\}/g, (_m, body: string) => {
    const parts = String(body).split('|').map((p) => p.trim());
    const name = (parts[0] ?? '').toLowerCase();
    if (name === 'pagename') return '';
    const named = parts.slice(1).filter((p) => !p.includes('='));
    return named.length > 0 ? named[named.length - 1] : '';
  });
  // Line breaks separate list entries in infobox fields; keep them as commas
  // so several linked quests do not run together into one string.
  out = out.replace(/<br\s*\/?>/gi, ', ');
  out = out.replace(/<[^>]+>/g, '');
  out = out.replace(/'''''|'''|''/g, '');
  out = out.replace(/&nbsp;/g, ' ');
  return out.replace(/[ \t]+/g, ' ').trim();
}

/** Raw wikitext body of a named `== Section ==`, empty when absent. */
function sectionRaw(wikitext: string, heading: string): string {
  const pattern = new RegExp('^==+\\s*' + heading + '\\s*==+\\s*$', 'im');
  const match = pattern.exec(wikitext);
  if (!match) return '';

  const start = match.index + match[0].length;
  const rest = wikitext.slice(start);
  const next = /^==[^=].*==\s*$/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/** Pull the bullet lines out of a named `== Section ==`. */
function sectionBullets(wikitext: string, heading: string): string[] {
  const body = sectionRaw(wikitext, heading);
  if (!body) return [];

  return body
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => /^\*+\s*\S/.test(line))
    .map((line) => {
      const depth = (/^(\*+)/.exec(line)?.[1].length ?? 1) - 1;
      const text = cleanWikitext(line.replace(/^\*+\s*/, ''));
      return text ? `${'  '.repeat(depth)}${text}` : '';
    })
    .filter(Boolean);
}

function infoboxField(wikitext: string, field: string): string | null {
  // Horizontal whitespace only: \s would swallow the newline and capture the
  // following infobox line when a field is left blank.
  const pattern = new RegExp('^\\|[ \\t]*' + field + '[ \\t]*=[ \\t]*(.*)$', 'im');
  const match = pattern.exec(wikitext);
  if (!match) return null;
  const value = cleanWikitext(match[1]);
  return value.length > 0 ? value : null;
}

function splitList(value: string | null): string[] {
  if (!value) return [];
  return value.split(/,|\band\b/).map((v) => v.trim()).filter(Boolean);
}

const TRADERS = new Set([
  'prapor', 'therapist', 'fence', 'skier', 'peacekeeper', 'mechanic',
  'ragman', 'jaeger', 'ref', 'lightkeeper', 'btr driver',
]);

const MAPS = new Set([
  'customs', 'factory', 'woods', 'shoreline', 'interchange', 'reserve',
  'the lab', 'lighthouse', 'streets of tarkov', 'ground zero', 'labyrinth',
]);

/**
 * Wiki link targets inside a chunk of wikitext, in page order.
 * Namespaced links (File:, Category:, ...) are not content and are dropped.
 */
function linkTargets(wikitext: string): string[] {
  const targets: string[] = [];
  const pattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(wikitext)) !== null) {
    const target = match[1].trim();
    if (/^(file|image|category|template):/i.test(target)) continue;
    targets.push(target);
  }
  return targets;
}

/** Traders and maps are linked constantly but are never gear to bring. */
function isGear(target: string): boolean {
  const lower = target.toLowerCase();
  if (TRADERS.has(lower) || MAPS.has(lower)) return false;
  if (/^(EXP|Roubles|Euros|Dollars|Scavs?|PMCs?|Quests?)$/i.test(target)) return false;
  return true;
}

/**
 * Keys and keycards the quest needs. Scoped to the objectives and guide text so
 * that keys handed out as rewards are not mistaken for gear you must bring.
 * tarkov.dev's `requiredKeys` is the precise source when the API is reachable.
 */
function extractKeys(wikitext: string): string[] {
  const scoped = [sectionRaw(wikitext, 'Objectives'), sectionRaw(wikitext, 'Guide')].join('\n');
  const keys = linkTargets(scoped).filter((target) => /\bkey(card|s)?\b/i.test(target));
  return Array.from(new Set(keys));
}

/** Items to bring in or hand over, read from the objective lines that need them. */
function extractItems(wikitext: string): { name: string; foundInRaid: boolean }[] {
  const objectives = sectionRaw(wikitext, 'Objectives');
  const found = new Map<string, boolean>();

  for (const line of objectives.split('\n')) {
    if (!/^\*+\s*\S/.test(line)) continue;
    if (!/hand over|stash|plant|give|obtain|deliver/i.test(line)) continue;

    const foundInRaid = /found in raid|in raid/i.test(line);
    for (const target of linkTargets(line)) {
      if (!isGear(target)) continue;
      found.set(target, (found.get(target) ?? false) || foundInRaid);
    }
  }

  return Array.from(found, ([name, foundInRaid]) => ({ name, foundInRaid }));
}

export function parseQuestPage(title: string, wikitext: string): WikiQuest {
  return {
    title,
    trader: infoboxField(wikitext, 'given by'),
    locations: splitList(infoboxField(wikitext, 'location')),
    kappaRequired: infoboxField(wikitext, 'reqkappa'),
    previous: splitList(infoboxField(wikitext, 'previous')),
    leadsTo: splitList(infoboxField(wikitext, 'leads to')),
    requirements: sectionBullets(wikitext, 'Requirements'),
    objectives: sectionBullets(wikitext, 'Objectives'),
    rewards: sectionBullets(wikitext, 'Rewards'),
    keys: extractKeys(wikitext),
    itemsToBring: extractItems(wikitext),
    wikiUrl: `https://escapefromtarkov.fandom.com/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
  };
}

export async function wikiGet(params: Record<string, string>): Promise<any> {
  const query = new URLSearchParams({ format: 'json', origin: '*', ...params });
  const response = await fetch(`${WIKI}?${query.toString()}`);
  if (!response.ok) throw new Error(`Wiki request failed (${response.status})`);
  return response.json();
}

/** Every page in Category:Quests, paged through and cached locally. */
export async function fetchQuestList(force = false): Promise<string[]> {
  if (!force) {
    try {
      const raw = localStorage.getItem(LIST_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.titles) && parsed.titles.length > 0) return parsed.titles;
      }
    } catch { /* fall through to a fresh fetch */ }
  }

  const titles: string[] = [];
  let cont: string | undefined;
  // The category runs to well over a thousand pages; bound the loop defensively.
  for (let page = 0; page < 20; page++) {
    const params: Record<string, string> = {
      action: 'query', list: 'categorymembers', cmtitle: 'Category:Quests',
      cmlimit: '500', cmnamespace: '0',
    };
    if (cont) params.cmcontinue = cont;
    const data = await wikiGet(params);
    for (const member of data?.query?.categorymembers ?? []) titles.push(member.title);
    cont = data?.continue?.cmcontinue;
    if (!cont) break;
  }

  const unique = Array.from(new Set(titles)).sort((a, b) => a.localeCompare(b));
  try {
    localStorage.setItem(LIST_CACHE_KEY, JSON.stringify({ titles: unique, fetchedAt: Date.now() }));
  } catch { /* cache is best-effort */ }
  return unique;
}

export async function fetchQuest(title: string): Promise<WikiQuest> {
  const cacheKey = `${PAGE_CACHE_PREFIX}${title}`;
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) return JSON.parse(raw) as WikiQuest;
  } catch { /* ignore and refetch */ }

  const data = await wikiGet({ action: 'parse', page: title, prop: 'wikitext', redirects: '1' });
  if (data?.error) throw new Error(data.error.info ?? `No wiki page for "${title}"`);

  const wikitext = data?.parse?.wikitext?.['*'];
  if (typeof wikitext !== 'string') throw new Error(`No wikitext returned for "${title}"`);

  const parsed = parseQuestPage(data.parse.title ?? title, wikitext);
  try { localStorage.setItem(cacheKey, JSON.stringify(parsed)); } catch { /* best-effort */ }
  return parsed;
}

/** Ranked substring match: exact, then prefix, then contains. */
export function searchQuests(titles: string[], query: string, limit = 12): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { title: string; score: number }[] = [];
  for (const title of titles) {
    const lower = title.toLowerCase();
    if (lower === q) scored.push({ title, score: 0 });
    else if (lower.startsWith(q)) scored.push({ title, score: 1 });
    else if (lower.includes(q)) scored.push({ title, score: 2 });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.title.localeCompare(b.title))
    .slice(0, limit)
    .map((s) => s.title);
}
