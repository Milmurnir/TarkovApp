import type { MapExtract, MapSpawn, Task, TaskObjective, Vec3 } from './types';

/**
 * Client for json.tarkov.dev.
 *
 * The GraphQL API at api.tarkov.dev has been returning "GraphQL server
 * unavailable" since 2026-07-21 (the-hideout/tarkov-api#474). A maintainer
 * pointed to this JSON API as the live replacement, and it is what tarkov.dev's
 * own site runs on. It carries everything the router needs: objective zones with
 * coordinates, extracts with positions and switches, and spawn points including
 * sniper scavs.
 *
 * The two datasets are large (~9.5 MB maps, ~2.2 MB tasks), so they are fetched
 * once, reduced to the slice one map needs, and only that slice is cached.
 */
const BASE = '/api/json';
const CACHE_PREFIX = 'tarkov-json-slice-v3:';
const GRAPH_KEY = 'tarkov-task-index-v2';
const LANGUAGE = 'en';
const CACHE_TTL_MS = 1000 * 60 * 60 * 24;

export interface SniperSpawn {
  zoneName: string | null;
  position: Vec3;
}

export interface MapSlice {
  mapName: string;
  spawns: MapSpawn[];
  sniperSpawns: SniperSpawn[];
  extracts: MapExtract[];
  tasks: Task[];
  fetchedAt: number;
  stale: boolean;
}

export class JsonApiError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message);
    this.name = 'JsonApiError';
  }
}

interface RawSpawn {
  position: Vec3;
  sides: string[] | null;
  categories: string[] | null;
  zoneName: string | null;
}

function asList<T>(value: Record<string, T> | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : Object.values(value);
}

