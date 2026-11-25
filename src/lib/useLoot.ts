import { useEffect, useMemo, useState } from 'react';
import { byDensity, placeContainers } from './loot';
import { buildLootRun, DEFAULT_BALANCE, itemsOnMap, spotsFor, type ItemChoice } from './lootRun';
import { containersHolding, type ContainerLoot } from './containerLoot';
import { loadLooseLoot, type MapSlice } from './jsonApi';
import type { Settings } from './settings';
import type { Route, Vec3 } from './types';

/**
 * The Loot run tab: which items you are after on this map, where they can
 * be, and the run that collects them.
 */
export function useLootRun({ mapName, api, active, routeStart, reference }: {
  mapName: string;
  api: MapSlice | null;
  /** Only the Loot run tab builds a run. */
  active: boolean;
  routeStart: { position: Vec3; zoneName: string | null } | null;
  reference: {
    containerNames: Record<string, string>;
    containerLoot: ContainerLoot;
    shortNames: Record<string, string>;
    itemNames: Record<string, string>;
  };
}) {
  const { containerNames, containerLoot, shortNames, itemNames } = reference;
  const [wanted, setWanted] = useState<ItemChoice[]>([]);
  const [limit, setLimit] = useState(10);
  const [balance, setBalance] = useState(DEFAULT_BALANCE);

  // What you want from one map is rarely on the next.
  useEffect(() => { setWanted([]); }, [mapName]);

  /** Loose loot for this map, read from what the last map fetch cached. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const looseLoot = useMemo(() => loadLooseLoot(mapName), [mapName, api]);

  /** Names for everything searchable: loose loot, keys, and container contents. */
  const allItemNames = useMemo(() => {
    const names: Record<string, string> = { ...itemNames };
    containerLoot.ids.forEach((id, index) => {
      if (!names[id]) names[id] = containerLoot.names[index] ?? id;
    });
    return names;
  }, [itemNames, containerLoot]);

  const items = useMemo(() => {
    const seen = new Map(itemsOnMap(looseLoot.points, allItemNames).map((item) => [item.id, item]));

    // How many containers of each kind stand on this map, so an item's count
    // can include the cupboards it might be inside and not just the floor.
    const perTemplate = new Map<string, number>();
    for (const container of api?.lootContainers ?? []) {
      perTemplate.set(container.template, (perTemplate.get(container.template) ?? 0) + 1);
    }

    const fromContainers = new Map<number, number>();
    for (const [template, indexes] of Object.entries(containerLoot.containers)) {
      const placed = perTemplate.get(template);
      if (!placed) continue;
      for (const index of indexes) {
        fromContainers.set(index, (fromContainers.get(index) ?? 0) + placed);
      }
    }

    for (const [index, count] of fromContainers) {
      const id = containerLoot.ids[index];
      if (!id) continue;
      const existing = seen.get(id);
      if (existing) existing.spots += count;
      else seen.set(id, { id, name: containerLoot.names[index] ?? id, spots: count });
    }

    return Array.from(seen.values())
      .map((item) => ({ ...item, short: shortNames[item.id] }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [looseLoot, allItemNames, api, containerLoot, shortNames]);

  const spots = useMemo(() => {
    const ids = wanted.map((item) => item.id);
    return spotsFor(
      ids, looseLoot.points, api?.lootContainers ?? [],
      containersHolding(ids, containerLoot), containerNames,
    );
  }, [wanted, looseLoot, api, containerLoot, containerNames]);

  const run = useMemo(() => {
    if (!active || spots.length === 0 || !routeStart) return null;
    return buildLootRun(spots, looseLoot.locks, routeStart, limit, allItemNames, balance);
  }, [active, spots, looseLoot, routeStart, limit, allItemNames, balance]);

  return {
    items, wanted, setWanted, limit, setLimit, balance, setBalance, spots, run, allItemNames,
  };
}

/** The containers layer on the map, filtered by the Loot panel's settings. */
export function useLootLayer({ api, containerNames, route, settings }: {
  api: MapSlice | null;
  containerNames: Record<string, string>;
  route: Route | null;
  settings: Pick<Settings, 'showLoot' | 'lootRadius' | 'hiddenLoot' | 'lootDensity'>;
}) {
  const { showLoot, lootRadius, hiddenLoot, lootDensity } = settings;

  /** Containers with a name and a distance from the route. */
  const placed = useMemo(
    () => placeContainers(api?.lootContainers ?? [], containerNames, route ? route.stops.map((s) => s.position) : []),
    [api, containerNames, route],
  );

  const visible = useMemo(() => {
    if (!showLoot) return [];
    // With no route there is nothing to be near, so the radius sits inert
    // rather than filtering everything away.
    const byRoute = lootRadius === null || !route
      ? () => true
      : (container: { fromRoute: number }) => container.fromRoute <= lootRadius;

    // Density is judged against everything on the map, not what survives the
    // other filters: hiding drawers should not make a cluster stop being one.
    const dense = new Set(byDensity(placed, lootDensity));

    return placed.filter((container) =>
      byRoute(container) && dense.has(container) && !hiddenLoot.includes(container.name));
  }, [showLoot, placed, lootRadius, hiddenLoot, route, lootDensity]);

  return { placed, visible };
}
