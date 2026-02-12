import { describe, it, expect } from 'vitest';
import {
  parseWeaponProficiencies,
  rollGrowthRates,
  createUnit,
  createLordUnit,
  createEnemyUnit,
  createRecruitUnit,
  levelUp,
  gainExperience,
  canPromote,
  promoteUnit,
  canEquip,
  getCombatWeapons,
  equipWeapon,
  addToInventory,
  removeFromInventory,
  learnSkill,
  checkLevelUpSkills,
  getClassInnateSkills,
  applyStatBoost,
  calculateCombatXP,
  hasStaff,
  getStaffWeapon,
  resolvePromotionTargetClass,
} from '../src/engine/UnitManager.js';
import { loadGameData } from './testData.js';
import { XP_BASE_COMBAT, XP_KILL_BONUS, XP_LEVEL_DIFF_SCALE, XP_LEVEL_DIFF_STEEP, XP_MIN } from '../src/utils/constants.js';

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
    // finalBoss has 65% skill chance for level 5+ enemies
    const enemy = createEnemyUnit(fighter, 6, data.weapons, 1.0, data.skills, 'finalBoss');
    // Level 5+ in finalBoss should get 65% chance for combat skill
    // Test probabilistically: run 100 times, expect ~50-80 with skills (binomial)
    let withSkills = 0;
    for (let i = 0; i < 100; i++) {
      const e = createEnemyUnit(fighter, 6, data.weapons, 1.0, data.skills, 'finalBoss');
      if (e.skills.length > 0) withSkills++;
    }
    expect(withSkills).toBeGreaterThan(50); // 65% ± margin
    expect(withSkills).toBeLessThan(80);
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

  it('promotion upgrades all promoted weapon proficiencies to Mast', () => {
    const general = data.classes.find(c => c.name === 'General');
    const knight = data.classes.find(c => c.name === 'Knight');
    const unit = createEnemyUnit(knight, 10, data.weapons);
    promoteUnit(unit, general, general.promotionBonuses);
    expect(unit.proficiencies.length).toBeGreaterThan(0);
    expect(unit.proficiencies.every((p) => p.rank === 'Mast')).toBe(true);
  });

  it('promoted units can equip Mast-rank legendaries for their proficiencies', () => {
    const general = data.classes.find(c => c.name === 'General');
    const knight = data.classes.find(c => c.name === 'Knight');
    const unit = createEnemyUnit(knight, 10, data.weapons);
    promoteUnit(unit, general, general.promotionBonuses);

    const braveAxe = structuredClone(data.weapons.find(w => w.name === 'Brave Axe'));
    unit.inventory.push(braveAxe);

    expect(canEquip(unit, braveAxe)).toBe(true);
    equipWeapon(unit, braveAxe);
    expect(unit.weapon).toBe(braveAxe);
  });

  it('promotion normalizes class state and re-equips a legal weapon when needed', () => {
    const myrmidon = data.classes.find(c => c.name === 'Myrmidon');
    const unit = createEnemyUnit(myrmidon, 10, data.weapons);
    const ironLance = structuredClone(data.weapons.find(w => w.name === 'Iron Lance'));
    unit.inventory.push(ironLance);

    const customPromoted = {
      name: 'Skyblade Test',
      tier: 'promoted',
      baseStats: { MOV: 7 },
      moveType: 'Flying',
      weaponProficiencies: 'Lances (M)',
      promotionBonuses: {
        HP: 0, STR: 0, MAG: 0, SKL: 0, SPD: 0, DEF: 0, RES: 0, LCK: 0, MOV: 0,
      },
    };

    promoteUnit(unit, customPromoted, customPromoted.promotionBonuses, data.skills);

    expect(unit.className).toBe('Skyblade Test');
    expect(unit.tier).toBe('promoted');
    expect(unit.moveType).toBe('Flying');
    expect(unit.mov).toBe(unit.stats.MOV);
    expect(unit.proficiencies).toEqual([{ type: 'Lance', rank: 'Mast' }]);
    expect(unit.weapon?.type).toBe('Lance');
    expect(unit.weapon).toBe(ironLance);
  });
});

