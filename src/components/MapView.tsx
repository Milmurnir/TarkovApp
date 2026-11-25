import { useEffect, useRef, useState, type ReactNode } from 'react';
import { gameToSvg, svgToGame, type MapProjection, type MapViewBox } from '../lib/mapgeo';
import type { RouteStop, Vec3 } from '../lib/types';
import type { MapLabel } from '../lib/mapData';
import type { PlacedContainer } from '../lib/loot';
import { lootLook, type LootShape } from '../lib/lootIcons';
import { questColor } from '../lib/questColor';

interface Props {
  /** Which map to draw, and how to place points on it. */
  svgUrl: string;
  viewBox: MapViewBox;
  projection: MapProjection;
  stops: RouteStop[];
  labels?: MapLabel[];
  /** Every candidate spawn point, drawn faintly for context. */
  spawnPoints?: { x: number; z: number }[];
  /** Sniper scav positions, drawn as danger markers. */
  sniperSpawns?: { zoneName: string | null; position: Vec3 }[];
  /** Transit points to another map, e.g. the Woods exit into Reserve. */
  transits?: { position: Vec3; label: string }[];
  /** Loot containers to draw, already filtered by the loot panel. */
  lootContainers?: PlacedContainer[];
  /** Called with game coordinates when the map itself is clicked. */
  onPickSpawn?: (position: Vec3) => void;
  /** Called when a route marker is clicked. */
  onSelectStop?: (stop: RouteStop) => void;
  selectedOrder?: number | null;
  /** Quest whose dots should stand out; others are dimmed. */
  highlightQuest?: string | null;
  /** Multiplier on the spawn/objective/switch/extract markers, from Settings. */
  routeIconScale?: number;
  /** Laid over the map's corner, outside the pan/zoom handling (the current objective). */
  overlay?: ReactNode;
  /** Extra buttons at the right end of the toolbar (Finish run). */
  actions?: ReactNode;
}

const COLORS: Record<RouteStop['kind'], string> = {
  spawn: '#4ade80',
  objective: '#fbbf24',
  extract: '#60a5fa',
  switch: '#c084fc',
};

/** Short glyph shown inside a marker. */
function markerLabel(stop: RouteStop): string {
  if (stop.kind === 'spawn') return 'S';
  if (stop.kind === 'extract') return 'E';
  if (stop.kind === 'switch') return '⚡';
  return String(stop.order);
}

/** Pointer travel beyond this many pixels counts as a drag, not a click. */
const DRAG_THRESHOLD = 5;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;

interface View {
  zoom: number;
  pan: { x: number; y: number };
}

/**
 * Zooms to `nextZoom` keeping the map point under `anchor` (viewport pixels,
 * relative to its centre) where it is. The SVG scales about its own centre,
 * so a screen point s shows local point (s - pan) / zoom; holding that fixed
 * gives the new pan.
 */
function zoomAbout(view: View, nextZoom: number, anchor: { x: number; y: number }): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
  const ratio = zoom / view.zoom;
  return {
    zoom,
    pan: {
      x: anchor.x - ratio * (anchor.x - view.pan.x),
      y: anchor.y - ratio * (anchor.y - view.pan.y),
    },
  };
}