async function getJson(path: string): Promise<any> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`);
  } catch (error) {
    throw new JsonApiError('Could not reach json.tarkov.dev.', String(error));
  }
  if (!response.ok) {
    throw new JsonApiError(`json.tarkov.dev returned ${response.status}.`, await response.text().catch(() => ''));
  }
  return response.json();
}

function readCache(mapName: string): MapSlice | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + mapName);
    return raw ? (JSON.parse(raw) as MapSlice) : null;
  } catch {
    return null;
  }
}

function hasCategory(spawn: RawSpawn, category: string): boolean {
  return (spawn.categories ?? []).some((c) => c.toLowerCase() === category);
}

/**
 * Names and descriptions come back as translation keys. The real strings live at
 * `<path>_<language>`, which is how tarkov.dev's own frontend resolves them
 * (src/modules/api-request.mjs). Only a few of the published JSONPath selectors
 * matter here, so they are applied directly rather than pulling in a JSONPath
 * dependency.
 */
type Translations = Record<string, string>;

function translate(translations: Translations, key: unknown): string {
  if (typeof key !== 'string') return '';
  const value = translations[key];
  // Fall back to the key itself, which is what the upstream client does.
  return value && value.length > 0 ? value : key;
}

/** Readable fallback when a description has no translation at all. */
const TYPE_LABELS: Record<string, string> = {
  visit: 'Go to this location',
  mark: 'Place a marker here',
  shoot: 'Eliminate target here',
  findQuestItem: 'Pick up the quest item here',
  giveQuestItem: 'Hand in the quest item',
  plantItem: 'Stash the item here',
  plantQuestItem: 'Stash the quest item here',
  findItem: 'Find the item here',
  useItem: 'Use the item here',
  extract: 'Extract',
  basic: 'Objective',
};

function describe(objective: any, translations: Translations): string {
  const text = translate(translations, objective.description);
  // A key that resolved to itself is not readable; use the type wording.
  if (!text || text === objective.description) {
    return TYPE_LABELS[objective.type] ?? `Objective (${objective.type})`;
  }
  return text;
}

/** Fetches both datasets and reduces them to what one map needs. */
export async function fetchMapSlice(mapName: string, force = false): Promise<MapSlice> {
  const cached = readCache(mapName);
  if (cached && !force && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

  let mapsPayload: any;
  let tasksPayload: any;
  let mapsLang: any;
  let tasksLang: any;
  try {
    [mapsPayload, tasksPayload, mapsLang, tasksLang] = await Promise.all([
      getJson('/regular/maps'),
      getJson('/regular/tasks'),
      getJson(`/regular/maps_${LANGUAGE}`),
      getJson(`/regular/tasks_${LANGUAGE}`),
    ]);
  } catch (error) {
    if (cached) return { ...cached, stale: true };
    throw error;
  }

  const mapText: Translations = mapsLang?.data ?? {};
  const taskText: Translations = tasksLang?.data ?? {};

  const rawMaps = asList<any>(mapsPayload?.data?.maps);
  const target = rawMaps.find((m) => m.normalizedName === mapName);
  if (!target) {
    if (cached) return { ...cached, stale: true };
    throw new JsonApiError(`json.tarkov.dev has no map named ${mapName}.`);
  }

  const idToName = new Map<string, string>();
  for (const m of rawMaps) idToName.set(m.id, m.normalizedName);

  const rawSpawns: RawSpawn[] = target.spawns ?? [];

  const spawns: MapSpawn[] = rawSpawns
    .filter((s) => s.position && hasCategory(s, 'player'))
    .map((s) => ({
      zoneName: s.zoneName,
      position: s.position,
      sides: s.sides,
      categories: s.categories,
    }));

  const sniperSpawns: SniperSpawn[] = rawSpawns
    .filter((s) => s.position && hasCategory(s, 'sniper'))
    .map((s) => ({ zoneName: s.zoneName, position: s.position }));

  // An extract's `switches` are ids into the map's switch list, so they have to
  // be looked up to get a position.
  const switchesById = new Map<string, any>();
  for (const sw of target.switches ?? []) switchesById.set(sw.id, sw);

  const extracts: MapExtract[] = (target.extracts ?? [])
    .filter((e: any) => e.position)
    .map((e: any) => ({
      id: e.id,
      name: translate(mapText, e.name) || null,
      // Untranslated key doubles as the SPT extract name.
      rawName: typeof e.name === 'string' ? e.name : null,
      faction: e.faction ?? null,
      position: e.position,
      switches: (e.switches ?? [])
        .map((id: any) => switchesById.get(typeof id === 'string' ? id : id?.id))
        .filter((sw: any) => sw && sw.position)
        .map((sw: any) => ({
          id: sw.id,
          name: translate(mapText, sw.name) || null,
          switchType: sw.switchType ?? null,
          position: sw.position,
        })),
    }));

  // Keep only tasks that have at least one positioned objective on this map.
  const tasks: Task[] = [];
  for (const raw of asList<any>(tasksPayload?.data?.tasks)) {
    const objectives: TaskObjective[] = [];
    let relevant = false;

    for (const objective of raw.objectives ?? []) {
      const zones = (objective.zones ?? [])
        .filter((z: any) => z.position && idToName.get(z.map) === mapName)
        .map((z: any) => ({
          id: z.id,
          map: { normalizedName: mapName },
          position: z.position as Vec3,
        }));

      if (zones.length > 0) relevant = true;

      objectives.push({
        id: objective.id ?? null,
        type: objective.type,
        description: describe(objective, taskText),
        optional: Boolean(objective.optional),
        maps: zones.length > 0 ? [{ normalizedName: mapName, name: mapName }] : [],
        zones,
        exitName: objective.exitName ? translate(taskText, objective.exitName) : null,
      });
    }

    if (!relevant) continue;

    tasks.push({
      id: raw.id ?? null,
      // Display name is translated; normalizedName stays the stable identifier
      // the app matches wiki titles against.
      name: translate(taskText, raw.name) || raw.normalizedName,
      normalizedName: raw.normalizedName,
      trader: null,
      map: { normalizedName: mapName, name: mapName },
      minPlayerLevel: raw.minPlayerLevel ?? null,
      kappaRequired: raw.kappaRequired ?? null,
      wikiLink: raw.wikiLink ?? null,
      experience: raw.experience ?? null,
      // Prerequisites are ids, which is all that is needed to tell whether a
      // quest is available: the id is looked up in what TarkovTracker reports
      // as finished, so the prerequisite itself never has to be on this map.
      taskRequirements: (raw.taskRequirements ?? []).map((req: any) => ({
        task: { id: typeof req.task === 'string' ? req.task : req.task?.id ?? null, name: null },
        status: Array.isArray(req.status) ? req.status : [],
      })),
      traderRequirements: [],
      objectives,
    });
  }

  // Every task, not just this map's slice: prerequisite chains run across maps,
  // and a quest with no coordinates here still has an id worth writing back.
  // Ids and names only, which stays small enough to keep around.
  const index: TaskIndex = { requires: {}, idByName: {} };
  for (const raw of asList<any>(tasksPayload?.data?.tasks)) {
    if (typeof raw?.id !== 'string') continue;
    index.requires[raw.id] = (raw.taskRequirements ?? [])
      .map((req: any) => (typeof req.task === 'string' ? req.task : req.task?.id))
      .filter((id: any): id is string => typeof id === 'string');
    if (typeof raw.normalizedName === 'string') {
      index.idByName[raw.normalizedName.toLowerCase().replace(/[^a-z0-9]/g, '')] = raw.id;
    }
  }
  try {
    localStorage.setItem(GRAPH_KEY, JSON.stringify(index));
  } catch {
    // A full cache is not worth failing the load over.
  }

  const slice: MapSlice = {
    mapName,
    spawns,
    sniperSpawns,
    extracts,
    tasks,
    fetchedAt: Date.now(),
    stale: false,
  };

  try {
    localStorage.setItem(CACHE_PREFIX + mapName, JSON.stringify(slice));
  } catch {
    // Quota exceeded is not fatal; it just refetches next time.
  }
  return slice;
}

/** Every task's prerequisites and id, cached from the last successful load. */
export interface TaskIndex {
  /** Task id -> ids of the tasks it requires. */
  requires: Record<string, string[]>;
  /** Normalised quest name -> task id, for quests with no coordinates here. */
  idByName: Record<string, string>;
}

export function loadTaskIndex(): TaskIndex {
  try {
    const raw = localStorage.getItem(GRAPH_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && parsed.requires && parsed.idByName) return parsed as TaskIndex;
  } catch {
    // Fall through to an empty index; it is rebuilt on the next load.
  }
  return { requires: {}, idByName: {} };
}