describe('resolvePromotionTargetClass', () => {
  it('returns a valid class for normal promotion targets', () => {
    const myrmidon = data.classes.find(c => c.name === 'Myrmidon');
    const unit = createEnemyUnit(myrmidon, 10, data.weapons);
    const target = resolvePromotionTargetClass(unit, data.classes, data.lords);
    expect(target?.name).toBe('Swordmaster');
  });

  it('returns null for blocked promotion target (Dancer -> Bard)', () => {
    const dancer = data.classes.find(c => c.name === 'Dancer');
    const unit = createEnemyUnit(dancer, 10, data.weapons);
    const target = resolvePromotionTargetClass(unit, data.classes, data.lords);
    expect(target).toBeNull();
  });

  it('returns Wyvern Lord for Wyvern Rider promotion', () => {
    const wyvernRider = data.classes.find(c => c.name === 'Wyvern Rider');
    const unit = createEnemyUnit(wyvernRider, 10, data.weapons);
    const target = resolvePromotionTargetClass(unit, data.classes, data.lords);
    expect(target?.name).toBe('Wyvern Lord');
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

describe('checkLevelUpSkills class thresholds', () => {
  it('base class does not learn class skill before level 15', () => {
    const unit = {
      className: 'Myrmidon',
      tier: 'base',
      level: 14,
      skills: [],
    };
    const learned = checkLevelUpSkills(unit, data.classes);
    expect(learned).toEqual([]);
    expect(unit.skills).not.toContain('vantage');
  });

  it('base class learns class skill at level 15', () => {
    const unit = {
      className: 'Myrmidon',
      tier: 'base',
      level: 15,
      skills: [],
    };
    const learned = checkLevelUpSkills(unit, data.classes);
    expect(learned).toContain('vantage');
    expect(unit.skills).toContain('vantage');
  });

  it('promoted class learns missed base-class skill at promoted level 10', () => {
    const unit = {
      className: 'Paladin',
      tier: 'promoted',
      level: 10,
      skills: [],
    };
    const learned = checkLevelUpSkills(unit, data.classes);
    expect(learned).toContain('sol');
    expect(unit.skills).toContain('sol');
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

  it('excludes non-proficient weapons', () => {
    const myrmidon = data.classes.find(c => c.name === 'Myrmidon');
    const unit = createEnemyUnit(myrmidon, 1, data.weapons);
    // Myrmidon has Sword proficiency — give them a Lance they can't use
    const lance = structuredClone(data.weapons.find(w => w.name === 'Iron Lance'));
    unit.inventory.push(lance);
    const combat = getCombatWeapons(unit);
    expect(combat.every(w => w.type !== 'Lance')).toBe(true);
    expect(combat.length).toBeGreaterThan(0); // still has swords
  });

  it('includes only proficient weapons', () => {
    const cavalier = data.classes.find(c => c.name === 'Cavalier');
    const unit = createEnemyUnit(cavalier, 1, data.weapons);
    // Cavalier has Sword + Lance — give them an Axe they can't use
    const axe = structuredClone(data.weapons.find(w => w.name === 'Iron Axe'));
    unit.inventory.push(axe);
    const combat = getCombatWeapons(unit);
    expect(combat.every(w => w.type === 'Sword' || w.type === 'Lance')).toBe(true);
  });
});

describe('equipWeapon', () => {
  it('allows equipping a proficient weapon', () => {
    const myrmidon = data.classes.find(c => c.name === 'Myrmidon');
    const unit = createEnemyUnit(myrmidon, 1, data.weapons);
    const steelSword = structuredClone(data.weapons.find(w => w.name === 'Steel Sword'));
    unit.inventory.push(steelSword);
    equipWeapon(unit, steelSword);
    expect(unit.weapon).toBe(steelSword);
  });

  it('rejects equipping a non-proficient weapon', () => {
    const myrmidon = data.classes.find(c => c.name === 'Myrmidon');
    const unit = createEnemyUnit(myrmidon, 1, data.weapons);
    const originalWeapon = unit.weapon;
    // Myrmidon cannot use Lances
    const lance = structuredClone(data.weapons.find(w => w.name === 'Iron Lance'));
    unit.inventory.push(lance);
    equipWeapon(unit, lance);
    expect(unit.weapon).toBe(originalWeapon); // unchanged
  });

  it('rejects equipping a weapon not in inventory', () => {
    const myrmidon = data.classes.find(c => c.name === 'Myrmidon');
    const unit = createEnemyUnit(myrmidon, 1, data.weapons);
    const originalWeapon = unit.weapon;
    const steelSword = structuredClone(data.weapons.find(w => w.name === 'Steel Sword'));
    // NOT added to inventory
    equipWeapon(unit, steelSword);
    expect(unit.weapon).toBe(originalWeapon); // unchanged
  });
});

describe('hasStaff / getStaffWeapon proficiency', () => {
  it('hasStaff returns false when unit lacks Staff proficiency', () => {
    const myrmidon = data.classes.find(c => c.name === 'Myrmidon');
    const unit = createEnemyUnit(myrmidon, 1, data.weapons);
    const heal = structuredClone(data.weapons.find(w => w.name === 'Heal'));
    unit.inventory.push(heal);
    expect(hasStaff(unit)).toBe(false);
  });

  it('hasStaff returns true when unit has Staff proficiency', () => {
    const cleric = data.classes.find(c => c.name === 'Cleric');
    const unit = createEnemyUnit(cleric, 1, data.weapons);
    expect(hasStaff(unit)).toBe(true);
  });

  it('getStaffWeapon returns null when unit lacks Staff proficiency', () => {
    const myrmidon = data.classes.find(c => c.name === 'Myrmidon');
    const unit = createEnemyUnit(myrmidon, 1, data.weapons);
    const heal = structuredClone(data.weapons.find(w => w.name === 'Heal'));
    unit.inventory.push(heal);
    expect(getStaffWeapon(unit)).toBeNull();
  });

  it('getStaffWeapon returns staff when unit has Staff proficiency', () => {
    const cleric = data.classes.find(c => c.name === 'Cleric');
    const unit = createEnemyUnit(cleric, 1, data.weapons);
    const staff = getStaffWeapon(unit);
    expect(staff).not.toBeNull();
    expect(staff.type).toBe('Staff');
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

  it('auto-equip skips non-proficient weapons', () => {
    const myrmidon = data.classes.find(c => c.name === 'Myrmidon');
    const unit = createEnemyUnit(myrmidon, 1, data.weapons);
    const sword = unit.weapon; // Iron Sword (proficient)
    // Add a non-proficient lance and a proficient steel sword
    const lance = structuredClone(data.weapons.find(w => w.name === 'Iron Lance'));
    const steelSword = structuredClone(data.weapons.find(w => w.name === 'Steel Sword'));
    unit.inventory = [sword, lance, steelSword];
    unit.weapon = sword;
    removeFromInventory(unit, sword);
    // Should skip lance (non-proficient) and equip Steel Sword
    expect(unit.weapon).toBe(steelSword);
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
  it('createEnemyUnit respects act1 skill chance (10%)', () => {
    const fighter = data.classes.find(c => c.name === 'Fighter');
    // Generate 1000 level 5 enemies in act1, expect ~80-120 with combat skills
    let withSkills = 0;
    for (let i = 0; i < 1000; i++) {
      const enemy = createEnemyUnit(fighter, 5, data.weapons, 1.0, data.skills, 'act1');
      if (enemy.skills.length > 0) withSkills++;
    }
    expect(withSkills).toBeGreaterThan(60); // 10% ± margin
    expect(withSkills).toBeLessThan(140);
  });

  it('createEnemyUnit respects act2 skill chance (25%)', () => {
    const fighter = data.classes.find(c => c.name === 'Fighter');
    // Generate 1000 level 5 enemies in act2, expect ~200-300 with combat skills
    let withSkills = 0;
    for (let i = 0; i < 1000; i++) {
      const enemy = createEnemyUnit(fighter, 5, data.weapons, 1.0, data.skills, 'act2');
      if (enemy.skills.length > 0) withSkills++;
    }
    expect(withSkills).toBeGreaterThan(200); // 25% ± margin
    expect(withSkills).toBeLessThan(300);
  });

  it('createEnemyUnit respects act3 skill chance (50%)', () => {
    const fighter = data.classes.find(c => c.name === 'Fighter');
    // Generate 1000 level 5 enemies in act3, expect ~450-550 with combat skills
    let withSkills = 0;
    for (let i = 0; i < 1000; i++) {
      const enemy = createEnemyUnit(fighter, 5, data.weapons, 1.0, data.skills, 'act3');
      if (enemy.skills.length > 0) withSkills++;
    }
    expect(withSkills).toBeGreaterThan(450);
    expect(withSkills).toBeLessThan(550);
  });

  it('createEnemyUnit respects finalBoss skill chance (65%)', () => {
    const fighter = data.classes.find(c => c.name === 'Fighter');
    // Generate 1000 level 5 enemies in finalBoss, expect ~600-720 with combat skills
    let withSkills = 0;
    for (let i = 0; i < 1000; i++) {
      const enemy = createEnemyUnit(fighter, 5, data.weapons, 1.0, data.skills, 'finalBoss');
      if (enemy.skills.length > 0) withSkills++;
    }
    expect(withSkills).toBeGreaterThan(600);
    expect(withSkills).toBeLessThan(720);
  });
});

describe('calculateCombatXP tiered diminishing returns', () => {
  const unit = (level) => ({ level, stats: {} });

  it('returns base XP at equal level', () => {
    expect(calculateCombatXP(unit(5), unit(5), false)).toBe(XP_BASE_COMBAT);
  });

  it('gives bonus for under-leveled attacker', () => {
    expect(calculateCombatXP(unit(3), unit(6), false)).toBe(XP_BASE_COMBAT + 3 * XP_LEVEL_DIFF_SCALE);
  });

  it('normal scale for advantage 1-3 (no kill)', () => {
    expect(calculateCombatXP(unit(5), unit(4), false)).toBe(XP_BASE_COMBAT - 1 * XP_LEVEL_DIFF_SCALE);
    expect(calculateCombatXP(unit(6), unit(3), false)).toBe(XP_BASE_COMBAT - 3 * XP_LEVEL_DIFF_SCALE);
  });

  it('steep scale kicks in at advantage 4', () => {
    const xp = calculateCombatXP(unit(7), unit(3), false);
    // First 3 levels: -15, next 1 level steep: -8
    expect(xp).toBe(XP_BASE_COMBAT - 3 * XP_LEVEL_DIFF_SCALE - 1 * XP_LEVEL_DIFF_STEEP);
  });

  it('advantage 5 uses steep scale for 2 extra levels', () => {
    const xp = calculateCombatXP(unit(8), unit(3), false);
    expect(xp).toBe(Math.max(XP_MIN, XP_BASE_COMBAT - 3 * XP_LEVEL_DIFF_SCALE - 2 * XP_LEVEL_DIFF_STEEP));
  });

  it('advantage 6 clamps to minimum', () => {
    const xp = calculateCombatXP(unit(9), unit(3), false);
    // 30 - 15 - 24 = -9 -> clamped to 1
    expect(xp).toBe(XP_MIN);
  });

  it('advantage 7+ returns flat minimum', () => {
    expect(calculateCombatXP(unit(10), unit(3), false)).toBe(XP_MIN);
    expect(calculateCombatXP(unit(15), unit(3), false)).toBe(XP_MIN);
    expect(calculateCombatXP(unit(20), unit(1), false)).toBe(XP_MIN);
  });

  it('kill bonus full in tier 1 (advantage 0-3)', () => {
    const noKill = calculateCombatXP(unit(5), unit(5), false);
    const kill = calculateCombatXP(unit(5), unit(5), true);
    expect(kill - noKill).toBe(XP_KILL_BONUS);
  });

  it('kill bonus halved in tier 2 (advantage 4-6)', () => {
    const noKill = calculateCombatXP(unit(7), unit(3), false);
    const kill = calculateCombatXP(unit(7), unit(3), true);
    expect(kill - noKill).toBe(Math.floor(XP_KILL_BONUS / 2));
  });

  it('no kill bonus in tier 3 (advantage 7+)', () => {
    const noKill = calculateCombatXP(unit(10), unit(3), false);
    const kill = calculateCombatXP(unit(10), unit(3), true);
    expect(kill).toBe(noKill);
  });

  it('never returns less than XP_MIN for any advantage', () => {
    for (let adv = 0; adv < 25; adv++) {
      const xp = calculateCombatXP(unit(1 + adv), unit(1), false);
      expect(xp).toBeGreaterThanOrEqual(XP_MIN);
    }
  });
});

describe('createUnit weapon cloning', () => {
  it('weapon is cloned from data array (not same reference)', () => {
    const myrmidon = data.classes.find(c => c.name === 'Myrmidon');
    const unit = createUnit(myrmidon, 1, data.weapons);
    const dataWeapon = data.weapons.find(w => w.name === unit.weapon.name);
    expect(unit.weapon).not.toBe(dataWeapon);
  });

  it('weapon === inventory[0] (same reference within unit)', () => {
    const myrmidon = data.classes.find(c => c.name === 'Myrmidon');
    const unit = createUnit(myrmidon, 1, data.weapons);
    expect(unit.weapon).toBe(unit.inventory[0]);
  });
});
