import { describe, expect, it } from 'vitest';
import { buildRoute } from '../src/lib/route';
import type { MapExtract } from '../src/lib/types';
import { at, objective, task, zone } from './helpers';

const spawn = { position: at(0, 0), zoneName: 'Spawn A' };

function extract(name: string, x: number, z: number, partial: Partial<MapExtract> = {}): MapExtract {
  return { id: name, name, faction: null, position: at(x, z), switches: null, ...partial };
}

describe('buildRoute', () => {
  it('starts at the spawn and visits the nearest objective first', () => {
    const quest = task({
      objectives: [
        objective({ description: 'far', zones: [zone(100, 0)] }),
        objective({ description: 'near', zones: [zone(10, 0)] }),
      ],
    });
    const route = buildRoute([quest], spawn, [], 'customs');
    expect(route.stops.map((s) => s.description)).toEqual(['Your spawn point', 'near', 'far']);
    expect(route.stops[0]).toMatchObject({ kind: 'spawn', label: 'Spawn A', order: 0 });
    expect(route.totalDistance).toBeCloseTo(100);
  });

  it('uses the closest of several zones for one objective', () => {
    const quest = task({ objectives: [objective({ zones: [zone(50, 0), zone(0, 5)] })] });
    expect(buildRoute([quest], spawn, [], 'customs').stops[1].position).toEqual(at(0, 5));
  });

  it('removes the back-and-forth nearest-neighbour leaves behind', () => {
    // Points on a line at 1, -2, 4 and -8. Nearest-neighbour zig-zags
    // 1 -> -2 -> 4 -> -8 (22 m); going out to 4 first and then sweeping back
    // through -2 to -8 is 16 m (as is 4 -> 1 -> -2 -> -8, so only the
    // length is checked, not which of the two it picks).
    const quest = task({
      objectives: [
        objective({ description: 'a', zones: [zone(1, 0)] }),
        objective({ description: 'b', zones: [zone(-2, 0)] }),
        objective({ description: 'c', zones: [zone(4, 0)] }),
        objective({ description: 'd', zones: [zone(-8, 0)] }),
      ],
    });
    const route = buildRoute([quest], spawn, [], 'customs');
    expect(route.totalDistance).toBeCloseTo(16);
    expect(route.stops.map((s) => s.order)).toEqual([0, 1, 2, 3, 4]);
  });

  it('lists objectives with no coordinates on this map as unmapped', () => {
    const quest = task({
      objectives: [
        objective({ description: 'here', zones: [zone(5, 5)] }),
        objective({ description: 'elsewhere', zones: [zone(5, 5, 'woods')] }),
        objective({ description: 'nowhere' }),
      ],
    });
    const route = buildRoute([quest], spawn, [], 'customs');
    expect(route.stops).toHaveLength(2);
    expect(route.unmappedObjectives.map((o) => o.description)).toEqual(['elsewhere', 'nowhere']);
  });

  it('routes quest items by their possible locations', () => {
    const quest = task({
      objectives: [objective({
        type: 'findQuestItem',
        possibleLocations: [{ map: { normalizedName: 'customs' }, positions: [at(3, 4)] }],
      })],
    });
    expect(buildRoute([quest], spawn, [], 'customs').stops[1].position).toEqual(at(3, 4));
  });

  it('carries the quest name, keys and count onto the stop', () => {
    const quest = task({
      name: 'Delivery',
      objectives: [objective({
        zones: [zone(1, 1)], count: 3,
        requiredKeys: [[{ name: 'Dorm 214', shortName: null }]],
      })],
    });
    expect(buildRoute([quest], spawn, [], 'customs').stops[1])
      .toMatchObject({ questName: 'Delivery', keys: ['Dorm 214'], count: 3, label: 'Objective 1' });
  });

  it('ends at the extract nearest the last objective', () => {
    const quest = task({ objectives: [objective({ zones: [zone(100, 0)] })] });
    const route = buildRoute([quest], spawn, [extract('Near start', 1, 0), extract('Near end', 105, 0)], 'customs');
    expect(route.stops[route.stops.length - 1]).toMatchObject({ kind: 'extract', label: 'Near end' });
    expect(route.totalDistance).toBeCloseTo(105);
  });

  it('prefers the exit the quest demands, case-insensitively', () => {
    const quest = task({
      objectives: [
        objective({ zones: [zone(100, 0)] }),
        objective({ type: 'extract', exitName: 'far gate' }),
      ],
    });
    const route = buildRoute([quest], spawn, [extract('Close', 101, 0), extract('Far Gate', -50, 0)], 'customs');
    const last = route.stops[route.stops.length - 1];
    expect(last.label).toBe('Far Gate');
    expect(last.description).toMatch(/^Required extract/);
  });

  it('puts a pending transit ahead of every other exit', () => {
    const quest = task({ objectives: [objective({ type: 'extract', exitName: 'Close' })] });
    const transit = extract('Transit to Woods', 500, 0);
    const route = buildRoute([quest], spawn, [extract('Close', 1, 0)], 'customs', transit);
    expect(route.stops[route.stops.length - 1])
      .toMatchObject({ label: 'Transit to Woods', description: 'Continue this quest here' });
  });

  it("visits an extract's switch on the way to it", () => {
    const gated = extract('Power exit', 20, 0, {
      switches: [{ id: 's', name: 'Breaker', switchType: null, position: at(10, 0) }],
    });
    const route = buildRoute([], spawn, [gated], 'customs');
    expect(route.stops.map((s) => s.kind)).toEqual(['spawn', 'switch', 'extract']);
    expect(route.stops.map((s) => s.order)).toEqual([0, 1, 2]);
    expect(route.stops[2].cumulativeDistance).toBeCloseTo(20);
  });

  it('skips extracts with no position', () => {
    const route = buildRoute([], spawn, [extract('Unknown', 0, 0, { position: null })], 'customs');
    expect(route.stops).toHaveLength(1);
  });
});
