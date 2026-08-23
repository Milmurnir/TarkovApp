import type { MapExtract, MapSpawn, MapTransit, Task } from './types';

const ENDPOINT = '/api/tarkov';
const CACHE_KEY_PREFIX = 'tarkov-map-cache-v3:';
const CACHE_TTL_MS = 1000 * 60 * 60 * 12;

const ZONE_FRAGMENT = `zones { id position { x y z } map { normalizedName } }`;
const KEYS_FRAGMENT = `requiredKeys { name shortName }`;

/**
 * Fragments are spread per concrete type because `zones` lives on the six
 * concrete objective types, not on the TaskObjective interface.
 */
const QUERY = `
query MapData($mapName: [String!]) {
  maps(name: $mapName) {
    name
    normalizedName
    spawns { zoneName sides categories position { x y z } }
    extracts {
      id
      name
      faction
      position { x y z }
      switches { id name switchType position { x y z } }
    }
    transits { id description conditions map { name normalizedName } position { x y z } }
  }
  tasks {
    id
    name
    normalizedName
    minPlayerLevel
    kappaRequired
    wikiLink
    experience
    trader { name }
    map { name normalizedName }
    taskRequirements { task { name } status }
    traderRequirements { trader { name } value requirementType }
    objectives {
      id
      type
      description
      optional
      maps { name normalizedName }
      ... on TaskObjectiveBasic { ${ZONE_FRAGMENT} ${KEYS_FRAGMENT} }
      ... on TaskObjectiveItem { ${ZONE_FRAGMENT} ${KEYS_FRAGMENT} count foundInRaid }
      ... on TaskObjectiveMark { ${ZONE_FRAGMENT} ${KEYS_FRAGMENT} }
      ... on TaskObjectiveQuestItem {
        ${ZONE_FRAGMENT}
        ${KEYS_FRAGMENT}
        possibleLocations { map { normalizedName } positions { x y z } }
      }
      ... on TaskObjectiveShoot { ${ZONE_FRAGMENT} ${KEYS_FRAGMENT} }
      ... on TaskObjectiveUseItem { ${ZONE_FRAGMENT} ${KEYS_FRAGMENT} }
      ... on TaskObjectiveExtract { ${KEYS_FRAGMENT} exitName exitStatus }
    }
  }
}`;

export interface StreetsData {
  spawns: MapSpawn[];
  extracts: MapExtract[];
  transits: MapTransit[];
  tasks: Task[];
  fetchedAt: number;
  stale: boolean;
}

export class TarkovApiError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message);
    this.name = 'TarkovApiError';
  }
}

function readCache(mapName: string): StreetsData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + mapName);
    if (!raw) return null;
    return JSON.parse(raw) as StreetsData;
  } catch {
    return null;
  }
}

function writeCache(mapName: string, data: StreetsData) {
  try {
    localStorage.setItem(CACHE_KEY_PREFIX + mapName, JSON.stringify(data));
  } catch {
    // Quota exceeded is not fatal; the app just refetches next time.
  }
}

/**
 * Fetches one map's spawns, extracts and every task with its objective zones.
 *
 * The upstream API has outages. When it is unreachable we fall back to the last
 * good cache and mark it stale rather than leaving the app empty.
 */
export async function fetchMapApiData(mapName: string, force = false): Promise<StreetsData> {
  const cached = readCache(mapName);
  const fresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;
  if (cached && fresh && !force) return cached;

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { mapName: [mapName] } }),
    });
  } catch (error) {
    if (cached) return { ...cached, stale: true };
    throw new TarkovApiError('Could not reach the tarkov.dev API.', String(error));
  }

  const text = await response.text();
  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    if (cached) return { ...cached, stale: true };
    throw new TarkovApiError('tarkov.dev returned a non-JSON response.', text.slice(0, 200));
  }

  if (payload.errors) {
    const detail = Array.isArray(payload.errors)
      ? payload.errors.map((e: any) => (typeof e === 'string' ? e : e.message)).join('; ')
      : String(payload.errors);
    if (cached) return { ...cached, stale: true };
    throw new TarkovApiError('tarkov.dev API is unavailable.', detail);
  }

  const map = payload?.data?.maps?.[0];
  if (!map) {
    if (cached) return { ...cached, stale: true };
    throw new TarkovApiError(`tarkov.dev returned no data for ${mapName}.`);
  }

  const data: StreetsData = {
    spawns: (map.spawns ?? []).filter((s: MapSpawn) => s.position),
    extracts: (map.extracts ?? []).filter((e: MapExtract) => e.position),
    transits: (map.transits ?? []).filter((t: MapTransit) => t.position),
    tasks: payload.data.tasks ?? [],
    fetchedAt: Date.now(),
    stale: false,
  };
  writeCache(mapName, data);
  return data;
}

/** Player spawns only — scav/boss spawn zones are not useful as a start point. */
export function playerSpawns(spawns: MapSpawn[]): MapSpawn[] {
  const isPlayer = (s: MapSpawn) =>
    (s.categories ?? []).some((c) => c.toLowerCase() === 'player') ||
    (s.sides ?? []).some((c) => c.toLowerCase() === 'pmc' || c.toLowerCase() === 'all');
  const filtered = spawns.filter(isPlayer);
  return filtered.length > 0 ? filtered : spawns;
}
