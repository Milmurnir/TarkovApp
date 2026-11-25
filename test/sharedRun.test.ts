import { describe, expect, it } from 'vitest';
import { applyRestamp, fieldWins, makeFields, mergeFields, toRunState, type Fields } from '../src/lib/sharedRun';
import { mergeIncoming, MAX_CLOCK_LEAD_MS } from '../relay/merge.js';

const f = (value: unknown, at: number, by = 'a') => ({ value, at, by });

describe('fieldWins', () => {
  it('takes the newer write, and the higher peer id on a tie', () => {
    expect(fieldWins(f(1, 2), f(0, 1))).toBe(true);
    expect(fieldWins(f(1, 1), f(0, 2))).toBe(false);
    expect(fieldWins(f(1, 1, 'b'), f(0, 1, 'a'))).toBe(true);
    expect(fieldWins(f(1, 1, 'a'), f(0, 1, 'b'))).toBe(false);
    expect(fieldWins(f(1, 1), undefined)).toBe(true);
  });
});

describe('mergeFields', () => {
  it('reports only the paths that changed, leaving the input alone', () => {
    const current: Fields = { map: f('customs', 5), spawn: f(null, 5) };
    const { fields, changed } = mergeFields(current, { map: f('woods', 4), spawn: f({ x: 1 }, 6) });
    expect(changed).toEqual(['spawn']);
    expect(fields.map.value).toBe('customs');
    expect(current.spawn.value).toBeNull();
  });

  it("converges whichever order two peers' writes arrive in", () => {
    const a = { map: f('customs', 10, 'a') };
    const b = { map: f('woods', 10, 'b') };
    const one = mergeFields(mergeFields({}, a).fields, b).fields;
    const two = mergeFields(mergeFields({}, b).fields, a).fields;
    expect(one).toEqual(two);
    expect(one.map.value).toBe('woods');
  });
});

describe('makeFields', () => {
  it('never stamps two calls with the same time', () => {
    const first = makeFields('me', { a: 1 }).a.at;
    const second = makeFields('me', { a: 2 }).a.at;
    expect(second).toBeGreaterThan(first);
  });
});

describe('toRunState', () => {
  it('reads the fields back, checklist entries included', () => {
    const state = toRunState({
      map: f('customs', 1), quests: f(['q'], 1), zone: f(2, 1),
      'check:Keys': f({ claimedBy: 'a', claimedName: 'A', packed: true }, 1),
      'check:broken': f('nonsense', 1),
    });
    expect(state).toMatchObject({ map: 'customs', quests: ['q'], zoneIndex: 2, spawn: null });
    expect(Object.keys(state.checks)).toEqual(['Keys']);
  });
});

describe('relay merge', () => {
  const NOW = 1_000_000;

  it('applies the same rule as the app', () => {
    const fields: Fields = { map: f('customs', 5, 'a') };
    const { accepted } = mergeIncoming(fields, { map: f('woods', 5, 'b'), spawn: f(1, 4) }, NOW, 500);
    expect(Object.keys(accepted)).toEqual(['map', 'spawn']);
    expect(mergeIncoming(fields, { map: f('old', 4, 'z') }, NOW, 500).accepted).toEqual({});
  });

  it('pulls a write from a fast clock back to its own time, and says so', () => {
    const fields: Fields = {};
    const { accepted, restamped } = mergeIncoming(fields, { map: f('woods', NOW + 10 * 60_000) }, NOW, 500);
    expect(accepted.map.at).toBe(NOW);
    expect(restamped).toEqual({ map: f('woods', NOW) });

    // The other player's change a minute later now wins, as it should.
    const later = mergeIncoming(fields, { map: f('customs', NOW + 60_000, 'b') }, NOW + 60_000, 500);
    expect(later.accepted.map.value).toBe('customs');
  });

  it('leaves ordinary drift alone', () => {
    const { accepted, restamped } = mergeIncoming({}, { map: f('x', NOW + MAX_CLOCK_LEAD_MS) }, NOW, 500);
    expect(accepted.map.at).toBe(NOW + MAX_CLOCK_LEAD_MS);
    expect(restamped).toEqual({});
  });

  it('drops malformed fields and caps the room size', () => {
    const fields: Fields = { a: f(1, 1) };
    const { accepted } = mergeIncoming(fields, {
      bad: { value: 1 }, nan: f(1, Number.NaN), ['x'.repeat(201)]: f(1, 1), b: f(1, 1), a: f(2, 2),
    }, NOW, 1);
    expect(Object.keys(accepted)).toEqual(['a']);
    expect(mergeIncoming({}, null, NOW, 5)).toEqual({ accepted: {}, restamped: {} });
  });
});

describe('applyRestamp', () => {
  it("takes the relay's earlier time for our own unchanged write", () => {
    const mine: Fields = { map: f('woods', 9000, 'me') };
    expect(applyRestamp(mine, { map: f('woods', 5000, 'me') }).map.at).toBe(5000);
  });

  it('ignores a correction for a field that has changed since', () => {
    const mine: Fields = { map: f('customs', 9001, 'me'), spawn: f(1, 9000, 'other') };
    const next = applyRestamp(mine, { map: f('woods', 5000, 'me'), spawn: f(1, 5000, 'me'), gone: f(1, 1, 'me') });
    expect(next).toEqual(mine);
  });

  it("lets the other player's later write through afterwards", () => {
    const mine = applyRestamp({ map: f('woods', 9000, 'me') }, { map: f('woods', 5000, 'me') });
    expect(mergeFields(mine, { map: f('customs', 6000, 'other') }).changed).toEqual(['map']);
  });
});
