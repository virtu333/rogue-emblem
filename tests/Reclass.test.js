import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createUnit,
  createLordUnit,
  canReclass,
  getReclassTargets,
  reclassUnit,
  canEquip,
  addToInventory,
  promoteUnit,
  learnSkill,
  getClassInnateSkills,
} from '../src/engine/UnitManager.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { loadGameData } from './testData.js';
import { MAX_SKILLS } from '../src/utils/constants.js';

const data = loadGameData();

// Mock localStorage for meta tests
const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => store[key] || null),
  setItem: vi.fn((key, val) => {
    store[key] = val;
  }),
  removeItem: vi.fn((key) => {
    delete store[key];
  }),
};
vi.stubGlobal('localStorage', localStorageMock);

function clearStore() {
  for (const key of Object.keys(store)) delete store[key];
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
}

// Helper: make a base-tier recruit at a given class
function makeRecruit(className, level = 5) {
  const cls = data.classes.find((c) => c.name === className);
  return createUnit(cls, level, data.weapons, { name: `Test ${className}` });
}

// Helper: promote a unit
function promoteTestUnit(unit) {
  const promotedClass = data.classes.find((c) => c.promotesFrom === unit.className);
  if (!promotedClass) return null;
  promoteUnit(unit, promotedClass, promotedClass.promotionBonuses, data.skills);
  return promotedClass;
}

describe('canReclass', () => {
  it('returns true for a normal recruit', () => {
    const unit = makeRecruit('Myrmidon');
    expect(canReclass(unit)).toBe(true);
  });

  it('returns false for a lord', () => {
    const edric = data.lords[0];
    const edricClass = data.classes.find((c) => c.name === edric.class);
    const unit = createLordUnit(edric, edricClass, data.weapons);
    expect(canReclass(unit)).toBe(false);
  });

  it('returns false for Dancer', () => {
    const unit = makeRecruit('Dancer');
    expect(canReclass(unit)).toBe(false);
  });

  it('returns false for lord-exclusive classes', () => {
    for (const cls of [
      'Lord',
      'Tactician',
      'Ranger',
      'Light Sage',
      'Chevalier',
      'Sky Lancer',
      'Sentinel',
    ]) {
      const classData = data.classes.find((c) => c.name === cls);
      if (!classData) continue;
      const unit = createUnit(classData, 5, data.weapons, { name: `Test ${cls}` });
      expect(canReclass(unit)).toBe(false);
    }
  });

  it('returns false for null/undefined', () => {
    expect(canReclass(null)).toBe(false);
    expect(canReclass(undefined)).toBe(false);
  });
});

