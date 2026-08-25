import { distance2d } from './mapgeo';
import type { MapExtract, Route, RouteStop, Task, TaskObjective, Vec3 } from './types';

interface Candidate {
  objective: TaskObjective;
  /** An objective can have several marked zones; any one of them satisfies it. */
  positions: Vec3[];
  questName: string;
}

/** Objective types that carry `zones` in the tarkov.dev schema. */
const ROUTABLE_TYPES = new Set([
  'findItem', 'findQuestItem', 'giveItem', 'giveQuestItem', 'plantItem',
  'plantQuestItem', 'mark', 'shoot', 'useItem', 'visit', 'extract', 'basic',
]);

function collectCandidates(tasks: Task[], mapName: string): { candidates: Candidate[]; unmapped: TaskObjective[] } {
  const candidates: Candidate[] = [];
  const unmapped: TaskObjective[] = [];

  for (const task of tasks) {
  for (const objective of task.objectives) {
    // Extract objectives are handled as the route's endpoint, not a stop.
    if (objective.type === 'extract') continue;

    const zonePositions = (objective.zones ?? [])
      .filter((z) => z.position && (!z.map || z.map.normalizedName === mapName))
      .map((z) => z.position as Vec3);

    // Quest items publish their own coordinates separately from zones.
    const itemPositions = (objective.possibleLocations ?? [])
      .filter((loc) => !loc.map || loc.map.normalizedName === mapName)
      .flatMap((loc) => loc.positions ?? []);

    const positions = [...zonePositions, ...itemPositions];

    if (positions.length > 0) {
      candidates.push({ objective, positions, questName: task.name });
    } else {
      // No coordinates published for this objective: still shown, just not routed.
      unmapped.push(objective);
    }
  }
  }
  return { candidates, unmapped };
}

/** Nearest position of a candidate relative to a point, plus that distance. */
function nearestPosition(from: Vec3, positions: Vec3[]): { position: Vec3; distance: number } {
  let best = positions[0];
  let bestDist = distance2d(from, positions[0]);
  for (const p of positions.slice(1)) {
    const d = distance2d(from, p);
    if (d < bestDist) { best = p; bestDist = d; }
  }
  return { position: best, distance: bestDist };
}

/** Greedy nearest-neighbour ordering, anchored at the spawn. */
function nearestNeighbourOrder(spawn: Vec3, candidates: Candidate[]) {
  const remaining = [...candidates];
  const ordered: { objective: TaskObjective; position: Vec3; questName: string }[] = [];
  let current = spawn;

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestPick = nearestPosition(current, remaining[0].positions);
    for (let i = 1; i < remaining.length; i++) {
      const pick = nearestPosition(current, remaining[i].positions);
      if (pick.distance < bestPick.distance) { bestIndex = i; bestPick = pick; }
    }
    const [chosen] = remaining.splice(bestIndex, 1);
    ordered.push({ objective: chosen.objective, position: bestPick.position, questName: chosen.questName });
    current = bestPick.position;
  }
  return ordered;
}

function pathLength(spawn: Vec3, stops: { position: Vec3 }[]): number {
  let total = 0;
  let prev = spawn;
  for (const s of stops) { total += distance2d(prev, s.position); prev = s.position; }
  return total;
}

/**
 * 2-opt refinement. Nearest-neighbour alone often leaves an obvious crossing;
 * reversing segments removes those. The spawn stays fixed as the start.
 */
function twoOpt(spawn: Vec3, stops: { objective: TaskObjective; position: Vec3; questName: string }[]) {
  if (stops.length < 3) return stops;

  let best = [...stops];
  let bestLength = pathLength(spawn, best);
  let improved = true;
  let guard = 0;

  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const candidate = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        const length = pathLength(spawn, candidate);
        if (length < bestLength - 0.01) {
          best = candidate; bestLength = length; improved = true;
        }
      }
    }
  }
  return best;
}

export function buildRoute(
  tasks: Task[],
  spawn: { position: Vec3; zoneName: string | null },
  extracts: MapExtract[],
  mapName: string,
): Route {
  const { candidates, unmapped } = collectCandidates(tasks, mapName);

  const ordered = twoOpt(spawn.position, nearestNeighbourOrder(spawn.position, candidates));

  const stops: RouteStop[] = [{
    order: 0,
    label: spawn.zoneName ?? 'Spawn',
    description: 'Your spawn point',
    position: spawn.position,
    kind: 'spawn',
    legDistance: 0,
    cumulativeDistance: 0,
  optional: false,
  }];

  let cumulative = 0;
  let previous = spawn.position;

  ordered.forEach((stop, index) => {
    const leg = distance2d(previous, stop.position);
    cumulative += leg;
    stops.push({
      order: index + 1,
      label: `Objective ${index + 1}`,
      description: stop.objective.description,
      position: stop.position,
      kind: 'objective',
      legDistance: leg,
      cumulativeDistance: cumulative,
      optional: stop.objective.optional,
      keys: (stop.objective.requiredKeys ?? []).flat().map((k) => k.name),
      questName: stop.questName,
      count: stop.objective.count ?? null,
    });
    previous = stop.position;
  });

  // If the quest demands a particular exit, finish there; otherwise take the
  // extract closest to the last objective.
  const usableExtracts = extracts.filter((e) => e.position);
  const requiredExitNames = tasks
    .flatMap((t) => t.objectives)
    .filter((o) => o.type === 'extract' && o.exitName)
    .map((o) => (o.exitName as string).toLowerCase());

  let chosen: MapExtract | null = null;
  let required = false;

  if (requiredExitNames.length > 0) {
    chosen = usableExtracts.find((e) => e.name && requiredExitNames.includes(e.name.toLowerCase())) ?? null;
    required = chosen !== null;
  }

  if (!chosen && usableExtracts.length > 0) {
    chosen = usableExtracts.reduce((best, e) =>
      distance2d(previous, e.position as Vec3) < distance2d(previous, best.position as Vec3) ? e : best,
    );
  }

  if (chosen) {
    // A switch-gated extract only opens once its switch is flipped, so the
    // switch becomes a waypoint on the way there.
    for (const sw of chosen.switches ?? []) {
      if (!sw.position) continue;
      const legToSwitch = distance2d(previous, sw.position);
      cumulative += legToSwitch;
      stops.push({
        order: stops.length,
        label: sw.name ?? 'Switch',
        description: `Activate this switch to open ${chosen.name ?? 'the extract'}`,
        position: sw.position,
        kind: 'switch',
        legDistance: legToSwitch,
        cumulativeDistance: cumulative,
        optional: false,
      });
      previous = sw.position;
    }

    const legToExtract = distance2d(previous, chosen.position as Vec3);
    cumulative += legToExtract;
    stops.push({
      order: stops.length,
      label: chosen.name ?? 'Extract',
      description: required
        ? `Required extract for this quest${chosen.faction ? ` (${chosen.faction})` : ''}`
        : `Nearest extract${chosen.faction ? ` (${chosen.faction})` : ''}`,
      position: chosen.position as Vec3,
      kind: 'extract',
      legDistance: legToExtract,
      cumulativeDistance: cumulative,
      optional: false,
    });
  }

  return { stops, totalDistance: cumulative, unmappedObjectives: unmapped };
}

export { ROUTABLE_TYPES };
