import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  detectWipe, finishedSince, gameLogBridge, parseSinceDate, type GameLogEvent, type GameLogScan,
} from './gameLogs';
import { emptyProgress, missingPrerequisites, withCompleted, type Progress } from './progress';
import type { Settings } from './settings';

interface Options {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  progress: Progress;
  /** Functional so a log event landing mid-render never works off stale progress. */
  changeProgress: (change: (current: Progress) => Progress) => void;
  idByName: Record<string, string>;
  requires: Record<string, string[]>;
}

export interface GameLogSync {
  /** False in a browser or an older desktop shell: nothing here does anything. */
  available: boolean;
  scanning: boolean;
  scan: Omit<GameLogScan, 'events'> | null;
  /** Wipe found in the logs, ms since epoch, or null. */
  detectedWipe: number | null;
  /** What actually counts: the player's own date, else the detected wipe. */
  countingSince: number | null;
  /** Quests the logs show finished in the counted window. */
  finishedInLogs: number;
  /**
   * Quests the game has handed out (started, finished or failed) in the counted
   * window, or null when the logs are not being read or could not be found.
   */
  given: Set<string> | null;
  /** The last time quests were ticked off from the logs, for the sidebar note. */
  lastImport: { count: number; at: number } | null;
  dismissImport: () => void;
  /** Set when a newer wipe shows up and local progress has quests the game no longer does. */
  /** `manual`: the start date is the player's own (a prestige), not a wipe found in the logs. */
  wipePrompt: { at: number; extra: number; manual: boolean } | null;
  resolveWipe: (matchGame: boolean) => void;
  syncNow: () => void;
  pickFolder: () => Promise<string | null>;
}

/** Ids plus every prerequisite behind them: finishing a quest means its chain is done too. */
function withChains(ids: string[], requires: Record<string, string[]>): Set<string> {
  const all = new Set(ids);
  const empty = emptyProgress();
  for (const id of ids) {
    for (const before of missingPrerequisites(id, requires, empty)) all.add(before);
  }
  return all;
}

/**
 * Keeps progress in step with the game's log files: one scan at startup, then
 * whatever the shell's watcher sends while the game runs. Only ever adds
 * finished quests -- removing is left to the player, through the wipe prompt.
 */
export function useGameLogSync({
  settings, updateSettings, progress, changeProgress, idByName, requires,
}: Options): GameLogSync {
  const bridge = gameLogBridge();
  const enabled = Boolean(bridge) && settings.gameLogSync;

  const [scan, setScan] = useState<Omit<GameLogScan, 'events'> | null>(null);
  const [events, setEvents] = useState<GameLogEvent[]>([]);
  const [scanning, setScanning] = useState(false);
  const [lastImport, setLastImport] = useState<{ count: number; at: number } | null>(null);

  const known = useMemo(() => new Set(Object.values(idByName)), [idByName]);
  const ready = known.size > 0;

  const progressRef = useRef(progress);
  progressRef.current = progress;

  const runScan = useCallback(() => {
    if (!bridge) return;
    setScanning(true);
    bridge.scan()
      .then(({ events: found, ...info }) => { setScan(info); setEvents(found); })
      .catch(() => setScan({ ok: false, dir: null, source: null, sessions: 0 }))
      .finally(() => setScanning(false));
  }, [bridge]);

  // One scan once the quest data is in, since that is what says which ids are quests.
  const scanned = useRef(false);
  useEffect(() => {
    if (!enabled || !ready || scanned.current) return;
    scanned.current = true;
    runScan();
  }, [enabled, ready, runScan]);

  // Live: quests turned in while the app is open arrive within a few seconds.
  useEffect(() => {
    if (!enabled || !bridge) return;
    return bridge.onEvents((fresh) => setEvents((current) => [...current, ...fresh]));
  }, [enabled, bridge]);

  const detectedWipe = useMemo(() => (ready ? detectWipe(events, known) : null), [events, known, ready]);
  const countingSince = parseSinceDate(settings.gameLogSince) ?? detectedWipe;
  const finished = useMemo(
    () => (ready ? finishedSince(events, known, countingSince) : []),
    [events, known, ready, countingSince],
  );

  const given = useMemo(() => {
    if (!enabled || !scan?.ok || !ready) return null;
    const ids = new Set<string>();
    for (const event of events) {
      if (countingSince !== null && event.at < countingSince) continue;
      if (known.has(event.id)) ids.add(event.id);
    }
    return ids;
  }, [enabled, scan, ready, events, countingSince, known]);

  // Adds whatever the logs say is finished and progress does not have yet.
  useEffect(() => {
    if (!enabled || finished.length === 0) return;
    const current = progressRef.current;
    const toAdd = [...withChains(finished, requires)].filter((id) => !current.completed.has(id));
    if (toAdd.length === 0) return;
    changeProgress((latest) => withCompleted(latest, toAdd, true));
    setLastImport({ count: toAdd.length, at: Date.now() });
  }, [enabled, finished, requires, changeProgress]);

  // A new starting point -- a wipe found in the logs, or a date the player set
  // after a prestige -- newer than the last one asked about, with local
  // progress the game has not seen since: worth asking, never worth doing silently.
  const wipePrompt = useMemo(() => {
    if (!enabled || !ready || countingSince === null) return null;
    if (settings.gameLogWipeSeen !== null && countingSince <= settings.gameLogWipeSeen) return null;
    const inGame = withChains(finished, requires);
    const extra = [...progress.completed].filter((id) => known.has(id) && !inGame.has(id)).length;
    return { at: countingSince, extra, manual: settings.gameLogSince !== null };
  }, [enabled, ready, countingSince, settings.gameLogSince, settings.gameLogWipeSeen, finished, requires, progress, known]);

  // Nothing to ask about: just remember this wipe was seen.
  useEffect(() => {
    if (wipePrompt && wipePrompt.extra === 0) updateSettings({ gameLogWipeSeen: wipePrompt.at });
  }, [wipePrompt, updateSettings]);

  function resolveWipe(matchGame: boolean) {
    if (!wipePrompt) return;
    if (matchGame) {
      const inGame = [...withChains(finished, requires)];
      // Which quests are done is the game's call; level and traders stay the player's.
      changeProgress((latest) => ({
        ...withCompleted(emptyProgress(), inGame, true),
        playerLevel: latest.playerLevel,
        traders: latest.traders,
      }));
    }
    updateSettings({ gameLogWipeSeen: wipePrompt.at });
  }

  async function pickFolder(): Promise<string | null> {
    if (!bridge) return null;
    const result = await bridge.pickFolder();
    if (!result.ok) return result.reason === 'not-logs' ? 'not-logs' : null;
    runScan();
    return null;
  }

  return {
    available: Boolean(bridge),
    scanning,
    scan,
    detectedWipe,
    countingSince,
    finishedInLogs: finished.length,
    given,
    lastImport,
    dismissImport: () => setLastImport(null),
    wipePrompt: wipePrompt && wipePrompt.extra > 0 ? wipePrompt : null,
    resolveWipe,
    syncNow: runScan,
    pickFolder,
  };
}
