// Imbue delivery + persistence: stones resolve through the `forge` loot
// category, and `_imbueId` survives the save/load round trip
// (serializeUnit → JSON → relinkWeapon).
import { describe, it, expect } from 'vitest';
import { generateLootChoices } from '../src/engine/LootSystem.js';
import { serializeUnit, relinkWeapon } from '../src/engine/RunManager.js';
import {
  applyImbue,
  getImbueById,
  getImbueCombatMods,
  isImbueStone,
} from '../src/engine/ImbueSystem.js';
import { applyForge } from '../src/engine/ForgeSystem.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const imbuesData = data.imbues;

function makeForgeOnlyLootTables(forgePool) {
  // Only the forge category has weight, so every generated card is a forge item.
  return {
    act2: {
      weapons: [],
      healing: [],
      statBooster: [],
      promotion: [],
      skillScroll: [],
      weaponArtScroll: [],
      legendaryWeapon: [],
      accessories: [],
      forge: forgePool,
      weights: { forge: 100, gold: 0 },
      goldRange: [0, 0],
    },
  };
}

describe('Imbue loot delivery', () => {
  it('imbuing stones resolve from the forge category when imbues data is provided', () => {
    const lootTables = makeForgeOnlyLootTables(['Prismatic Stone', 'Vampiric Imbuing Stone']);
    const choices = generateLootChoices(
      'act2',
      lootTables,
      data.weapons,
      data.consumables,
      2,
      0,
      data.accessories,
      data.whetstones,
      null,
      false,
      null,
      false,
      null,
      { imbues: imbuesData },
    );
    const stoneChoices = choices.filter((c) => c.type === 'forge' && isImbueStone(c.item));
    expect(stoneChoices).toHaveLength(2);
    const names = stoneChoices.map((c) => c.item.name).sort();
    expect(names).toEqual(['Prismatic Stone', 'Vampiric Imbuing Stone']);
    for (const choice of stoneChoices) {
      expect(choice.item.type).toBe('Whetstone');
      expect(choice.item.uid).toBeTruthy();
    }
  });

  it('regular whetstones still resolve alongside stones', () => {
    const lootTables = makeForgeOnlyLootTables(['Silver Whetstone']);
    const choices = generateLootChoices(
      'act2',
      lootTables,
      data.weapons,
      data.consumables,
      1,
      0,
      data.accessories,
      data.whetstones,
      null,
      false,
      null,
      false,
      null,
      { imbues: imbuesData },
    );
    expect(choices[0].type).toBe('forge');
    expect(choices[0].item.name).toBe('Silver Whetstone');
    expect(isImbueStone(choices[0].item)).toBe(false);
  });

  it('stones do not resolve without imbues data (fall back to gold fill)', () => {
    const lootTables = makeForgeOnlyLootTables(['Vampiric Imbuing Stone']);
    const choices = generateLootChoices(
      'act2',
      lootTables,
      data.weapons,
      data.consumables,
      1,
      0,
      data.accessories,
      data.whetstones,
      null,
      false,
      null,
      false,
      null,
      {},
    );
    expect(choices.every((c) => c.type === 'gold')).toBe(true);
  });

  it('real act2+ loot tables generate stone cards through the standard path', () => {
    // Sanity: with real data + imbues option, forge-category picks can produce
    // a stone (force the forge category by zeroing every other weight).
    const table = structuredClone(data.lootTables.act2);
    table.forge = ['Prismatic Stone'];
    table.weights = { forge: 100, gold: 0 };
    const lootTables = { act2: table };
    const choices = generateLootChoices(
      'act2',
      lootTables,
      data.weapons,
      data.consumables,
      1,
      0,
      data.accessories,
      data.whetstones,
      null,
      false,
      null,
      false,
      null,
      { imbues: imbuesData },
    );
    expect(choices[0].type).toBe('forge');
    expect(choices[0].item.imbueId).toBe('choice');
  });
});

describe('Imbue serialization round trip', () => {
  function makeUnit() {
    const weapon = structuredClone(data.weapons.find((w) => w.name === 'Iron Sword'));
    return {
      name: 'Edric',
      className: 'Lord',
      tier: 'base',
      level: 5,
      stats: { HP: 24, STR: 9, MAG: 0, SKL: 9, SPD: 9, DEF: 6, RES: 3, LCK: 7 },
      currentHP: 24,
      faction: 'player',
      weapon,
      inventory: [weapon],
      consumables: [],
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      skills: [],
      moveType: 'Infantry',
    };
  }

  it('_imbueId and the imbued name survive serializeUnit → JSON → relinkWeapon', () => {
    const unit = makeUnit();
    applyImbue(unit.weapon, getImbueById(imbuesData, 'vampiric'));
    expect(unit.weapon.name).toBe('Vampiric Iron Sword');

    const serialized = serializeUnit(unit);
    const restored = JSON.parse(JSON.stringify(serialized));
    relinkWeapon(restored);

    expect(restored.weapon).toBe(restored.inventory[0]); // identity relinked
    expect(restored.weapon._imbueId).toBe('vampiric');
    expect(restored.weapon.name).toBe('Vampiric Iron Sword');
    // Effects still resolve from the catalog after the round trip
    expect(getImbueCombatMods(restored.weapon, imbuesData)).toMatchObject({ drainPercent: 0.3 });
  });

  it('imbue + forge state survive together', () => {
    const unit = makeUnit();
    applyForge(unit.weapon, 'might');
    applyImbue(unit.weapon, getImbueById(imbuesData, 'keen'));
    expect(unit.weapon.name).toBe('Keen Iron Sword +1');

    const restored = JSON.parse(JSON.stringify(serializeUnit(unit)));
    relinkWeapon(restored);

    expect(restored.weapon._imbueId).toBe('keen');
    expect(restored.weapon._forgeLevel).toBe(1);
    expect(restored.weapon._baseName).toBe('Keen Iron Sword');
    expect(restored.weapon.name).toBe('Keen Iron Sword +1');
  });
});
