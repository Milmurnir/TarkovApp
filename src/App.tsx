import { useEffect, useMemo, useState } from 'react';
import MapView from './components/MapView';
import RequirementsPanel from './components/RequirementsPanel';
import RouteList from './components/RouteList';
import CurrentObjective from './components/CurrentObjective';
import RouteRequirements from './components/RouteRequirements';
import QuestGuide from './components/QuestGuide';
import UpdateNotice from './components/UpdateNotice';
import { buildRoute } from './lib/route';
import { JsonApiError, fetchMapSlice, type MapSlice } from './lib/jsonApi';
import { fetchQuest, fetchQuestList, searchQuests } from './lib/wiki';
import { fetchQuestIndex, questsForMap, type QuestIndex } from './lib/questIndex';
import {
  extractDisplayName, extractRestriction, extractsForSpawn, fetchMapData, fetchMapIndex,
  isPlainPmcExtract, spawnZones,
  type MapData, type MapExtractInfo, type MapIndexEntry, type MapSpawnPoint,
} from './lib/mapData';
import type { Task, Vec3, WikiQuest } from './lib/types';
import { questAccent } from './lib/questColor';

const DEFAULT_MAP = 'streets-of-tarkov';

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export default function App() {
  const [maps, setMaps] = useState<MapIndexEntry[]>([]);
  const [mapName, setMapName] = useState(DEFAULT_MAP);
  const [mapData, setMapData] = useState<MapData | null>(null);

  const [questTitles, setQuestTitles] = useState<string[]>([]);
  const [questIndex, setQuestIndex] = useState<QuestIndex | null>(null);
  const [indexProgress, setIndexProgress] = useState<{ done: number; total: number } | null>(null);
  const [query, setQuery] = useState('');
  /** Quests currently routed together, by wiki title. */
  const [selectedQuests, setSelectedQuests] = useState<string[]>([]);
  const [wikiByTitle, setWikiByTitle] = useState<Record<string, WikiQuest>>({});
  const [activeWiki, setActiveWiki] = useState<string | null>(null);
  const [showSnipers, setShowSnipers] = useState(true);
  const [wikiError, setWikiError] = useState<string | null>(null);
  const [loadingQuest, setLoadingQuest] = useState(false);

  const [api, setApi] = useState<MapSlice | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [zoneIndex, setZoneIndex] = useState(0);
  /** Spawn placed by clicking the map; takes priority over the zone list. */
  const [clickedSpawn, setClickedSpawn] = useState<Vec3 | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<number | null>(null);

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
    setClickedSpawn(null);
    setSelectedOrder(null);
    setZoneIndex(0);
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

  const currentMap = maps.find((m) => m.normalizedName === mapName) ?? null;
  const wikiMapName = currentMap?.wikiName ?? mapData?.wikiName ?? '';

  const mapQuestTitles = useMemo(() => {
    if (!questIndex || !wikiMapName) return questTitles;
    return questsForMap(questIndex, wikiMapName).map((entry) => entry.title);
  }, [questIndex, questTitles, wikiMapName]);

  const suggestions = useMemo(
    () => searchQuests(mapQuestTitles, query).filter((t) => !selectedQuests.includes(t)),
    [mapQuestTitles, query, selectedQuests],
  );

  function pickQuest(title: string) {
    setQuery('');
    setWikiError(null);
    setSelectedOrder(null);
    setActiveWiki(title);
    setSelectedQuests((current) => (current.includes(title) ? current : [...current, title]));

    if (wikiByTitle[title]) return;
    setLoadingQuest(true);
    fetchQuest(title)
      .then((quest) => setWikiByTitle((current) => ({ ...current, [title]: quest })))
      .catch((error) => setWikiError(String(error.message ?? error)))
      .finally(() => setLoadingQuest(false));
  }

  function removeQuest(title: string) {
    setSelectedQuests((current) => current.filter((t) => t !== title));
    setActiveWiki((current) => (current === title ? null : current));
    setSelectedOrder(null);
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

  const apiSpawns = useMemo(() => api?.spawns ?? [], [api]);

  /**
   * Only Streets tags a 'sniper' category in the API, so the generated data
   * (derived from marksman waves) is the source that covers every map.
   */
  const sniperSpawns = useMemo(() => {
    if (mapData?.sniperSpawns?.length) return mapData.sniperSpawns;
    return api?.sniperSpawns ?? [];
  }, [mapData, api]);
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

  /** Where the route starts: the clicked point, else the selected spawn zone. */
  const routeStart = useMemo(() => {
    if (clickedSpawn) return { position: clickedSpawn, zoneName: 'Clicked spawn' };
    if (apiSpawns.length > 0) {
      const spawn = apiSpawns[0];
      return { position: spawn.position, zoneName: spawn.zoneName };
    }
    if (zoneCentre) return { position: zoneCentre.position, zoneName: zoneCentre.zoneName };
    return null;
  }, [clickedSpawn, apiSpawns, zoneCentre]);

  const route = useMemo(() => {
    if (tasks.length === 0 || !api || !routeStart) return null;
    return buildRoute(tasks, routeStart, routableExtracts, mapName);
  }, [tasks, api, routeStart, routableExtracts, mapName]);

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



  return (
    <div className="app">
      <header>
        <h1>Tarkov Quest Router</h1>
        <span className="muted">quests from the EFT wiki · coordinates from json.tarkov.dev · spawns from SPT</span>
        <UpdateNotice />
      </header>

      <div className="layout">
        <aside>
          <div className="panel">
            <h2>Map</h2>
            <select
              value={mapName}
              onChange={(e) => { setMapName(e.target.value); setSelectedQuests([]); setActiveWiki(null); setQuery(''); }}
            >
              {maps.map((m) => (
                <option key={m.normalizedName} value={m.normalizedName}>{m.wikiName}</option>
              ))}
            </select>
            <label className="toggle">
              <input type="checkbox" checked={showSnipers} onChange={(e) => setShowSnipers(e.target.checked)} />
              Show sniper scavs ({sniperSpawns.length})
            </label>
          </div>

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
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {suggestions.length > 0 && (
              <ul className="suggestions">
                {suggestions.map((title) => (
                  <li key={title}><button onClick={() => pickQuest(title)}>{title}</button></li>
                ))}
              </ul>
            )}
            {query.trim().length > 1 && suggestions.length === 0 && mapQuestTitles.length > 0 && (
              <p className="muted small">No {wikiMapName} quest matches "{query.trim()}".</p>
            )}

            {selectedQuests.length > 0 && (
              <ul className="chosen">
                {selectedQuests.map((title) => (
                  <li
                    key={title}
                    className={activeWiki === title ? 'active' : ''}
                    style={{ borderLeft: `4px solid ${questAccent(taskNameFor(title))}` }}
                  >
                    <button className="chosen-name" onClick={() => setActiveWiki(title)}>{title}</button>
                    {unroutable.includes(title) && <span className="tag">no coords</span>}
                    <button className="chosen-remove" onClick={() => removeQuest(title)} title="Remove">x</button>
                  </li>
                ))}
              </ul>
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

          <div className="panel">
            <h2>Your spawn</h2>

            {clickedSpawn ? (
              <p className="small">
                Set by clicking the map at ({Math.round(clickedSpawn.x)}, {Math.round(clickedSpawn.z)}).{' '}
                <button onClick={() => setClickedSpawn(null)}>Undo</button>
              </p>
            ) : (
              <p className="muted small">Click anywhere on the map to drop your spawn point.</p>
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
          </div>

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

          {activeWiki && wikiByTitle[activeWiki] && (
            <RequirementsPanel
              wiki={wikiByTitle[activeWiki]}
              task={tasks.find((t) => normalize(t.normalizedName) === normalize(activeWiki)) ?? null}
            />
          )}
        </aside>

        <main>
          {mapData ? (
            <MapView
              svgUrl={mapData.svg}
              viewBox={mapData.viewBox}
              projection={mapData.projection}
              stops={route ? route.stops : fallbackStops}
              labels={mapData.labels}
              spawnPoints={activeZone ? activeZone.spawns.map((sp) => ({ x: sp.position.x, z: sp.position.z })) : []}
              sniperSpawns={showSnipers ? sniperSpawns : []}
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

          {route && (
            <CurrentObjective route={route} selectedOrder={selectedOrder} onSelect={setSelectedOrder} />
          )}

          <RouteRequirements
            quests={selectedWiki}
            activeTitle={activeWiki}
            onSelect={(title) => setActiveWiki(title)}
            colorOf={(title) => questAccent(taskNameFor(title))}
          />

          {activeWiki && (
            <QuestGuide
              title={activeWiki}
              wikiUrl={wikiByTitle[activeWiki]?.wikiUrl}
              accent={questAccent(taskNameFor(activeWiki))}
            />
          )}

          {route && <RouteList route={route} />}

          {unroutable.length > 0 && api && (
            <div className="panel warn">
              <p className="small">
                No published objective coordinates for: {unroutable.join(', ')}. These are not drawn on
                the map; their requirements still show on the left.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
