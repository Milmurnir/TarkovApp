/**
 * Quest progress read from the game's own log files, via the Electron shell
 * (see electron/gameLogs.cjs). Absent in a plain browser and in shells older
 * than shellVersion 5, where every caller here just does nothing.
 */

export type GameLogStatus = 'started' | 'failed' | 'finished';

export interface GameLogEvent {
  /** BSG quest id -- the same id progress is stored under. */
  id: string;
  status: GameLogStatus;
  /** When it happened, ms since epoch. */
  at: number;
  /** Start of the game session (log folder) it was written in, ms since epoch. */
  session: number;
}

export interface GameLogScan {
  ok: boolean;
  dir: string | null;
  source: 'picked' | 'registry' | 'default' | null;
  sessions: number;
  firstSession?: number | null;
  lastSession?: number | null;
  events: GameLogEvent[];
}

interface GameLogBridge {
  scan: () => Promise<GameLogScan>;
  pickFolder: () => Promise<{ ok: boolean; dir?: string; reason?: string }>;
  onEvents: (callback: (events: GameLogEvent[]) => void) => () => void;
}

declare global {
  interface Window {
    gameLogs?: GameLogBridge;
  }
}

export function gameLogBridge(): GameLogBridge | null {
  return typeof window !== 'undefined' && window.gameLogs ? window.gameLogs : null;
}

/**
 * When the most recent wipe (or prestige) happened, judged from the logs alone.
 *
 * The logs span several wipes, and a quest finished last wipe must not count
 * now. A wipe shows up as a quest being *started* again after it was already
 * finished -- only possible once progress was reset. The cut is put at the
 * start of the game session where that happened, so quests finished earlier in
 * that same first post-wipe session still count.
 *
 * Only ids in `known` are considered: repeatable dailies/weeklies reuse
 * templates, are not in the quest data, and would look like endless wipes.
 */
export function detectWipe(events: GameLogEvent[], known: Set<string>): number | null {
  const sorted = events.filter((e) => known.has(e.id)).sort((a, b) => a.at - b.at);
  const finishedAt = new Map<string, number>();
  let cutoff: number | null = null;

  for (const event of sorted) {
    if (event.status === 'started') {
      const finished = finishedAt.get(event.id);
      if (finished !== undefined && (cutoff === null || finished >= cutoff)) {
        cutoff = event.session;
      }
    } else if (event.status === 'finished') {
      finishedAt.set(event.id, event.at);
    }
  }
  return cutoff;
}

/** Known quests the logs show finished at or after `since` (null: all of them). */
export function finishedSince(events: GameLogEvent[], known: Set<string>, since: number | null): string[] {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.status !== 'finished' || !known.has(event.id)) continue;
    if (since !== null && event.at < since) continue;
    ids.add(event.id);
  }
  return [...ids];
}

/** "2026-08-01" (from a date input) -> local midnight that day; anything else -> null. */
export function parseSinceDate(value: string | null): number | null {
  if (!value || !/^\d{4}-\d\d-\d\d$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}
