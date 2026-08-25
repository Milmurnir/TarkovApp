import type { Task } from './types';

/**
 * Your quest progress, kept on this machine.
 *
 * There is no public BSG API for your character, so no tool can read the game.
 * TarkovTracker was the obvious stand-in until its own quest list turned out to
 * depend on the tarkov.dev GraphQL API, which has been down since 2026-07-21 —
 * their site currently shows no tasks at all, so there is nothing to tick off
 * there and nothing to import. This app already has working quest data and the
 * whole prerequisite graph, so it keeps its own record instead.
 *
 * Stored by tarkov.dev task id, which is the same identifier the quest data
 * uses, so nothing has to be re-matched by name later.
 */

const KEY = 'tarkov-progress-v1';

/**
 * Durable storage the Electron shell provides, outside the renderer's profile.
 * Absent in a plain browser, where localStorage is all there is.
 */
interface AppStore {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<boolean>;
}

declare global {
  interface Window {
    appStore?: AppStore;
  }
}

function store(): AppStore | null {
  return typeof window !== 'undefined' && window.appStore ? window.appStore : null;
}

interface StoredProgress {
  completed: string[];
  playerLevel: number | null;
  updatedAt: number;
}

function toStored(progress: Progress): StoredProgress {
  return {
    completed: [...progress.completed],
    playerLevel: progress.playerLevel,
    updatedAt: progress.updatedAt,
  };
}

function fromStored(raw: any): Progress | null {
  if (!raw || !Array.isArray(raw.completed)) return null;
  return {
    completed: new Set(raw.completed.filter((id: unknown) => typeof id === 'string')),
    playerLevel: typeof raw.playerLevel === 'number' ? raw.playerLevel : null,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
  };
}

export interface Progress {
  completed: Set<string>;
  /** Used to tell "available" from "too low level"; null means do not check. */
  playerLevel: number | null;
  updatedAt: number;
}

export function emptyProgress(): Progress {
  return { completed: new Set(), playerLevel: null, updatedAt: 0 };
}

/** Reads localStorage only: synchronous, so the first render has something. */
export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    return (raw && fromStored(JSON.parse(raw))) || emptyProgress();
  } catch {
    return emptyProgress();
  }
}

/**
 * The copy in the user-data folder, which is the one that survives the app
 * being replaced. Returns it when it is newer than what is already loaded, so
 * a fresh install picks up the old progress without a later change here being
 * overwritten by a stale file.
 *
 * Also returns it when it simply has more completed quests, even if its clock
 * is behind: a completed write to localStorage racing a failed write to this
 * file (two app instances open at once, a crash mid-save) can otherwise leave
 * an emptier record with a newer timestamp that would shadow the real one
 * forever, since nothing after that point would ever look "newer" again.
 */
export async function loadDurableProgress(current: Progress): Promise<Progress | null> {
  const bridge = store();
  if (!bridge) return null;
  try {
    const durable = fromStored(await bridge.get('progress'));
    if (durable && (durable.updatedAt > current.updatedAt || durable.completed.size > current.completed.size)) {
      return durable;
    }
  } catch {
    // A missing or unreadable file just means nothing to restore.
  }
  return null;
}

export function saveProgress(progress: Progress): Progress {
  const stored = { ...progress, updatedAt: Date.now() };
  const serialisable = toStored(stored);

  try {
    localStorage.setItem(KEY, JSON.stringify(serialisable));
  } catch {
    // A full quota should not lose the in-memory state.
  }
  // Written to both: localStorage is what the next render reads, the file is
  // what an update or a changed port cannot take away.
  store()?.set('progress', serialisable).catch(() => {
    // Reported nowhere on purpose; localStorage still holds this session.
  });
  return stored;
}

export function withCompleted(progress: Progress, ids: string[], done: boolean): Progress {
  const completed = new Set(progress.completed);
  for (const id of ids) {
    if (done) completed.add(id);
    else completed.delete(id);
  }
  return { ...progress, completed };
}

