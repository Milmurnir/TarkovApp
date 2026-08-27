import { useMemo, useState } from 'react';
import { searchItems, stopChoices, type ItemChoice, type LootRun } from '../lib/lootRun';

interface Props {
  items: ItemChoice[];
  chosen: ItemChoice[];
  onAdd: (item: ItemChoice) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  /** Spots holding at least one of the chosen items. */
  spots: number;
  run: LootRun | null;
  limit: number;
  onLimit: (limit: number) => void;
  /** 0 walks the shortest way, 1 chases the best odds. */
  balance: number;
  onBalance: (balance: number) => void;
  /** Key item id -> name, for saying which key to bring. */
  keyNames: Record<string, string>;
  mapName: string;
  hasSpawn: boolean;
}

/** What the balance slider is doing, in words, so the number is not the only clue. */
function balanceReads(balance: number): string {
  if (balance <= 0.05) return 'the shortest walk, whatever the odds are';
  if (balance < 0.4) return 'a short walk, odds only breaking ties';
  if (balance <= 0.6) return 'odds and walking distance, evenly';
  if (balance < 0.95) return 'the better odds, walking further for them';
  return 'the best odds on the map, however far they are';
}

/**
 * A raid planned around one item instead of around quests.
 *
 * Says "possible" throughout rather than promising anything: the game's loose
 * loot lists what *can* appear at a spot, and a route that guarantees six of
 * something and delivers none is worse than no route at all.
 */
export default function LootRunPanel({
  items, chosen, onAdd, onRemove, onClear, spots, run, limit, onLimit,
  balance, onBalance, keyNames, mapName, hasSpawn,
}: Props) {
  const [query, setQuery] = useState('');
  const picked = useMemo(() => new Set(chosen.map((item) => item.id)), [chosen]);
  const suggestions = useMemo(
    () => searchItems(items, query).filter((item) => !picked.has(item.id)),
    [items, query, picked],
  );

  const choices = useMemo(() => stopChoices(spots), [spots]);
  // The slider indexes the rungs rather than carrying the count itself, so a
  // limit left over from a bigger map settles on the nearest rung that fits.
  const chosenStop = useMemo(() => {
    const index = choices.findIndex((count) => count >= limit);
    return index < 0 ? choices.length - 1 : index;
  }, [choices, limit]);
  const stopCount = choices[chosenStop];

  if (items.length === 0) {
    return (
      <div className="panel">
        <h2>Loot run</h2>
        <p className="muted small">
          No loose loot data for {mapName} yet. It arrives with the map data on the next load.
        </p>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Loot run</h2>
        <span className="muted small">{items.length} items here</span>
      </div>

      <p className="muted small">
        Pick what you are after and the route goes where it can spawn. Quests are ignored here.
      </p>

      <input
        value={query}
        placeholder="Search an item..."
        onChange={(event) => setQuery(event.target.value)}
      />
      {suggestions.length > 0 && (
        <ul className="suggestions">
          {suggestions.map((item) => (
            <li key={item.id}>
              <button onClick={() => { onAdd(item); setQuery(''); }}>
                {item.name}
                {/* The short name is how it reads in your stash, so show it
                    when it is the thing you would have searched for. */}
                {item.short && <span className="muted"> ({item.short})</span>}
                <span className="muted small"> · {item.spots} spot{item.spots === 1 ? '' : 's'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim().length > 1 && suggestions.length === 0 && (
        <p className="muted small">Nothing else on {mapName} matches "{query.trim()}".</p>
      )}

      {chosen.length > 0 && (
        <>
          <ul className="chosen">
            {chosen.map((item) => (
              <li key={item.id}>
                <span className="chosen-name">
                  {item.short ?? item.name}
                  <span className="muted small"> · {item.spots}</span>
                </span>
                <button className="chosen-remove" onClick={() => onRemove(item.id)} title="Remove">x</button>
              </li>
            ))}
          </ul>
          <p className="muted small">
            {spots} spot{spots === 1 ? '' : 's'} on {mapName} can hold at least one of these.
            {chosen.length > 1 && <> <button className="muted-button" onClick={onClear}>Clear all</button></>}
          </p>

          <section className="section">
            <h3>How many stops</h3>
            <label className="density-row">
              <input
                type="range"
                min={0}
                max={choices.length - 1}
                value={chosenStop}
                onChange={(event) => onLimit(choices[Number(event.target.value)])}
              />
              <span className="small">
                {Number.isFinite(stopCount)
                  ? <><strong>{stopCount}</strong> stop{stopCount === 1 ? '' : 's'}</>
                  : <><strong>all {spots}</strong></>}
              </span>
            </label>
            {run && run.skipped > 0 && (
              <p className="muted small">
                The best {run.stops.length - 1} of {spots}. The other {run.skipped} are worse
                odds, further out, or both.
              </p>
            )}
            {run && run.skipped === 0 && run.stops.length > 25 && (
              <p className="muted small">
                Every spot on the map, ordered as short a walk as it can manage. That is a
                lot of ground for one raid.
              </p>
            )}
          </section>

          <section className="section">
            <h3>What to chase</h3>
            <label className="density-row">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(balance * 100)}
                onChange={(event) => onBalance(Number(event.target.value) / 100)}
              />
              <span className="small">{Math.round(balance * 100)}% odds</span>
            </label>
            <p className="muted small">
              Picks {balanceReads(balance)}. A spot's odds are how often it really holds one of
              these; distance is measured from your spawn, half-weighted once you are past the
              average spot.
            </p>
          </section>

          {!hasSpawn && (
            <p className="error small">
              Set a spawn point on the map first — the route has to start somewhere.
            </p>
          )}

          {run && run.keys.length > 0 && (
            <section className="section">
              <h3>Bring a key</h3>
              <ul>
                {run.keys.map(({ id, stops }) => (
                  <li key={id}>
                    {keyNames[id] ?? 'Unknown key'}
                    <span className="muted small"> · near {stops} stop{stops === 1 ? '' : 's'}</span>
                  </li>
                ))}
              </ul>
              {/* Proximity, not certainty: the data gives lock positions, not
                  which room a spawn sits in. */}
              <p className="muted small">
                These locks are close to stops on the route. Whether one is actually between you and
                the loot is not something the map data says, so treat it as a warning rather than a
                shopping list.
              </p>
            </section>
          )}

          {run && run.stops.length > 1 && (
            <p className="muted small">
              {Math.round(run.totalDistance)} m in total. These are possible spawns, not guaranteed
              ones — the game rolls what appears each raid.
            </p>
          )}
        </>
      )}
    </div>
  );
}
