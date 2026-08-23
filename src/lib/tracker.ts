import type { Task } from './types';

/**
 * TarkovTracker progress import.
 *
 * BSG publishes no API for your character, so nothing can read your real
 * in-game state. TarkovTracker is the workable stand-in: it is what you have
 * ticked off there, which is only as current as your own bookkeeping — worth
 * saying out loud in the UI rather than implying the app knows your account.
 *
 * The API is called straight from the page; tarkovtracker.io allows it. The
 * token is a credential, so it stays in localStorage on this machine and goes
 * nowhere except tarkovtracker.io.
 */

const BASE = 'https://tarkovtracker.io/api/v2';
const TOKEN_KEY = 'tarkov-tracker-token';

export interface TrackerProgress {
  displayName: string | null;
  playerLevel: number | null;
  /** Task ids reported finished. */
  completed: Set<string>;
  /** Task ids reported failed, which are not worth routing either. */
  failed: Set<string>;
  fetchedAt: number;
}

export class TrackerError extends Error {}

export function readToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function storeToken(token: string): void {
  const trimmed = token.trim();
  if (trimmed) localStorage.setItem(TOKEN_KEY, trimmed);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function fetchProgress(token: string): Promise<TrackerProgress> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/progress`, {
      headers: { Authorization: `Bearer ${token.trim()}` },
    });
  } catch (error) {
    throw new TrackerError(`Could not reach TarkovTracker: ${String(error)}`);
  }

  if (response.status === 401) {
    throw new TrackerError(
      'TarkovTracker rejected that token. It needs the "GP" permission (read personal progression).',
    );
  }
  if (response.status === 429) {
    throw new TrackerError('TarkovTracker is rate limiting; wait a moment and try again.');
  }
  if (!response.ok) {
    throw new TrackerError(`TarkovTracker returned ${response.status}.`);
  }

  const payload = await response.json().catch(() => null);
  const data = payload?.data ?? {};
  // The schema calls it taskProgress; the plural spelling shows up in enough
  // third-party examples to be worth accepting too.
  const entries: any[] = Array.isArray(data.taskProgress) ? data.taskProgress
    : Array.isArray(data.tasksProgress) ? data.tasksProgress
    : [];

  const completed = new Set<string>();
  const failed = new Set<string>();
  for (const entry of entries) {
    const id = typeof entry?.id === 'string' ? entry.id : null;
    // `invalid` means unreachable rather than failed — wrong faction, or a
    // branch of a quest chain that another choice closed off. Either way it is
    // not something to route towards.
    if (!id || entry.invalid) continue;
    if (entry.failed) failed.add(id);
    else if (entry.complete) completed.add(id);
  }

  return {
    displayName: typeof data.displayName === 'string' ? data.displayName : null,
    playerLevel: typeof data.playerLevel === 'number' ? data.playerLevel : null,
    completed,
    failed,
    fetchedAt: Date.now(),
  };
}

/** Why a quest is not worth adding to the route right now. */
export type TaskStanding = 'available' | 'completed' | 'failed' | 'locked' | 'too-low-level';

export function standingOf(task: Task, progress: TrackerProgress | null): TaskStanding {
  if (!progress || !task.id) return 'available';
  if (progress.completed.has(task.id)) return 'completed';
  if (progress.failed.has(task.id)) return 'failed';

  // A prerequisite only counts as met when it is actually finished. The
  // prerequisite itself need not be on this map, which is why ids are compared
  // rather than looking the quest up.
  const locked = task.taskRequirements.some((requirement) => {
    const id = requirement.task?.id;
    if (!id) return false;
    const wants = requirement.status.length > 0 ? requirement.status : ['complete'];
    if (!wants.includes('complete')) return false;
    return !progress.completed.has(id);
  });
  if (locked) return 'locked';

  if (progress.playerLevel !== null && task.minPlayerLevel !== null
    && progress.playerLevel < task.minPlayerLevel) {
    return 'too-low-level';
  }
  return 'available';
}
