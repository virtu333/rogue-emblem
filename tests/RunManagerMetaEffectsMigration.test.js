import { describe, expect, it } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';

describe('RunManager meta-effects migration', () => {
  it('fromJSON maps legacy lootWeaponWeightBonus into quality and weapon category bonuses', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData, { lootWeaponWeightBonus: 13 });
    const json = rm.toJSON();
    json.metaEffects = { lootWeaponWeightBonus: 13 };

    const restored = RunManager.fromJSON(json, gameData);

    expect(restored.metaEffects.lootWeaponQualityBonus).toBe(13);
    expect(restored.metaEffects.lootCategoryWeightBonuses.weapon).toBe(13);
  });

  it('fromJSON adds migrated legacy bonus to existing weapon category weight bonus', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData, { lootWeaponWeightBonus: 7 });
    const json = rm.toJSON();
    json.metaEffects = {
      lootWeaponWeightBonus: 7,
      lootCategoryWeightBonuses: { weapon: 5, accessory: 2 },
    };

    const restored = RunManager.fromJSON(json, gameData);

    expect(restored.metaEffects.lootWeaponQualityBonus).toBe(7);
    expect(restored.metaEffects.lootCategoryWeightBonuses.weapon).toBe(12);
    expect(restored.metaEffects.lootCategoryWeightBonuses.accessory).toBe(2);
  });
});
