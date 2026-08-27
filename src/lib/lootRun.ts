import { distance2d } from './mapgeo';
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

/** Above this many stops the ordering gets slow and the raid gets silly. */
export const MAX_STOPS = 20;
/** How close a lock has to be before it might be the thing in your way. */
export const LOCK_RADIUS = 12;

export interface ItemChoice {
  id: string;
  name: string;
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
}

/**
 * Everywhere the wanted items can appear: loose spots plus every container of a
 * kind that can hold one.
 */
export function spotsFor(
  itemIds: string[],
  points: LooseLootPoint[],
  containers: LootContainer[],
  holdsByTemplate: Map<string, string[]>,
  containerNames: Record<string, string>,
): LootSpot[] {
  const wanted = new Set(itemIds);
  if (wanted.size === 0) return [];

  const loose: LootSpot[] = points
    .map((point) => ({
      position: point.position,
      hits: point.items.filter((id) => wanted.has(id)),
      container: null,
    }))
    .filter((spot) => spot.hits.length > 0);

  const inContainers: LootSpot[] = containers
    .filter((container) => holdsByTemplate.has(container.template))
    .map((container) => ({
      position: container.position,
      hits: holdsByTemplate.get(container.template) ?? [],
      container: containerNames[container.template] ?? 'Container',
    }));

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

  return items
    .filter((item) => item.name.toLowerCase().includes(needle))
    // A name that starts with what you typed is more likely the one you meant.
    .sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(needle) ? 0 : 1;
      const bStarts = b.name.toLowerCase().startsWith(needle) ? 0 : 1;
      return aStarts - bStarts || b.spots - a.spots || a.name.localeCompare(b.name);
    })
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
 * Capped first: a hundred spots of an item is not a raid plan, and the ordering
 * is quadratic.
 */
export function buildLootRun(
  spots: LootSpot[],
  locks: MapLock[],
  spawn: { position: Vec3; zoneName: string | null },
  limit: number,
  names: Record<string, string> = {},
): LootRun {
  if (spots.length === 0) return { stops: [], totalDistance: 0, skipped: 0, keys: [] };

  // A spot holding three things on your list beats one holding a single item,
  // even a little further out; distance only breaks the tie.
  const nearest = [...spots]
    .sort((a, b) => b.hits.length - a.hits.length
      || distance2d(spawn.position, a.position) - distance2d(spawn.position, b.position))
    .slice(0, Math.min(limit, MAX_STOPS));

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
      description: [what || 'Possible spawn', nearby.length > 0 ? 'a lock nearby' : null]
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

function pathLength(spawn: Vec3, points: LootSpot[]): number {
  let total = 0;
  let previous = spawn;
  for (const point of points) {
    total += distance2d(previous, point.position);
    previous = point.position;
  }
  return total;
}

function twoOpt(spawn: Vec3, points: LootSpot[]): LootSpot[] {
  if (points.length < 3) return points;

  let best = [...points];
  let bestLength = pathLength(spawn, best);
  let improved = true;
  let guard = 0;

  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const candidate = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        const length = pathLength(spawn, candidate);
        if (length < bestLength - 0.01) {
          best = candidate;
          bestLength = length;
          improved = true;
        }
      }
    }
  }
  return best;
}
