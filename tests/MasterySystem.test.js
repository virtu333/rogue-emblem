import { describe, it, expect } from 'vitest';
import {
  recordBattleParticipation,
  getMasteryProgress,
  getBaseClassName,
  getMasteryThreshold,
  isMastered,
  getMasteryPerk,
  getMasteryCombatMods,
  getTraitXpMultiplier,
} from '../src/engine/MasterySystem.js';
import { getSkillCombatMods } from '../src/engine/SkillSystem.js';
import { createRecruitUnit, promoteUnit, reclassUnit } from '../src/engine/UnitManager.js';
import { serializeUnit } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';
import { MASTERY_BATTLES, MASTERY_MIN_BATTLES } from '../src/utils/constants.js';
import { UI_DEPTHS } from '../src/utils/uiDepths.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __testDir = dirname(fileURLToPath(import.meta.url));

const data = loadGameData();
const classes = data.classes;
const traits = data.traits;

function findClass(name) {
  return classes.find((c) => c.name === name);
}

describe('MasterySystem — battle participation & progress', () => {
  it('increments the current class counter', () => {
    const u = { className: 'Myrmidon' };
    recordBattleParticipation(u);
    recordBattleParticipation(u);
    expect(u.classBattles).toEqual({ Myrmidon: 2 });
    expect(getMasteryProgress(u, classes)).toBe(2);
  });

  it('resolves base class of a promoted class', () => {
    const u = { className: 'Swordmaster' };
    expect(getBaseClassName(u, classes)).toBe('Myrmidon');
  });

  it('base class returns itself as its own family', () => {
    expect(getBaseClassName({ className: 'Knight' }, classes)).toBe('Knight');
  });

  it('credits pre-promotion battles toward the promoted family', () => {
    const u = { className: 'Swordmaster', classBattles: { Myrmidon: 6, Swordmaster: 2 } };
    // current (2) + base (6) = 8
    expect(getMasteryProgress(u, classes)).toBe(8);
    expect(isMastered(u, classes, traits)).toBe(true);
  });

  it('carries battle continuity across promoteUnit', () => {
    const u = createRecruitUnit(
      { name: 'A', className: 'Myrmidon', level: 10 },
      findClass('Myrmidon'),
      data.weapons,
      null,
      null,
      null,
      classes,
    );
    for (let i = 0; i < 6; i++) recordBattleParticipation(u);
    expect(getMasteryProgress(u, classes)).toBe(6);
    const promoted = findClass('Swordmaster');
    promoteUnit(u, promoted, promoted.promotionBonuses || {}, data.skills);
    // classBattles preserved; still Myrmidon-keyed but credited to the family
    expect(u.classBattles.Myrmidon).toBe(6);
    for (let i = 0; i < 2; i++) recordBattleParticipation(u);
    expect(u.classBattles.Swordmaster).toBe(2);
    expect(getMasteryProgress(u, classes)).toBe(8);
    expect(isMastered(u, classes, traits)).toBe(true);
  });

  it('reclass resets progress (different family)', () => {
    const u = createRecruitUnit(
      { name: 'B', className: 'Myrmidon', level: 10 },
      findClass('Myrmidon'),
      data.weapons,
      null,
      null,
      null,
      classes,
    );
    for (let i = 0; i < 8; i++) recordBattleParticipation(u);
    expect(isMastered(u, classes, traits)).toBe(true);
    const target = findClass('Mercenary');
    reclassUnit(u, target, findClass('Myrmidon'), classes, data.skills);
    // Now Mercenary family — no Mercenary/base battles logged
    expect(u.className).toBe('Mercenary');
    expect(getMasteryProgress(u, classes)).toBe(0);
    expect(isMastered(u, classes, traits)).toBe(false);
  });
});

describe('MasterySystem — threshold & trait deltas', () => {
  it('default threshold is MASTERY_BATTLES', () => {
    expect(getMasteryThreshold({ traits: [] }, traits)).toBe(MASTERY_BATTLES);
  });

  it('Studious lowers threshold by 2', () => {
    expect(getMasteryThreshold({ traits: ['studious'] }, traits)).toBe(MASTERY_BATTLES - 2);
  });

  it('Slow Oath raises threshold by 2', () => {
    expect(getMasteryThreshold({ traits: ['slow_oath'] }, traits)).toBe(MASTERY_BATTLES + 2);
  });

  it('Studious and Slow Oath cancel out', () => {
    expect(getMasteryThreshold({ traits: ['studious', 'slow_oath'] }, traits)).toBe(
      MASTERY_BATTLES,
    );
  });

  it('threshold is floored at MASTERY_MIN_BATTLES', () => {
    // Two studious-like deltas can't drop below the floor.
    const u = { traits: ['studious', 'studious'] };
    expect(getMasteryThreshold(u, traits)).toBe(MASTERY_MIN_BATTLES);
  });
});

