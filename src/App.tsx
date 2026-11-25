import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapView from './components/MapView';
import RequirementsPanel from './components/RequirementsPanel';
import RouteList from './components/RouteList';
import CurrentObjective from './components/CurrentObjective';
import RouteRequirements from './components/RouteRequirements';
import QuestGuide from './components/QuestGuide';
import UpdateNotice from './components/UpdateNotice';
import CoopPanel from './components/CoopPanel';
import CoopNotices from './components/CoopNotices';
import LootPanel from './components/LootPanel';
import LootRunPanel from './components/LootRunPanel';
import ProgressPanel from './components/ProgressPanel';
import FinishRunDialog from './components/FinishRunDialog';
import SettingsPanel from './components/SettingsPanel';
import Fold from './components/Fold';
import MapPicker from './components/MapPicker';
import SpawnPanel from './components/SpawnPanel';
import QuestSearch from './components/QuestSearch';
import ChosenQuests from './components/ChosenQuests';
import ProgressNotices from './components/ProgressNotices';
import MultiMapPrompt from './components/MultiMapPrompt';
import { loadSettings, saveSettings, type Settings } from './lib/settings';
import { loadRunState, saveRunState } from './lib/runState';
import { useGameLogSync } from './lib/useGameLogSync';
import { useProgress } from './lib/useProgress';
import { useReferenceData } from './lib/useReferenceData';
import { useSpawnAndExtracts } from './lib/useSpawnAndExtracts';
import { useLootLayer, useLootRun } from './lib/useLoot';
import { useRouteKeys } from './lib/useRouteKeys';
import { traderBlock } from './lib/traders';
import { questMapSpan } from './lib/multiMap';
import {
  emptyProgress, missingPrerequisites, standingById, withCompleted, type ProgressExport,
} from './lib/progress';
import { useCoopRun, useMirroredField } from './lib/useCoopRun';
import type { CheckEntry } from './lib/sharedRun';
import { buildRoute } from './lib/route';
import { JsonApiError, fetchMapSlice, loadTaskIndex, type MapSlice } from './lib/jsonApi';
import { fetchQuest, fetchQuestList, searchQuests } from './lib/wiki';
import { fetchQuestIndex, questsForMap, type QuestIndex } from './lib/questIndex';
import { fetchMapData, fetchMapIndex, type MapData, type MapIndexEntry } from './lib/mapData';
import type { MapExtract, Task, Vec3, WikiQuest } from './lib/types';
import { questAccent } from './lib/questColor';

