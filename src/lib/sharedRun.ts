import type { Vec3 } from './types';

/**
 * The state two players share during a run.
 *
 * Everything is stored as a flat map of path -> field so one merge rule covers
 * the lot: the newest write wins, and if two writes land in the same
 * millisecond the higher peer id breaks the tie. That is enough for two people
 * on a headset; it is not enough for a dozen strangers, and it is not trying to
 * be. The relay applies the identical rule, so both sides converge.
 */
export interface Field<T = unknown> {
  value: T;
  /** Wall-clock ms when the change was made. */
  at: number;
  /** Peer id that made it, used only to break exact ties. */
  by: string;
}

export type Fields = Record<string, Field>;

/** One entry in the pre-raid checklist, keyed by `check:<label>`. */
export interface CheckEntry {
  /** Peer id that took responsibility for bringing it, or null. */
  claimedBy: string | null;
  /** Their display name at the time, so the list reads right when offline. */
  claimedName: string | null;
  packed: boolean;
}

export interface RunState {
  map: string | null;
  quests: string[];
  spawn: Vec3 | null;
  zoneIndex: number | null;
  selectedOrder: number | null;
  activeQuest: string | null;
  checks: Record<string, CheckEntry>;
}

export const CHECK_PREFIX = 'check:';

export function emptyRunState(): RunState {
  return {
    map: null, quests: [], spawn: null, zoneIndex: null,
    selectedOrder: null, activeQuest: null, checks: {},
  };
}

/** True when `candidate` should replace `current`. */
export function fieldWins(candidate: Field, current: Field | undefined): boolean {
  if (!current) return true;
  if (candidate.at !== current.at) return candidate.at > current.at;
  return candidate.by > current.by;
}

/** Applies incoming fields, returning the merged map and what actually changed. */
export function mergeFields(current: Fields, incoming: Fields): { fields: Fields; changed: string[] } {
  const fields = { ...current };
  const changed: string[] = [];

  for (const [path, field] of Object.entries(incoming)) {
    if (fieldWins(field, fields[path])) {
      fields[path] = field;
      changed.push(path);
    }
  }
  return { fields, changed };
}

/** Reads the flat field map back into the shape the app works with. */
export function toRunState(fields: Fields): RunState {
  const state = emptyRunState();

  const read = <T>(path: string, fallback: T): T => {
    const field = fields[path];
    return field === undefined ? fallback : (field.value as T);
  };

  state.map = read<string | null>('map', null);
  state.quests = read<string[]>('quests', []);
  state.spawn = read<Vec3 | null>('spawn', null);
  state.zoneIndex = read<number | null>('zone', null);
  state.selectedOrder = read<number | null>('selected', null);
  state.activeQuest = read<string | null>('activeQuest', null);

  for (const [path, field] of Object.entries(fields)) {
    if (!path.startsWith(CHECK_PREFIX)) continue;
    const entry = field.value as CheckEntry | null;
    if (entry && typeof entry === 'object') {
      state.checks[path.slice(CHECK_PREFIX.length)] = entry;
    }
  }
  return state;
}

let lastStamp = 0;

/**
 * Stamps values into fields ready to send.
 *
 * The clock is forced to move on every call. Two changes a few milliseconds
 * apart — claiming a key and then ticking it as packed — can otherwise land in
 * the same millisecond, and the tie-break on peer id cannot separate a peer's
 * own two writes, so the second one would lose to the first and vanish.
 */
export function makeFields(by: string, values: Record<string, unknown>): Fields {
  const at = Math.max(Date.now(), lastStamp + 1);
  lastStamp = at;

  const fields: Fields = {};
  for (const [path, value] of Object.entries(values)) fields[path] = { value, at, by };
  return fields;
}

export interface Peer {
  id: string;
  name: string;
}