describe('getReclassTargets', () => {
  describe('infantry seal (base tier)', () => {
    it('returns infantry/armored classes for a base Myrmidon', () => {
      const unit = makeRecruit('Myrmidon');
      const targets = getReclassTargets(unit, data.classes, 'infantry');
      expect(targets.length).toBeGreaterThan(0);
      for (const t of targets) {
        expect(t.tier).toBe('base');
        expect(['Infantry', 'Armored']).toContain(t.moveType);
      }
      // Should not include Myrmidon itself
      expect(targets.find((t) => t.name === 'Myrmidon')).toBeUndefined();
      // Should include Knight (Armored), Fighter (Infantry)
      expect(targets.find((t) => t.name === 'Knight')).toBeTruthy();
      expect(targets.find((t) => t.name === 'Fighter')).toBeTruthy();
    });

    it('excludes lord-only and Dancer/Bard classes', () => {
      const unit = makeRecruit('Myrmidon');
      const targets = getReclassTargets(unit, data.classes, 'infantry');
      const names = targets.map((t) => t.name);
      expect(names).not.toContain('Lord');
      expect(names).not.toContain('Dancer');
      expect(names).not.toContain('Tactician');
      expect(names).not.toContain('Ranger');
      expect(names).not.toContain('Light Sage');
      expect(names).not.toContain('Sentinel');
    });
  });

  describe('mounted seal (base tier)', () => {
    it('returns cavalry/flying classes for a base Cavalier', () => {
      const unit = makeRecruit('Cavalier');
      const targets = getReclassTargets(unit, data.classes, 'mounted');
      expect(targets.length).toBeGreaterThan(0);
      for (const t of targets) {
        expect(t.tier).toBe('base');
        expect(['Cavalry', 'Flying']).toContain(t.moveType);
      }
      expect(targets.find((t) => t.name === 'Cavalier')).toBeUndefined();
      expect(targets.find((t) => t.name === 'Pegasus Knight')).toBeTruthy();
      expect(targets.find((t) => t.name === 'Wyvern Rider')).toBeTruthy();
    });

    it('excludes lord-only mounted classes', () => {
      const unit = makeRecruit('Cavalier');
      const targets = getReclassTargets(unit, data.classes, 'mounted');
      const names = targets.map((t) => t.name);
      expect(names).not.toContain('Chevalier');
      expect(names).not.toContain('Sky Lancer');
    });
  });

  describe('promoted tier', () => {
    it('infantry seal returns promoted infantry/armored classes', () => {
      const unit = makeRecruit('Myrmidon', 10);
      promoteTestUnit(unit);
      expect(unit.tier).toBe('promoted');

      const targets = getReclassTargets(unit, data.classes, 'infantry');
      expect(targets.length).toBeGreaterThan(0);
      for (const t of targets) {
        expect(t.tier).toBe('promoted');
        expect(['Infantry', 'Armored']).toContain(t.moveType);
      }
      expect(targets.find((t) => t.name === 'Swordmaster')).toBeUndefined();
      expect(targets.find((t) => t.name === 'General')).toBeTruthy();
    });

    it('mounted seal returns promoted cavalry/flying classes', () => {
      const unit = makeRecruit('Cavalier', 10);
      promoteTestUnit(unit);
      expect(unit.tier).toBe('promoted');

      const targets = getReclassTargets(unit, data.classes, 'mounted');
      expect(targets.length).toBeGreaterThan(0);
      for (const t of targets) {
        expect(t.tier).toBe('promoted');
        expect(['Cavalry', 'Flying']).toContain(t.moveType);
      }
      expect(targets.find((t) => t.name === 'Paladin')).toBeUndefined();
      expect(targets.find((t) => t.name === 'Falcon Knight')).toBeTruthy();
    });
  });

  it('returns empty for lords', () => {
    const edric = data.lords[0];
    const edricClass = data.classes.find((c) => c.name === edric.class);
    const unit = createLordUnit(edric, edricClass, data.weapons);
    expect(getReclassTargets(unit, data.classes, 'infantry')).toEqual([]);
  });

  it('returns empty for invalid seal subEffect', () => {
    const unit = makeRecruit('Myrmidon');
    expect(getReclassTargets(unit, data.classes, 'invalid')).toEqual([]);
  });
});

