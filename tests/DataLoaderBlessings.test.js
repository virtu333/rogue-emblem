import { describe, expect, it } from 'vitest';
import { DataLoader } from '../src/engine/DataLoader.js';

function makeMinimalPayload(path) {
  const defaults = {
    'data/terrain.json': [],
    'data/lords.json': [],
    'data/classes.json': [],
    'data/weapons.json': [],
    'data/skills.json': [],
    'data/mapSizes.json': [],
    'data/mapTemplates.json': {},
    'data/enemies.json': {},
    'data/consumables.json': [],
    'data/lootTables.json': {},
    'data/recruits.json': {},
    'data/metaUpgrades.json': [],
    'data/accessories.json': [],
    'data/whetstones.json': [],
    'data/turnBonus.json': {},
    'data/difficulty.json': {
      version: 1,
      modes: {
        normal: {
          enemyStatBonus: 0,
          enemyCountBonus: 0,
          enemyEquipTierShift: 0,
          enemySkillChance: 0,
          enemyPoisonChance: 0,
          enemyStatusStaffChance: 0,
          goldMultiplier: 1,
          shopPriceMultiplier: 1,
          lootQualityShift: 0,
          deployLimitBonus: 0,
          xpMultiplier: 1,
          fogChanceBonus: 0,
          reinforcementTurnOffset: 0,
          currencyMultiplier: 1,
          actsIncluded: ['act1'],
          extendedLevelingEnabled: false,
        },
        hard: {
          enemyStatBonus: 1,
          enemyCountBonus: 1,
          enemyEquipTierShift: 0,
          enemySkillChance: 0,
          enemyPoisonChance: 0,
          enemyStatusStaffChance: 0,
          goldMultiplier: 1,
          shopPriceMultiplier: 1,
          lootQualityShift: 0,
          deployLimitBonus: 0,
          xpMultiplier: 1,
          fogChanceBonus: 0,
          reinforcementTurnOffset: 0,
          currencyMultiplier: 1,
          actsIncluded: ['act1'],
          extendedLevelingEnabled: false,
        },
        lunatic: {
          enemyStatBonus: 2,
          enemyCountBonus: 2,
          enemyEquipTierShift: 0,
          enemySkillChance: 0,
          enemyPoisonChance: 0,
          enemyStatusStaffChance: 0,
          goldMultiplier: 1,
          shopPriceMultiplier: 1,
          lootQualityShift: 0,
          deployLimitBonus: 0,
          xpMultiplier: 1,
          fogChanceBonus: 0,
          reinforcementTurnOffset: 0,
          currencyMultiplier: 1,
          actsIncluded: ['act1'],
          extendedLevelingEnabled: false,
        },
      },
    },
  };
  return defaults[path];
}

describe('DataLoader blessings integration', () => {
  it('loads successfully when optional blessings file is missing', async () => {
    const loader = new DataLoader();
    loader.loadJSON = async (path) => makeMinimalPayload(path);
    loader.loadOptionalJSON = async () => null;
    const data = await loader.loadAll();
    expect(data.blessings).toBeNull();
    expect(data.difficulty).toBeTruthy();
  });

  it('throws cleanly for invalid blessings payload', async () => {
    const loader = new DataLoader();
    loader.loadJSON = async (path) => makeMinimalPayload(path);
    loader.loadOptionalJSON = async () => ({ version: 1, blessings: [] });
    await expect(loader.loadAll()).rejects.toThrow('Invalid blessings data');
  });

  it('throws cleanly for invalid difficulty payload', async () => {
    const loader = new DataLoader();
    loader.loadJSON = async (path) => {
      if (path === 'data/difficulty.json') {
        return { version: 1, modes: { normal: {} } };
      }
      return makeMinimalPayload(path);
    };
    loader.loadOptionalJSON = async () => null;
    await expect(loader.loadAll()).rejects.toThrow('Invalid difficulty data');
  });

  it('loads optional dialogue payload when present', async () => {
    const loader = new DataLoader();
    loader.loadJSON = async (path) => makeMinimalPayload(path);
    loader.loadOptionalJSON = async (path) => {
      if (path === 'data/dialogue.json') {
        return { recruitLines: { Fighter: ['Hello there.'] } };
      }
      return null;
    };
    const data = await loader.loadAll();
    expect(data.dialogue).toBeTruthy();
    expect(data.dialogue.recruitLines.Fighter.length).toBe(1);
  });

  it('loads optional weapon arts payload when present', async () => {
    const loader = new DataLoader();
    loader.loadJSON = async (path) => makeMinimalPayload(path);
    loader.loadOptionalJSON = async (path) => {
      if (path === 'data/weaponArts.json') {
        return { version: 1, arts: [{ id: 'test_art', weaponType: 'Sword' }] };
      }
      return null;
    };
    const data = await loader.loadAll();
    expect(data.weaponArts).toBeTruthy();
    expect(data.weaponArts.arts[0].id).toBe('test_art');
  });
});

