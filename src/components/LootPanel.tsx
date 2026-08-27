import { countByName, DENSITY_RADIUS, type PlacedContainer } from '../lib/loot';
import { lootGroups, lootLook } from '../lib/lootIcons';

interface Props {
  /** Every container on this map, already measured against the route. */
  containers: PlacedContainer[];
  /** Those left after the current filters, which is what the map draws. */
  shown: PlacedContainer[];
  enabled: boolean;
  onEnabled: (on: boolean) => void;
  /** Metres from the route, or null for "anywhere on the map". */
  radius: number | null;
  onRadius: (radius: number | null) => void;
  hasRoute: boolean;
  /** Container names switched off; everything else is drawn. */
  hidden: string[];
  onToggleName: (name: string) => void;
  /** Neighbours a container needs nearby before it is drawn at all. */
  density: number;
  onDensity: (density: number) => void;
}

const RADII = [15, 30, 50, 100];

/**
 * Which loot to draw.
 *
 * Five hundred containers on one map is wallpaper. The distance filter is what
 * turns it into something usable: the ones you pass anyway.
 */
export default function LootPanel({
  containers, shown, enabled, onEnabled, radius, onRadius, hasRoute, hidden, onToggleName,
  density, onDensity,
}: Props) {
  if (containers.length === 0) return null;

  // Counted before the name filter, so a type's number does not vanish when you
  // switch it off and you can find it again. With no route there is nothing to
  // be near, so the radius sits inert rather than emptying the list.
  const inRange = radius === null || !hasRoute
    ? containers
    : containers.filter((container) => container.fromRoute <= radius);

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Loot</h2>
        <span className="muted small">{shown.length} of {containers.length} shown</span>
      </div>

      <label className="toggle">
        <input type="checkbox" checked={enabled} onChange={(event) => onEnabled(event.target.checked)} />
        Show loot containers
      </label>

      {enabled && (
        <>
          <section className="section">
            <h3>Near the route</h3>
            {hasRoute ? (
              <div className="loot-radius">
                {RADII.map((metres) => (
                  <button
                    key={metres}
                    className={radius === metres ? 'active' : ''}
                    onClick={() => onRadius(metres)}
                  >
                    {metres} m
                  </button>
                ))}
                <button className={radius === null ? 'active' : ''} onClick={() => onRadius(null)}>
                  Anywhere
                </button>
              </div>
            ) : (
              <p className="muted small">Pick some quests first and the route becomes the filter.</p>
            )}
          </section>

          <section className="section">
            <h3>Density</h3>
            <label className="density-row">
              <input
                type="range"
                min={1}
                max={12}
                value={density}
                onChange={(event) => onDensity(Number(event.target.value))}
              />
              <span className="small">
                {density === 1
                  ? 'every container'
                  : <>at least <strong>{density}</strong> within {DENSITY_RADIUS} m</>}
              </span>
            </label>
            <p className="muted small">
              A lone cupboard is rarely worth the detour; six in one room is.
            </p>
          </section>

          <section className="section">
            <h3>Kinds</h3>
            <ul className="loot-kinds">
              {countByName(inRange).map(({ name, count }) => (
                <li key={name}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!hidden.includes(name)}
                      onChange={() => onToggleName(name)}
                    />
                    <span className="loot-swatch" style={{ background: lootLook(name).colour }} />
                    <span className="loot-name">{name}</span>
                    <span className="muted small">{count}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>

          <section className="section">
            <h3>On the map</h3>
            <ul className="loot-legend">
              {lootGroups().map((look) => (
                <li key={look.shape}>
                  <span className="loot-swatch" style={{ background: look.colour }} />
                  <span className="muted small">{look.group}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
