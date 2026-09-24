import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadGameData } from './testData.js';
import {
  rollAndApplyLordTrait,
  rollAndApplyTraits,
  applyLegendaryStaffHeal,
} from '../src/engine/TraitSystem.js';
import { getSkillCombatMods } from '../src/engine/SkillSystem.js';
import { serializeBattleUnit } from '../src/engine/BattleUnitState.js';
import { RunManager, serializeUnit } from '../src/engine/RunManager.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';

const data = loadGameData();
beforeEach(() => {
  const store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());
function unit(name = 'Edric') {
  return {
    name,
    isLord: true,
    faction: 'player',
    col: 1,
    row: 1,
    currentHP: 20,
    stats: { HP: 20, STR: 6, MAG: 6, DEF: 5, RES: 3, SPD: 6, SKL: 6, LCK: 4 },
    growths: {},
    proficiencies: [{ type: 'Sword' }],
    skills: [],
    inventory: [],
  };
}
function mods(
  name,
  trait,
  { initiating = true, hp = 20, foeHP = 20, movement = 0, adjacent = false, dead = false } = {},
) {
  const u = unit(name);
  u.traits = [trait];
  u.currentHP = hp;
  u._movementSpent = movement;
  const foe = unit('Foe');
  foe.currentHP = foeHP;
  const ally = { ...unit('Ally'), col: 2, currentHP: dead ? 0 : 20 };
  return getSkillCombatMods(u, foe, adjacent ? [u, ally] : [u], [foe], [], null, initiating, null, {
    traitsData: data.traits,
  });
}
describe('legendary lord creation and persistence', () => {
  it.each(data.lords.map((l) => l.name))(
    '%s receives only their signature trait at the legendary boundary',
    (name) => {
      const u = unit(name);
      rollAndApplyLordTrait(u, data.traits, () => 0.049, 0.05);
      expect(u.traits).toEqual([data.traits.find((t) => t.lordName === name).id]);
      const again = structuredClone(u);
      rollAndApplyLordTrait(u, data.traits, () => 0.99, 0.15);
      expect(u).toEqual(again);
      const regular = unit(name);
      rollAndApplyLordTrait(regular, data.traits, () => 0.05, 0.05);
      expect(data.traits.find((t) => t.id === regular.traits[0]).rarity).not.toBe('legendary');
    },
  );
  it('disables at zero, caps at fifteen percent, and excludes ordinary recruits', () => {
    for (const [chance, draw] of [
      [0, 0],
      [100, 0.15],
    ]) {
      const u = unit();
      rollAndApplyLordTrait(u, data.traits, () => draw, chance);
      expect(data.traits.find((t) => t.id === u.traits[0]).rarity).not.toBe('legendary');
    }
    for (let n = 0; n < 100; n++) {
      const u = unit();
      u.isLord = false;
      rollAndApplyTraits(u, data.traits, () => n / 100);
      expect(u.traits.every((id) => !data.traits.find((t) => t.id === id).lordName)).toBe(true);
    }
  });
  it('freezes chance for later recruits and preserves legacy saves without re-rolling', () => {
    const run = new RunManager(data, { legendaryLordChanceBonus: 0.1 });
    run.startRun({ runSeed: 123, applyBlessingsAtStart: false });
    const saved = JSON.parse(JSON.stringify(run.toJSON()));
    const restored = RunManager.fromJSON(saved, data);
    expect(restored.legendaryLordChance).toBe(0.15);
    expect(restored.roster.map((u) => u.traits)).toEqual(run.roster.map((u) => u.traits));
    restored.metaEffects.legendaryLordChanceBonus = 0;
    // Traits roll from the lord-trait stream; force a roll under the frozen
    // 15% chance (0.1) that a recomputed 5% chance would reject.
    const traitRng = vi.spyOn(restored, '_lordTraitRng').mockReturnValue(() => 0.1);
    try {
      const third = unit('Rowan');
      restored.resolveThirdLord(third);
      expect(third.traits).toEqual(['riding_guard']);
    } finally {
      traitRng.mockRestore();
    }
    delete saved.legendaryLordChance;
    saved.roster.forEach((u) => delete u.traits);
    const legacy = RunManager.fromJSON(saved, data);
    expect(legacy.legendaryLordChance).toBe(0);
    expect(legacy.roster.every((u) => !u.traits)).toBe(true);
  });
  it('prices both tiers in Valor and exposes the cumulative chance bonus', () => {
    const meta = new MetaProgressionManager(data.metaUpgrades, 'legendary-test');
    meta.totalValor = 900;
    expect(meta.getCurrencyForUpgrade('legendary_lord_chance')).toBe('valor');
    expect(meta.purchaseUpgrade('legendary_lord_chance')).toBe(true);
    expect(meta.totalValor).toBe(600);
    expect(meta.getActiveEffects().legendaryLordChanceBonus).toBe(0.05);
    expect(meta.purchaseUpgrade('legendary_lord_chance')).toBe(true);
    expect(meta.totalValor).toBe(0);
    expect(meta.getActiveEffects().legendaryLordChanceBonus).toBe(0.1);
    expect(meta.purchaseUpgrade('legendary_lord_chance')).toBe(false);
  });
});
describe('legendary combat conditions', () => {
  it('Edric needs a living adjacent ally', () => {
    expect(mods('Edric', 'standard_bearer', { adjacent: true })).toMatchObject({
      atkBonus: 2,
      defBonus: 2,
    });
    expect(mods('Edric', 'standard_bearer', { adjacent: true, dead: true }).atkBonus).toBe(0);
    expect(mods('Edric', 'standard_bearer').atkBonus).toBe(0);
  });
  it('Kira needs initiation and a full-health foe', () => {
    expect(mods('Kira', 'calculated_opening').hitBonus).toBe(15);
    expect(mods('Kira', 'calculated_opening', { foeHP: 19 }).hitBonus).toBe(0);
    expect(mods('Kira', 'calculated_opening', { initiating: false }).hitBonus).toBe(0);
  });
  it('Voss matches the existing half-HP boundary', () => {
    expect(mods('Voss', 'unbroken', { hp: 10 })).toMatchObject({ resBonus: 2, hitBonus: 10 });
    expect(mods('Voss', 'unbroken', { hp: 11 }).hitBonus).toBe(0);
  });
  it('Rowan counts movement cost and only initiation', () => {
    expect(mods('Rowan', 'riding_guard', { movement: 3 })).toMatchObject({
      defBonus: 2,
      resBonus: 2,
    });
    expect(mods('Rowan', 'riding_guard', { movement: 2 }).defBonus).toBe(0);
    expect(mods('Rowan', 'riding_guard', { movement: 3, initiating: false }).defBonus).toBe(0);
  });
  it('Astrid flanks while Cael defends', () => {
    expect(mods('Astrid', 'open_skies')).toMatchObject({ hitBonus: 10, critBonus: 5 });
    expect(mods('Astrid', 'open_skies', { adjacent: true }).hitBonus).toBe(0);
    expect(mods('Astrid', 'open_skies', { initiating: false }).hitBonus).toBe(0);
    expect(mods('Cael', 'dread_presence', { initiating: false }).hitBonus).toBe(10);
    expect(mods('Cael', 'dread_presence').hitBonus).toBe(0);
  });
});
describe('Overflowing Grace checkpoint contract', () => {
  it('heals once per player phase, caps at max HP and restores the usage marker on rewind/resume', () => {
    const sera = unit('Sera');
    sera.traits = ['overflowing_grace'];
    sera.currentHP = 15;
    const target = unit();
    const before = serializeBattleUnit(sera);
    const heal = (u, amount = 2, turn = 1, phase = 'player', recipient = target) =>
      applyLegendaryStaffHeal(u, recipient, amount, data.traits, turn, phase);
    expect(heal(sera, 0)).toBe(0);
    expect(heal(sera, 2, 1, 'enemy')).toBe(0);
    expect(heal(sera, 2, 1, 'player', sera)).toBe(0);
    expect(heal(sera)).toBe(3);
    const resumed = serializeBattleUnit(sera);
    expect(heal(resumed)).toBe(0);
    expect(heal(before)).toBe(3); // Rewinding restores both HP and allowance.
    expect(heal(resumed, 2, 2)).toBe(2);
    expect(resumed.currentHP).toBe(20);
    expect(serializeUnit(resumed)._legendaryGraceTurn).toBeUndefined();
  });
});

describe('seeded lord traits', () => {
  it('a seeded run rolls the same starting lord traits every time', () => {
    const roll = () => {
      const run = new RunManager(data);
      run.startRun({ runSeed: 42, applyBlessingsAtStart: false });
      return run.roster.map((u) => [u.name, u.traits]);
    };
    const first = roll();
    for (let i = 0; i < 5; i++) expect(roll()).toEqual(first);
  });

  it('the trait stream does not consume the ambient random stream', () => {
    const spy = vi.spyOn(Math, 'random');
    try {
      const run = new RunManager(data);
      run.startRun({ runSeed: 7, applyBlessingsAtStart: false });
      const calls = spy.mock.calls.length;
      run.resolveThirdLord(unit('Rowan'));
      expect(spy.mock.calls.length).toBe(calls);
    } finally {
      spy.mockRestore();
    }
  });
});
