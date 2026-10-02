// The headless harness burns and corrodes exactly as BattleScene does (lava at the end of
// a side's phase, acid ground, acid ticks at turn start). Ways it can go wrong:
//   - the harness writes HP around UnitHealth, so a hold mark (or its absence) differs;
//   - the harness skips acid ground or acid ticks the scene applies;
//   - lava in the harness leaves a sleeper asleep, or burns a flier.
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { applyHoldSpawn } from '../src/engine/HoldActivation.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const T = Object.fromEntries(data.terrain.map((t, i) => [t.name, i]));

const LAYOUT = [
  [T['Lava Crack'], T['Lava Crack'], T['Lava Crack'], T['Acidic Swamp'], T['Acidic Bog'], T['Acidic Swamp'], T.Plain], // prettier-ignore
];

function fixtures() {
  const unit = (name, col, extra = {}) => ({
    name,
    faction: 'enemy',
    col,
    row: 0,
    currentHP: 20,
    stats: { HP: 20 },
    moveType: 'Infantry',
    skills: [],
    ...extra,
  });
  return [
    applyHoldSpawn(unit('LavaHolder', 0, { _conditions: [{ id: 'sleep', turnsRemaining: 2 }] }), {
      aiMode: 'hold',
      holdPack: 0,
      holdPackSize: 2,
    }),
    unit('LowLava', 1, { currentHP: 3 }),
    unit('Flier', 2, { moveType: 'Flying' }),
    applyHoldSpawn(unit('AcidHolder', 3), { aiMode: 'hold', holdPack: 0, holdPackSize: 2 }),
    unit('Immune', 4, { poisonImmune: true }),
    unit('AcidFlier', 5, { moveType: 'Flying' }),
    unit('Plain', 6),
  ];
}

function sceneStub() {
  const noop = () => {};
  return new Proxy(
    {
      _battleSession: 1,
      _sceneShutdownCleanedUp: false,
      grid: { mapLayout: LAYOUT, gridToPixel: () => ({ x: 0, y: 0 }) },
      _showsTurnEffectOn: () => false,
      _checkPhoenixBrooch: async () => {},
    },
    { get: (t, k) => (k in t ? t[k] : noop) },
  );
}

function harness() {
  installSeed(3);
  const battle = new HeadlessBattle(data, { act: 'act1', objective: 'rout', battleSeed: 9, deployCount: 3 }); // prettier-ignore
  battle.init();
  restoreMathRandom();
  battle.grid.mapLayout = LAYOUT;
  return battle;
}

const state = (units) =>
  units.map((u) => ({
    name: u.name,
    hp: u.currentHP,
    conditions: (u._conditions || []).map((c) => c.id).sort(),
    disturbed: u.holdDisturbed ?? null,
  }));

describe('harness terrain hazards match BattleScene', () => {
  it('end-of-phase pass, then the next turn start', async () => {
    const sceneUnits = fixtures();
    const harnessUnits = fixtures();
    const scene = sceneStub();
    await BattleScene.prototype.processTerrainDamage.call(scene, sceneUnits);
    const battle = harness();
    battle._processTerrainDamage(harnessUnits);
    expect(state(harnessUnits)).toEqual(state(sceneUnits));

    // What the pass did, written out by hand: lava burns 5 (never below 1) and wakes the
    // sleeper, fliers are untouched, acid ground corrodes walkers that are not immune.
    const after = state(sceneUnits);
    expect(after.find((u) => u.name === 'LavaHolder')).toMatchObject({ hp: 15, conditions: [] });
    expect(after.find((u) => u.name === 'LowLava').hp).toBe(1);
    expect(after.find((u) => u.name === 'Flier').hp).toBe(20);
    expect(after.find((u) => u.name === 'AcidHolder').conditions).toEqual(['acid']);
    expect(after.find((u) => u.name === 'Immune').conditions).toEqual([]);
    expect(after.find((u) => u.name === 'AcidFlier').conditions).toEqual([]);
    // The ground never disturbs a holder, in either.
    expect(after.every((u) => u.disturbed === null)).toBe(true);

    // The next turn start: acid ticks (BattleScene step 0b) in both.
    await BattleScene.prototype._processAcidTicks.call(scene, sceneUnits);
    battle._processTurnStartEffects(harnessUnits);
    expect(state(harnessUnits)).toEqual(state(sceneUnits));
    expect(state(sceneUnits).find((u) => u.name === 'AcidHolder').hp).toBeLessThan(20);
  });
});
