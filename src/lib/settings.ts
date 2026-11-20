/**
 * App-wide preferences, kept on this machine. Separate from progress.ts:
 * losing a setting is a shrug, losing quest progress is not, so this only
 * ever touches localStorage.
 */

const KEY = 'tarkov-settings-v1';

export interface Settings {
  /** Multiplier on the map's route markers (spawn/objective/switch/extract). */
  routeIconScale: number;
  /** Read finished quests from the game's log files (desktop app only). */
  gameLogSync: boolean;
  /**
   * Only count quests the logs show finished on or after this day
   * ("YYYY-MM-DD"). Null means work it out from the logs (see detectWipe).
   */
  gameLogSince: string | null;
  /** The newest wipe the player has already been asked about, ms since epoch. */
  gameLogWipeSeen: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  routeIconScale: 1,
  gameLogSync: true,
  gameLogSince: null,
  gameLogWipeSeen: null,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    const scale = parsed?.routeIconScale;
    return {
      routeIconScale: typeof scale === 'number' && scale > 0 ? scale : DEFAULT_SETTINGS.routeIconScale,
      gameLogSync: typeof parsed?.gameLogSync === 'boolean' ? parsed.gameLogSync : DEFAULT_SETTINGS.gameLogSync,
      gameLogSince: typeof parsed?.gameLogSince === 'string' ? parsed.gameLogSince : null,
      gameLogWipeSeen: typeof parsed?.gameLogWipeSeen === 'number' ? parsed.gameLogWipeSeen : null,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // A full quota just means the choice does not survive reload.
  }
}