describe('reclassUnit', () => {
  it('applies base-stat delta correctly', () => {
    const unit = makeRecruit('Myrmidon', 5);
    const oldClass = data.classes.find((c) => c.name === 'Myrmidon');
    const newClass = data.classes.find((c) => c.name === 'Knight');

    const preDEF = unit.stats.DEF;
    const preSTR = unit.stats.STR;
    const preSPD = unit.stats.SPD;

    reclassUnit(unit, newClass, oldClass, data.classes, data.skills);

    expect(unit.stats.DEF).toBe(
      Math.max(1, preDEF + (newClass.baseStats.DEF - oldClass.baseStats.DEF)),
    );
    expect(unit.stats.STR).toBe(
      Math.max(1, preSTR + (newClass.baseStats.STR - oldClass.baseStats.STR)),
    );
    expect(unit.stats.SPD).toBe(
      Math.max(1, preSPD + (newClass.baseStats.SPD - oldClass.baseStats.SPD)),
    );
  });

  it('clamps stats to minimum 1', () => {
    const unit = makeRecruit('Myrmidon', 1);
    const oldClass = data.classes.find((c) => c.name === 'Myrmidon');
    const newClass = data.classes.find((c) => c.name === 'Fighter');

    reclassUnit(unit, newClass, oldClass, data.classes, data.skills);
    expect(unit.stats.MAG).toBeGreaterThanOrEqual(1);
  });

  it('preserves HP ratio', () => {
    const unit = makeRecruit('Myrmidon', 5);
    const oldClass = data.classes.find((c) => c.name === 'Myrmidon');
    const newClass = data.classes.find((c) => c.name === 'Knight');

    unit.currentHP = Math.floor(unit.stats.HP / 2);
    const oldRatio = unit.currentHP / unit.stats.HP;

    reclassUnit(unit, newClass, oldClass, data.classes, data.skills);

    const newRatio = unit.currentHP / unit.stats.HP;
    expect(Math.abs(newRatio - oldRatio)).toBeLessThan(0.15);
    expect(unit.currentHP).toBeGreaterThanOrEqual(1);
    expect(unit.currentHP).toBeLessThanOrEqual(unit.stats.HP);
  });

  it('preserves level and XP', () => {
    const unit = makeRecruit('Myrmidon', 7);
    unit.xp = 42;
    const oldClass = data.classes.find((c) => c.name === 'Myrmidon');
    const newClass = data.classes.find((c) => c.name === 'Fighter');

    reclassUnit(unit, newClass, oldClass, data.classes, data.skills);

    expect(unit.level).toBe(7);
    expect(unit.xp).toBe(42);
  });

  it('updates className, moveType, and proficiencies', () => {
    const unit = makeRecruit('Myrmidon');
    const oldClass = data.classes.find((c) => c.name === 'Myrmidon');
    const newClass = data.classes.find((c) => c.name === 'Knight');

    reclassUnit(unit, newClass, oldClass, data.classes, data.skills);

    expect(unit.className).toBe('Knight');
    expect(unit.moveType).toBe('Armored');
    expect(unit.proficiencies.some((p) => p.type === 'Lance')).toBe(true);
  });

  it('re-rolls growths from new class', () => {
    const unit = makeRecruit('Myrmidon', 5);
    const oldClass = data.classes.find((c) => c.name === 'Myrmidon');
    const newClass = data.classes.find((c) => c.name === 'Knight');

    reclassUnit(unit, newClass, oldClass, data.classes, data.skills);

    expect(unit.growths).toBeDefined();
    expect(unit.growths.HP).toBeGreaterThanOrEqual(80);
    expect(unit.growths.HP).toBeLessThanOrEqual(95);
  });

  it('auto-unequips weapon if no longer proficient', () => {
    const unit = makeRecruit('Myrmidon');
    expect(unit.weapon).toBeTruthy();
    expect(unit.weapon.type).toBe('Sword');

    const oldClass = data.classes.find((c) => c.name === 'Myrmidon');
    const newClass = data.classes.find((c) => c.name === 'Knight');

    reclassUnit(unit, newClass, oldClass, data.classes, data.skills);

    // Weapon should be null (no lances in inventory) or a valid equippable weapon
    if (unit.weapon) {
      expect(canEquip(unit, unit.weapon)).toBe(true);
    } else {
      expect(unit.weapon).toBeNull();
    }
  });

  it('adds new class innate skills (conservative — does not remove old)', () => {
    const unit = makeRecruit('Myrmidon', 10);
    const smClass = data.classes.find((c) => c.name === 'Swordmaster');
    promoteUnit(unit, smClass, smClass.promotionBonuses, data.skills);

    const smInnates = getClassInnateSkills('Swordmaster', data.skills);

    const oldClass = data.classes.find((c) => c.name === 'Swordmaster');
    const newClass = data.classes.find((c) => c.name === 'General');

    reclassUnit(unit, newClass, oldClass, data.classes, data.skills);

    const genInnates = getClassInnateSkills('General', data.skills);
    for (const sid of genInnates) {
      expect(unit.skills).toContain(sid);
    }
    // Conservative: old Swordmaster innates should still be present
    for (const sid of smInnates) {
      expect(unit.skills).toContain(sid);
    }
  });

  it('respects MAX_SKILLS cap when adding innates', () => {
    const unit = makeRecruit('Myrmidon', 10);
    unit.skills = ['sol', 'luna', 'astra', 'vantage', 'wrath'];
    expect(unit.skills.length).toBe(MAX_SKILLS);

    const oldClass = data.classes.find((c) => c.name === 'Myrmidon');
    const newClass = data.classes.find((c) => c.name === 'Knight');

    reclassUnit(unit, newClass, oldClass, data.classes, data.skills);

    expect(unit.skills.length).toBeLessThanOrEqual(MAX_SKILLS);
  });

  it('grants learnable skills at current level for new class', () => {
    const unit = makeRecruit('Fighter', 15);
    unit.skills = unit.skills.filter((s) => s !== 'vantage');

    const oldClass = data.classes.find((c) => c.name === 'Fighter');
    const newClass = data.classes.find((c) => c.name === 'Myrmidon');

    reclassUnit(unit, newClass, oldClass, data.classes, data.skills);

    expect(unit.skills).toContain('vantage');
  });

  it('works for promoted → promoted reclass', () => {
    const unit = makeRecruit('Myrmidon', 10);
    const smClass = data.classes.find((c) => c.name === 'Swordmaster');
    promoteUnit(unit, smClass, smClass.promotionBonuses, data.skills);
    expect(unit.tier).toBe('promoted');

    const oldClass = data.classes.find((c) => c.name === 'Swordmaster');
    const newClass = data.classes.find((c) => c.name === 'General');

    reclassUnit(unit, newClass, oldClass, data.classes, data.skills);

    expect(unit.className).toBe('General');
    expect(unit.tier).toBe('promoted');
    expect(unit.moveType).toBe('Armored');
  });

  it('uses promotesFrom base class growths plus promoted growthBonuses for promoted targets', () => {
    const unit = makeRecruit('Myrmidon', 10);
    const smClass = data.classes.find((c) => c.name === 'Swordmaster');
    promoteUnit(unit, smClass, smClass.promotionBonuses, data.skills);

    const oldClass = data.classes.find((c) => c.name === 'Swordmaster');
    const newClass = data.classes.find((c) => c.name === 'General');

    reclassUnit(unit, newClass, oldClass, data.classes, data.skills);

    // General re-rolls from Knight's base ranges, then layers General's
    // growthBonuses on top (matching promoteUnit's behavior).
    const knight = data.classes.find((c) => c.name === 'Knight');
    const hpBonus = newClass.growthBonuses?.HP || 0;
    expect(hpBonus).toBeGreaterThan(0); // guard: data still has the bonus
    expect(unit.growths.HP).toBeGreaterThanOrEqual(
      Number(knight.growthRanges.HP.split('-')[0]) + hpBonus,
    );
    expect(unit.growths.HP).toBeLessThanOrEqual(
      Number(knight.growthRanges.HP.split('-')[1]) + hpBonus,
    );
  });

  it('applies real stat deltas on promoted → promoted reclass (regression: was a silent no-op)', () => {
    // Promoted classes carry no baseStats in classes.json; the old code diffed
    // {} vs {} and changed nothing. Effective base = promotesFrom base + promotionBonuses.
    const unit = makeRecruit('Myrmidon', 10);
    const smClass = data.classes.find((c) => c.name === 'Swordmaster');
    promoteUnit(unit, smClass, smClass.promotionBonuses, data.skills);

    const statsBefore = { ...unit.stats };
    const newClass = data.classes.find((c) => c.name === 'General');
    reclassUnit(unit, newClass, smClass, data.classes, data.skills);

    const myrm = data.classes.find((c) => c.name === 'Myrmidon');
    const knight = data.classes.find((c) => c.name === 'Knight');
    for (const stat of ['HP', 'STR', 'SPD', 'DEF', 'MOV']) {
      const oldBase = (myrm.baseStats[stat] || 0) + (smClass.promotionBonuses[stat] || 0);
      const newBase = (knight.baseStats[stat] || 0) + (newClass.promotionBonuses[stat] || 0);
      const expected = Math.max(1, statsBefore[stat] + (newBase - oldBase));
      expect(unit.stats[stat]).toBe(expected);
    }
    // A Swordmaster→General reclass must actually trade SPD for DEF.
    expect(unit.stats.DEF).toBeGreaterThan(statsBefore.DEF);
    expect(unit.stats.SPD).toBeLessThan(statsBefore.SPD);
    expect(unit.mov).toBe(unit.stats.MOV);
  });

  it('base-tier reclass stat deltas are unchanged by the effective-base helper', () => {
    const unit = makeRecruit('Myrmidon', 5);
    const statsBefore = { ...unit.stats };
    const oldClass = data.classes.find((c) => c.name === 'Myrmidon');
    const newClass = data.classes.find((c) => c.name === 'Knight');

    reclassUnit(unit, newClass, oldClass, data.classes, data.skills);

    for (const stat of ['HP', 'STR', 'SPD', 'DEF', 'MOV']) {
      const expected = Math.max(
        1,
        statsBefore[stat] + ((newClass.baseStats[stat] || 0) - (oldClass.baseStats[stat] || 0)),
      );
      expect(unit.stats[stat]).toBe(expected);
    }
  });
});

