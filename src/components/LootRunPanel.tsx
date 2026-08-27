import { useMemo, useState } from 'react';
import { searchItems, type ItemChoice, type LootRun } from '../lib/lootRun';

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
  /** Key item id -> name, for saying which key to bring. */
  keyNames: Record<string, string>;
  mapName: string;
  hasSpawn: boolean;
}

const LIMITS = [5, 10, 15, 20];

/**
 * A raid planned around one item instead of around quests.
 *
 * Says "possible" throughout rather than promising anything: the game's loose
 * loot lists what *can* appear at a spot, and a route that guarantees six of
 * something and delivers none is worse than no route at all.
 */
export default function LootRunPanel({
  items, chosen, onAdd, onRemove, onClear, spots, run, limit, onLimit, keyNames, mapName, hasSpawn,
}: Props) {
  const [query, setQuery] = useState('');
  const picked = useMemo(() => new Set(chosen.map((item) => item.id)), [chosen]);
  const suggestions = useMemo(
    () => searchItems(items, query).filter((item) => !picked.has(item.id)),
    [items, query, picked],
  );

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
                  {item.name}
                  <span className="muted small"> · {item.spots}</span>
                </span>
                <button className="chosen-remove" onClick={() => onRemove(item.id)} title="Remove">x</button>
              </li>
            ))}
          </ul>
          <p className="muted small">
            {spots} spot{spots === 1 ? '' : 's'} on {mapName} hold at least one of these
            {chosen.length > 1 && ', and the route prefers the ones holding several'}.
            {chosen.length > 1 && <> <button className="muted-button" onClick={onClear}>Clear all</button></>}
          </p>

          <section className="section">
            <h3>How many stops</h3>
            <div className="loot-radius">
              {LIMITS.map((count) => (
                <button key={count} className={limit === count ? 'active' : ''} onClick={() => onLimit(count)}>
                  {count}
                </button>
              ))}
            </div>
            {run && run.skipped > 0 && (
              <p className="muted small">
                The {run.stops.length - 1} closest to your spawn; {run.skipped} further away are left out.
              </p>
            )}
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
