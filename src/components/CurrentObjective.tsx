import type { Route, RouteStop } from '../lib/types';
import { questColor } from '../lib/questColor';

interface Props {
  route: Route;
  selectedOrder: number | null;
  onSelect: (order: number | null) => void;
}

/**
 * The stop you are heading to right now, with whatever comes next after it.
 * Selected by clicking a dot on the map or a step in the route list.
 */
export default function CurrentObjective({ route, selectedOrder, onSelect }: Props) {
  const index = route.stops.findIndex((s) => s.order === selectedOrder);
  if (index === -1) {
    return (
      <div className="panel">
        <h2>Current objective</h2>
        <p className="muted small">Click a dot on the map to set what you are doing now.</p>
      </div>
    );
  }

  const current = route.stops[index];
  const next = route.stops[index + 1] ?? null;
  const remaining = route.totalDistance - current.cumulativeDistance;
  const accent = current.questName ? questColor(current.questName) : null;

  return (
    <div
      className="panel current"
      style={accent ? { borderTopColor: accent, borderTopWidth: 3 } : undefined}
    >
      <div className="panel-head">
        <h2>Current objective</h2>
        <button onClick={() => onSelect(null)}>Clear</button>
      </div>

      <div className="current-body">
        <span className={`badge big ${current.kind}`} style={accent ? { background: accent } : undefined}>
          {glyph(current)}
        </span>
        <div>
          {/* The quest name leads: the dot you clicked is colour-coded per quest,
              and "Objective 1" alone never said which quest that was. */}
          <div className="route-label" style={accent ? { color: accent } : undefined}>
            {title(current)}
            {current.optional && <span className="tag">optional</span>}
          </div>
          {current.questName && <div className="muted small">{current.label}</div>}
          <p className="small">{current.description}</p>
        </div>
      </div>

      <dl className="facts">
        <dt>Distance in</dt>
        <dd>{Math.round(current.legDistance)} m from the previous stop</dd>
        <dt>Remaining</dt>
        <dd>{Math.round(remaining)} m to the end of the route</dd>
      </dl>

      {current.keys && current.keys.length > 0 && (
        <section className="section">
          <h3>Key for this stop</h3>
          <ul>{current.keys.map((key) => <li key={key}>{key}</li>)}</ul>
        </section>
      )}

      <section className="section">
        <h3>Next up</h3>
        {next ? (
          <button className="next-step" onClick={() => onSelect(next.order)}>
            <span
              className={`badge ${next.kind}`}
              style={next.questName ? { background: questColor(next.questName) } : undefined}
            >
              {glyph(next)}
            </span>
            <span>
              <strong>{title(next)}</strong>
              <span className="muted small"> · {Math.round(next.legDistance)} m further</span>
              <br />
              <span className="muted small">
                {next.questName ? `${next.label} · ` : ''}{next.description}
              </span>
            </span>
          </button>
        ) : (
          <p className="muted small">Nothing after this: the route ends here.</p>
        )}
      </section>
    </div>
  );
}

/** Quest name for objective stops; spawn, switch and extract keep their own name. */
function title(stop: RouteStop): string {
  return stop.questName ?? stop.label;
}

function glyph(stop: RouteStop): string {
  if (stop.kind === 'spawn') return 'S';
  if (stop.kind === 'extract') return 'E';
  if (stop.kind === 'switch') return '⚡';
  return String(stop.order);
}