describe('serialization round-trip', () => {
  it('reclassed unit serializes and restores correctly', () => {
    const unit = makeRecruit('Myrmidon', 5);
    const oldClass = data.classes.find((c) => c.name === 'Myrmidon');
    const newClass = data.classes.find((c) => c.name === 'Knight');

    reclassUnit(unit, newClass, oldClass, data.classes, data.skills);

    const serialized = JSON.parse(
      JSON.stringify({
        name: unit.name,
        className: unit.className,
        tier: unit.tier,
        level: unit.level,
        xp: unit.xp,
        stats: unit.stats,
        growths: unit.growths,
        currentHP: unit.currentHP,
        moveType: unit.moveType,
        proficiencies: unit.proficiencies,
        skills: unit.skills,
        inventory: unit.inventory,
        consumables: unit.consumables,
        weapon: unit.weapon,
        mov: unit.mov,
      }),
    );

    expect(serialized.className).toBe('Knight');
    expect(serialized.tier).toBe('base');
    expect(serialized.moveType).toBe('Armored');
    expect(serialized.proficiencies.some((p) => p.type === 'Lance')).toBe(true);
    expect(serialized.stats.HP).toBeGreaterThan(0);
    expect(serialized.currentHP).toBeGreaterThanOrEqual(1);
    expect(serialized.level).toBe(5);
  });
});

