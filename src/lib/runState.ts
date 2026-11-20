/**
 * The run you are in the middle of -- map, quests, spawn -- kept so closing
 * the app (or it updating itself) does not throw away a planned raid.
 *
 * Like settings, this only ever touches localStorage: losing it is an
 * annoyance, not lost progress, so it does not go to the durable store.
 */
import type { Vec3 } from './types';

const KEY = 'tarkov-run-v1';

export interface RunState {
  mapName: string;
  selectedQuests: string[];
  activeWiki: string | null;
  pages: string[];
  addedOnPage: Record<string, string>;
  multiMapQuests: Record<string, { maps: string[]; visited: string[] }>;
  dismissedMultiMap: string[];
  clickedSpawn: Vec3 | null;
  zoneIndex: number;
  hideFinished: boolean;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isVec3(value: unknown): value is Vec3 {
  return isRecord(value)
    && typeof value.x === 'number' && typeof value.y === 'number' && typeof value.z === 'number';
}

/** Whatever was saved, field by field; anything malformed falls back to its default. */
export function loadRunState(defaultMap: string): RunState {
  const fallback: RunState = {
    mapName: defaultMap,
    selectedQuests: [],
    activeWiki: null,
    pages: [],
    addedOnPage: {},
    multiMapQuests: {},
    dismissedMultiMap: [],
    clickedSpawn: null,
    zoneIndex: 0,
    hideFinished: true,
  };

  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return fallback;

    const selectedQuests = isStringArray(parsed.selectedQuests) ? parsed.selectedQuests : [];
    const multiMapQuests: RunState['multiMapQuests'] = {};
    if (isRecord(parsed.multiMapQuests)) {
      for (const [title, entry] of Object.entries(parsed.multiMapQuests)) {
        if (isRecord(entry) && isStringArray(entry.maps) && isStringArray(entry.visited)) {
          multiMapQuests[title] = { maps: entry.maps, visited: entry.visited };
        }
      }
    }
    const addedOnPage: Record<string, string> = {};
    if (isRecord(parsed.addedOnPage)) {
      for (const [title, page] of Object.entries(parsed.addedOnPage)) {
        if (typeof page === 'string') addedOnPage[title] = page;
      }
    }

    return {
      mapName: typeof parsed.mapName === 'string' && parsed.mapName ? parsed.mapName : defaultMap,
      selectedQuests,
      activeWiki: typeof parsed.activeWiki === 'string' && selectedQuests.includes(parsed.activeWiki)
        ? parsed.activeWiki
        : null,
      pages: isStringArray(parsed.pages) ? parsed.pages : [],
      addedOnPage,
      multiMapQuests,
      dismissedMultiMap: isStringArray(parsed.dismissedMultiMap) ? parsed.dismissedMultiMap : [],
      clickedSpawn: isVec3(parsed.clickedSpawn) ? parsed.clickedSpawn : null,
      zoneIndex: typeof parsed.zoneIndex === 'number' && parsed.zoneIndex >= 0 ? parsed.zoneIndex : 0,
      hideFinished: typeof parsed.hideFinished === 'boolean' ? parsed.hideFinished : true,
    };
  } catch {
    return fallback;
  }
}

export function saveRunState(state: RunState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // A full quota just means the run does not survive a restart.
  }
}
