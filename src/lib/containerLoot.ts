/**
 * What each kind of container can hold.
 *
 * json.tarkov.dev places containers on the map but says nothing about their
 * contents, so "which containers might hold bolts" cannot be answered from it.
 * SPT ships the static loot tables that can, and
 * scripts/generate_map_data.py folds them into one file: the union across every
 * map, since a route needs to know what is possible rather than how likely it
 * is here specifically.
 */

export interface ContainerLoot {
  /** Item ids, indexed by the numbers in `containers`. */
  ids: string[];
  /** Item names, in the same order as `ids`. */
  names: string[];
  /** Container template id -> indexes into `ids`. */
  containers: Record<string, number[]>;
}

const EMPTY: ContainerLoot = { ids: [], names: [], containers: {} };

let loaded: ContainerLoot | null = null;
let pending: Promise<ContainerLoot> | null = null;

export async function loadContainerLoot(): Promise<ContainerLoot> {
  if (loaded) return loaded;
  if (pending) return pending;

  pending = fetch('/data/container-loot.json')
    .then((response) => (response.ok ? response.json() : EMPTY))
    .catch(() => EMPTY)
    .then((data: ContainerLoot) => {
      loaded = data;
      pending = null;
      return data;
    });
  return pending;
}

/** Container templates that can hold any of these items. */
export function containersHolding(itemIds: string[], loot: ContainerLoot): Map<string, string[]> {
  const wanted = new Map<string, number>();
  for (const id of itemIds) {
    const index = loot.ids.indexOf(id);
    if (index >= 0) wanted.set(id, index);
  }
  if (wanted.size === 0) return new Map();

  const result = new Map<string, string[]>();
  for (const [template, indexes] of Object.entries(loot.containers)) {
    const inside = new Set(indexes);
    const holds = [...wanted].filter(([, index]) => inside.has(index)).map(([id]) => id);
    if (holds.length > 0) result.set(template, holds);
  }
  return result;
}

/** Every item name known from container tables, for the search. */
export function containerItemChoices(loot: ContainerLoot): { id: string; name: string }[] {
  return loot.ids.map((id, index) => ({ id, name: loot.names[index] ?? id }));
}
