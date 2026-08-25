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