export default function MapView({
  svgUrl, viewBox, projection,
  stops, labels = [], spawnPoints = [], sniperSpawns = [], transits = [], lootContainers = [],
  onPickSpawn, onSelectStop, selectedOrder = null, highlightQuest = null, routeIconScale = 1, overlay, actions,
}: Props) {
  const [view, setView] = useState<View>({ zoom: 1, pan: { x: 0, y: 0 } });
  const { zoom, pan } = view;
  /** Armed by the "Set spawn" button: the next plain click drops the spawn. */
  const [placing, setPlacing] = useState(false);
  const dragging = useRef<{ x: number; y: number } | null>(null);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // React attaches wheel listeners as passive, so preventDefault there is
  // rejected and the page scrolls while zooming. Bind it natively instead.
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;

    // Plain scroll zooms, toward the cursor, as on every other map. It used to
    // need ctrl, so the obvious gesture scrolled the page out from under the
    // map instead; the map now fills the window, so there is nothing to scroll.
    const onWheelNative = (event: WheelEvent) => {
      event.preventDefault();
      const box = node.getBoundingClientRect();
      const anchor = {
        x: event.clientX - box.left - box.width / 2,
        y: event.clientY - box.top - box.height / 2,
      };
      setView((current) => zoomAbout(current, current.zoom * (event.deltaY < 0 ? 1.15 : 0.87), anchor));
    };

    node.addEventListener('wheel', onWheelNative, { passive: false });
    return () => node.removeEventListener('wheel', onWheelNative);
  }, []);

  const points = stops.map((s) => ({ ...gameToSvg(s.position, projection, viewBox), stop: s }));
  const polyline = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  /**
   * Undoes the zoom for the marks laid over the map.
   *
   * Everything lives inside one scaled SVG, so a marker at zoom 8 was drawn
   * eight times the size and four stops in one building turned into a stack of
   * overlapping discs covering the street they were meant to point at. Their
   * size says nothing about the map -- it is just how big a thing has to be to
   * be clickable -- so they hold their screen size and let the map grow past
   * them, which is also what the route line already does with its stroke.
   */
  const pin = `scale(${(1 / zoom).toFixed(4)})`;
  /** Same idea as `pin`, but also carries the Settings size preference. */
  const routePin = `scale(${(routeIconScale / zoom).toFixed(4)})`;

  /** Screen pixel -> SVG user units, accounting for the current zoom and pan. */
  function toSvgPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }

  function onPointerDown(event: React.PointerEvent) {
    // Middle-click normally triggers the browser's autoscroll cursor; that has
    // nothing to do with placing a spawn, so it is swallowed here.
    if (event.button === 1) event.preventDefault();
    dragging.current = { x: event.clientX - pan.x, y: event.clientY - pan.y };
    pressOrigin.current = { x: event.clientX, y: event.clientY };
    (event.target as Element).setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!dragging.current) return;
    const origin = dragging.current;
    setView((current) => ({ ...current, pan: { x: event.clientX - origin.x, y: event.clientY - origin.y } }));
  }

  function onPointerUp(event: React.PointerEvent) {
    const origin = pressOrigin.current;
    dragging.current = null;
    pressOrigin.current = null;
    if (!origin || !onPickSpawn) return;
    // Left-click normally pans and clicks markers, so an ordinary click never
    // relocates the spawn by accident -- unless "Set spawn" was armed first.
    // Right-click is the documented way (see onContextMenu); middle-click
    // quietly does the same, since older versions taught it.
    const armedLeft = placing && event.button === 0;
    if (event.button !== 1 && !armedLeft) return;

    // Ignore the pointer-up that ends a pan.
    const travel = Math.hypot(event.clientX - origin.x, event.clientY - origin.y);
    if (travel > DRAG_THRESHOLD) return;

    placeSpawnAt(event.clientX, event.clientY);
  }

  function placeSpawnAt(clientX: number, clientY: number) {
    if (!onPickSpawn) return;
    const local = toSvgPoint(clientX, clientY);
    if (!local) return;
    onPickSpawn(svgToGame(local, projection, viewBox));
    setPlacing(false);
  }

  // Esc backs out of placing mode without dropping anything.
  useEffect(() => {
    if (!placing) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setPlacing(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [placing]);

  return (
    <div className="map-shell">
      <div className="map-controls">
        <button aria-label="Zoom in" title="Zoom in" onClick={() => setView((v) => zoomAbout(v, v.zoom * 1.3, { x: 0, y: 0 }))}>+</button>
        <button aria-label="Zoom out" title="Zoom out" onClick={() => setView((v) => zoomAbout(v, v.zoom / 1.3, { x: 0, y: 0 }))}>−</button>
        <button onClick={() => setView({ zoom: 1, pan: { x: 0, y: 0 } })}>Reset</button>
        {onPickSpawn && (
          <button
            className={placing ? 'primary' : ''}
            aria-pressed={placing}
            onClick={() => setPlacing((p) => !p)}
          >
            {placing ? 'Click where you spawned… (Esc)' : 'Set spawn'}
          </button>
        )}
        <span className="hint">right-click sets spawn · scroll to zoom · drag to pan</span>
        {actions}
      </div>

      <div className="map-stage">
      <div
        className={placing ? 'map-viewport placing' : 'map-viewport'}
        ref={viewportRef}
        onContextMenu={(event) => {
          event.preventDefault();
          placeSpawnAt(event.clientX, event.clientY);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => { dragging.current = null; pressOrigin.current = null; }}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
          className="map-svg"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          <image href={svgUrl} x="0" y="0" width={viewBox.width} height={viewBox.height} />

          {labels.map((label, i) => {
            const p = gameToSvg({ x: label.x, y: 0, z: label.z }, projection, viewBox);
            return (
              <text
                key={`label-${i}`}
                x={p.x}
                y={p.y}
                textAnchor="middle"
                fontSize={Math.max(6, viewBox.width / 90)}
                fill="#93a4bb"
                opacity={0.85}
                style={{ pointerEvents: 'none' }}
              >
                {label.text}
              </text>
            );
          })}

          {spawnPoints.map((spawn, i) => {
            const p = gameToSvg({ x: spawn.x, y: 0, z: spawn.z }, projection, viewBox);
            return (
              <circle key={`sp-${i}`} cx={p.x} cy={p.y} r={2 / zoom} fill="#4ade80" opacity={0.35}
                style={{ pointerEvents: 'none' }} />
            );
          })}

          {/* Under the route and the markers: loot is context, not the plan. */}
          {lootContainers.map((container, i) => {
            const p = gameToSvg(container.position, projection, viewBox);
            const look = lootLook(container.name);
            return (
              // Hoverable so the title says which container this is. No
              // handlers of its own, so the press still reaches the viewport
              // underneath and clicking here still drops a spawn point.
              <g key={`loot-${i}`} transform={`translate(${p.x} ${p.y}) ${pin}`} className="loot-mark">
                <LootGlyph shape={look.shape} colour={look.colour} />
                <title>
                  {container.name}
                  {Number.isFinite(container.fromRoute) && ` — ${Math.round(container.fromRoute)} m off the route`}
                </title>
              </g>
            );
          })}

          {sniperSpawns.map((sniper, i) => {
            const p = gameToSvg(sniper.position, projection, viewBox);
            return (
              <g key={`sniper-${i}`} transform={`translate(${p.x} ${p.y}) ${pin}`} style={{ pointerEvents: 'none' }}>
                <circle r={8.5} fill="#ef4444" fillOpacity={0.25} stroke="#ef4444" strokeWidth={1.5} />
                <path d="M -3.5 -3.5 L 3.5 3.5 M 3.5 -3.5 L -3.5 3.5" stroke="#ef4444" strokeWidth={1.5} />
                <title>{`Sniper scav${sniper.zoneName ? ` — ${sniper.zoneName}` : ''}`}</title>
              </g>
            );
          })}

          {transits.map((transit, i) => {
            const p = gameToSvg(transit.position, projection, viewBox);
            return (
              <g key={`transit-${i}`} transform={`translate(${p.x} ${p.y}) ${pin}`} style={{ pointerEvents: 'none' }}>
                <rect x={-9} y={-9} width={18} height={18} rx={3} transform="rotate(45)"
                  fill="#2dd4bf" fillOpacity={0.3} stroke="#2dd4bf" strokeWidth={1.5} />
                <text textAnchor="middle" dy={4} fontSize={11} fontWeight={700} fill="#2dd4bf">T</text>
                <title>{transit.label}</title>
              </g>
            );
          })}

          {points.length > 1 && (
            <polyline
              points={polyline}
              fill="none"
              stroke="#f87171"
              strokeWidth={3}
              strokeDasharray="6 4"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: 'none' }}
            />
          )}

          {points.map((p) => {
            const selected = selectedOrder === p.stop.order && p.stop.kind !== 'spawn';
            // Dim only other quests' objectives; spawn, switch and extract stay
            // fully visible because they belong to the run as a whole.
            const dimmed = Boolean(highlightQuest)
              && p.stop.kind === 'objective'
              && p.stop.questName !== highlightQuest;
            const highlighted = Boolean(highlightQuest)
              && p.stop.kind === 'objective'
              && p.stop.questName === highlightQuest;
            return (
              <g
                key={`${p.stop.kind}-${p.stop.order}`}
                transform={`translate(${p.x} ${p.y}) ${routePin}`}
                className="map-marker"
                opacity={dimmed ? 0.35 : 1}
                onPointerDown={(event) => {
                  // Without this the press bubbles to the viewport and starts a
                  // pan, which the marker's own pointerup then never clears.
                  event.stopPropagation();
                }}
                onPointerUp={(event) => {
                  // Keep a marker click from also re-placing the spawn, and make
                  // sure no drag state survives the click.
                  event.stopPropagation();
                  dragging.current = null;
                  pressOrigin.current = null;
                  onSelectStop?.(p.stop);
                }}
              >
                {selected && <circle r={17} fill="none" stroke="#fff" strokeWidth={2.5} opacity={0.9} />}
                {highlighted && (
                  <circle r={15} fill="none"
                    stroke={p.stop.questName ? questColor(p.stop.questName) : '#fbbf24'}
                    strokeWidth={2.5} opacity={0.95} />
                )}
                <circle
                  r={highlighted ? 12.5 : 11.5}
                  fill={p.stop.kind === 'objective' && p.stop.questName
                    ? questColor(p.stop.questName)
                    : COLORS[p.stop.kind]}
                  stroke={highlighted ? '#fff7e0' : '#0b0f14'}
                  strokeWidth={2}
                />
                <text textAnchor="middle" dy={4.5} fontSize={13} fontWeight={700} fill="#0b0f14">
                  {markerLabel(p.stop)}
                </text>
                <title>{`${p.stop.questName ? `${p.stop.questName}: ` : ''}${p.stop.label} — ${p.stop.description}`}</title>
              </g>
            );
          })}
        </svg>
      </div>
      {overlay && <div className="map-overlay">{overlay}</div>}
      </div>
    </div>
  );
}

