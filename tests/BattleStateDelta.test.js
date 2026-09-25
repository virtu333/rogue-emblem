import { describe, expect, it } from 'vitest';
import {
  applyBattleStatePatch,
  diffBattleState,
  jsonEqual,
  peekBattleStatePatch,
  toJsonValue,
  validBattleStatePatch,
} from '../src/engine/BattleStateDelta.js';
import { serializedBytes } from '../src/engine/BattleStateSnapshot.js';
import { loadGameData } from './testData.js';
import { createRewindBattleSim } from './helpers/rewindBattleSim.js';

const roundTrip = (base, target) => {
  const patch = diffBattleState(base, target);
  const rebuilt = applyBattleStatePatch(base, patch);
  expect(jsonEqual(rebuilt, target)).toBe(true);
  // Patches survive the save boundary.
  expect(applyBattleStatePatch(base, JSON.parse(JSON.stringify(patch)))).toEqual(rebuilt);
  return patch;
};

describe('battle state patches', () => {
  it('reproduces arbitrary JSON edits exactly and never aliases inputs', () => {
    const base = { a: 1, b: { c: [1, 2, 3], d: 'x' }, e: [{ f: 1 }], gone: true, n: null };
    const target = {
      a: 2,
      b: { c: [1, 5], d: 'x', z: { deep: [0] } },
      e: [{ f: 1 }, { f: 2 }],
      n: 0,
    };
    const patch = roundTrip(base, target);
    expect(patch.o.gone).toBeUndefined();
    expect(patch.x).toEqual(['gone']);
    const rebuilt = applyBattleStatePatch(base, patch);
    rebuilt.b.z.deep.push(9);
    expect(target.b.z.deep).toEqual([0]);
    expect(base.b.c).toEqual([1, 2, 3]);
    expect(diffBattleState(base, structuredClone(base))).toBeNull();
    expect(applyBattleStatePatch(base, null)).toEqual(base);
  });

  it('keys entity lists by battleEntityId so a death does not shift later units', () => {
    const unit = (id, hp) => ({
      battleEntityId: id,
      name: `U${id}`,
      currentHP: hp,
      bag: [1, 2, 3],
    });
    const base = { enemyUnits: [unit('u1', 5), unit('u2', 6), unit('u3', 7), unit('u4', 8)] };
    const target = { enemyUnits: [unit('u2', 6), unit('u3', 2), unit('u4', 8), unit('u9', 1)] };
    const patch = roundTrip(base, target);
    expect(patch.o.enemyUnits.k).toEqual(['u2', 'u3', 'u4', 'u9']);
    expect(Object.keys(patch.o.enemyUnits.m)).toEqual(['u3', 'u9']);
    expect(patch.o.enemyUnits.m.u3).toEqual({ o: { currentHP: { $: 2 } } });
  });

  it('keeps a real late-game action patch small', () => {
    const sim = createRewindBattleSim(loadGameData());
    const before = toJsonValue(sim.state());
    sim.playerAct(sim.scene.playerUnits[2]);
    const after = toJsonValue(sim.state());
    const patch = roundTrip(before, after);
    expect(serializedBytes(after)).toBeGreaterThan(40000);
    expect(serializedBytes(patch)).toBeLessThan(serializedBytes(after) / 10);
    expect(peekBattleStatePatch(before, patch)).toEqual(applyBattleStatePatch(before, patch));
  });

  it.each([
    ['unknown node', { q: 1 }],
    ['mixed node', { $: 1, o: {} }],
    ['prototype key', JSON.parse('{"o":{"__proto__":{"$":1}}}')],
    ['constructor key', { o: { constructor: { $: 1 } } }],
    ['deleted and patched', { o: { a: { $: 1 } }, x: ['a'] }],
    ['negative length', { n: -1, i: {} }],
    ['index past length', { n: 1, i: { 2: { $: 1 } } }],
    ['non-index key', { n: 1, i: { a: { $: 1 } } }],
    ['duplicate ids', { k: ['u1', 'u1'], m: {} }],
    ['patch for unlisted id', { k: ['u1'], m: { u2: { $: {} } } }],
  ])('rejects a malformed patch: %s', (_, patch) => {
    expect(validBattleStatePatch(patch)).toBe(false);
    expect(() => applyBattleStatePatch({ a: 1 }, patch)).toThrow();
  });

  it('rejects patches that do not fit their base', () => {
    expect(() => applyBattleStatePatch([1], { o: { a: { $: 1 } } })).toThrow();
    expect(() => applyBattleStatePatch({}, { n: 1, i: {} })).toThrow('expects an array');
    expect(() => applyBattleStatePatch([], { n: 1, i: {} })).toThrow('hole');
    expect(() => applyBattleStatePatch([{ battleEntityId: 'u1' }], { k: ['u2'], m: {} })).toThrow(
      'unknown entity',
    );
    expect({}.polluted).toBeUndefined();
  });
});
