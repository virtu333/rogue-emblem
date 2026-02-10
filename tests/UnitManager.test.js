import { describe, it, expect } from 'vitest';
import {
  parseWeaponProficiencies,
  rollGrowthRates,
  createLordUnit,
  createEnemyUnit,
  createRecruitUnit,
  levelUp,
  gainExperience,
  canPromote,
  promoteUnit,
  canEquip,
  getCombatWeapons,
  addToInventory,
  removeFromInventory,
  learnSkill,
  getClassInnateSkills,
  applyStatBoost,
} from '../src/engine/UnitManager.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

describe('parseWeaponProficiencies', () => {
  it('parses single proficiency', () => {
    const result = parseWeaponProficiencies('Swords (P)');
    expect(result).toEqual([{ type: 'Sword', rank: 'Prof' }]);
  });

  it('parses multiple proficiencies', () => {
    const result = parseWeaponProficiencies('Lances (M), Axes (P)');
    expect(result).toEqual([
      { type: 'Lance', rank: 'Mast' },
      { type: 'Axe', rank: 'Prof' },
    ]);
  });

  it('returns empty for None', () => {
    expect(parseWeaponProficiencies('None')).toEqual([]);
    expect(parseWeaponProficiencies('')).toEqual([]);
  });
});

describe('rollGrowthRates', () => {
  it('rolls values within range', () => {
    const myrmidon = data.classes.find(c => c.name === 'Myrmidon');
    const growths = rollGrowthRates(myrmidon.growthRanges);
    expect(growths.HP).toBeGreaterThanOrEqual(0);
    expect(growths.STR).toBeGreaterThanOrEqual(0);
    expect(growths.SPD).toBeGreaterThanOrEqual(0);
    // Check it's within the actual range
    const [minHP, maxHP] = myrmidon.growthRanges.HP.split('-').map(Number);
    expect(growths.HP).toBeGreaterThanOrEqual(minHP);
    expect(growths.HP).toBeLessThanOrEqual(maxHP);
  });
});

describe('createLordUnit', () => {
  it('creates Edric with correct properties', () => {
    const edric = data.lords[0];
    const edricClass = data.classes.find(c => c.name === edric.class);
    const unit = createLordUnit(edric, edricClass, data.weapons);

    expect(unit.name).toBe('Edric');
    expect(unit.isLord).toBe(true);
    expect(unit.faction).toBe('player');
    expect(unit.level).toBe(1);
    expect(unit.weapon).toBeTruthy();
    expect(unit.stats.HP).toBeGreaterThan(0);
    expect(unit.skills.length).toBeGreaterThanOrEqual(1); // personal skill
  });

  it('all four lords create without errors', () => {
    for (const lord of data.lords) {
      const classData = data.classes.find(c => c.name === lord.class);
      const unit = createLordUnit(lord, classData, data.weapons);
      expect(unit.name).toBe(lord.name);
      expect(unit.isLord).toBe(true);
    }
  });
});

describe('createEnemyUnit', () => {
  it('creates a base-class enemy at target level', () => {
    const myrmidon = data.classes.find(c => c.name === 'Myrmidon');
    const enemy = createEnemyUnit(myrmidon, 5, data.weapons);
    expect(enemy.faction).toBe('enemy');
    expect(enemy.level).toBe(5);
    expect(enemy.weapon).toBeTruthy();
  });

  it('creates all base classes without errors', () => {
    const baseClasses = data.classes.filter(c => c.tier === 'base');
    for (const cls of baseClasses) {
      const enemy = createEnemyUnit(cls, 3, data.weapons);
      expect(enemy.className).toBe(cls.name);
      expect(enemy.stats.HP).toBeGreaterThan(0);
    }
  });

  it('assigns skills to level 5+ enemies when skillsData provided', () => {
    const fighter = data.classes.find(c => c.name === 'Fighter');
    // Act3 has 20% skill chance — use finalBoss (30%) for more reliable test
    const enemy = createEnemyUnit(fighter, 6, data.weapons, 1.0, data.skills, 'finalBoss');
    // Level 5+ in finalBoss should get 30% chance for combat skill
    // Test probabilistically: run 100 times, expect ~30 with skills (binomial)
    let withSkills = 0;
    for (let i = 0; i < 100; i++) {
      const e = createEnemyUnit(fighter, 6, data.weapons, 1.0, data.skills, 'finalBoss');
      if (e.skills.length > 0) withSkills++;
    }
    expect(withSkills).toBeGreaterThan(15); // 30% ± margin
    expect(withSkills).toBeLessThan(45);
  });
});

