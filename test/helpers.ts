import { createRequire } from 'module';
import type { Task, TaskObjective, Vec3 } from '../src/lib/types';

/** The Electron side is CommonJS; this loads it the way Electron does. */
export const requireCjs = createRequire(import.meta.url);

export const at = (x: number, z: number): Vec3 => ({ x, y: 0, z });

export function objective(partial: Partial<TaskObjective> = {}): TaskObjective {
  return { id: null, type: 'visit', description: 'Go there', optional: false, maps: [], ...partial };
}

export function task(partial: Partial<Task> = {}): Task {
  return {
    id: 't1', name: 'Quest', normalizedName: 'quest', trader: null, map: null,
    minPlayerLevel: null, kappaRequired: null, wikiLink: null, experience: null,
    taskRequirements: [], traderRequirements: [], objectives: [], ...partial,
  };
}

/** A zone on `map` at (x, z). */
export function zone(x: number, z: number, map = 'customs') {
  return { id: `${x},${z}`, map: { normalizedName: map }, position: at(x, z) };
}