const DEFAULT_MAP = 'streets-of-tarkov';

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export default function App() {
  /** The run left open last time, read once so every piece of state starts from it. */
  const [restored] = useState(() => loadRunState(DEFAULT_MAP));
  /**
   * The map the spawn state belongs to, so only a real switch resets it --
   * not the first load of the restored map, nor StrictMode re-running effects.
   */
  const spawnMap = useRef(restored.mapName);

  const [maps, setMaps] = useState<MapIndexEntry[]>([]);
  const [mapName, setMapName] = useState(restored.mapName);
  const [mapData, setMapData] = useState<MapData | null>(null);

  const [questTitles, setQuestTitles] = useState<string[]>([]);
  const [questIndex, setQuestIndex] = useState<QuestIndex | null>(null);
  const [indexProgress, setIndexProgress] = useState<{ done: number; total: number } | null>(null);
  const [query, setQuery] = useState('');
  /** Quests currently routed together, by wiki title. */
  const [selectedQuests, setSelectedQuests] = useState<string[]>(restored.selectedQuests);
  /** Keyboard-highlighted row in the quest suggestions. */
  const [highlight, setHighlight] = useState(0);
  const [wikiByTitle, setWikiByTitle] = useState<Record<string, WikiQuest>>({});
  const [activeWiki, setActiveWiki] = useState<string | null>(restored.activeWiki);
  const [wikiError, setWikiError] = useState<string | null>(null);
  const [loadingQuest, setLoadingQuest] = useState(false);

  const [api, setApi] = useState<MapSlice | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [zoneIndex, setZoneIndex] = useState(restored.zoneIndex);
  /** Spawn placed by clicking the map; takes priority over the zone list. */
  const [clickedSpawn, setClickedSpawn] = useState<Vec3 | null>(restored.clickedSpawn);
  const [selectedOrder, setSelectedOrder] = useState<number | null>(null);

  const { progress, updateProgress, changeProgress, durableProblem } = useProgress();
  const [hideFinished, setHideFinished] = useState(restored.hideFinished);
  const [finishOpen, setFinishOpen] = useState(false);
  /** Quest routing, or a raid built around one item. */
  const [mode, setMode] = useState<'quests' | 'loot' | 'settings'>('quests');
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  /** Bumped on every open so the dialog never inherits the last run's ticks. */
  const [finishSession, setFinishSession] = useState(0);
  /** The last automatic back-fill, kept so it can be undone. */
  const [lastBackfill, setLastBackfill] = useState<{ title: string; ids: string[] } | null>(null);
  /** The run a map switch just cleared, kept so the switch can be undone. */
  const [clearedRun, setClearedRun] = useState<{
    mapName: string;
    selectedQuests: string[];
    activeWiki: string | null;
    pages: string[];
    multiMapQuests: Record<string, { maps: string[]; visited: string[] }>;
    addedOnPage: Record<string, string>;
  } | null>(null);

  /**
   * Per multi-map (transit) quest: its full map span and which of those maps
   * this app has actually had it selected on. `visited` only ever grows when
   * the quest is selected while `mapName` matches one of its own maps -- see
   * the effect below -- so a later leg can never be assumed reached just
   * because an earlier one was. Local only, not coop-mirrored, same as
   * progress/finish tracking (`finishRun` below).
   */
  const [multiMapQuests, setMultiMapQuests] = useState<Record<string, { maps: string[]; visited: string[] }>>(
    restored.multiMapQuests,
  );
  /** Quests just added that span maps, waiting on the player to say whether to include the rest. */
  const [pendingMultiMap, setPendingMultiMap] = useState<{ title: string; maps: string[] }[]>([]);
  /** Asked about once already, so declining does not immediately re-prompt. */
  const [dismissedMultiMap, setDismissedMultiMap] = useState<Set<string>>(
    () => new Set(restored.dismissedMultiMap),
  );
  /**
   * The maps this run now spans, in the order they were introduced -- empty
   * means ordinary single-map mode. Grows only when a multi-map quest is
   * confirmed (see `resolveMultiMap`), never shrinks on its own: switching to
   * a map already in here is "flip to that page", switching to anything else
   * is "start over" (see the map `<select>`'s onChange).
   */
  const [pages, setPages] = useState<string[]>(restored.pages);
  /**
   * Which page a quest was added under -- the map you were looking at when
   * you picked it. Decides which page's sidebar list shows it; a quest with
   * no published coordinates at all still belongs to whichever page you
   * added it from, so it must not simply vanish because it can't be routed.
   */
  const [addedOnPage, setAddedOnPage] = useState<Record<string, string>>(restored.addedOnPage);

  // Written through on every change, same as progress, so a crash or an
  // update restart reopens on the run you were planning.
  useEffect(() => {
    saveRunState({
      mapName,
      selectedQuests,
      activeWiki,
      pages,
      addedOnPage,
      multiMapQuests,
      dismissedMultiMap: Array.from(dismissedMultiMap),
      clickedSpawn,
      zoneIndex,
      hideFinished,
    });
  }, [mapName, selectedQuests, activeWiki, pages, addedOnPage, multiMapQuests, dismissedMultiMap,
    clickedSpawn, zoneIndex, hideFinished]);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  // Map and loot layers live in settings so they survive a restart.
  const { showSnipers, showTransits, showLoot, lootRadius, hiddenLoot, lootDensity } = settings;

  const coop = useCoopRun();
  /** The checklist is shared during a run and kept locally otherwise. */
  const [soloChecks, setSoloChecks] = useState<Record<string, CheckEntry>>({});
  const checks = coop.code ? coop.state.checks : soloChecks;

  function setCheck(label: string, patch: Partial<CheckEntry>) {
    if (coop.code) {
      coop.claim(label, patch);
      return;
    }
    setSoloChecks((current) => {
      const existing = current[label] ?? { claimedBy: null, claimedName: null, packed: false };
      return { ...current, [label]: { ...existing, ...patch } };
    });
  }

  useEffect(() => {
    fetchMapIndex().then(setMaps).catch(() => setMaps([]));
    fetchQuestList()
      .then(async (titles) => {
        setQuestTitles(titles);
        // Per-quest map data is only in each page's infobox, so build the
        // index once (batched, cached) to filter the list per map.
        const index = await fetchQuestIndex(titles, (done, total) => setIndexProgress({ done, total }));
        setQuestIndex(index);
        setIndexProgress(null);
      })
      .catch((e) => setWikiError(String(e)));
  }, []);

  // Reload everything map-specific when the map changes.
  useEffect(() => {
    setMapData(null);
    setSelectedOrder(null);
    // The restored map's spawn is still the right one; only a switch clears it.
    if (spawnMap.current !== mapName) {
      spawnMap.current = mapName;
      setClickedSpawn(null);
      setZoneIndex(0);
    }
    // The old map's objectives must not be drawn on the new map while it loads,
    // and a slow response for the map just left must not land on the new one.
    setApi(null);
    let current = true;
    fetchMapData(mapName)
      .then((data) => { if (current) setMapData(data); })
      .catch(() => { if (current) setMapData(null); });
    loadApi();
    return () => { current = false; };
  }, [mapName]);

  /** Bumped per request, so only the latest map-slice fetch is applied. */
  const apiRequest = useRef(0);

  function loadApi(force = false) {
    const request = ++apiRequest.current;
    setApiError(null);
    fetchMapSlice(mapName, force)
      .then((slice) => { if (request === apiRequest.current) setApi(slice); })
      .catch((error) => {
        if (request !== apiRequest.current) return;
        setApi(null);
        const detail = error instanceof JsonApiError && error.detail ? ` (${error.detail})` : '';
        setApiError(`${error.message}${detail}`);
      });
  }

  // Credits this map toward every tracked multi-map quest still selected here.
  // The only place `visited` grows, so a leg is never counted reached just
  // because an earlier one was -- see the `multiMapQuests` declaration.
  useEffect(() => {
    setMultiMapQuests((current) => {
      let changed = false;
      const next = { ...current };
      for (const title of selectedQuests) {
        const entry = next[title];
        if (entry && entry.maps.includes(mapName) && !entry.visited.includes(mapName)) {
          next[title] = { ...entry, visited: [...entry.visited, mapName] };
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [mapName, selectedQuests]);

  const currentMap = maps.find((m) => m.normalizedName === mapName) ?? null;
  const wikiMapName = currentMap?.wikiName ?? mapData?.wikiName ?? '';
  /** Used to spot which map an objective's text is talking about. */
  const allMapNames = useMemo(() => maps.map((m) => m.wikiName).filter(Boolean), [maps]);

  const taskIndex = useMemo(() => loadTaskIndex(), [api]);

  const gameLogs = useGameLogSync({
    settings,
    updateSettings,
    progress,
    changeProgress,
    idByName: taskIndex.idByName,
    requires: taskIndex.requires,
  });

  const mapQuestTitles = useMemo(() => {
    if (!questIndex || !wikiMapName) return questTitles;
    return questsForMap(questIndex, wikiMapName).map((entry) => entry.title);
  }, [questIndex, questTitles, wikiMapName]);

  /**
   * Where each quest on this map stands. Computed from the cached index, which
   * covers every quest, rather than the map slice, which only holds the ones
   * with published coordinates — those are the only ones that can be drawn, not
   * the only ones you can go and do.
   */
  const standingByQuest = useMemo(() => {
    const byName = new Map<string, ReturnType<typeof standingById>>();
    for (const title of mapQuestTitles) {
      const key = normalize(title);
      const id = taskIndex.idByName[key];
      if (id) byName.set(key, standingById(id, taskIndex, progress, gameLogs.given));
    }
    return byName;
  }, [mapQuestTitles, taskIndex, progress, gameLogs.given]);

  function standingFor(title: string) {
    return standingByQuest.get(normalize(title)) ?? 'available';
  }

  const suggestions = useMemo(
    () => searchQuests(mapQuestTitles, query)
      .filter((t) => !selectedQuests.includes(t))
      .filter((t) => !(hideFinished && standingByQuest.get(normalize(t)) === 'completed')),
    [mapQuestTitles, query, selectedQuests, hideFinished, standingByQuest],
  );

  /**
   * When the search finds nothing on this map, the same search across every
   * quest, with the map each one is on -- quests are filtered by map, and a
   * dead-end "no match" left people thinking a quest was missing.
   */
  const elsewhereMatches = useMemo(() => {
    if (query.trim().length < 2 || suggestions.length > 0 || !questIndex) return [];
    const onThisMap = new Set(mapQuestTitles);
    const byTitle = new Map(Object.values(questIndex).map((entry) => [entry.title, entry]));
    const known = new Set(maps.map((m) => m.wikiName));
    return searchQuests(questTitles, query)
      .filter((title) => !onThisMap.has(title) && !selectedQuests.includes(title))
      .slice(0, 6)
      .map((title) => ({
        title,
        map: byTitle.get(title)?.locations.find((location) => known.has(location)) ?? null,
      }));
  }, [query, suggestions, questIndex, mapQuestTitles, questTitles, maps, selectedQuests]);

  /**
   * Quests on this map you could start right now, and have not already added.
   * Empty until the index is built: before then `mapQuestTitles` is every
   * quest in the game, and "add all available" would add every map's quests.
   */
  const availableTitles = useMemo(() => (questIndex ? mapQuestTitles.filter((title) =>
    !selectedQuests.includes(title) && standingByQuest.get(normalize(title)) === 'available') : []),
  [questIndex, mapQuestTitles, selectedQuests, standingByQuest]);

  function pickQuest(title: string, options: { keepUndo?: boolean; page?: string } = {}) {
    setQuery('');
    setHighlight(0);
    // Building a new run here means the old one is not coming back.
    if (!options.keepUndo) setClearedRun(null);
    const page = options.page ?? mapName;
    setWikiError(null);
    setSelectedOrder(null);
    setActiveWiki(title);
    setSelectedQuests((current) => (current.includes(title) ? current : [...current, title]));
    setAddedOnPage((current) => (title in current ? current : { ...current, [title]: page }));
    backfillFor(title);
    checkMultiMap(title);

    if (wikiByTitle[title]) return;
    setLoadingQuest(true);
    fetchQuest(title)
      .then((quest) => setWikiByTitle((current) => ({ ...current, [title]: quest })))
      .catch((error) => setWikiError(String(error.message ?? error)))
      .finally(() => setLoadingQuest(false));
  }

  /** Records the run's finished quests, then clears the run they belonged to. */
  function finishRun(ids: string[]) {
    updateProgress(withCompleted(progress, ids, true));
    setFinishOpen(false);

    // Finishing is personal, because progress is. Clearing the quest list is a
    // shared change, so in a co-op run it would wipe a friend's screen before
    // he had ticked off his own — which is exactly what it did.
    if (!coop.code) {
      setSelectedQuests([]);
      setActiveWiki(null);
      setSelectedOrder(null);
      setMultiMapQuests({});
      setPages([]);
      setAddedOnPage({});
    }
  }

  /**
   * Adding a quest means you are doing it now, which can only be true if
   * everything before it is already done — so those are marked, and it is not.
   * Announced with an undo rather than done silently: it changes stored
   * progress off the back of what looks like a browsing action.
   */
  function backfillFor(title: string) {
    const id = tasks.find((t) => normalize(t.normalizedName) === normalize(title))?.id
      ?? taskIndex.idByName[normalize(title)];
    if (!id) return;

    const missing = missingPrerequisites(id, taskIndex.requires, progress);
    if (missing.length === 0) return;

    updateProgress(withCompleted(progress, missing, true));
    setLastBackfill({ title, ids: missing });
  }

  /**
   * Queues the "this quest also needs {map}" prompt when a freshly-picked
   * quest's objectives are genuinely tied to more than one map. Looked up
   * fresh from `api.tasks` rather than the `tasks` memo, which still reflects
   * `selectedQuests` from before this pick.
   */
  function checkMultiMap(title: string) {
    if (!api || multiMapQuests[title] || dismissedMultiMap.has(title)) return;
    const target = normalize(title);
    const task = api.tasks.find((t) => normalize(t.normalizedName) === target);
    if (!task) return;

    const knownMaps = new Set(maps.map((m) => m.normalizedName));
    const span = questMapSpan(task, knownMaps);
    if (span.length <= 1) return;

    setPendingMultiMap((current) => (current.some((p) => p.title === title) ? current : [...current, { title, maps: span }]));
  }

  /** Applies the player's yes/no answers from the multi-map prompt. */
  function resolveMultiMap(confirmedTitles: string[]) {
    setMultiMapQuests((current) => {
      const next = { ...current };
      for (const { title, maps: span } of pendingMultiMap) {
        if (confirmedTitles.includes(title)) {
          // Credit the map this was just confirmed on immediately -- the
          // accumulation effect only reacts to a later `mapName` change, and
          // this one has already happened by the time the prompt is answered.
          next[title] = { maps: span, visited: span.includes(mapName) ? [mapName] : [] };
        }
      }
      return next;
    });
    setDismissedMultiMap((current) => {
      const next = new Set(current);
      for (const { title } of pendingMultiMap) next.add(title);
      return next;
    });

    // Every confirmed quest's maps become pages in this run -- the current
    // map first, if this is the first one, so it reads as "page one".
    const confirmedSpans = pendingMultiMap.filter((p) => confirmedTitles.includes(p.title)).map((p) => p.maps);
    if (confirmedSpans.length > 0) {
      setPages((current) => {
        const next = current.length > 0 ? [...current] : [mapName];
        for (const span of confirmedSpans) {
          for (const m of span) if (!next.includes(m)) next.push(m);
        }
        return next;
      });
    }

    setPendingMultiMap([]);
  }

  /**
   * Takes a friend's exported progress. Merging keeps both records; replacing
   * adopts theirs wholesale, including their level, which is what someone
   * handed a save actually wants.
   */
  function importProgress(payload: ProgressExport, mode: 'replace' | 'merge') {
    const base = mode === 'replace' ? emptyProgress() : progress;
    const merged = withCompleted(base, payload.completed, true);
    updateProgress({
      ...merged,
      playerLevel: mode === 'replace' ? payload.playerLevel : (progress.playerLevel ?? payload.playerLevel),
      // Trader settings are not in the export, so a friend's file never resets yours.
      traders: progress.traders,
    });
    setLastBackfill(null);
  }

  function undoBackfill() {
    if (!lastBackfill) return;
    updateProgress(withCompleted(progress, lastBackfill.ids, false));
    setLastBackfill(null);
  }

  function addAvailableQuests() {
    for (const title of availableTitles) pickQuest(title);
  }

  function removeQuest(title: string) {
    setSelectedQuests((current) => current.filter((t) => t !== title));
    setActiveWiki((current) => (current === title ? null : current));
    setSelectedOrder(null);
    setMultiMapQuests((current) => {
      if (!(title in current)) return current;
      const { [title]: _removed, ...rest } = current;
      return rest;
    });
    setAddedOnPage((current) => {
      if (!(title in current)) return current;
      const { [title]: _removed, ...rest } = current;
      return rest;
    });
  }

  const tasks: Task[] = useMemo(() => {
    if (!api || selectedQuests.length === 0) return [];
    return selectedQuests
      .map((title) => {
        const target = normalize(title);
        return api.tasks.find((t) => normalize(t.normalizedName) === target) ?? null;
      })
      .filter((t): t is Task => t !== null);
  }, [selectedQuests, api]);

  /** Wiki data for every selected quest, in the order they were added. */
  const selectedWiki: WikiQuest[] = useMemo(
    () => selectedQuests.map((title) => wikiByTitle[title]).filter(Boolean),
    [selectedQuests, wikiByTitle],
  );

  /** Task matching the quest currently focused in the sidebar. */
  const activeTask = useMemo(
    () => (activeWiki ? tasks.find((t) => normalize(t.normalizedName) === normalize(activeWiki)) ?? null : null),
    [tasks, activeWiki],
  );

  /** Display name of a selected quest's task, used for colours and matching. */
  function taskNameFor(title: string): string {
    const task = tasks.find((t) => normalize(t.normalizedName) === normalize(title));
    return task?.name ?? title;
  }

  /** Clicking a dot focuses the quest it belongs to. */
  function focusQuestByTaskName(taskName: string | undefined) {
    if (!taskName) return;
    const task = tasks.find((t) => t.name === taskName);
    if (!task) return;
    const title = selectedQuests.find((q) => normalize(q) === normalize(task.normalizedName));
    if (title) setActiveWiki(title);
  }

  /** Selected quests the API has no routable objectives for on this map. */
  const unroutable = useMemo(() => {
    if (!api) return [];
    return selectedQuests.filter((title) =>
      !api.tasks.some((t) => normalize(t.normalizedName) === normalize(title)));
  }, [selectedQuests, api]);

  /** Selected quests still waiting on at least one more map, in wiki-friendly names. */
  const multiMapPending = useMemo(() => selectedQuests
    .map((title) => {
      const entry = multiMapQuests[title];
      if (!entry) return null;
      const remaining = entry.maps.filter((m) => !entry.visited.includes(m));
      return remaining.length > 0 ? { title, remaining } : null;
    })
    .filter((entry): entry is { title: string; remaining: string[] } => entry !== null),
  [selectedQuests, multiMapQuests]);

  /**
   * With more than one page in this run, the sidebar list only shows quests
   * that belong to the active page: a tracked multi-map quest shows on every
   * map it spans, anything else only on the page it was added from. Checking
   * routability instead would hide a legitimately-added quest the moment it
   * turned out to have no published coordinates anywhere, which is a
   * different problem from which page it belongs on. In ordinary single-page
   * runs (the common case) nothing is hidden, matching today.
   */
  const visibleSelectedQuests = useMemo(() => (
    pages.length > 1
      ? selectedQuests.filter((title) => {
          const multi = multiMapQuests[title];
          return multi ? multi.maps.includes(mapName) : addedOnPage[title] === mapName;
        })
      : selectedQuests
  ), [pages, selectedQuests, multiMapQuests, addedOnPage, mapName]);

  function mapDisplayName(normalizedName: string): string {
    return maps.find((m) => m.normalizedName === normalizedName)?.wikiName ?? normalizedName;
  }

  /**
   * Switching to a map already tracked as a page in this run (via the tab
   * strip, the Continue banner, or picking it straight from the dropdown)
   * just flips to it. Anything else is starting over, same as every other
   * map switch has always been.
   */
  function switchMap(next: string) {
    if (next === mapName) return;
    setMapName(next);
    if (pages.includes(next)) return;

    // Kept for one Undo: the dropdown sits right above the quest list, and a
    // stray pick used to throw away a whole planned run with no way back.
    setClearedRun(selectedQuests.length > 0
      ? { mapName, selectedQuests, activeWiki, pages, multiMapQuests, addedOnPage }
      : null);
    setSelectedQuests([]);
    setActiveWiki(null);
    setQuery('');
    setPages([]);
    setMultiMapQuests({});
    setAddedOnPage({});
  }

  function undoMapSwitch() {
    if (!clearedRun) return;
    setMapName(clearedRun.mapName);
    setSelectedQuests(clearedRun.selectedQuests);
    setActiveWiki(clearedRun.activeWiki);
    setPages(clearedRun.pages);
    setMultiMapQuests(clearedRun.multiMapQuests);
    setAddedOnPage(clearedRun.addedOnPage);
    setClearedRun(null);
  }

  const reference = useReferenceData();
  const {
    sniperSpawns, transits, zones, activeZone, plainExtracts, restrictedExtracts,
    extractLabel, routableExtracts, routeStart,
  } = useSpawnAndExtracts({ mapData, api, maps, zoneIndex, clickedSpawn });

  const loot = useLootRun({ mapName, api, active: mode === 'loot', routeStart, reference });

  /**
   * A pending multi-map quest's exit is the transit to its next leg, not
   * whichever plain extract happens to be nearest -- that transit is not in
   * `routableExtracts` at all, since transits and extracts are separate data.
   */
  const transitExtract: MapExtract | null = useMemo(() => {
    for (const { remaining } of multiMapPending) {
      const transit = transits.find((t) => t.toMap === remaining[0]);
      if (transit) {
        return { id: `transit-${remaining[0]}`, name: transit.label, faction: null, position: transit.position, switches: null };
      }
    }
    return null;
  }, [multiMapPending, transits]);

  const route = useMemo(() => {
    if (tasks.length === 0 || !api || !routeStart) return null;
    return buildRoute(tasks, routeStart, routableExtracts, mapName, transitExtract);
  }, [tasks, api, routeStart, routableExtracts, mapName, transitExtract]);

  useRouteKeys(route, mode === 'quests', selectedOrder, setSelectedOrder);

  /** With no coordinates for objectives, at least mark where you spawn. */
  const fallbackStops = useMemo(() => {
    if (route || !routeStart) return [];
    return [{
      order: 0,
      label: routeStart.zoneName ?? 'Spawn',
      description: 'Your spawn point',
      position: routeStart.position,
      kind: 'spawn' as const,
      legDistance: 0,
      cumulativeDistance: 0,
      optional: false,
    }];
  }, [route, routeStart]);

  // Everything that defines "the run we are doing" is mirrored; pan and zoom
  // are not, so you can look somewhere else without dragging your friend's
  // view along with you.
  useMirroredField(coop, 'map', mapName, setMapName);
  useMirroredField(coop, 'quests', selectedQuests, setSelectedQuests);
  useMirroredField(coop, 'pages', pages, setPages);
  // Which page a quest belongs on is part of the shared plan, not personal
  // progress -- unlike multiMapQuests, both players must see the same thing.
  useMirroredField(coop, 'addedOnPage', addedOnPage, setAddedOnPage);
  useMirroredField(coop, 'spawn', clickedSpawn, setClickedSpawn);
  useMirroredField(coop, 'zone', zoneIndex, setZoneIndex);
  useMirroredField(coop, 'selected', selectedOrder, setSelectedOrder);
  useMirroredField(coop, 'activeQuest', activeWiki, setActiveWiki);

  // Whatever a friend picked has to be fetched here too, or their quest shows
  // up as a name with no requirements behind it.
  useEffect(() => {
    for (const title of selectedQuests) {
      if (wikiByTitle[title] || loadingQuest) continue;
      fetchQuest(title)
        .then((quest) => setWikiByTitle((current) => ({ ...current, [title]: quest })))
        .catch(() => { /* the panel already reports quests it cannot load */ });
    }
  }, [selectedQuests, wikiByTitle, loadingQuest]);

  const { placed: placedLoot, visible: visibleLoot } = useLootLayer({
    api, containerNames: reference.containerNames, route, settings,
  });

  return (
    <div className="app">
      <CoopNotices run={coop} />
      <header>
        <h1>Tarkov Quest Router</h1>
        <UpdateNotice />
      </header>

      <div className="layout">
        <aside>
          <div className="mode-tabs">
            <button
              className={mode === 'quests' ? 'active' : ''}
              onClick={() => setMode('quests')}
            >
              Quests
            </button>
            <button
              className={mode === 'loot' ? 'active' : ''}
              onClick={() => setMode('loot')}
            >
              Loot run
            </button>
            <button
              className={mode === 'settings' ? 'active' : ''}
              onClick={() => setMode('settings')}
            >
              Settings
            </button>
          </div>

          {mode === 'settings' ? (
            <SettingsPanel settings={settings} onChange={updateSettings} gameLogs={gameLogs} />
          ) : (
          <>

          <MapPicker
            maps={maps}
            mapName={mapName}
            onSwitch={switchMap}
            cleared={clearedRun && { mapName: clearedRun.mapName, count: clearedRun.selectedQuests.length }}
            onUndoSwitch={undoMapSwitch}
            pages={pages}
            mapDisplayName={mapDisplayName}
            snipers={{ shown: showSnipers, count: sniperSpawns.length, onChange: (shown) => updateSettings({ showSnipers: shown }) }}
            transits={{ shown: showTransits, count: transits.length, onChange: (shown) => updateSettings({ showTransits: shown }) }}
          />

          <SpawnPanel
            clickedSpawn={clickedSpawn}
            onClearSpawn={() => setClickedSpawn(null)}
            zones={zones}
            zoneIndex={zoneIndex}
            onZone={(index) => { setZoneIndex(index); setClickedSpawn(null); }}
            activeZoneLabel={activeZone?.label ?? null}
            plainExtracts={plainExtracts}
            restrictedExtracts={restrictedExtracts}
            extractLabel={extractLabel}
            transits={transits}
          />

          {mode === 'loot' && (
            <LootRunPanel
              items={loot.items}
              chosen={loot.wanted}
              onAdd={(item) => loot.setWanted((current) =>
                current.some((c) => c.id === item.id) ? current : [...current, item])}
              onRemove={(id) => loot.setWanted((current) => current.filter((c) => c.id !== id))}
              onClear={() => loot.setWanted([])}
              spots={loot.spots.length}
              run={loot.run}
              limit={loot.limit}
              balance={loot.balance}
              onBalance={loot.setBalance}
              onLimit={loot.setLimit}
              keyNames={loot.allItemNames}
              mapName={wikiMapName || mapName}
              hasSpawn={Boolean(routeStart)}
            />
          )}

          {mode === 'quests' && (
          <div className="panel">
            <h2>Quests</h2>
            <QuestSearch
              query={query}
              onQuery={(value) => { setQuery(value); setHighlight(0); }}
              highlight={highlight}
              onHighlight={setHighlight}
              suggestions={suggestions}
              elsewhere={elsewhereMatches}
              onPick={(title) => pickQuest(title)}
              onPickElsewhere={(match) => {
                const target = maps.find((m) => m.wikiName === match.map)?.normalizedName;
                if (target) switchMap(target);
                // Keeps the switch's Undo: this pick is part of that switch.
                pickQuest(match.title, { keepUndo: true, page: target ?? mapName });
              }}
              mapLabel={wikiMapName}
              questCount={mapQuestTitles.length}
              indexProgress={indexProgress}
            />

            <ChosenQuests
              titles={visibleSelectedQuests}
              active={activeWiki}
              onFocus={setActiveWiki}
              onRemove={removeQuest}
              accentOf={(title) => questAccent(taskNameFor(title))}
              standingOf={standingFor}
              traderReason={(title) => traderBlock(taskIndex.idByName[normalize(title)] ?? '', taskIndex, progress.traders)}
              unroutable={unroutable}
            />

            <ProgressNotices
              durableProblem={durableProblem}
              gameLogs={gameLogs}
              onShowLogDetails={() => setMode('settings')}
              backfill={lastBackfill}
              onUndoBackfill={undoBackfill}
            />

            {selectedQuests.length > 1 && (
              <p className="muted small">Routing {selectedQuests.length} quests together.</p>
            )}
            {questIndex && wikiMapName && selectedQuests.length === 0 && (
              <p className="muted small">
                Showing {mapQuestTitles.length} of {questTitles.length} quests: those on {wikiMapName}.
                Add several to route them in one run.
              </p>
            )}
            {loadingQuest && <p className="muted small">Loading quest...</p>}
            {wikiError && <p className="error small">{wikiError}</p>}
          </div>
          )}

          {mode === 'quests' && activeWiki && wikiByTitle[activeWiki] && (
            <RequirementsPanel
              wiki={wikiByTitle[activeWiki]}
              task={tasks.find((t) => normalize(t.normalizedName) === normalize(activeWiki)) ?? null}
            />
          )}

          {apiError && (
            <div className="panel warn">
              <h2>Objective data unavailable</h2>
              <p className="small">{apiError}</p>
              <p className="small muted">
                Quests, requirements, spawns and the map still work. The drawn route needs objective
                coordinates from json.tarkov.dev.
              </p>
              <button onClick={() => loadApi(true)}>Retry</button>
            </div>
          )}

          {api?.stale && (
            <div className="panel warn">
              <p className="small">
                Showing cached data from {new Date(api.fetchedAt).toLocaleString()}, because
                json.tarkov.dev is currently unreachable.
              </p>
              <button onClick={() => loadApi(true)}>Retry</button>
            </div>
          )}

          {mode === 'quests' && (
            <Fold title="Your progress" meta={`${progress.completed.size} finished`} storageKey="progress">
              <ProgressPanel
                progress={progress}
                questTitles={questTitles}
                idByName={taskIndex.idByName}
                requires={taskIndex.requires}
                mapName={wikiMapName || mapName}
                availableTitles={availableTitles}
                indexing={!questIndex}
                hideFinished={hideFinished}
                onCatchUp={(ids) => updateProgress(withCompleted(progress, ids, true))}
                onUnmark={(id) => updateProgress(withCompleted(progress, [id], false))}
                onAddAvailable={addAvailableQuests}
                onHideFinished={setHideFinished}
                onSetLevel={(level) => updateProgress({ ...progress, playerLevel: level })}
                onSetTrader={(traderId, level) => changeProgress((current) => {
                  const traders = { ...current.traders };
                  if (level === null) delete traders[traderId];
                  else traders[traderId] = level;
                  return { ...current, traders };
                })}
                onImport={importProgress}
                onReset={() => updateProgress(emptyProgress())}
              />
            </Fold>
          )}

          {placedLoot.length > 0 && (
            <Fold
              title="Loot"
              meta={showLoot ? `${visibleLoot.length} of ${placedLoot.length} shown` : 'off'}
              storageKey="loot"
              defaultOpen={false}
            >
              <LootPanel
                containers={placedLoot}
                shown={visibleLoot}
                enabled={showLoot}
                onEnabled={(enabled) => updateSettings({ showLoot: enabled })}
                radius={lootRadius}
                onRadius={(radius) => updateSettings({ lootRadius: radius })}
                hasRoute={Boolean(route)}
                hidden={hiddenLoot}
                onToggleName={(name) => updateSettings({
                  hiddenLoot: hiddenLoot.includes(name) ? hiddenLoot.filter((n) => n !== name) : [...hiddenLoot, name],
                })}
                density={lootDensity}
                onDensity={(density) => updateSettings({ lootDensity: density })}
              />
            </Fold>
          )}

          <Fold
            title="Co-op"
            meta={coop.code ? `In run ${coop.code}` : 'Not in a run'}
            storageKey="coop"
            defaultOpen={Boolean(coop.code)}
          >
            <CoopPanel run={coop} />
          </Fold>
          </>
          )}
        </aside>

        <main>
          {mapData ? (
            <MapView
              svgUrl={mapData.svg}
              viewBox={mapData.viewBox}
              projection={mapData.projection}
              stops={mode === 'loot'
                ? (loot.run ? loot.run.stops : fallbackStops)
                : (route ? route.stops : fallbackStops)}
              labels={mapData.labels}
              spawnPoints={activeZone ? activeZone.spawns.map((sp) => ({ x: sp.position.x, z: sp.position.z })) : []}
              sniperSpawns={showSnipers ? sniperSpawns : []}
              transits={showTransits ? transits : []}
              routeIconScale={settings.routeIconScale}
              lootContainers={visibleLoot}
              onPickSpawn={(position) => { setClickedSpawn(position); setSelectedOrder(null); }}
              onSelectStop={(stop) => {
                setSelectedOrder(stop.order);
                focusQuestByTaskName(stop.questName);
              }}
              selectedOrder={selectedOrder}
              highlightQuest={selectedQuests.length > 1 ? activeTask?.name ?? null : null}
              // In the toolbar because the map now fills the window: it is the
              // one strip always in view, where a panel below it was a scroll away.
              actions={mode === 'quests' && selectedQuests.length > 0 && (
                <button
                  className="primary"
                  title="Tick off what you finished and the next run already knows"
                  onClick={() => { setFinishSession((n) => n + 1); setFinishOpen(true); }}
                >
                  Finish run
                </button>
              )}
              overlay={mode === 'quests' && route
                ? <CurrentObjective route={route} selectedOrder={selectedOrder} onSelect={setSelectedOrder} />
                : null}
            />
          ) : (
            <div className="panel"><p className="muted small">Loading map...</p></div>
          )}

          {mode === 'quests' && activeWiki && (
            // Folded by default: the wiki text is long, and open it pushed the
            // route and the requirements a screen below the map.
            <Fold title={`${activeWiki} — guide`} storageKey="guide" defaultOpen={false}>
            <QuestGuide
              title={activeWiki}
              wikiUrl={wikiByTitle[activeWiki]?.wikiUrl}
              accent={questAccent(taskNameFor(activeWiki))}
              objectives={wikiByTitle[activeWiki]?.objectives ?? []}
              mapNames={allMapNames}
              currentMap={wikiMapName || null}
            />
            </Fold>
          )}

          {mode === 'loot' && loot.run && loot.run.stops.length > 1 && (
            <RouteList route={{ stops: loot.run.stops, totalDistance: loot.run.totalDistance, unmappedObjectives: [] }} />
          )}

          {mode === 'quests' && (
          <RouteRequirements
            quests={selectedWiki}
            activeTitle={activeWiki}
            onSelect={(title) => setActiveWiki(title)}
            colorOf={(title) => questAccent(taskNameFor(title))}
            checks={checks}
            onCheck={setCheck}
            me={{ id: coop.peerId, name: coop.name }}
            shared={coop.others.length > 0}
            mapNames={allMapNames}
            currentMap={wikiMapName || null}
          />
          )}

          {mode === 'quests' && multiMapPending.map(({ title, remaining }) => {
            const nextMap = remaining[0];
            const transit = transits.find((t) => t.toMap === nextMap);
            return (
              <div key={title} className="panel warn">
                <p className="small">
                  <strong>{title}</strong> also needs {remaining.map(mapDisplayName).join(', ')}.
                  {transit && ` Use the transit to ${mapDisplayName(nextMap)} to get there.`}
                </p>
                <button onClick={() => switchMap(nextMap)}>
                  Continue to {mapDisplayName(nextMap)}
                </button>
              </div>
            );
          })}

          {mode === 'quests' && route && (
            <RouteList route={route} selectedOrder={selectedOrder} onSelect={setSelectedOrder} />
          )}

          {mode === 'quests' && unroutable.length > 0 && api && (
            <div className="panel warn">
              <p className="small">
                No published objective coordinates for: {unroutable.join(', ')}. These are not drawn on
                the map; their requirements still show on the left.
              </p>
            </div>
          )}
        </main>
      </div>

      {finishOpen && (
        <FinishRunDialog
          key={finishSession}
          entries={selectedQuests.map((title) => ({
            title,
            // A quest with no coordinates on this map is absent from the slice
            // but still has an id in the cached index, and is still trackable.
            taskId: tasks.find((t) => normalize(t.normalizedName) === normalize(title))?.id
              ?? taskIndex.idByName[normalize(title)] ?? null,
          }))}
          progress={progress}
          requires={taskIndex.requires}
          shared={Boolean(coop.code)}
          multiMapRemaining={Object.fromEntries(
            multiMapPending.map(({ title, remaining }) => [title, remaining.map(mapDisplayName)]),
          )}
          onSubmit={finishRun}
          onClose={() => setFinishOpen(false)}
        />
      )}

      {pendingMultiMap.length > 0 && (
        <MultiMapPrompt
          entries={pendingMultiMap.map(({ title, maps: span }) => ({
            title,
            maps: span.filter((m) => m !== mapName),
          }))}
          mapDisplayName={mapDisplayName}
          onSubmit={resolveMultiMap}
        />
      )}
    </div>
  );
}
