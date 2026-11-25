import Fold from './Fold';
import { extractRestriction, type MapExtractInfo, type SpawnZone } from '../lib/mapData';
import type { Transit } from '../lib/useSpawnAndExtracts';
import type { Vec3 } from '../lib/types';

interface Props {
  clickedSpawn: Vec3 | null;
  onClearSpawn: () => void;
  zones: SpawnZone[];
  zoneIndex: number;
  onZone: (index: number) => void;
  activeZoneLabel: string | null;
  plainExtracts: MapExtractInfo[];
  restrictedExtracts: MapExtractInfo[];
  extractLabel: (extract: MapExtractInfo) => string;
  transits: Transit[];
}

/**
 * Where you spawn, and the exits open to you from there.
 *
 * Foldable, with the spawn in its header: once it is set, the extract lists
 * under it are reference, not something to work through.
 */
export default function SpawnPanel({
  clickedSpawn, onClearSpawn, zones, zoneIndex, onZone, activeZoneLabel,
  plainExtracts, restrictedExtracts, extractLabel, transits,
}: Props) {
  return (
    <Fold
      title="Your spawn"
      meta={clickedSpawn ? 'Clicked point' : activeZoneLabel ?? 'Not set'}
      storageKey="spawn"
    >
      {clickedSpawn ? (
        <p className="small">
          Set on the map at ({Math.round(clickedSpawn.x)}, {Math.round(clickedSpawn.z)}).{' '}
          <button className="muted-button" onClick={onClearSpawn}>Clear</button>
        </p>
      ) : (
        <p className="muted small">
          Pick your spawn area below, or right-click the map (or press <strong>Set spawn</strong>)
          for an exact spot.
        </p>
      )}

      {zones.length > 0 && (
        <>
          <select value={zoneIndex} onChange={(e) => onZone(Number(e.target.value))}>
            {zones.map((zone, i) => (
              <option key={zone.infiltration} value={i}>
                {zone.label} ({zone.spawns.length} spawn points)
              </option>
            ))}
          </select>

          {plainExtracts.length > 0 && (
            <p className="small extract-line">
              <span className="muted">Extracts: </span>
              {plainExtracts.map(extractLabel).join(' · ')}
            </p>
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
        <p className="small extract-line">
          <span className="muted">Transits: </span>
          {transits.map((transit) => transit.label.replace(/^Transit to /, '')).join(' · ')}
        </p>
      )}
    </Fold>
  );
}
