import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadGameData } from './testData.js';
import { rollAndApplyLordTrait } from '../src/engine/TraitSystem.js';
import { RunManager } from '../src/engine/RunManager.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { createSeededRng } from '../src/engine/BlessingEngine.js';
const data = loadGameData();
let storage;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  });
});
function lord() {
  return {
    isLord: true,
    stats: { HP: 20, STR: 5, MAG: 2, DEF: 3 },
    currentHP: 20,
    growths: { HP: 50, SPD: 30 },
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
  };
}
describe('lord trait creation', () => {
  it('rolls exactly one eligible trait with deterministic seeded outcomes', () => {
    for (let seed = 0; seed < 100; seed++) {
      const a = lord(),
        b = lord();
      rollAndApplyLordTrait(a, data.traits, createSeededRng(seed));
      rollAndApplyLordTrait(b, data.traits, createSeededRng(seed));
      expect(a).toEqual(b);
      expect(a.traits).toHaveLength(1);
      expect(['lazy', 'reckless', 'clever', 'lone_wolf', 'slow_oath']).not.toContain(a.traits[0]);
      expect(data.traits.find((t) => t.id === a.traits[0]).retired).toBeFalsy();
    }
  });
  it('stacks a creation modifier once after meta bonuses and persists it without reapplication', () => {
    const gameData = structuredClone(data);
    gameData.traits = [data.traits.find((t) => t.id === 'nimble')];
    const run = new RunManager(gameData);
    run.metaEffects = { lordStatBonuses: { SPD: 2 }, lordGrowthBonuses: { HP: 5 } };
    run.startRun({ runSeed: 77, applyBlessingsAtStart: false });
    const bare = new RunManager({ ...gameData, traits: [] });
    bare.metaEffects = { lordStatBonuses: { SPD: 2 }, lordGrowthBonuses: { HP: 5 } };
    bare.startRun({ runSeed: 77, applyBlessingsAtStart: false });
    for (const unit of run.roster) {
      expect(unit.traits).toEqual(['nimble']);
      const plain = bare.roster.find((u) => u.name === unit.name);
      // Meta +2 is in both; the trait adds exactly +1 Spd on top.
      expect(unit.stats.SPD).toBe(plain.stats.SPD + 1);
    }
    const serialized = JSON.parse(JSON.stringify(run.toJSON()));
    const restored = RunManager.fromJSON(serialized, gameData);
    expect(restored.roster.map((u) => [u.traits, u.stats, u.growths])).toEqual(
      run.roster.map((u) => [u.traits, u.stats, u.growths]),
    );
    const unit = restored.roster[0],
      before = structuredClone(unit.stats);
    rollAndApplyLordTrait(unit, data.traits, () => 0);
    expect(unit.stats).toEqual(before);
  });
  it('applies to newly joining third lords without replacing an existing trait', () => {
    const run = new RunManager({ ...data, traits: [data.traits.find((t) => t.id === 'hardy')] });
    const unit = lord();
    run.resolveThirdLord(unit);
    expect(unit.traits).toEqual(['hardy']);
    expect(unit.stats.HP).toBe(23);
  });
});
describe('advanced starting-skill unlocks', () => {
  it.each(['pavise', 'aegis', 'renewal'])(
    'gates %s behind a victory, charges currency, persists and applies an assigned slot',
    (skill) => {
      const meta = new MetaProgressionManager(data.metaUpgrades, 'test-meta');
      meta.totalValor = 2000;
      meta.totalSupply = 2000;
      expect(meta.purchaseUpgrade(`unlock_${skill}`)).toBe(false);
      meta.milestones.add('beatGame');
      expect(meta.purchaseUpgrade(`unlock_${skill}`)).toBe(true);
      expect(meta.totalValor).toBe(1500);
      expect(meta.assignSkill('Edric', skill)).toBe(true);
      expect(meta.assignSkill('Edric', 'sol')).toBe(false);
      const restored = new MetaProgressionManager(data.metaUpgrades, 'test-meta');
      expect(restored.getUnlockedSkills()).toContain(skill);
      const run = new RunManager(data);
      run.metaEffects = restored.getActiveEffects();
      run.startRun({ runSeed: 8, applyBlessingsAtStart: false });
      expect(run.roster.find((u) => u.name === 'Edric').skills).toContain(skill);
    },
  );
  it('keeps the reduced supply progression total within the prior ceiling', () => {
    const total = data.metaUpgrades
      .filter((u) => u.id !== 'legendary_lord_chance')
      .reduce((sum, u) => sum + u.costs.reduce((a, b) => a + b, 0), 0);
    expect(total).toBe(52628);
    expect(total / 53428).toBeLessThan(1.03);
  });
});
