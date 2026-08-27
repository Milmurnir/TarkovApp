import { distance2d } from './mapgeo';
import type { ContainerHit } from './containerLoot';
import type { LooseLootPoint } from './jsonApi';
import type { LootContainer, MapLock, RouteStop, Vec3 } from './types';

/**
 * Routing a raid around items rather than around quests.
 *
 * Two sources, because neither is enough alone. Loose loot lists what can
 * appear at each spot on the floor. Containers are placed by the same data but
 * with no word on their contents, so what a toolbox might hold comes from SPT's
 * static tables — see containerLoot.ts. Without that half, asking for bolts
 * would find the few lying on shelves and none of the toolboxes.
 *
 * "Can" is the operative word throughout: these are possible spawns, not
 * guaranteed ones, and the panel says so. A route that promises six Golden neck
 * chains and delivers none is worse than no route.
 */

/** How close a lock has to be before it might be the thing in your way. */
export const LOCK_RADIUS = 12;

/**
 * What one loose spawn point is worth.
 *
 * Containers come with real odds from SPT's static tables. Loose loot does not:
 * json.tarkov.dev lists what can lie at a point but not how often, and SPT's own
 * looseLoot tables are 42 MB per map behind git LFS, which is not something to
 * ship for a ranking tweak. So it is estimated -- a point that spawns rolls
 * roughly one item from its candidate list, and points do not always spawn --
 * which makes a lone-candidate point worth about a good container and a
 * twelve-candidate one worth much less. Right in shape, rough in scale.
 */
const LOOSE_SPAWN_CHANCE = 0.25;

/**
 * Where distance starts cancelling out odds.
 *
 * A spot at the median distance from your spawn counts for half what the same
 * spot would at your feet. Taking the median rather than a fixed metre count
 * makes it scale itself: Factory and Streets both end up judging "far" against
 * their own size.
 */
function halfLife(distances: number[]): number {
  if (distances.length === 0) return 1;
  const sorted = [...distances].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 1;
}

export interface ItemChoice {
  id: string;
  name: string;
  /** What the game calls it in your stash, when that differs. */
  short?: string;
  /** Spots on this map where it can appear. */
  spots: number;
}

/** One place worth walking to, from either source. */
export interface LootSpot {
  position: Vec3;
  /** Wanted items that can turn up here. */
  hits: string[];
  /** Container name, or null when the loot lies loose. */
  container: string | null;
  /** Chance at least one wanted item is here, 0..1. */
  chance: number;
}

/** Chance of at least one, given independent per-item odds. */
function anyOf(chances: number[]): number {
  return 1 - chances.reduce((left, chance) => left * (1 - chance), 1);
}

/**
 * Everywhere the wanted items can appear: loose spots plus every container of a
 * kind that can hold one.
 */
export function spotsFor(
  itemIds: string[],
  points: LooseLootPoint[],
  containers: LootContainer[],
  holdsByTemplate: Map<string, ContainerHit[]>,
  containerNames: Record<string, string>,
): LootSpot[] {
  const wanted = new Set(itemIds);
  if (wanted.size === 0) return [];

  const loose: LootSpot[] = points
    .map((point) => {
      const hits = point.items.filter((id) => wanted.has(id));
      // One roll spread over everything that could lie here, so a spot that
      // only ever holds the thing you want beats one that might hold anything.
      const each = LOOSE_SPAWN_CHANCE / Math.max(1, point.items.length);
      return { position: point.position, hits, container: null, chance: anyOf(hits.map(() => each)) };
    })
    .filter((spot) => spot.hits.length > 0);

  const inContainers: LootSpot[] = containers
    .filter((container) => holdsByTemplate.has(container.template))
    .map((container) => {
      const holds = holdsByTemplate.get(container.template) ?? [];
      return {
        position: container.position,
        hits: holds.map((hit) => hit.id),
        container: containerNames[container.template] ?? 'Container',
        chance: anyOf(holds.map((hit) => hit.chance)),
      };
    });

  return [...loose, ...inContainers];
}