/**
 * The mark for one kind of container.
 *
 * Drawn here rather than taken from the wiki's interactive map: that art is
 * theirs. The style is the borrowed part — a bold flat pictogram with a pale
 * outline, which is what makes these readable against a busy map instead of
 * dissolving into it.
 *
 * Bigger than a dot on purpose. At five pixels every kind looked the same; the
 * density and distance filters are what keep the map from filling up, not
 * shrinking the marks until they carry no information.
 */
function LootGlyph({ shape, colour }: { shape: LootShape; colour: string }) {
  const body = { fill: colour, stroke: '#f2efe6', strokeWidth: 0.7, strokeLinejoin: 'round' as const };
  const detail = { fill: 'none', stroke: '#1b1710', strokeWidth: 0.7, strokeLinecap: 'round' as const };

  switch (shape) {
    case 'body':
      return (
        <g>
          <circle r={4} {...body} />
          <path d="M -1.8 -1.8 L 1.8 1.8 M 1.8 -1.8 L -1.8 1.8" {...detail} strokeWidth={1} />
        </g>
      );
    case 'safe':
      return (
        <g>
          <rect x={-4} y={-4} width={8} height={8} rx={1} {...body} />
          <circle r={1.6} {...detail} />
          <path d="M 1.6 0 L 3 0" {...detail} />
        </g>
      );
    case 'medical':
      return (
        <g>
          <rect x={-4} y={-3} width={8} height={6} rx={1} {...body} />
          <path d="M 0 -1.8 L 0 1.8 M -1.8 0 L 1.8 0" stroke="#c0392b" strokeWidth={1.4} strokeLinecap="round" />
          <path d="M -1.6 -3 L -1.6 -4 L 1.6 -4 L 1.6 -3" {...body} />
        </g>
      );
    case 'weapon':
      return (
        <g>
          <rect x={-4.5} y={-2.8} width={9} height={5.6} rx={0.8} {...body} />
          <path d="M -4.5 -0.6 L 4.5 -0.6" {...detail} />
          <path d="M -2 -2.8 L -2 2.8 M 2 -2.8 L 2 2.8" {...detail} strokeWidth={0.5} />
        </g>
      );
    case 'tech':
      return (
        <g>
          <rect x={-3} y={-4} width={6} height={8} rx={0.8} {...body} />
          <path d="M -1.4 -2.4 L 1.4 -2.4" {...detail} />
          <circle cx={0} cy={1.4} r={1} {...detail} />
        </g>
      );
    case 'cache':
      // Buried: a mound, which nothing else on the map is shaped like.
      return (
        <g>
          <path d="M -4.2 3 A 4.2 4 0 0 1 4.2 3 Z" {...body} />
          <path d="M -2 3 A 2 2.2 0 0 1 2 3" {...detail} strokeWidth={0.5} />
        </g>
      );
    case 'crate':
      return (
        <g>
          <rect x={-4} y={-3.4} width={8} height={6.8} rx={0.4} {...body} />
          <path d="M -4 -1.2 L 4 -1.2 M -4 1.2 L 4 1.2" {...detail} strokeWidth={0.5} />
        </g>
      );
    case 'bag':
    default:
      return (
        <g>
          <rect x={-4} y={-2.2} width={8} height={5.6} rx={2} {...body} />
          {/* The handle is what makes a bag a bag at this size. */}
          <path d="M -1.8 -2.2 A 1.8 1.8 0 0 1 1.8 -2.2" {...detail} />
        </g>
      );
  }
}
