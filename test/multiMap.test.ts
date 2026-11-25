import { describe, expect, it } from 'vitest';
import { questMapSpan } from '../src/lib/multiMap';
import { objective, task } from './helpers';

const known = new Set(['customs', 'woods', 'factory', 'interchange', 'shoreline']);
const on = (...names: string[]) => names.map((n) => ({ normalizedName: n, name: n }));

describe('questMapSpan', () => {
  it('lists each map once, in objective order', () => {
    const quest = task({
      objectives: [
        objective({ maps: on('woods') }),
        objective({ maps: on('customs') }),
        objective({ maps: on('woods') }),
      ],
    });
    expect(questMapSpan(quest, known)).toEqual(['woods', 'customs']);
  });

  it('folds night Factory into Factory', () => {
    const quest = task({ objectives: [objective({ maps: on('night-factory') }), objective({ maps: on('factory') })] });
    expect(questMapSpan(quest, known)).toEqual(['factory']);
  });

  it('ignores "any location" objectives and maps the app does not have', () => {
    const quest = task({
      objectives: [
        objective({ maps: on('customs', 'woods', 'interchange') }),
        objective({ maps: on('event-map') }),
        objective({ maps: [] }),
        objective({ maps: on('shoreline') }),
      ],
    });
    expect(questMapSpan(quest, known)).toEqual(['shoreline']);
  });
});