/** Items that can spawn on this map, searchable by name. */
export function itemsOnMap(points: LooseLootPoint[], names: Record<string, string>): ItemChoice[] {
  const counts = new Map<string, number>();
  for (const point of points) {
    for (const id of point.items) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return Array.from(counts, ([id, spots]) => ({ id, name: names[id] ?? id, spots }))
    .filter((choice) => choice.name !== choice.id)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function searchItems(items: ItemChoice[], query: string): ItemChoice[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];

  // Matched on the short name as well: a 6-STEN-140-M military battery is a
  // "Tank battery" everywhere except in this data, and that is what gets typed.
  const haystack = (item: ItemChoice) => `${item.name} ${item.short ?? ''}`.toLowerCase();
  const starts = (item: ItemChoice) =>
    item.name.toLowerCase().startsWith(needle) || (item.short ?? '').toLowerCase().startsWith(needle);

  return items
    .filter((item) => haystack(item).includes(needle))
    // A name that starts with what you typed is more likely the one you meant.
    .sort((a, b) => (starts(a) ? 0 : 1) - (starts(b) ? 0 : 1)
      || b.spots - a.spots
      || a.name.localeCompare(b.name))
    .slice(0, 10);
}

/** Locks close enough to a stop to plausibly be between you and it. */
export function locksNear(position: Vec3, locks: MapLock[]): MapLock[] {
  return locks.filter((lock) => distance2d(position, lock.position) <= LOCK_RADIUS);
}

export interface LootRun {
  stops: RouteStop[];
  totalDistance: number;
  /** Spots left out because the run was capped. */
  skipped: number;
  /** Key item ids any stop might need, most needed first. */
  keys: { id: string; stops: number }[];
}

/**
 * Nearest-neighbour from the spawn, then 2-opt, the same as the quest route.
 *
 * Which spots make the cut is the interesting half. Neither odds nor distance
 * decides alone: a 12% toolbox across the map loses to a 12% one by your spawn,
 * and a 0.6% medcase next door loses to a 12% toolbox a little further out. So
 * each spot is scored as its odds discounted by how far it sits, and the best
 * `limit` are kept -- `Infinity` keeps every one.
 */
export function buildLootRun(
  spots: LootSpot[],
  locks: MapLock[],
  spawn: { position: Vec3; zoneName: string | null },
  limit: number,
  names: Record<string, string> = {},
): LootRun {
  if (spots.length === 0) return { stops: [], totalDistance: 0, skipped: 0, keys: [] };

  const distances = spots.map((spot) => distance2d(spawn.position, spot.position));
  const half = halfLife(distances);
  const nearest = spots
    .map((spot, index) => ({ spot, score: spot.chance / (1 + distances[index] / half) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Number.isFinite(limit) ? limit : spots.length)
    .map((ranked) => ranked.spot);

  const ordered = twoOpt(spawn.position, nearestNeighbour(spawn.position, nearest));

  const stops: RouteStop[] = [{
    order: 0,
    label: spawn.zoneName ?? 'Spawn',
    description: 'Your spawn point',
    position: spawn.position,
    kind: 'spawn',
    legDistance: 0,
    cumulativeDistance: 0,
    optional: false,
  }];

  const keyCounts = new Map<string, number>();
  let cumulative = 0;
  let previous = spawn.position;

  ordered.forEach((spot, index) => {
    const leg = distance2d(previous, spot.position);
    cumulative += leg;

    const nearby = locksNear(spot.position, locks);
    const keys = Array.from(new Set(nearby.map((lock) => lock.key).filter((k): k is string => Boolean(k))));
    for (const key of keys) keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);

    const what = spot.hits.map((id) => names[id] ?? 'item').join(', ');

    stops.push({
      order: index + 1,
      label: spot.container ?? `Loose loot ${index + 1}`,
      description: [`${percent(spot.chance)} · ${what || 'possible spawn'}`,
        nearby.length > 0 ? 'a lock nearby' : null]
        .filter(Boolean).join(' — '),
      position: spot.position,
      kind: 'objective',
      legDistance: leg,
      cumulativeDistance: cumulative,
      optional: false,
      keys,
    });
    previous = spot.position;
  });

  return {
    stops,
    totalDistance: cumulative,
    skipped: Math.max(0, spots.length - ordered.length),
    keys: Array.from(keyCounts, ([id, count]) => ({ id, stops: count }))
      .sort((a, b) => b.stops - a.stops),
  };
}

/** Odds read as a percentage, kept legible when they are tiny. */
function percent(chance: number): string {
  if (chance >= 0.1) return `${Math.round(chance * 100)}%`;
  if (chance >= 0.01) return `${(chance * 100).toFixed(1)}%`;
  return `${(chance * 100).toFixed(2)}%`;
}

function nearestNeighbour(spawn: Vec3, points: LootSpot[]): LootSpot[] {
  const remaining = [...points];
  const ordered: LootSpot[] = [];
  let current = spawn;

  while (remaining.length > 0) {
    let best = 0;
    let bestDistance = distance2d(current, remaining[0].position);
    for (let i = 1; i < remaining.length; i++) {
      const d = distance2d(current, remaining[i].position);
      if (d < bestDistance) { best = i; bestDistance = d; }
    }
    const [chosen] = remaining.splice(best, 1);
    ordered.push(chosen);
    current = chosen.position;
  }
  return ordered;
}

/**
 * 2-opt on an open path, judged by the two edges a reversal actually changes
 * rather than by re-walking the whole route. Rebuilding the array and measuring
 * it inside the loop was fine for twenty stops and hopeless for the hundreds
 * "All stops" can ask for -- cubic work against quadratic.
 */
function twoOpt(spawn: Vec3, points: LootSpot[]): LootSpot[] {
  const count = points.length;
  if (count < 3) return points;

  const best = [...points];
  const at = (index: number) => (index < 0 ? spawn : best[index].position);
  // Long routes get fewer sweeps; nearly all the gain lands in the first few.
  const sweeps = count > 200 ? 4 : 50;

  for (let sweep = 0; sweep < sweeps; sweep++) {
    let improved = false;
    for (let i = 0; i < count - 1; i++) {
      for (let k = i + 1; k < count; k++) {
        const tail = k + 1 < count;
        const before = distance2d(at(i - 1), at(i)) + (tail ? distance2d(at(k), at(k + 1)) : 0);
        const after = distance2d(at(i - 1), at(k)) + (tail ? distance2d(at(i), at(k + 1)) : 0);
        if (after < before - 0.01) {
          reverseBetween(best, i, k);
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return best;
}

function reverseBetween(points: LootSpot[], from: number, to: number): void {
  for (let left = from, right = to; left < right; left++, right--) {
    [points[left], points[right]] = [points[right], points[left]];
  }
}
