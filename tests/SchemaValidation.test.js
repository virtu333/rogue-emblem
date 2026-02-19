import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import { validateMapTemplatesConfig } from '../src/engine/MapTemplateEngine.js';

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

  it('mapTemplates.json passes engine validator', () => {
    const data = loadData('mapTemplates.json');
    const result = validateMapTemplatesConfig(data);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
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