describe('promoted enemy creation pattern', () => {
  it('creates promoted enemy via base class + promoteUnit', () => {
    const general = data.classes.find(c => c.name === 'General');
    const knight = data.classes.find(c => c.name === general.promotesFrom);
    const enemy = createEnemyUnit(knight, 10, data.weapons, 1.0, data.skills);
    promoteUnit(enemy, general, general.promotionBonuses, data.skills);

    expect(enemy.className).toBe('General');
    expect(enemy.tier).toBe('promoted');
    expect(enemy.level).toBe(1); // reset on promotion
  });
});

describe('levelUp', () => {
  it('returns stat gains based on growth rates', () => {
    const myrmidon = data.classes.find(c => c.name === 'Myrmidon');
    const unit = createEnemyUnit(myrmidon, 1, data.weapons);
    const result = levelUp(unit);
    expect(result).toBeTruthy();
    expect(result.gains).toBeDefined();
    // levelUp increments level and returns gains
    expect(result.newLevel).toBeDefined();
  });
});

describe('gainExperience', () => {
  it('levels up after gaining 100 XP', () => {
    const myrmidon = data.classes.find(c => c.name === 'Myrmidon');
    const unit = createEnemyUnit(myrmidon, 1, data.weapons);
    unit.faction = 'player'; // make it a player unit for XP
    const startLevel = unit.level;
    const result = gainExperience(unit, 100);
    expect(result.levelUps.length).toBe(1);
    expect(unit.level).toBe(startLevel + 1);
  });
});

describe('canPromote', () => {
  it('base class at level 10+ can promote', () => {
    const myrmidon = data.classes.find(c => c.name === 'Myrmidon');
    const unit = createEnemyUnit(myrmidon, 10, data.weapons);
    expect(canPromote(unit)).toBe(true);
  });

  it('base class at level 9 cannot promote', () => {
    const myrmidon = data.classes.find(c => c.name === 'Myrmidon');
    const unit = createEnemyUnit(myrmidon, 9, data.weapons);
    expect(canPromote(unit)).toBe(false);
  });

  it('promoted class cannot promote again', () => {
    const general = data.classes.find(c => c.name === 'General');
    const knight = data.classes.find(c => c.name === 'Knight');
    const unit = createEnemyUnit(knight, 10, data.weapons);
    promoteUnit(unit, general, general.promotionBonuses);
    expect(canPromote(unit)).toBe(false);
  });
});

describe('learnSkill', () => {
  it('learns a new skill', () => {
    const myrmidon = data.classes.find(c => c.name === 'Myrmidon');
    const unit = createEnemyUnit(myrmidon, 1, data.weapons);
    unit.skills = [];
    const result = learnSkill(unit, 'sol');
    expect(result.learned).toBe(true);
    expect(unit.skills).toContain('sol');
  });

  it('rejects duplicate skill', () => {
    const myrmidon = data.classes.find(c => c.name === 'Myrmidon');
    const unit = createEnemyUnit(myrmidon, 1, data.weapons);
    unit.skills = ['sol'];
    const result = learnSkill(unit, 'sol');
    expect(result.learned).toBe(false);
    expect(result.reason).toBe('already_known');
  });

  it('rejects at MAX_SKILLS cap', () => {
    const myrmidon = data.classes.find(c => c.name === 'Myrmidon');
    const unit = createEnemyUnit(myrmidon, 1, data.weapons);
    unit.skills = ['sol', 'luna', 'vantage', 'wrath', 'astra'];
    const result = learnSkill(unit, 'charisma');
    expect(result.learned).toBe(false);
    expect(result.reason).toBe('at_cap');
  });
});

describe('getCombatWeapons', () => {
  it('filters out staves and scrolls', () => {
    const myrmidon = data.classes.find(c => c.name === 'Myrmidon');
    const unit = createEnemyUnit(myrmidon, 1, data.weapons);
    const heal = data.weapons.find(w => w.name === 'Heal');
    if (heal) unit.inventory.push(heal);
    const combat = getCombatWeapons(unit);
    expect(combat.every(w => w.type !== 'Staff')).toBe(true);
    expect(combat.every(w => w.type !== 'Scroll')).toBe(true);
  });
});

