/**
 * What each kind of container can hold.
 *
 * json.tarkov.dev places containers on the map but says nothing about their
 * contents, so "which containers might hold bolts" cannot be answered from it.
 * SPT ships the static loot tables that can, and
 * scripts/generate_map_data.py folds them into one file: which items each kind
 * of container can hold, and the chance one opened container actually has it.
 */

export interface ContainerLoot {
  /** Item ids, indexed by the numbers in `containers`. */
  ids: string[];
  /** Item names, in the same order as `ids`. */
  names: string[];
  /** Container template id -> indexes into `ids`. */
  containers: Record<string, number[]>;
  /** Chance in parts per million, parallel to `containers`. */
  chances: Record<string, number[]>;
}

const EMPTY: ContainerLoot = { ids: [], names: [], containers: {}, chances: {} };

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

/** One item a container kind can hold, with the chance it does. */
export interface ContainerHit {
  id: string;
  /** Chance an opened container of this kind holds it, 0..1. */
  chance: number;
}

/** Container templates that can hold any of these items, with the odds. */
export function containersHolding(
  itemIds: string[], loot: ContainerLoot,
): Map<string, ContainerHit[]> {
  const wanted = new Map<string, number>();
  for (const id of itemIds) {
    const index = loot.ids.indexOf(id);
    if (index >= 0) wanted.set(id, index);
  }
  if (wanted.size === 0) return new Map();

  const result = new Map<string, ContainerHit[]>();
  for (const [template, indexes] of Object.entries(loot.containers)) {
    // The chance list runs parallel to the index list, so the position of an
    // item in `indexes` is where its odds live.
    const at = new Map(indexes.map((index, position) => [index, position]));
    const odds = loot.chances[template] ?? [];

    const holds: ContainerHit[] = [];
    for (const [id, index] of wanted) {
      const position = at.get(index);
      if (position === undefined) continue;
      holds.push({ id, chance: (odds[position] ?? 0) / 1e6 });
    }
    if (holds.length > 0) result.set(template, holds);
  }
  return result;
}

/** Every item name known from container tables, for the search. */
export function containerItemChoices(loot: ContainerLoot): { id: string; name: string }[] {
  return loot.ids.map((id, index) => ({ id, name: loot.names[index] ?? id }));
}
