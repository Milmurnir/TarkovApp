/**
 * App-wide preferences, kept on this machine. Separate from progress.ts:
 * losing a setting is a shrug, losing quest progress is not, so this only
 * ever touches localStorage.
 */

const KEY = 'tarkov-settings-v1';

export interface Settings {
  /** Multiplier on the map's route markers (spawn/objective/switch/extract). */
  routeIconScale: number;
}

export const DEFAULT_SETTINGS: Settings = {
  routeIconScale: 1,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    const scale = parsed?.routeIconScale;
    return {
      routeIconScale: typeof scale === 'number' && scale > 0 ? scale : DEFAULT_SETTINGS.routeIconScale,
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
