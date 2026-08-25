import type { Route } from '../lib/types';
import { questColor } from '../lib/questColor';

export default function RouteList({ route }: { route: Route }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Route</h2>
        <span className="muted">{Math.round(route.totalDistance)} m total</span>
      </div>

      <ol className="route">
        {route.stops.map((stop) => (
          <li key={`${stop.kind}-${stop.order}`} className={`route-step ${stop.kind}`}>
            <span
              className="badge"
              style={stop.kind === 'objective' && stop.questName
                ? { background: questColor(stop.questName) }
                : undefined}
            >
              {stop.kind === 'spawn' ? 'S'
                : stop.kind === 'extract' ? 'E'
                : stop.kind === 'switch' ? '⚡'
                : stop.order}
            </span>
            <div>
              {/* Quest name first: "Objective 3" on its own says nothing about
                  which quest the matching map dot belongs to. */}
              <div
                className="route-label"
                style={stop.questName ? { color: questColor(stop.questName) } : undefined}
              >
                {stop.questName ?? stop.label}
                {stop.optional && <span className="tag">optional</span>}
              </div>
              <div className="muted small">
                {stop.questName ? `${stop.label} · ` : ''}{stop.description}
                {stop.count !== null && stop.count !== undefined && stop.count > 1 && (
                  <span className="count-badge">×{stop.count}</span>
                )}
              </div>
              {stop.legDistance > 0 && (
                <div className="muted small">
                  {Math.round(stop.legDistance)} m from previous · {Math.round(stop.cumulativeDistance)} m cumulative
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>

      {route.unmappedObjectives.length > 0 && (
        <section className="section">
          <h3>Not on the map</h3>
          <p className="muted small">
            These objectives have no published coordinates, so they are not part of the drawn path.
          </p>
          <ul>
            {route.unmappedObjectives.map((o, i) => <li key={i}>{o.description}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