/** Why a quest is not worth adding to the route right now. */
export type TaskStanding = 'available' | 'completed' | 'locked' | 'too-low-level';

export function standingOf(task: Task, progress: Progress): TaskStanding {
  if (!task.id) return 'available';
  return standingById(task.id, {
    requires: {
      [task.id]: task.taskRequirements
        .filter((r) => (r.status.length > 0 ? r.status : ['complete']).includes('complete'))
        .map((r) => r.task?.id)
        .filter((id): id is string => Boolean(id)),
    },
    minLevel: task.minPlayerLevel === null ? {} : { [task.id]: task.minPlayerLevel },
  }, progress);
}

/**
 * Standing for any quest, by id.
 *
 * Works off the cached index rather than a map's task list on purpose: that
 * list only holds quests with published objective coordinates, so anything
 * without them was invisible to availability — a quest perfectly possible to do
 * on the map simply never appeared as available.
 */
export function standingById(
  id: string,
  index: { requires: Record<string, string[]>; minLevel: Record<string, number> },
  progress: Progress,
): TaskStanding {
  if (progress.completed.has(id)) return 'completed';

  // A prerequisite only counts as met when it is actually finished. The
  // prerequisite itself need not be on this map, which is why ids are compared
  // rather than looking the quest up.
  if ((index.requires[id] ?? []).some((required) => !progress.completed.has(required))) {
    return 'locked';
  }

  const minLevel = index.minLevel[id];
  if (progress.playerLevel !== null && typeof minLevel === 'number' && progress.playerLevel < minLevel) {
    return 'too-low-level';
  }
  return 'available';
}

/**
 * Every quest that must be finished before `taskId`, walking the whole chain
 * and skipping anything already done. This is what makes catching up bearable:
 * mark the last quest you actually did in a chain and the rest follows, instead
 * of ticking a hundred boxes by hand.
 */
export function missingPrerequisites(
  taskId: string,
  requires: Record<string, string[]>,
  progress: Progress,
): string[] {
  const missing: string[] = [];
  const seen = new Set<string>([taskId]);
  const queue = [...(requires[taskId] ?? [])];

  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    if (progress.completed.has(id)) continue;
    missing.push(id);
    queue.push(...(requires[id] ?? []));
  }
  return missing;
}

/**
 * Sharing progress between players.
 *
 * A file rather than a paste-able code on purpose: a few hundred task ids is
 * several kilobytes, past what chat apps accept in a message, and an attachment
 * survives being forwarded without anyone trimming it.
 */
const EXPORT_FORMAT = 'tarkov-quest-router-progress';

export interface ProgressExport {
  completed: string[];
  playerLevel: number | null;
  exportedAt: number;
}

export function exportProgress(progress: Progress): string {
  return JSON.stringify({
    format: EXPORT_FORMAT,
    version: 1,
    exportedAt: Date.now(),
    playerLevel: progress.playerLevel,
    completed: [...progress.completed],
  }, null, 2);
}

/** Suggested filename, dated so several exports do not overwrite each other. */
export function exportFilename(): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `tarkov-progress-${stamp}.json`;
}

/**
 * Reads an exported file. Returns null for anything that is not one, rather
 * than half-importing a file that happens to be JSON.
 */
export function parseProgressExport(text: string): ProgressExport | null {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }

  // The bare shape the app stores is accepted too: someone who found
  // progress.json in the user-data folder should not be told it is invalid.
  const looksLikeExport = raw?.format === EXPORT_FORMAT;
  if (!looksLikeExport && !Array.isArray(raw?.completed)) return null;
  if (!Array.isArray(raw.completed)) return null;

  const completed = raw.completed.filter((id: unknown): id is string => typeof id === 'string');
  if (completed.length === 0 && raw.completed.length > 0) return null;

  return {
    completed,
    playerLevel: typeof raw.playerLevel === 'number' ? raw.playerLevel : null,
    exportedAt: typeof raw.exportedAt === 'number' ? raw.exportedAt
      : typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
  };
}