describe('removeFromInventory', () => {
  it('auto-equips next combat weapon, skipping non-combat items', () => {
    const myrmidon = data.classes.find(c => c.name === 'Myrmidon');
    const unit = createEnemyUnit(myrmidon, 1, data.weapons);
    const sword = unit.weapon; // Iron Sword
    const consumable = { name: 'Vulnerary', type: 'Consumable', effect: 'heal', value: 10, uses: 3, price: 300 };
    const steelSword = data.weapons.find(w => w.name === 'Steel Sword');
    // Set up inventory: [sword, consumable, steelSword]
    unit.inventory = [sword, consumable];
    addToInventory(unit, steelSword);
    unit.weapon = sword;
    removeFromInventory(unit, sword);
    // Should skip consumable and equip Steel Sword (check name since weapons are now cloned)
    expect(unit.weapon.name).toBe('Steel Sword');
  });

  it('sets weapon to null when no combat weapons remain', () => {
    const myrmidon = data.classes.find(c => c.name === 'Myrmidon');
    const unit = createEnemyUnit(myrmidon, 1, data.weapons);
    const sword = unit.weapon;
    const consumable = { name: 'Vulnerary', type: 'Consumable', effect: 'heal', value: 10, uses: 3, price: 300 };
    unit.inventory = [sword, consumable];
    unit.weapon = sword;
    removeFromInventory(unit, sword);
    expect(unit.weapon).toBeNull();
  });
});

describe('createRecruitUnit', () => {
  const fighterClass = data.classes.find(c => c.name === 'Fighter');

  it('returns unit with faction npc', () => {
    const unit = createRecruitUnit({ className: 'Fighter', name: 'Galvin', level: 3 }, fighterClass, data.weapons);
    expect(unit.faction).toBe('npc');
    expect(unit.isLord).toBe(false);
  });

  it('has correct class, level, and name', () => {
    const unit = createRecruitUnit({ className: 'Fighter', name: 'Galvin', level: 5 }, fighterClass, data.weapons);
    expect(unit.className).toBe('Fighter');
    expect(unit.name).toBe('Galvin');
    expect(unit.level).toBe(5);
  });

  it('has a weapon appropriate to level', () => {
    const low = createRecruitUnit({ className: 'Fighter', name: 'Galvin', level: 2 }, fighterClass, data.weapons);
    expect(low.weapon).not.toBeNull();
    expect(low.weapon.tier).toBe('Iron');

    const mid = createRecruitUnit({ className: 'Fighter', name: 'Galvin', level: 8 }, fighterClass, data.weapons);
    expect(mid.weapon).not.toBeNull();
    expect(mid.weapon.tier).toBe('Steel');
  });

  it('applies growth bonuses before leveling', () => {
    const growthBonuses = { STR: 10, SPD: 10 };
    const unit = createRecruitUnit(
      { className: 'Fighter', name: 'Galvin', level: 1 },
      fighterClass, data.weapons, null, growthBonuses
    );
    // Growth bonuses should be applied to the unit's growths
    const baseGrowths = fighterClass.growthRanges;
    const [minSTR, maxSTR] = baseGrowths.STR.split('-').map(Number);
    // Unit growth should be base roll + 10
    expect(unit.growths.STR).toBeGreaterThanOrEqual(minSTR + 10);
    expect(unit.growths.STR).toBeLessThanOrEqual(maxSTR + 10);
  });

  it('applies flat stat bonuses after leveling', () => {
    const statBonuses = { STR: 1, HP: 2 };
    const unit = createRecruitUnit(
      { className: 'Fighter', name: 'Galvin', level: 1 },
      fighterClass, data.weapons, statBonuses
    );
    // Flat bonuses added on top of base stats
    expect(unit.stats.STR).toBe(fighterClass.baseStats.STR + 1);
    expect(unit.stats.HP).toBe(fighterClass.baseStats.HP + 2);
    expect(unit.currentHP).toBe(fighterClass.baseStats.HP + 2);
  });

  it('assigns a random skill from pool when randomSkillPool provided', () => {
    const pool = ['sol', 'luna', 'astra'];
    const unit = createRecruitUnit(
      { className: 'Fighter', name: 'Galvin', level: 1 },
      fighterClass, data.weapons, null, null, pool
    );
    expect(unit.skills.length).toBe(1);
    expect(pool).toContain(unit.skills[0]);
  });

  it('does not assign skill when randomSkillPool is null', () => {
    const unit = createRecruitUnit(
      { className: 'Fighter', name: 'Galvin', level: 1 },
      fighterClass, data.weapons, null, null, null
    );
    expect(unit.skills.length).toBe(0);
  });
});