describe('MasterySystem — perk lookup & trait amplification', () => {
  it('returns the class-family perk', () => {
    const perk = getMasteryPerk({ className: 'Knight' }, classes, traits);
    expect(perk.name).toBe('Bulwark');
    expect(perk.mods).toEqual({ defBonus: 2 });
    expect(perk.classMods).toEqual({ defBonus: 2 });
    expect(perk.multiplier).toBe(1);
  });

  it('promoted class inherits the base-family perk', () => {
    const perk = getMasteryPerk({ className: 'Swordmaster' }, classes, traits);
    expect(perk.name).toBe("Duelist's Edge");
  });

  it('Reckless no longer touches the class perk', () => {
    const perk = getMasteryPerk({ className: 'Knight', traits: ['reckless'] }, classes, traits);
    expect(perk.name).toBe('Bulwark');
    expect(perk.mods).toEqual({ defBonus: 2 });
  });

  it('Slow Oath doubles the class perk and tags its name', () => {
    const perk = getMasteryPerk({ className: 'Cavalier', traits: ['slow_oath'] }, classes, traits);
    expect(perk.name).toBe('Wayfarer ×2');
    expect(perk.mods).toEqual({ atkBonus: 2, spdBonus: 2 });
    expect(perk.classMods).toEqual({ atkBonus: 1, spdBonus: 1 });
  });

  it('no trait ever lowers any class perk mod', () => {
    const regular = traits.filter((t) => !t.lordName);
    for (const cls of classes.filter((c) => c.masteryPerk)) {
      const base = getMasteryPerk({ className: cls.name }, classes, traits).mods;
      for (const trait of regular) {
        const perk = getMasteryPerk({ className: cls.name, traits: [trait.id] }, classes, traits);
        for (const [key, value] of Object.entries(base))
          expect(Math.abs(perk.mods[key]), `${trait.id} on ${cls.name}`).toBeGreaterThanOrEqual(
            Math.abs(value),
          );
      }
    }
  });
});

describe('MasterySystem — combat mods', () => {
  it('mastered unit contributes perk mods', () => {
    const u = { className: 'Archer', classBattles: { Archer: 8 } };
    const { mods, activated } = getMasteryCombatMods(u, classes, traits);
    expect(mods).toEqual({ hitBonus: 10, critBonus: 5 });
    expect(activated).toEqual({ id: 'mastery', name: 'Deadeye' });
  });

  it('un-mastered unit contributes nothing', () => {
    const u = { className: 'Archer', classBattles: { Archer: 3 } };
    const { mods, activated } = getMasteryCombatMods(u, classes, traits);
    expect(mods).toEqual({});
    expect(activated).toBeNull();
  });
});

describe('MasterySystem — trait XP multiplier', () => {
  it('applies Hungry (quick_study) 1.2x', () => {
    expect(getTraitXpMultiplier({ traits: ['quick_study'] }, traits)).toBeCloseTo(1.2);
  });
  it('defaults to 1 for no traits', () => {
    expect(getTraitXpMultiplier({ traits: [] }, traits)).toBe(1);
  });
});

describe('Mastery back-compat (pre-feature saves)', () => {
  it('reads gracefully with no classBattles/traits fields', () => {
    const legacy = { className: 'Mage' }; // no classBattles, no traits
    expect(getMasteryProgress(legacy, classes)).toBe(0);
    expect(isMastered(legacy, classes, null)).toBe(false);
    expect(() => getMasteryCombatMods(legacy, classes, null)).not.toThrow();
    expect(getTraitXpMultiplier(legacy, traits)).toBe(1);
    // recordBattleParticipation initializes the map
    recordBattleParticipation(legacy);
    expect(legacy.classBattles).toEqual({ Mage: 1 });
  });
});