describe('meta upgrade integration', () => {
  beforeEach(() => clearStore());

  it('starting_reclass_seal upgrade surfaces in getActiveEffects', () => {
    const meta = new MetaProgressionManager(data.metaUpgrades, 'test_reclass_meta');

    const upgrade = data.metaUpgrades.find((u) => u.id === 'starting_reclass_seal');
    expect(upgrade).toBeTruthy();
    expect(upgrade.category).toBe('starting_equipment');
    expect(upgrade.costs).toEqual([200]);

    // Give valor and purchase
    meta.totalValor = 500;
    const bought = meta.purchaseUpgrade('starting_reclass_seal');
    expect(bought).toBe(true);

    const effects = meta.getActiveEffects();
    expect(effects.startingReclassSeal).toBe(1);
  });

  it('default startingReclassSeal is 0', () => {
    const meta = new MetaProgressionManager(data.metaUpgrades, 'test_reclass_default');
    const effects = meta.getActiveEffects();
    expect(effects.startingReclassSeal).toBe(0);
  });
});

describe('consumables data', () => {
  it('Infantry Seal exists with correct shape', () => {
    const seal = data.consumables.find((c) => c.name === 'Infantry Seal');
    expect(seal).toBeTruthy();
    expect(seal.type).toBe('Consumable');
    expect(seal.effect).toBe('reclass');
    expect(seal.subEffect).toBe('infantry');
    expect(seal.uses).toBe(1);
    expect(seal.price).toBe(2000);
  });

  it('Mounted Seal exists with correct shape', () => {
    const seal = data.consumables.find((c) => c.name === 'Mounted Seal');
    expect(seal).toBeTruthy();
    expect(seal.type).toBe('Consumable');
    expect(seal.effect).toBe('reclass');
    expect(seal.subEffect).toBe('mounted');
    expect(seal.uses).toBe(1);
    expect(seal.price).toBe(2500);
  });
});

describe('loot tables', () => {
  it('act2 promotion pool includes Infantry Seal', () => {
    expect(data.lootTables.act2.promotion).toContain('Infantry Seal');
  });

  it('act3 promotion pool includes both seals', () => {
    expect(data.lootTables.act3.promotion).toContain('Infantry Seal');
    expect(data.lootTables.act3.promotion).toContain('Mounted Seal');
  });

  it('act1 promotion pool does not include reclass seals', () => {
    expect(data.lootTables.act1.promotion).not.toContain('Infantry Seal');
    expect(data.lootTables.act1.promotion).not.toContain('Mounted Seal');
  });
});
