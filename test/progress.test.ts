import { describe, expect, it } from 'vitest';
import {
  emptyProgress, exportProgress, missingPrerequisites, parseProgressExport,
  standingById, standingOf, withCompleted, type Progress,
} from '../src/lib/progress';
import { task } from './helpers';

const PRAPOR = '54cb50c76803fa8b248b4571';

function progress(partial: Partial<Progress> = {}): Progress {
  return { ...emptyProgress(), ...partial };
}

describe('standingById', () => {
  const index = { requires: { b: ['a'], c: ['b'] }, minLevel: { c: 20 } };

  it('is completed once ticked, whatever else holds', () => {
    expect(standingById('c', index, progress({ completed: new Set(['c']) }))).toBe('completed');
  });

  it('is locked while any prerequisite is unfinished', () => {
    expect(standingById('b', index, progress())).toBe('locked');
    expect(standingById('b', index, progress({ completed: new Set(['a']) }))).toBe('available');
  });

  it('checks the level only when one is set', () => {
    const completed = new Set(['a', 'b']);
    expect(standingById('c', index, progress({ completed }))).toBe('available');
    expect(standingById('c', index, progress({ completed, playerLevel: 19 }))).toBe('too-low-level');
    expect(standingById('c', index, progress({ completed, playerLevel: 20 }))).toBe('available');
  });

  it('holds back a dialogue-gated quest until the logs show it given', () => {
    const gated = { requires: {}, minLevel: {}, gated: { g: true as const } };
    expect(standingById('g', gated, progress(), null)).toBe('available');
    expect(standingById('g', gated, progress(), new Set())).toBe('not-given');
    expect(standingById('g', gated, progress(), new Set(['g']))).toBe('available');
  });

  it('respects locked traders and loyalty levels', () => {
    const traders = {
      requires: {}, minLevel: {},
      trader: { q: PRAPOR },
      traderLevel: { r: [{ trader: PRAPOR, level: 3 }] },
    };
    expect(standingById('q', traders, progress({ traders: { [PRAPOR]: 0 } }))).toBe('trader-locked');
    expect(standingById('r', traders, progress({ traders: { [PRAPOR]: 2 } }))).toBe('trader-locked');
    expect(standingById('r', traders, progress({ traders: { [PRAPOR]: 3 } }))).toBe('available');
    // A trader nobody has set filters nothing.
    expect(standingById('r', traders, progress())).toBe('available');
  });
});

describe('standingOf', () => {
  it('counts only "complete" requirements (or none stated) as prerequisites', () => {
    const quest = task({
      id: 'q',
      taskRequirements: [
        { task: { id: 'done-first', name: null }, status: ['complete'] },
        { task: { id: 'merely-active', name: null }, status: ['active'] },
        { task: { id: 'no-status', name: null }, status: [] },
      ],
    });
    expect(standingOf(quest, progress({ completed: new Set(['done-first']) }))).toBe('locked');
    expect(standingOf(quest, progress({ completed: new Set(['done-first', 'no-status']) }))).toBe('available');
  });
});

describe('missingPrerequisites', () => {
  it('walks the whole chain, skipping what is done, without looping on a cycle', () => {
    const requires = { d: ['c'], c: ['b', 'x'], b: ['a'], x: ['d'] };
    const missing = missingPrerequisites('d', requires, progress({ completed: new Set(['b']) }));
    expect(missing.sort()).toEqual(['c', 'x']);
  });
});

describe('withCompleted', () => {
  it('adds and removes without touching the original', () => {
    const before = progress({ completed: new Set(['a']) });
    const after = withCompleted(before, ['b'], true);
    expect([...after.completed].sort()).toEqual(['a', 'b']);
    expect([...withCompleted(after, ['a'], false).completed]).toEqual(['b']);
    expect([...before.completed]).toEqual(['a']);
  });
});

describe('progress files', () => {
  it('round-trips an export', () => {
    const text = exportProgress(progress({ completed: new Set(['a', 'b']), playerLevel: 30 }));
    expect(parseProgressExport(text)).toMatchObject({ completed: ['a', 'b'], playerLevel: 30 });
  });

  it('accepts the bare stored shape', () => {
    expect(parseProgressExport('{"completed":["a"],"updatedAt":5}'))
      .toEqual({ completed: ['a'], playerLevel: null, exportedAt: 5 });
  });

  it('rejects anything else', () => {
    expect(parseProgressExport('not json')).toBeNull();
    expect(parseProgressExport('{"something":"else"}')).toBeNull();
    expect(parseProgressExport('{"completed":[1,2]}')).toBeNull();
  });
});
