import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import { validateMapTemplatesConfig } from '../src/engine/MapTemplateEngine.js';
import { validateCrossReferences } from '../tools/validateCrossReferences.js';

const DATA_DIR = path.resolve('data');
const SCHEMA_DIR = path.resolve('schemas');

function loadSchema(name) {
  return JSON.parse(readFileSync(path.join(SCHEMA_DIR, name), 'utf-8'));
}

function loadData(name) {
  return JSON.parse(readFileSync(path.join(DATA_DIR, name), 'utf-8'));
}

function compileSchema(name) {
  const ajv = new Ajv({ allErrors: true });
  return ajv.compile(loadSchema(name));
}

// --- Positive: real data files pass ---

describe('Schema validation — positive (real data)', () => {
  it('classes.json passes schema', () => {
    const validate = compileSchema('classes.schema.json');
    expect(validate(loadData('classes.json'))).toBe(true);
  });

  it('weapons.json passes schema', () => {
    const validate = compileSchema('weapons.schema.json');
    expect(validate(loadData('weapons.json'))).toBe(true);
  });

  it('skills.json passes schema', () => {
    const validate = compileSchema('skills.schema.json');
    expect(validate(loadData('skills.json'))).toBe(true);
  });

  it('enemies.json passes schema', () => {
    const validate = compileSchema('enemies.schema.json');
    expect(validate(loadData('enemies.json'))).toBe(true);
  });

  it('affixes.json passes schema', () => {
    const validate = compileSchema('affixes.schema.json');
    expect(validate(loadData('affixes.json'))).toBe(true);
  });

  it('blessings.json passes schema', () => {
    const validate = compileSchema('blessings.schema.json');
    expect(validate(loadData('blessings.json'))).toBe(true);
  });

  it('weaponArts.json passes schema', () => {
    const validate = compileSchema('weaponArts.schema.json');
    expect(validate(loadData('weaponArts.json'))).toBe(true);
  });

  it('accessories.json passes schema', () => {
    const validate = compileSchema('accessories.schema.json');
    expect(validate(loadData('accessories.json'))).toBe(true);
  });

  it('lootTables.json passes schema', () => {
    const validate = compileSchema('lootTables.schema.json');
    expect(validate(loadData('lootTables.json'))).toBe(true);
  });

  it('terrain.json passes schema', () => {
    const validate = compileSchema('terrain.schema.json');
    expect(validate(loadData('terrain.json'))).toBe(true);
  });

  it('lords.json passes schema', () => {
    const validate = compileSchema('lords.schema.json');
    expect(validate(loadData('lords.json'))).toBe(true);
  });

  it('consumables.json passes schema', () => {
    const validate = compileSchema('consumables.schema.json');
    expect(validate(loadData('consumables.json'))).toBe(true);
  });

  it('recruits.json passes schema', () => {
    const validate = compileSchema('recruits.schema.json');
    expect(validate(loadData('recruits.json'))).toBe(true);
  });

  it('metaUpgrades.json passes schema', () => {
    const validate = compileSchema('metaUpgrades.schema.json');
    expect(validate(loadData('metaUpgrades.json'))).toBe(true);
  });

  it('mapTemplates.json passes engine validator', () => {
    const data = loadData('mapTemplates.json');
    const result = validateMapTemplatesConfig(data);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe('Cross-reference validation', () => {
  it('passes for current data files', () => {
    const result = validateCrossReferences();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails when a weapon references an unknown skill', () => {
    const classes = loadData('classes.json');
    const skills = loadData('skills.json');
    const weapons = loadData('weapons.json');
    const lootTables = loadData('lootTables.json');
    const accessories = loadData('accessories.json');
    const consumables = loadData('consumables.json');
    const lords = loadData('lords.json');
    const recruits = loadData('recruits.json');
    const weaponArts = loadData('weaponArts.json');

    const badWeapons = structuredClone(weapons);
    badWeapons[0].skillId = '__missing_skill__';

    const result = validateCrossReferences({
      classes,
      skills,
      weapons: badWeapons,
      weaponArts,
      lootTables,
      accessories,
      consumables,
      lords,
      recruits,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((entry) => entry.includes('__missing_skill__'))).toBe(true);
  });
});

// --- Negative: known-bad fixtures catch errors ---

describe('Schema validation — negative (known-bad fixtures)', () => {
  it('rejects class missing baseStats', () => {
    const validate = compileSchema('classes.schema.json');
    const bad = [
      {
        name: 'BadClass',
        tier: 'base',
        moveType: 'Infantry',
        weaponProficiencies: 'Swords (P)',
        role: 'Melee DPS',
        growthRanges: {
          HP: '50-60',
          STR: '40-50',
          MAG: '10-20',
          SKL: '40-50',
          SPD: '40-50',
          DEF: '20-30',
          RES: '20-30',
          LCK: '30-40',
        },
        promotesTo: 'Swordmaster',
      },
    ];
    expect(validate(bad)).toBe(false);
  });

  it('rejects weapon with invalid type enum', () => {
    const validate = compileSchema('weapons.schema.json');
    const bad = [
      {
        name: 'Bad Weapon',
        type: 'Wand',
        tier: 'Iron',
        rankRequired: 'Prof',
        might: 5,
        hit: 90,
        crit: 0,
        weight: 3,
        range: '1',
        special: '',
        price: 500,
      },
    ];
    expect(validate(bad)).toBe(false);
  });

  it('rejects skill with invalid trigger enum', () => {
    const validate = compileSchema('skills.schema.json');
    const bad = [
      {
        id: 'bad_skill',
        name: 'Bad Skill',
        description: 'Does nothing',
        trigger: 'on-death',
      },
    ];
    expect(validate(bad)).toBe(false);
  });

  it('rejects enemies missing pools key', () => {
    const validate = compileSchema('enemies.schema.json');
    const bad = {
      bosses: {},
      enemyCountByTiles: {},
    };
    expect(validate(bad)).toBe(false);
  });

  it('rejects weapon with extra properties', () => {
    const validate = compileSchema('weapons.schema.json');
    const bad = [
      {
        name: 'Bad Weapon',
        type: 'Sword',
        tier: 'Iron',
        rankRequired: 'Prof',
        might: 5,
        hit: 90,
        crit: 0,
        weight: 3,
        range: '1',
        special: '',
        price: 500,
        unknownField: true,
      },
    ];
    expect(validate(bad)).toBe(false);
  });

  it('accepts staff with a declared relocate kind', () => {
    const validate = compileSchema('weapons.schema.json');
    const good = [
      {
        name: 'Test Rescue',
        type: 'Staff',
        tier: 'Steel',
        rankRequired: 'Prof',
        might: 0,
        hit: 100,
        crit: 0,
        weight: 2,
        range: '2-3',
        uses: 2,
        perBattleUses: true,
        relocate: 'rescue',
        special: 'Pulls a distant ally to your side',
        price: 2400,
      },
    ];
    expect(validate(good)).toBe(true);
  });

  it('rejects staff with an invalid relocate value', () => {
    const validate = compileSchema('weapons.schema.json');
    const bad = [
      {
        name: 'Bad Relocate',
        type: 'Staff',
        tier: 'Steel',
        rankRequired: 'Prof',
        might: 0,
        hit: 100,
        crit: 0,
        weight: 2,
        range: '2-3',
        uses: 2,
        perBattleUses: true,
        relocate: 'teleport',
        special: '',
        price: 2400,
      },
    ];
    expect(validate(bad)).toBe(false);
  });

  it('rejects class with extra properties', () => {
    const validate = compileSchema('classes.schema.json');
    const bad = [
      {
        name: 'BadClass',
        tier: 'base',
        baseStats: { HP: 18, STR: 5, MAG: 0, SKL: 6, SPD: 7, DEF: 4, RES: 1, LCK: 3, MOV: 5 },
        moveType: 'Infantry',
        weaponProficiencies: 'Swords (P)',
        role: 'Melee DPS',
        growthRanges: {
          HP: '50-60',
          STR: '40-50',
          MAG: '10-20',
          SKL: '40-50',
          SPD: '40-50',
          DEF: '20-30',
          RES: '20-30',
          LCK: '30-40',
        },
        promotesTo: 'Swordmaster',
        unknownField: true,
      },
    ];
    expect(validate(bad)).toBe(false);
  });
});

describe('Entity schema validation', () => {
  it('Entity bossClass entry passes classes schema', () => {
    const validate = compileSchema('classes.schema.json');
    const classes = loadData('classes.json');
    expect(validate(classes)).toBe(true);
    const entity = classes.find((c) => c.name === 'Entity');
    expect(entity).toBeDefined();
    expect(entity.tier).toBe('boss');
  });

  it('Entity boss definition passes enemies schema', () => {
    const validate = compileSchema('enemies.schema.json');
    const enemies = loadData('enemies.json');
    expect(validate(enemies)).toBe(true);
    const entityBoss = enemies.bosses.finalBoss.find((b) => b.isEntity);
    expect(entityBoss).toBeDefined();
    expect(entityBoss.className).toBe('Entity');
    expect(entityBoss.difficultyFilter).toContain('lunatic');
  });

  it('bossClass rejects extra fields', () => {
    const validate = compileSchema('classes.schema.json');
    const bad = [
      {
        name: 'BadBoss',
        tier: 'boss',
        baseStats: {
          HP: 100,
          STR: 20,
          MAG: 20,
          SKL: 20,
          SPD: 10,
          DEF: 20,
          RES: 20,
          LCK: 10,
          MOV: 0,
        },
        moveType: 'Infantry',
        weaponProficiencies: 'Swords (M)',
        role: 'test',
        growthRanges: { HP: '50-60' },
      },
    ];
    expect(validate(bad)).toBe(false);
  });
});