describe('applyStatBoost', () => {
  it('increases STR by item value', () => {
    const myrmidon = data.classes.find(c => c.name === 'Myrmidon');
    const unit = createEnemyUnit(myrmidon, 1, data.weapons);
    const oldSTR = unit.stats.STR;
    applyStatBoost(unit, { stat: 'STR', value: 2 });
    expect(unit.stats.STR).toBe(oldSTR + 2);
  });

  it('increases HP and currentHP for HP booster', () => {
    const myrmidon = data.classes.find(c => c.name === 'Myrmidon');
    const unit = createEnemyUnit(myrmidon, 1, data.weapons);
    const oldHP = unit.stats.HP;
    const oldCurrent = unit.currentHP;
    applyStatBoost(unit, { stat: 'HP', value: 5 });
    expect(unit.stats.HP).toBe(oldHP + 5);
    expect(unit.currentHP).toBe(oldCurrent + 5);
  });

  it('works for all 7 stat types', () => {
    const boosters = [
      { stat: 'STR', value: 2 },
      { stat: 'MAG', value: 2 },
      { stat: 'SKL', value: 2 },
      { stat: 'SPD', value: 2 },
      { stat: 'DEF', value: 2 },
      { stat: 'RES', value: 2 },
      { stat: 'HP', value: 5 },
    ];
    const myrmidon = data.classes.find(c => c.name === 'Myrmidon');
    const unit = createEnemyUnit(myrmidon, 1, data.weapons);
    const before = { ...unit.stats };
    for (const b of boosters) {
      applyStatBoost(unit, b);
    }
    expect(unit.stats.STR).toBe(before.STR + 2);
    expect(unit.stats.MAG).toBe(before.MAG + 2);
    expect(unit.stats.SKL).toBe(before.SKL + 2);
    expect(unit.stats.SPD).toBe(before.SPD + 2);
    expect(unit.stats.DEF).toBe(before.DEF + 2);
    expect(unit.stats.RES).toBe(before.RES + 2);
    expect(unit.stats.HP).toBe(before.HP + 5);
  });

  it('does not change currentHP for non-HP stats', () => {
    const myrmidon = data.classes.find(c => c.name === 'Myrmidon');
    const unit = createEnemyUnit(myrmidon, 1, data.weapons);
    const oldCurrent = unit.currentHP;
    applyStatBoost(unit, { stat: 'STR', value: 2 });
    expect(unit.currentHP).toBe(oldCurrent);
  });
});

describe('Enemy skill scaling by act', () => {
  it('createEnemyUnit respects act1 skill chance (0%)', () => {
    const fighter = data.classes.find(c => c.name === 'Fighter');
    // Generate 100 level 5 enemies in act1, expect 0 combat skills (only innate)
    let withSkills = 0;
    for (let i = 0; i < 100; i++) {
      const enemy = createEnemyUnit(fighter, 5, data.weapons, 1.0, data.skills, 'act1');
      if (enemy.skills.length > 0) withSkills++;
    }
    expect(withSkills).toBe(0); // Act1 = 0% chance
  });

  it('createEnemyUnit respects act2 skill chance (10%)', () => {
    const fighter = data.classes.find(c => c.name === 'Fighter');
    // Generate 1000 level 5 enemies in act2, expect ~90-110 with combat skills (binomial)
    let withSkills = 0;
    for (let i = 0; i < 1000; i++) {
      const enemy = createEnemyUnit(fighter, 5, data.weapons, 1.0, data.skills, 'act2');
      if (enemy.skills.length > 0) withSkills++;
    }
    expect(withSkills).toBeGreaterThan(70); // 10% ± margin
    expect(withSkills).toBeLessThan(130);
  });

  it('createEnemyUnit respects act3 skill chance (20%)', () => {
    const fighter = data.classes.find(c => c.name === 'Fighter');
    // Generate 1000 level 5 enemies in act3, expect ~180-220 with combat skills
    let withSkills = 0;
    for (let i = 0; i < 1000; i++) {
      const enemy = createEnemyUnit(fighter, 5, data.weapons, 1.0, data.skills, 'act3');
      if (enemy.skills.length > 0) withSkills++;
    }
    expect(withSkills).toBeGreaterThan(160);
    expect(withSkills).toBeLessThan(240);
  });

  it('createEnemyUnit respects finalBoss skill chance (30%)', () => {
    const fighter = data.classes.find(c => c.name === 'Fighter');
    // Generate 1000 level 5 enemies in finalBoss, expect ~270-330 with combat skills
    let withSkills = 0;
    for (let i = 0; i < 1000; i++) {
      const enemy = createEnemyUnit(fighter, 5, data.weapons, 1.0, data.skills, 'finalBoss');
      if (enemy.skills.length > 0) withSkills++;
    }
    expect(withSkills).toBeGreaterThan(250);
    expect(withSkills).toBeLessThan(350);
  });
});
