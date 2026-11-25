import type { MapIndexEntry } from '../lib/mapData';

interface Props {
  maps: MapIndexEntry[];
  mapName: string;
  onSwitch: (mapName: string) => void;
  /** The run the last map switch cleared, while it can still be brought back. */
  cleared: { mapName: string; count: number } | null;
  onUndoSwitch: () => void;
  /** The maps a multi-map run spans, in order; only shown with two or more. */
  pages: string[];
  mapDisplayName: (normalizedName: string) => string;
  snipers: { shown: boolean; count: number; onChange: (shown: boolean) => void };
  transits: { shown: boolean; count: number; onChange: (shown: boolean) => void };
}

/** The map dropdown, the run's page tabs and the map layer toggles. */
export default function MapPicker({
  maps, mapName, onSwitch, cleared, onUndoSwitch, pages, mapDisplayName, snipers, transits,
}: Props) {
  return (
    <div className="panel">
      <h2>Map</h2>
      <select value={mapName} onChange={(e) => onSwitch(e.target.value)}>
        {maps.map((m) => (
          <option key={m.normalizedName} value={m.normalizedName}>{m.wikiName}</option>
        ))}
      </select>
      {cleared && (
        <p className="backfill-note small">
          Cleared {cleared.count} quest{cleared.count === 1 ? '' : 's'} from{' '}
          {mapDisplayName(cleared.mapName)}.{' '}
          <button className="muted-button" onClick={onUndoSwitch}>Undo</button>
        </p>
      )}
      {pages.length > 1 && (
        <div className="page-tabs">
          {pages.map((p, i) => (
            <button key={p} className={p === mapName ? 'active' : ''} onClick={() => onSwitch(p)}>
              {i + 1}. {mapDisplayName(p)}
            </button>
          ))}
        </div>
      )}
      <label className="toggle">
        <input type="checkbox" checked={snipers.shown} onChange={(e) => snipers.onChange(e.target.checked)} />
        Show sniper scavs ({snipers.count})
      </label>
      {transits.count > 0 && (
        <label className="toggle">
          <input type="checkbox" checked={transits.shown} onChange={(e) => transits.onChange(e.target.checked)} />
          Show transits ({transits.count})
        </label>
      )}
    </div>
  );
}
