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
  /** Map layer toggles, kept so they do not reset on every launch. */
  showSnipers: boolean;
  showTransits: boolean;
  showLoot: boolean;
  /** Metres from the route to show loot containers within; null means the whole map. */
  lootRadius: number | null;
  lootDensity: number;
  /** Container names the player has hidden from the loot layer. */
  hiddenLoot: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  routeIconScale: 1,
  gameLogSync: true,
  gameLogSince: null,
  gameLogWipeSeen: null,
  showSnipers: true,
  showTransits: true,
  showLoot: false,
  lootRadius: 30,
  lootDensity: 1,
  hiddenLoot: [],
};

const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

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
      showSnipers: bool(parsed?.showSnipers, DEFAULT_SETTINGS.showSnipers),
      showTransits: bool(parsed?.showTransits, DEFAULT_SETTINGS.showTransits),
      showLoot: bool(parsed?.showLoot, DEFAULT_SETTINGS.showLoot),
      lootRadius: parsed?.lootRadius === null || (typeof parsed?.lootRadius === 'number' && parsed.lootRadius > 0)
        ? parsed.lootRadius
        : DEFAULT_SETTINGS.lootRadius,
      lootDensity: typeof parsed?.lootDensity === 'number' && parsed.lootDensity > 0
        ? parsed.lootDensity
        : DEFAULT_SETTINGS.lootDensity,
      hiddenLoot: Array.isArray(parsed?.hiddenLoot)
        ? parsed.hiddenLoot.filter((n: unknown): n is string => typeof n === 'string')
        : DEFAULT_SETTINGS.hiddenLoot,
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
