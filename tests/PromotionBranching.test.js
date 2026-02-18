import { describe, it, expect } from 'vitest';
import { loadGameData } from './testData.js';
import {
  createEnemyUnit,
  promoteUnit,
  canPromote,
  resolvePromotionTargets,
  resolvePromotionTargetClass,
  getClassInnateSkills,
} from '../src/engine/UnitManager.js';

const data = loadGameData();

// All 11 recruitable base classes that should have 2-element promotesTo
const BRANCHING_BASES = [
  'Myrmidon', 'Knight', 'Fighter', 'Cavalier', 'Archer',
  'Mage', 'Cleric', 'Thief', 'Mercenary', 'Pegasus Knight', 'Wyvern Rider',
];

// Expected promotion paths per spec
const EXPECTED_PATHS = {
  'Myrmidon':       ['Swordmaster', 'Duelist'],
  'Knight':         ['General', 'Great Knight'],
  'Fighter':        ['Warrior', 'Berserker'],
  'Cavalier':       ['Paladin', 'Dark Knight'],
  'Archer':         ['Sniper', 'Bow Knight'],
  'Mage':           ['Sage', 'Warlock'],
  'Cleric':         ['Bishop', 'Battle Monk'],
  'Thief':          ['Assassin', 'Trickster'],
  'Mercenary':      ['Hero', 'Hunter'],
  'Pegasus Knight': ['Falcon Knight', 'Wyvern Lord'],
  'Wyvern Rider':   ['Wyvern Lord', 'Falcon Knight'],
};

describe('Promotion Branching — Data Integrity', () => {
  it('every recruitable base class has promotesTo as 2-element array', () => {
    for (const baseName of BRANCHING_BASES) {
      const cls = data.classes.find(c => c.name === baseName);
      expect(cls, `${baseName} not found`).toBeTruthy();
      expect(Array.isArray(cls.promotesTo), `${baseName}.promotesTo not array`).toBe(true);
      expect(cls.promotesTo).toHaveLength(2);
    }
  });

  it('Dancer keeps string promotesTo "Bard"', () => {
    const dancer = data.classes.find(c => c.name === 'Dancer');
    expect(dancer).toBeTruthy();
    expect(dancer.promotesTo).toBe('Bard');
  });

  it('promotion paths match spec', () => {
    for (const [baseName, expected] of Object.entries(EXPECTED_PATHS)) {
      const cls = data.classes.find(c => c.name === baseName);
      expect(cls.promotesTo).toEqual(expected);
    }
  });

  it('every promoted class has valid promotesFrom, promotionBonuses, weaponProficiencies', () => {
    const promoted = data.classes.filter(c => c.tier === 'promoted');
    for (const cls of promoted) {
      expect(cls.promotesFrom, `${cls.name} missing promotesFrom`).toBeTruthy();
      expect(cls.promotionBonuses, `${cls.name} missing promotionBonuses`).toBeTruthy();
      expect(cls.weaponProficiencies, `${cls.name} missing weaponProficiencies`).toBeTruthy();
      // promotesFrom should reference a valid base class
      const base = data.classes.find(c => c.name === cls.promotesFrom);
      expect(base, `${cls.name}.promotesFrom "${cls.promotesFrom}" not found`).toBeTruthy();
      expect(base.tier).toBe('base');
    }
  });

  it('every classInnate skill references a valid promoted class', () => {
    for (const skill of data.skills) {
      if (!skill.classInnate) continue;
      const names = Array.isArray(skill.classInnate) ? skill.classInnate : [skill.classInnate];
      for (const name of names) {
        const cls = data.classes.find(c => c.name === name);
        expect(cls, `skill "${skill.id}" classInnate "${name}" not in classes.json`).toBeTruthy();
      }
    }
  });

  it('every growthBonuses has valid stat keys and positive values', () => {
    const validStats = ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK', 'MOV'];
    for (const cls of data.classes) {
      if (!cls.growthBonuses) continue;
      for (const [stat, val] of Object.entries(cls.growthBonuses)) {
        expect(validStats, `${cls.name} growthBonuses has invalid stat "${stat}"`).toContain(stat);
        expect(val, `${cls.name} growthBonuses.${stat} must be positive`).toBeGreaterThan(0);
      }
    }
  });

  it('cross-promotion: Pegasus Knight → [FK, WL], Wyvern Rider → [WL, FK]', () => {
    const peg = data.classes.find(c => c.name === 'Pegasus Knight');
    const wyv = data.classes.find(c => c.name === 'Wyvern Rider');
    expect(peg.promotesTo).toContain('Falcon Knight');
    expect(peg.promotesTo).toContain('Wyvern Lord');
    expect(wyv.promotesTo).toContain('Wyvern Lord');
    expect(wyv.promotesTo).toContain('Falcon Knight');
  });

  it('canto classInnate includes Great Knight', () => {
    const canto = data.skills.find(s => s.id === 'canto');
    expect(canto).toBeTruthy();
    expect(Array.isArray(canto.classInnate)).toBe(true);
    expect(canto.classInnate).toContain('Great Knight');
    expect(canto.classInnate).toContain('Paladin');
    expect(canto.classInnate).toContain('Falcon Knight');
  });
});

