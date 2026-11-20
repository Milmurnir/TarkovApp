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
import { byDensity, loadContainerNames, placeContainers } from './lib/loot';
import LootRunPanel from './components/LootRunPanel';
import { buildLootRun, DEFAULT_BALANCE, itemsOnMap, spotsFor, type ItemChoice } from './lib/lootRun';
import {
  containerItemChoices, containersHolding, loadContainerLoot, type ContainerLoot,
} from './lib/containerLoot';
import ProgressPanel from './components/ProgressPanel';
import FinishRunDialog from './components/FinishRunDialog';
import SettingsPanel from './components/SettingsPanel';
import Fold from './components/Fold';
import { loadSettings, saveSettings, type Settings } from './lib/settings';
import { loadRunState, saveRunState } from './lib/runState';
import { useGameLogSync } from './lib/useGameLogSync';
import { loadFleaItems } from './lib/priceCheck';
import { questMapSpan } from './lib/multiMap';
import MultiMapPrompt from './components/MultiMapPrompt';
import {
  emptyProgress, loadDurableProgress, loadProgress, missingPrerequisites, saveProgress,
  standingById, withCompleted, type Progress, type ProgressExport,
} from './lib/progress';
import { useCoopRun, useMirroredField } from './lib/useCoopRun';
import type { CheckEntry } from './lib/sharedRun';
import { buildRoute } from './lib/route';
import {
  JsonApiError, fetchMapSlice, loadLooseLoot, loadTaskIndex, type MapSlice,
} from './lib/jsonApi';
import { fetchQuest, fetchQuestList, searchQuests } from './lib/wiki';
import { fetchQuestIndex, questsForMap, type QuestIndex } from './lib/questIndex';
import {
  extractDisplayName, extractRestriction, extractsForSpawn, fetchMapData, fetchMapIndex,
  isPlainPmcExtract, spawnZones,
  type MapData, type MapExtractInfo, type MapIndexEntry, type MapSpawnPoint,
} from './lib/mapData';
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
  const [showSnipers, setShowSnipers] = useState(true);
  const [showTransits, setShowTransits] = useState(true);
  const [wikiError, setWikiError] = useState<string | null>(null);
  const [loadingQuest, setLoadingQuest] = useState(false);

  const [api, setApi] = useState<MapSlice | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [zoneIndex, setZoneIndex] = useState(restored.zoneIndex);
  /** Spawn placed by clicking the map; takes priority over the zone list. */
  const [clickedSpawn, setClickedSpawn] = useState<Vec3 | null>(restored.clickedSpawn);
  const [selectedOrder, setSelectedOrder] = useState<number | null>(null);

  const [progress, setProgress] = useState<Progress>(() => loadProgress());
  const [hideFinished, setHideFinished] = useState(restored.hideFinished);
  const [finishOpen, setFinishOpen] = useState(false);
  const [showLoot, setShowLoot] = useState(false);
  /** Metres from the route; null means the whole map. */
  const [lootRadius, setLootRadius] = useState<number | null>(30);
  const [hiddenLoot, setHiddenLoot] = useState<string[]>([]);
  const [lootDensity, setLootDensity] = useState(1);
  const [containerNames, setContainerNames] = useState<Record<string, string>>({});
  /** Quest routing, or a raid built around one item. */
  const [mode, setMode] = useState<'quests' | 'loot' | 'settings'>('quests');
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [lootWanted, setLootWanted] = useState<ItemChoice[]>([]);
  const [lootLimit, setLootLimit] = useState(10);
  const [lootBalance, setLootBalance] = useState(DEFAULT_BALANCE);
  const [itemNames, setItemNames] = useState<Record<string, string>>({});
  const [containerLoot, setContainerLoot] = useState<ContainerLoot>(
    { ids: [], names: [], containers: {}, chances: {} },
  );
  const [shortNames, setShortNames] = useState<Record<string, string>>({});
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

  /** Every progress change is written through, so a crash loses nothing. */
  function updateProgress(next: Progress) {
    setProgress(saveProgress(next));
  }

  /** Same as updateProgress, but from whatever progress is current when it applies. */
  const changeProgress = useCallback((change: (current: Progress) => Progress) => {
    setProgress((current) => saveProgress(change(current)));
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  // A fresh install has an empty localStorage but the user-data file is still
  // there, which is what makes progress outlive replacing the app.
  useEffect(() => {
    loadDurableProgress(progress).then((restored) => {
      // Written straight back out, so localStorage matches from here on and a
      // restore leaves a trace rather than being invisible.
      if (restored) setProgress(saveProgress(restored));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Warms the price-check overlay's item cache so the first hotkey press mid-raid
  // is not the moment it starts an 18 MB fetch. Silent on failure: the overlay
  // retries this itself and reports the error there, where it is actually seen.
  useEffect(() => {
    loadFleaItems().catch(() => {});
  }, []);

  // Reload everything map-specific when the map changes.
  useEffect(() => {
    setMapData(null);
    setLootWanted([]);
    setSelectedOrder(null);
    // The restored map's spawn is still the right one; only a switch clears it.
    if (spawnMap.current !== mapName) {
      spawnMap.current = mapName;
      setClickedSpawn(null);
      setZoneIndex(0);
    }
    fetchMapData(mapName).then(setMapData).catch(() => setMapData(null));
    loadApi();
  }, [mapName]);

  function loadApi(force = false) {
    setApiError(null);
    fetchMapSlice(mapName, force)
      .then(setApi)
      .catch((error) => {
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
      if (id) byName.set(key, standingById(id, taskIndex, progress));
    }
    return byName;
  }, [mapQuestTitles, taskIndex, progress]);

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

  const apiSpawns = useMemo(() => api?.spawns ?? [], [api]);

  useEffect(() => { loadContainerNames().then(setContainerNames); }, []);
  useEffect(() => { loadContainerLoot().then(setContainerLoot); }, []);

  useEffect(() => {
    fetch('/data/item-shortnames.json')
      .then((response) => (response.ok ? response.json() : {}))
      .then(setShortNames)
      .catch(() => setShortNames({}));
  }, []);

  useEffect(() => {
    fetch('/data/loot-items.json')
      .then((response) => (response.ok ? response.json() : {}))
      .then(setItemNames)
      .catch(() => setItemNames({}));
  }, []);

  /** Loose loot for this map, read from what the last map fetch cached. */
  const looseLoot = useMemo(() => loadLooseLoot(mapName), [mapName, api]);
  /** Names for everything searchable: loose loot, keys, and container contents. */
  const allItemNames = useMemo(() => {
    const names: Record<string, string> = { ...itemNames };
    containerLoot.ids.forEach((id, index) => {
      if (!names[id]) names[id] = containerLoot.names[index] ?? id;
    });
    return names;
  }, [itemNames, containerLoot]);

  const lootItems = useMemo(() => {
    const seen = new Map(itemsOnMap(looseLoot.points, allItemNames).map((item) => [item.id, item]));

    // How many containers of each kind stand on this map, so an item's count
    // can include the cupboards it might be inside and not just the floor.
    const perTemplate = new Map<string, number>();
    for (const container of api?.lootContainers ?? []) {
      perTemplate.set(container.template, (perTemplate.get(container.template) ?? 0) + 1);
    }

    const fromContainers = new Map<number, number>();
    for (const [template, indexes] of Object.entries(containerLoot.containers)) {
      const placed = perTemplate.get(template);
      if (!placed) continue;
      for (const index of indexes) {
        fromContainers.set(index, (fromContainers.get(index) ?? 0) + placed);
      }
    }

    for (const [index, count] of fromContainers) {
      const id = containerLoot.ids[index];
      if (!id) continue;
      const existing = seen.get(id);
      if (existing) existing.spots += count;
      else seen.set(id, { id, name: containerLoot.names[index] ?? id, spots: count });
    }

    return Array.from(seen.values())
      .map((item) => ({ ...item, short: shortNames[item.id] }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [looseLoot, allItemNames, api, containerLoot, shortNames]);



  /**
   * Only Streets tags a 'sniper' category in the API, so the generated data
   * (derived from marksman waves) is the source that covers every map.
   */
  const sniperSpawns = useMemo(() => {
    if (mapData?.sniperSpawns?.length) return mapData.sniperSpawns;
    return api?.sniperSpawns ?? [];
  }, [mapData, api]);

  /** Where this map lets you walk straight into another one, e.g. Woods into Reserve. */
  const transits = useMemo(() => {
    return (api?.transits ?? []).map((transit) => {
      const destination = maps.find((m) => m.normalizedName === transit.toMap)?.wikiName ?? transit.toMap;
      return {
        position: transit.position,
        label: destination ? `Transit to ${destination}` : (transit.description ?? 'Transit'),
        toMap: transit.toMap,
      };
    });
  }, [api, maps]);

  const zones = useMemo(() => (mapData ? spawnZones(mapData.spawns) : []), [mapData]);
  const activeZone = zones[Math.min(zoneIndex, Math.max(0, zones.length - 1))] ?? null;

  /** Centre of an infiltration zone, used as the route start when offline. */
  const zoneCentre: MapSpawnPoint | null = useMemo(() => {
    if (!activeZone || activeZone.spawns.length === 0) return null;
    const count = activeZone.spawns.length;
    const sum = activeZone.spawns.reduce(
      (acc, s) => ({ x: acc.x + s.position.x, y: acc.y + s.position.y, z: acc.z + s.position.z }),
      { x: 0, y: 0, z: 0 },
    );
    return {
      ...activeZone.spawns[0],
      zoneName: activeZone.infiltration,
      position: { x: sum.x / count, y: sum.y / count, z: sum.z / count },
    };
  }, [activeZone]);

  const spawnExtracts = useMemo(
    () => (mapData && activeZone ? extractsForSpawn(mapData.extracts, activeZone.infiltration) : []),
    [mapData, activeZone],
  );
  const plainExtracts = useMemo(() => spawnExtracts.filter(isPlainPmcExtract), [spawnExtracts]);

  /**
   * In-game extract names, keyed by the untranslated name SPT also uses. The
   * offline data only has that raw id, so the API supplies the label players
   * actually see on the exit timer.
   */
  const extractNameByRaw = useMemo(() => {
    const byRaw = new Map<string, string>();
    for (const extract of api?.extracts ?? []) {
      if (extract.rawName && extract.name) byRaw.set(extract.rawName.toLowerCase(), extract.name);
    }
    return byRaw;
  }, [api]);

  function extractLabel(extract: MapExtractInfo): string {
    const raw = extract.name ?? '';
    return extractNameByRaw.get(raw.toLowerCase()) ?? extractDisplayName(raw);
  }

  const restrictedExtracts = useMemo(
    () => spawnExtracts.filter((e) => !isPlainPmcExtract(e)),
    [spawnExtracts],
  );

  /**
   * Extracts the route may finish at. The API supplies the coordinates and the
   * SPT list supplies the restrictions, joined on the untranslated name, so
   * scav routes and special exits (no backpack, Red Rebel, train) are excluded.
   */
  const routableExtracts = useMemo(() => {
    if (!api) return [];
    const pmcOnly = api.extracts.filter((e) => e.faction !== 'scav');
    if (!mapData) return pmcOnly;

    const restricted = new Set(
      mapData.extracts.filter((e) => !isPlainPmcExtract(e)).map((e) => (e.name ?? '').toLowerCase()),
    );
    const allowed = pmcOnly.filter((e) => !restricted.has((e.rawName ?? '').toLowerCase()));
    // Never strip every option: an empty list would leave the route with no end.
    return allowed.length > 0 ? allowed : pmcOnly;
  }, [api, mapData]);

  /**
   * Where the route starts: the clicked point, else the spawn zone picked in
   * the sidebar. The API's spawn list is only a last resort -- its first entry
   * is whatever the API happens to list first, often a scav or boss spawn,
   * and using it ahead of the zone made the zone picker do nothing.
   */
  const routeStart = useMemo(() => {
    if (clickedSpawn) return { position: clickedSpawn, zoneName: 'Clicked spawn' };
    if (zoneCentre) return { position: zoneCentre.position, zoneName: zoneCentre.zoneName };
    const spawn = apiSpawns.find((s) => s.sides?.some((side) => /pmc|all/i.test(side))) ?? apiSpawns[0];
    if (spawn) return { position: spawn.position, zoneName: spawn.zoneName };
    return null;
  }, [clickedSpawn, apiSpawns, zoneCentre]);

  const lootSpots = useMemo(() => {
    const ids = lootWanted.map((item) => item.id);
    return spotsFor(
      ids, looseLoot.points, api?.lootContainers ?? [],
      containersHolding(ids, containerLoot), containerNames,
    );
  }, [lootWanted, looseLoot, api, containerLoot, containerNames]);

  const lootRun = useMemo(() => {
    if (mode !== 'loot' || lootSpots.length === 0 || !routeStart) return null;
    return buildLootRun(lootSpots, looseLoot.locks, routeStart, lootLimit, allItemNames, lootBalance);
  }, [mode, lootSpots, looseLoot, routeStart, lootLimit, allItemNames, lootBalance]);

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

  // ← / → step through the route without reaching for the mouse mid-raid.
  // Ignored while typing, and while a dialog is open.
  useEffect(() => {
    if (mode !== 'quests' || !route || route.stops.length === 0) return;
    const stops = route.stops;

    function onKey(event: KeyboardEvent) {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName))) return;
      if (document.querySelector('.modal-backdrop')) return;

      const index = stops.findIndex((s) => s.order === selectedOrder);
      const nextIndex = event.key === 'ArrowRight'
        ? (index === -1 ? 0 : Math.min(stops.length - 1, index + 1))
        : (index === -1 ? -1 : Math.max(0, index - 1));
      if (nextIndex < 0) return;
      event.preventDefault();
      setSelectedOrder(stops[nextIndex].order);
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, route, selectedOrder]);

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

  /** Containers with a name and a distance from the route. */
  const placedLoot = useMemo(
    () => placeContainers(api?.lootContainers ?? [], containerNames, route ? route.stops.map((s) => s.position) : []),
    [api, containerNames, route],
  );

  const visibleLoot = useMemo(() => {
    if (!showLoot) return [];
    // With no route there is nothing to be near, so the radius sits inert
    // rather than filtering everything away.
    const byRoute = lootRadius === null || !route
      ? () => true
      : (container: { fromRoute: number }) => container.fromRoute <= lootRadius;

    // Density is judged against everything on the map, not what survives the
    // other filters: hiding drawers should not make a cluster stop being one.
    const dense = new Set(byDensity(placedLoot, lootDensity));

    return placedLoot.filter((container) =>
      byRoute(container) && dense.has(container) && !hiddenLoot.includes(container.name));
  }, [showLoot, placedLoot, lootRadius, hiddenLoot, route, lootDensity]);

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

          <div className="panel">
            <h2>Map</h2>
            <select value={mapName} onChange={(e) => switchMap(e.target.value)}>
              {maps.map((m) => (
                <option key={m.normalizedName} value={m.normalizedName}>{m.wikiName}</option>
              ))}
            </select>
            {clearedRun && (
              <p className="backfill-note small">
                Cleared {clearedRun.selectedQuests.length} quest{clearedRun.selectedQuests.length === 1 ? '' : 's'} from{' '}
                {mapDisplayName(clearedRun.mapName)}.{' '}
                <button className="muted-button" onClick={undoMapSwitch}>Undo</button>
              </p>
            )}
            {pages.length > 1 && (
              <div className="page-tabs">
                {pages.map((p, i) => (
                  <button
                    key={p}
                    className={p === mapName ? 'active' : ''}
                    onClick={() => switchMap(p)}
                  >
                    {i + 1}. {mapDisplayName(p)}
                  </button>
                ))}
              </div>
            )}
            <label className="toggle">
              <input type="checkbox" checked={showSnipers} onChange={(e) => setShowSnipers(e.target.checked)} />
              Show sniper scavs ({sniperSpawns.length})
            </label>
            {transits.length > 0 && (
              <label className="toggle">
                <input type="checkbox" checked={showTransits} onChange={(e) => setShowTransits(e.target.checked)} />
                Show transits ({transits.length})
              </label>
            )}
          </div>

          <div className="panel">
            <h2>Your spawn</h2>

            {clickedSpawn ? (
              <p className="small">
                Set by clicking the map at ({Math.round(clickedSpawn.x)}, {Math.round(clickedSpawn.z)}).{' '}
                <button onClick={() => setClickedSpawn(null)}>Undo</button>
              </p>
            ) : (
              <p className="muted small">
                Pick your spawn area below, or for an exact spot press <strong>Set spawn</strong> on the
                map (or right-click it).
              </p>
            )}

            {zones.length > 0 && (
              <>
                <select
                  value={zoneIndex}
                  onChange={(e) => { setZoneIndex(Number(e.target.value)); setClickedSpawn(null); }}
                >
                  {zones.map((zone, i) => (
                    <option key={zone.infiltration} value={i}>
                      {zone.infiltration} ({zone.spawns.length} spawn points)
                    </option>
                  ))}
                </select>

                {plainExtracts.length > 0 && (
                  <section className="section">
                    <h3>Extracts from this spawn</h3>
                    <ul>
                      {plainExtracts.map((extract) => (
                        <li key={extract.name ?? ''}>{extractLabel(extract)}</li>
                      ))}
                    </ul>
                  </section>
                )}

                {restrictedExtracts.length > 0 && (
                  <details className="section">
                    <summary className="muted small">
                      {restrictedExtracts.length} conditional exit{restrictedExtracts.length === 1 ? '' : 's'} hidden
                      (scav routes, no-backpack and similar)
                    </summary>
                    <ul>
                      {restrictedExtracts.map((extract) => (
                        <li key={extract.name ?? ''}>
                          {extractLabel(extract)}
                          <span className="tag">{extractRestriction(extract)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}

            {transits.length > 0 && (
              <section className="section">
                <h3>Transit to other maps</h3>
                <ul>
                  {transits.map((transit, i) => <li key={i}>{transit.label}</li>)}
                </ul>
              </section>
            )}
          </div>

          {mode === 'loot' && (
            <LootRunPanel
              items={lootItems}
              chosen={lootWanted}
              onAdd={(item) => setLootWanted((current) =>
                current.some((c) => c.id === item.id) ? current : [...current, item])}
              onRemove={(id) => setLootWanted((current) => current.filter((c) => c.id !== id))}
              onClear={() => setLootWanted([])}
              spots={lootSpots.length}
              run={lootRun}
              limit={lootLimit}
              balance={lootBalance}
              onBalance={setLootBalance}
              onLimit={setLootLimit}
              keyNames={allItemNames}
              mapName={wikiMapName || mapName}
              hasSpawn={Boolean(routeStart)}
            />
          )}

          {mode === 'quests' && (
          <div className="panel">
            <h2>Quests</h2>
            <input
              value={query}
              placeholder={
                indexProgress
                  ? `Indexing quests ${indexProgress.done}/${indexProgress.total}...`
                  : mapQuestTitles.length
                    ? `Add a ${wikiMapName} quest...`
                    : 'Loading quest list...'
              }
              onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' && suggestions.length > 0) {
                  e.preventDefault();
                  setHighlight((h) => Math.min(suggestions.length - 1, h + 1));
                } else if (e.key === 'ArrowUp' && suggestions.length > 0) {
                  e.preventDefault();
                  setHighlight((h) => Math.max(0, h - 1));
                } else if (e.key === 'Enter' && query.trim() && suggestions.length > 0) {
                  e.preventDefault();
                  pickQuest(suggestions[Math.min(highlight, suggestions.length - 1)]);
                } else if (e.key === 'Escape') {
                  setQuery('');
                  setHighlight(0);
                }
              }}
              autoFocus
            />
            {suggestions.length > 0 && (
              <ul className="suggestions">
                {suggestions.map((title, i) => (
                  <li key={title} className={i === highlight ? 'active' : undefined}>
                    <button onClick={() => pickQuest(title)} onMouseEnter={() => setHighlight(i)}>{title}</button>
                  </li>
                ))}
              </ul>
            )}
            {query.trim().length > 1 && suggestions.length === 0 && mapQuestTitles.length > 0 && (
              <div className="muted small">
                No {wikiMapName} quest matches "{query.trim()}".
                {elsewhereMatches.length > 0 && (
                  <>
                    {' '}On other maps:
                    <ul className="suggestions">
                      {elsewhereMatches.map((match) => (
                        <li key={match.title}>
                          <button
                            onClick={() => {
                              const target = maps.find((m) => m.wikiName === match.map)?.normalizedName;
                              if (target) switchMap(target);
                              // Keeps the switch's Undo: this pick is part of that switch.
                              pickQuest(match.title, { keepUndo: true, page: target ?? mapName });
                            }}
                          >
                            {match.title}
                            {match.map && <span className="muted small"> · switch to {match.map}</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            {visibleSelectedQuests.length > 0 && (
              <ul className="chosen">
                {visibleSelectedQuests.map((title) => (
                  <li
                    key={title}
                    className={activeWiki === title ? 'active' : ''}
                    style={{ borderLeft: `4px solid ${questAccent(taskNameFor(title))}` }}
                  >
                    <button className="chosen-name" onClick={() => setActiveWiki(title)}>{title}</button>
                    {/* Adding something you have already done, or cannot start
                        yet, is worth saying rather than silently routing it. */}
                    {standingFor(title) === 'completed' && (
                      <span className="tag" title="Already marked finished in your progress">done</span>
                    )}
                    {standingFor(title) === 'locked' && (
                      <span className="tag" title="A prerequisite quest is not finished yet">locked</span>
                    )}
                    {standingFor(title) === 'too-low-level' && (
                      <span className="tag" title="Your level (set under Your progress) is below this quest's requirement">level</span>
                    )}
                    {unroutable.includes(title) && (
                      <span className="tag" title="No published objective coordinates on this map, so it is not drawn">no coords</span>
                    )}
                    <button
                      className="chosen-remove"
                      onClick={() => removeQuest(title)}
                      title={`Remove ${title}`}
                      aria-label={`Remove ${title}`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {gameLogs.lastImport && (
              <p className="backfill-note small">
                Marked {gameLogs.lastImport.count} quest{gameLogs.lastImport.count === 1 ? '' : 's'} finished
                from the game's logs.{' '}
                <button className="muted-button" onClick={() => setMode('settings')}>Details</button>
                {' · '}
                <button className="muted-button" onClick={gameLogs.dismissImport}>OK</button>
              </p>
            )}

            {gameLogs.wipePrompt && (
              <div className="catch-up">
                <p className="small">
                  {gameLogs.wipePrompt.manual ? 'Counting quests from ' : 'The game logs show a wipe on '}
                  <strong>{new Date(gameLogs.wipePrompt.at).toLocaleDateString()}</strong>.
                  {' '}{gameLogs.wipePrompt.extra} quest{gameLogs.wipePrompt.extra === 1 ? ' is' : 's are'} marked
                  finished here that the game has not seen you finish since.
                </p>
                <div className="catch-up-actions">
                  <button className="primary" onClick={() => gameLogs.resolveWipe(true)}>Match the game</button>
                  <button onClick={() => gameLogs.resolveWipe(false)}>Keep mine</button>
                </div>
              </div>
            )}

            {lastBackfill && (
              <p className="backfill-note small">
                Marked the {lastBackfill.ids.length} quest{lastBackfill.ids.length === 1 ? '' : 's'} before{' '}
                {lastBackfill.title} as finished.{' '}
                <button className="muted-button" onClick={undoBackfill}>Undo</button>
              </p>
            )}

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
                onEnabled={setShowLoot}
                radius={lootRadius}
                onRadius={setLootRadius}
                hasRoute={Boolean(route)}
                hidden={hiddenLoot}
                onToggleName={(name) => setHiddenLoot((current) =>
                  current.includes(name) ? current.filter((n) => n !== name) : [...current, name])}
                density={lootDensity}
                onDensity={setLootDensity}
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
                ? (lootRun ? lootRun.stops : fallbackStops)
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
            />
          ) : (
            <div className="panel"><p className="muted small">Loading map...</p></div>
          )}

          {mode === 'quests' && activeWiki && (
            <QuestGuide
              title={activeWiki}
              wikiUrl={wikiByTitle[activeWiki]?.wikiUrl}
              accent={questAccent(taskNameFor(activeWiki))}
              objectives={wikiByTitle[activeWiki]?.objectives ?? []}
              mapNames={allMapNames}
              currentMap={wikiMapName || null}
            />
          )}

          {mode === 'quests' && route && (
            <CurrentObjective route={route} selectedOrder={selectedOrder} onSelect={setSelectedOrder} />
          )}

          {mode === 'loot' && lootRun && lootRun.stops.length > 1 && (
            <RouteList route={{ stops: lootRun.stops, totalDistance: lootRun.totalDistance, unmappedObjectives: [] }} />
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

          {mode === 'quests' && selectedQuests.length > 0 && (
            <div className="panel finish-panel">
              <div>
                <h2>Done with this run?</h2>
                <p className="muted small">
                  Tick off what you finished and it is remembered, so the next run already knows.
                </p>
              </div>
              <button
                className="primary"
                onClick={() => { setFinishSession((n) => n + 1); setFinishOpen(true); }}
              >
                Finish run
              </button>
            </div>
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
