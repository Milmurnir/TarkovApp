import type { Task, TaskObjective } from './types';

/**
 * tarkov.dev tracks Factory's day/night variant (and a few event/removed maps)
 * as separate map ids. This app only ever shows one Factory, so its variant
 * collapses into it; anything else with no entry in `knownMaps` simply isn't
 * a map this app can select or route to at all, and is dropped rather than
 * aliased.
 */
const MAP_ALIASES: Record<string, string> = {
  'night-factory': 'factory',
};

/**
 * The one map an objective is genuinely tied to, or null when it isn't tied
 * to exactly one. An objective naming several maps ("Eliminate Scavs on any
 * location") is not positional -- it can be completed wherever the player
 * already is, so it never forces a new map and must not be counted as
 * spanning all of them. Verified against real task data: legitimate
 * multi-map objectives (Secrets of Polikhim, Chumming) always resolve to
 * exactly one map each; "anywhere" bounty-style objectives list a dozen or
 * more and are excluded by this check.
 */
function objectiveMap(objective: TaskObjective, knownMaps: Set<string>): string | null {
  const resolved = new Set(
    objective.maps
      .map((m) => MAP_ALIASES[m.normalizedName] ?? m.normalizedName)
      .filter((name) => knownMaps.has(name)),
  );
  return resolved.size === 1 ? [...resolved][0] : null;
}

/**
 * Every map a quest's objectives are genuinely tied to, in the order its
 * objectives list them (which matches the quest's actual step order). Pass
 * every map this app can select and route to (the loaded map index's
 * normalizedNames) as `knownMaps` -- a handful of objectives point at maps
 * (event variants, cut content) this app has no data for at all, and those
 * must not be treated as a leg to route to.
 */
export function questMapSpan(task: Task, knownMaps: Set<string>): string[] {
  const maps: string[] = [];
  for (const objective of task.objectives) {
    const map = objectiveMap(objective, knownMaps);
    if (map && !maps.includes(map)) maps.push(map);
  }
  return maps;
}
