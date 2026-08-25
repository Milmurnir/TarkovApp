import { distanceToPath } from './mapgeo';
import type { LootContainer, Vec3 } from './types';

/**
 * Loot containers on a map.
 *
 * Positions come live from json.tarkov.dev, which identifies each container
 * only by its BSG template id and publishes no names for them. The names are
 * generated from SPT's locale into public/data/loot-containers.json — see
 * scripts/generate_map_data.py.
 */

let names: Record<string, string> | null = null;
let pending: Promise<Record<string, string>> | null = null;

export async function loadContainerNames(): Promise<Record<string, string>> {
  if (names) return names;
  if (pending) return pending;

  pending = fetch('/data/loot-containers.json')
    .then((response) => (response.ok ? response.json() : {}))
    .catch(() => ({}))
    .then((loaded: Record<string, string>) => {
      names = loaded;
      pending = null;
      return loaded;
    });
  return pending;
}

export interface PlacedContainer extends LootContainer {
  name: string;
  /** Metres from the route, or Infinity when there is no route yet. */
  fromRoute: number;
}

/**
 * Names each container and measures how far off the route it sits.
 *
 * The distance is the whole point of the feature: a map with five hundred
 * containers drawn on it is wallpaper, but "these thirty are within thirty
 * metres of where you are already walking" is a plan.
 */
export function placeContainers(
  containers: LootContainer[],
  lookup: Record<string, string>,
  path: Vec3[],
): PlacedContainer[] {
  return containers.map((container) => ({
    ...container,
    name: lookup[container.template] ?? 'Container',
    fromRoute: path.length > 0 ? distanceToPath(container.position, path) : Infinity,
  }));
}

/** Container names present, with how many of each, most common first. */
export function countByName(containers: PlacedContainer[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const container of containers) {
    counts.set(container.name, (counts.get(container.name) ?? 0) + 1);
  }
  return Array.from(counts, ([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Neighbourhood the density threshold counts within, in game metres. */
export const DENSITY_RADIUS = 20;

/**
 * Keeps only containers with enough neighbours nearby.
 *
 * Lone containers scattered across a map are rarely worth a detour; a cupboard
 * with six others in the same room is. Bucketed into a grid first, because the
 * naive comparison is a million and a half distance checks on Streets and this
 * runs on every filter change.
 */
export function byDensity<T extends { position: Vec3 }>(containers: T[], minimum: number): T[] {
  if (minimum <= 1) return containers;

  const cell = DENSITY_RADIUS;
  const buckets = new Map<string, T[]>();
  const key = (x: number, z: number) => `${Math.floor(x / cell)}:${Math.floor(z / cell)}`;

  for (const container of containers) {
    const id = key(container.position.x, container.position.z);
    const bucket = buckets.get(id);
    if (bucket) bucket.push(container);
    else buckets.set(id, [container]);
  }

  const withinRadius = DENSITY_RADIUS * DENSITY_RADIUS;

  return containers.filter((container) => {
    const cx = Math.floor(container.position.x / cell);
    const cz = Math.floor(container.position.z / cell);
    let near = 0;

    // The nine surrounding cells cover everything inside one radius.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const other of buckets.get(`${cx + dx}:${cz + dz}`) ?? []) {
          const ox = other.position.x - container.position.x;
          const oz = other.position.z - container.position.z;
          if (ox * ox + oz * oz <= withinRadius) near += 1;
        }
        if (near >= minimum) return true;
      }
    }
    return near >= minimum;
  });
}
