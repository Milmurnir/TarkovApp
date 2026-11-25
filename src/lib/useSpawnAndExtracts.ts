import { useCallback, useMemo } from 'react';
import {
  extractDisplayName, extractsForSpawn, isPlainPmcExtract, spawnZones,
  type MapData, type MapExtractInfo, type MapIndexEntry, type MapSpawnPoint,
} from './mapData';
import type { MapSlice } from './jsonApi';
import type { Vec3 } from './types';

/** "the-lab-dark" -> "The Lab Dark": a last resort when no translated name is cached. */
function tidyMapId(id: string): string {
  return id.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

export interface Transit {
  position: Vec3;
  label: string;
  toMap: string | null;
}

/**
 * Everything about where a raid starts and where it can end: spawn zones,
 * the route's starting point, the extracts open from that spawn, transits
 * and sniper scavs. All derived from the offline map data (mapData) and the
 * json.tarkov.dev slice (api), which each cover what the other lacks.
 */
export function useSpawnAndExtracts({ mapData, api, maps, zoneIndex, clickedSpawn }: {
  mapData: MapData | null;
  api: MapSlice | null;
  maps: MapIndexEntry[];
  zoneIndex: number;
  clickedSpawn: Vec3 | null;
}) {
  /**
   * Only Streets tags a 'sniper' category in the API, so the generated data
   * (derived from marksman waves) is the source that covers every map.
   */
  const sniperSpawns = useMemo(() => {
    if (mapData?.sniperSpawns?.length) return mapData.sniperSpawns;
    return api?.sniperSpawns ?? [];
  }, [mapData, api]);

  /** Where this map lets you walk straight into another one, e.g. Woods into Reserve. */
  const transits: Transit[] = useMemo(() => (api?.transits ?? []).map((transit) => {
    const destination = maps.find((m) => m.normalizedName === transit.toMap)?.wikiName
      ?? transit.toMapName
      ?? (transit.toMap ? tidyMapId(transit.toMap) : null);
    return {
      position: transit.position,
      label: destination ? `Transit to ${destination}` : (transit.description ?? 'Transit'),
      toMap: transit.toMap,
    };
  }), [api, maps]);

  const zones = useMemo(() => (mapData ? spawnZones(mapData.spawns, mapData.labels) : []), [mapData]);
  const activeZone = zones[Math.min(zoneIndex, Math.max(0, zones.length - 1))] ?? null;

  /** Centre of an infiltration zone, used as the route start when offline. */
  const zoneCentre: MapSpawnPoint | null = useMemo(() => {
    if (!activeZone || activeZone.spawns.length === 0) return null;
    const count = activeZone.spawns.length;
    const sum = activeZone.spawns.reduce(
      (acc, s) => ({ x: acc.x + s.position.x, y: acc.y + s.position.y, z: acc.z + s.position.z }),
      { x: 0, y: 0, z: 0 },
    );
    return {
      ...activeZone.spawns[0],
      zoneName: activeZone.label,
      position: { x: sum.x / count, y: sum.y / count, z: sum.z / count },
    };
  }, [activeZone]);

  const spawnExtracts = useMemo(
    () => (mapData && activeZone ? extractsForSpawn(mapData.extracts, activeZone.infiltration) : []),
    [mapData, activeZone],
  );
  const plainExtracts = useMemo(() => spawnExtracts.filter(isPlainPmcExtract), [spawnExtracts]);
  const restrictedExtracts = useMemo(
    () => spawnExtracts.filter((e) => !isPlainPmcExtract(e)),
    [spawnExtracts],
  );

  /**
   * In-game extract names, keyed by the untranslated name SPT also uses. The
   * offline data only has that raw id, so the API supplies the label players
   * actually see on the exit timer.
   */
  const extractNameByRaw = useMemo(() => {
    const byRaw = new Map<string, string>();
    for (const extract of api?.extracts ?? []) {
      if (extract.rawName && extract.name) byRaw.set(extract.rawName.toLowerCase(), extract.name);
    }
    return byRaw;
  }, [api]);

  const extractLabel = useCallback((extract: MapExtractInfo): string => {
    const raw = extract.name ?? '';
    return extractNameByRaw.get(raw.toLowerCase()) ?? extractDisplayName(raw);
  }, [extractNameByRaw]);

  /**
   * Extracts the route may finish at. The API supplies the coordinates and the
   * SPT list supplies the restrictions, joined on the untranslated name, so
   * scav routes and special exits (no backpack, Red Rebel, train) are excluded.
   */
  const routableExtracts = useMemo(() => {
    if (!api) return [];
    const pmcOnly = api.extracts.filter((e) => e.faction !== 'scav');
    if (!mapData) return pmcOnly;

    const restricted = new Set(
      mapData.extracts.filter((e) => !isPlainPmcExtract(e)).map((e) => (e.name ?? '').toLowerCase()),
    );
    const allowed = pmcOnly.filter((e) => !restricted.has((e.rawName ?? '').toLowerCase()));
    // Never strip every option: an empty list would leave the route with no end.
    return allowed.length > 0 ? allowed : pmcOnly;
  }, [api, mapData]);

  const apiSpawns = useMemo(() => api?.spawns ?? [], [api]);

  /**
   * Where the route starts: the clicked point, else the spawn zone picked in
   * the sidebar. The API's spawn list is only a last resort -- its first entry
   * is whatever the API happens to list first, often a scav or boss spawn,
   * and using it ahead of the zone made the zone picker do nothing.
   */
  const routeStart = useMemo(() => {
    if (clickedSpawn) return { position: clickedSpawn, zoneName: 'Clicked spawn' };
    if (zoneCentre) return { position: zoneCentre.position, zoneName: zoneCentre.zoneName };
    const spawn = apiSpawns.find((s) => s.sides?.some((side) => /pmc|all/i.test(side))) ?? apiSpawns[0];
    if (spawn) return { position: spawn.position, zoneName: spawn.zoneName };
    return null;
  }, [clickedSpawn, apiSpawns, zoneCentre]);

  return {
    sniperSpawns, transits, zones, activeZone, plainExtracts, restrictedExtracts,
    extractLabel, routableExtracts, routeStart,
  };
}
