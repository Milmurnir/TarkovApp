import type { Route, RouteStop } from '../lib/types';
import { questColor } from '../lib/questColor';

interface Props {
  route: Route;
  selectedOrder: number | null;
  onSelect: (order: number | null) => void;
}

/**
 * The stop you are heading to right now, laid over the map's corner.
 *
 * It used to be a panel below the map, which put it a scroll away from the
 * dots it describes: mid-raid you looked at the map, then scrolled down to
 * read what the dot meant. Over the map it stays in view with the route, so
 * it is kept to what you need at a glance -- what, where next, how far.
 */
export default function CurrentObjective({ route, selectedOrder, onSelect }: Props) {
  const index = route.stops.findIndex((s) => s.order === selectedOrder);
  if (index === -1) {
    return (
      <div className="map-objective idle">
        <span className="muted small">Click a dot or press → to follow the route.</span>
        {route.stops.length > 0 && (
          <button className="primary" onClick={() => onSelect(route.stops[0].order)}>Start</button>
        )}
      </div>
    );
  }

  const current = route.stops[index];
  const previous = route.stops[index - 1] ?? null;
  const next = route.stops[index + 1] ?? null;
  const remaining = route.totalDistance - current.cumulativeDistance;
  const accent = current.questName ? questColor(current.questName) : null;

  return (
    <div className="map-objective" style={accent ? { borderTopColor: accent } : undefined}>
      <div className="map-objective-head">
        <span className={`badge ${current.kind}`} style={accent ? { background: accent } : undefined}>
          {glyph(current)}
        </span>
        {/* The quest name leads: the dot you clicked is colour-coded per quest,
            and "Objective 1" alone never said which quest that was. */}
        <div className="map-objective-title">
          <div className="route-label" style={accent ? { color: accent } : undefined}>
            {title(current)}
            {current.optional && <span className="tag">optional</span>}
          </div>
          {current.questName && <div className="muted small">{current.label}</div>}
        </div>
        <div className="current-nav">
          <span className="muted small">{index + 1}/{route.stops.length}</span>
          <button
            onClick={() => previous && onSelect(previous.order)}
            disabled={!previous}
            title="Previous stop (←)"
            aria-label="Previous stop"
          >
            ←
          </button>
          <button
            className="primary"
            onClick={() => next && onSelect(next.order)}
            disabled={!next}
            title="Next stop (→)"
            aria-label="Next stop"
          >
            →
          </button>
          <button onClick={() => onSelect(null)} title="Stop following the route" aria-label="Clear">×</button>
        </div>
      </div>

      <p className="small map-objective-text">
        {current.description}
        {/* Three of a thing in one spot is three trips, not one. */}
        {current.count !== null && current.count !== undefined && current.count > 1 && (
          <span className="count-badge">×{current.count}</span>
        )}
      </p>

      {current.keys && current.keys.length > 0 && (
        <p className="small map-objective-text">
          <span className="muted">Key: </span>{current.keys.join(', ')}
        </p>
      )}

      <p className="muted small map-objective-text">
        {Math.round(current.legDistance)} m in · {Math.round(remaining)} m to the end
      </p>

      {next ? (
        <button className="next-step" onClick={() => onSelect(next.order)}>
          <span
            className={`badge ${next.kind}`}
            style={next.questName ? { background: questColor(next.questName) } : undefined}
          >
            {glyph(next)}
          </span>
          <span className="small">
            <span className="muted">Next: </span>
            <strong>{title(next)}</strong>
            <span className="muted"> · {Math.round(next.legDistance)} m</span>
          </span>
        </button>
      ) : (
        <p className="muted small map-objective-text">The route ends here.</p>
      )}
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