describe('getSkillCombatMods — mastery/trait integration', () => {
  const plain = { name: 'Plain', avoidBonus: 0 };
  function mkUnit(overrides = {}) {
    return {
      name: 'U',
      className: 'Knight',
      col: 0,
      row: 0,
      currentHP: 20,
      stats: { HP: 20 },
      skills: [],
      weapon: null,
      ...overrides,
    };
  }

  it('merges mastered perk mods into combat mods', () => {
    const u = mkUnit({ classBattles: { Knight: 8 } });
    const opp = mkUnit({ name: 'O', col: 5, row: 5 });
    const mods = getSkillCombatMods(u, opp, [u], [opp], data.skills, plain, true, null, {
      classesData: classes,
      traitsData: traits,
    });
    expect(mods.defBonus).toBe(2);
    expect(mods.activated.some((a) => a.id === 'mastery')).toBe(true);
  });

  it('does NOT merge mastery when unit is not mastered', () => {
    const u = mkUnit({ classBattles: { Knight: 2 } });
    const opp = mkUnit({ name: 'O', col: 5, row: 5 });
    const mods = getSkillCombatMods(u, opp, [u], [opp], data.skills, plain, true, null, {
      classesData: classes,
      traitsData: traits,
    });
    expect(mods.defBonus).toBe(0);
  });

  it('applies trait combat mod only when the condition holds', () => {
    // Last Ember (cornered): +2 Atk, +15 crit at half HP or less
    const low = mkUnit({ traits: ['cornered'], currentHP: 5, stats: { HP: 20 } });
    const oppL = mkUnit({ name: 'O', col: 5, row: 5 });
    const lowMods = getSkillCombatMods(low, oppL, [low], [oppL], data.skills, plain, true, null, {
      classesData: classes,
      traitsData: traits,
    });
    expect(lowMods.critBonus).toBe(15);
    expect(lowMods.atkBonus).toBe(2);

    const high = mkUnit({ traits: ['cornered'], currentHP: 20, stats: { HP: 20 } });
    const oppH = mkUnit({ name: 'O', col: 5, row: 5 });
    const highMods = getSkillCombatMods(
      high,
      oppH,
      [high],
      [oppH],
      data.skills,
      plain,
      true,
      null,
      {
        classesData: classes,
        traitsData: traits,
      },
    );
    expect(highMods.critBonus).toBe(0);
  });

  it('empty-skills unit still receives mastery/trait mods (early-return regression)', () => {
    // skillsData omitted entirely — the known early-return gotcha must not skip mastery.
    const u = mkUnit({ className: 'Archer', classBattles: { Archer: 8 }, skills: [] });
    const opp = mkUnit({ name: 'O', col: 5, row: 5 });
    const mods = getSkillCombatMods(u, opp, [u], [opp], null, plain, true, null, {
      classesData: classes,
      traitsData: traits,
    });
    expect(mods.hitBonus).toBe(10);
    expect(mods.critBonus).toBe(5);
  });

  it('no context param → no mastery/trait mods (back-compat with old call sites)', () => {
    const u = mkUnit({ className: 'Archer', classBattles: { Archer: 8 } });
    const opp = mkUnit({ name: 'O', col: 5, row: 5 });
    const mods = getSkillCombatMods(u, opp, [u], [opp], data.skills, plain, true);
    expect(mods.hitBonus).toBe(0);
  });
});

describe('Mastery notice depth (renders above the loot overlay)', () => {
  it('MASTERY_NOTICE exceeds the loot dim/display depths', () => {
    expect(UI_DEPTHS.MASTERY_NOTICE).toBeGreaterThan(UI_DEPTHS.LOOT_OVERLAY_DIM);
    expect(UI_DEPTHS.MASTERY_NOTICE).toBeGreaterThan(UI_DEPTHS.LOOT_DISPLAY);
  });

  it('LOOT_OVERLAY_DIM matches the literal used by LootScreenController', () => {
    // The dim rect still uses a literal depth; keep the registry constant honest.
    const src = readFileSync(join(__testDir, '..', 'src', 'ui', 'LootScreenController.js'), 'utf8');
    expect(src).toContain(`.setDepth(${UI_DEPTHS.LOOT_OVERLAY_DIM})`);
  });

  it('PostCombatController mastery notice uses the registry constant', () => {
    const src = readFileSync(join(__testDir, '..', 'src', 'ui', 'PostCombatController.js'), 'utf8');
    expect(src).toContain('.setDepth(UI_DEPTHS.MASTERY_NOTICE)');
  });
});

describe('Serialization round-trip (classBattles + traits)', () => {
  it('preserves classBattles and traits through serializeUnit', () => {
    const u = createRecruitUnit(
      { name: 'S', className: 'Fighter', level: 3 },
      findClass('Fighter'),
      data.weapons,
      null,
      null,
      null,
      classes,
    );
    u.classBattles = { Fighter: 5 };
    u.traits = ['steady', 'lucky'];
    const s = serializeUnit(u);
    expect(s.classBattles).toEqual({ Fighter: 5 });
    expect(s.traits).toEqual(['steady', 'lucky']);
    // Round-trip via JSON (save/load) keeps them
    const restored = JSON.parse(JSON.stringify(s));
    expect(getMasteryProgress(restored, classes)).toBe(5);
  });
});