describe('Promotion Branching — Enemy Pools', () => {
  const B_PATH_CLASSES = [
    'Duelist', 'Great Knight', 'Berserker', 'Dark Knight', 'Bow Knight',
    'Warlock', 'Battle Monk', 'Trickster', 'Hunter',
  ];

  it('new B-path classes in act3 promoted pool', () => {
    const act3Promoted = data.enemies.pools.act3.promoted;
    for (const cls of ['Duelist', 'Great Knight', 'Berserker', 'Dark Knight', 'Bow Knight']) {
      expect(act3Promoted, `${cls} missing from act3 promoted pool`).toContain(cls);
    }
  });

  it('all B-path classes in postAct promoted pool', () => {
    const postAct = data.enemies.pools.postAct.promoted;
    for (const cls of B_PATH_CLASSES) {
      expect(postAct, `${cls} missing from postAct promoted pool`).toContain(cls);
    }
  });

  it('Dark Rider boss in act2', () => {
    const boss = data.enemies.bosses.act2.find(b => b.name === 'Dark Rider');
    expect(boss).toBeTruthy();
    expect(boss.className).toBe('Dark Knight');
  });

  it('Berserker King boss in act3', () => {
    const boss = data.enemies.bosses.act3.find(b => b.name === 'Berserker King');
    expect(boss).toBeTruthy();
    expect(boss.className).toBe('Berserker');
  });
});

describe('Promotion Branching — Resolution', () => {
  it('resolvePromotionTargets returns 2-element array for recruitable base units', () => {
    for (const baseName of BRANCHING_BASES) {
      const cls = data.classes.find(c => c.name === baseName);
      const unit = createEnemyUnit(cls, 10, data.weapons);
      const targets = resolvePromotionTargets(unit, data.classes, data.lords);
      expect(targets, `${baseName} should resolve 2 targets`).toHaveLength(2);
    }
  });

  it('resolvePromotionTargets returns 1-element array for lords', () => {
    for (const lord of data.lords) {
      const cls = data.classes.find(c => c.name === lord.class);
      const unit = {
        name: lord.name,
        className: lord.class,
        level: 10,
        tier: 'base',
        skills: [],
        proficiencies: cls ? [{ type: cls.weaponProficiencies.split(' ')[0] }] : [],
        stats: { ...cls.baseStats },
      };
      const targets = resolvePromotionTargets(unit, data.classes, data.lords);
      expect(targets, `Lord ${lord.name} should resolve 1 target`).toHaveLength(1);
      expect(targets[0].name).toBe(lord.promotedClass);
    }
  });

  it('resolvePromotionTargetClass wrapper returns first option', () => {
    const cls = data.classes.find(c => c.name === 'Myrmidon');
    const unit = createEnemyUnit(cls, 10, data.weapons);
    const result = resolvePromotionTargetClass(unit, data.classes, data.lords);
    expect(result.name).toBe('Swordmaster');
  });

  it('returns null for already-promoted units', () => {
    const cls = data.classes.find(c => c.name === 'Myrmidon');
    const promoted = data.classes.find(c => c.name === 'Swordmaster');
    const unit = createEnemyUnit(cls, 10, data.weapons);
    promoteUnit(unit, promoted, promoted.promotionBonuses, data.skills);
    const targets = resolvePromotionTargets(unit, data.classes, data.lords);
    expect(targets).toBeNull();
  });
});

describe('Promotion Branching — Enemy Spawning', () => {
  it('all 9 B-path classes can be created via base + promote', () => {
    const newClasses = [
      'Duelist', 'Great Knight', 'Berserker', 'Dark Knight', 'Bow Knight',
      'Warlock', 'Battle Monk', 'Trickster', 'Hunter',
    ];
    for (const name of newClasses) {
      const promoted = data.classes.find(c => c.name === name);
      expect(promoted, `${name} not found`).toBeTruthy();
      const base = data.classes.find(c => c.name === promoted.promotesFrom);
      expect(base, `base class ${promoted.promotesFrom} not found`).toBeTruthy();

      const unit = createEnemyUnit(base, 10, data.weapons);
      promoteUnit(unit, promoted, promoted.promotionBonuses, data.skills);
      expect(unit.className).toBe(name);
      expect(unit.tier).toBe('promoted');
    }
  });

  it('Dark Rider boss spawns as Dark Knight', () => {
    const boss = data.enemies.bosses.act2.find(b => b.name === 'Dark Rider');
    const promoted = data.classes.find(c => c.name === boss.className);
    const base = data.classes.find(c => c.name === promoted.promotesFrom);
    const unit = createEnemyUnit(base, boss.level, data.weapons);
    promoteUnit(unit, promoted, promoted.promotionBonuses, data.skills);
    expect(unit.className).toBe('Dark Knight');
  });

  it('Berserker King boss spawns as Berserker', () => {
    const boss = data.enemies.bosses.act3.find(b => b.name === 'Berserker King');
    const promoted = data.classes.find(c => c.name === boss.className);
    const base = data.classes.find(c => c.name === promoted.promotesFrom);
    const unit = createEnemyUnit(base, boss.level, data.weapons);
    promoteUnit(unit, promoted, promoted.promotionBonuses, data.skills);
    expect(unit.className).toBe('Berserker');
  });
});
