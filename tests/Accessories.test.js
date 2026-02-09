// Accessories.test.js — Accessory equip/unequip, loot, shop, serialization
import { describe, it, expect, beforeAll } from 'vitest';
import { loadGameData } from './testData.js';
import {
  createUnit,
  equipAccessory,
  unequipAccessory,
} from '../src/engine/UnitManager.js';
import { generateLootChoices, generateShopInventory } from '../src/engine/LootSystem.js';
import { serializeUnit } from '../src/engine/RunManager.js';

let gameData;

beforeAll(() => {
  gameData = loadGameData();
});

function makeUnit() {
  const classData = gameData.classes.find(c => c.name === 'Myrmidon');
  return createUnit(classData, 5, gameData.weapons);
}

describe('Accessories', () => {
  describe('equipAccessory / unequipAccessory', () => {
    it('applies stat bonuses on equip', () => {
      const unit = makeUnit();
      const origSTR = unit.stats.STR;
      const ring = { name: 'Power Ring', type: 'Accessory', effects: { STR: 2 }, price: 1500 };
      equipAccessory(unit, ring);
      expect(unit.stats.STR).toBe(origSTR + 2);
      expect(unit.accessory).toBe(ring);
    });

    it('reverses stat bonuses on unequip', () => {
      const unit = makeUnit();
      const origDEF = unit.stats.DEF;
      const ring = { name: 'Shield Ring', type: 'Accessory', effects: { DEF: 2 }, price: 1500 };
      equipAccessory(unit, ring);
      expect(unit.stats.DEF).toBe(origDEF + 2);
      const old = unequipAccessory(unit);
      expect(unit.stats.DEF).toBe(origDEF);
      expect(old).toBe(ring);
      expect(unit.accessory).toBeNull();
    });

    it('roundtrip equip+unequip restores original stats', () => {
      const unit = makeUnit();
      const origStats = { ...unit.stats };
      const delphi = { name: 'Delphi Shield', type: 'Accessory', effects: { DEF: 3, RES: 3 }, price: 2500 };
      equipAccessory(unit, delphi);
      expect(unit.stats.DEF).toBe(origStats.DEF + 3);
      expect(unit.stats.RES).toBe(origStats.RES + 3);
      unequipAccessory(unit);
      expect(unit.stats.DEF).toBe(origStats.DEF);
      expect(unit.stats.RES).toBe(origStats.RES);
    });

    it('swaps accessories and returns old one', () => {
      const unit = makeUnit();
      const ring1 = { name: 'Power Ring', type: 'Accessory', effects: { STR: 2 }, price: 1500 };
      const ring2 = { name: 'Speed Ring', type: 'Accessory', effects: { SPD: 2 }, price: 2000 };
      equipAccessory(unit, ring1);
      const origSPD = unit.stats.SPD;
      const old = equipAccessory(unit, ring2);
      expect(old).toBe(ring1);
      expect(unit.accessory).toBe(ring2);
      expect(unit.stats.SPD).toBe(origSPD + 2);
    });

    it('clamps currentHP when unequipping HP accessory', () => {
      const unit = makeUnit();
      const robe = { name: 'Seraph Robe', type: 'Accessory', effects: { HP: 5 }, price: 2000 };
      equipAccessory(unit, robe);
      // Damage unit so currentHP is at the new max
      unit.currentHP = unit.stats.HP;
      unequipAccessory(unit);
      expect(unit.currentHP).toBe(unit.stats.HP); // clamped to new max
    });

    it('applies MOV bonus correctly', () => {
      const unit = makeUnit();
      const origMOV = unit.stats.MOV;
      const boots = { name: 'Boots', type: 'Accessory', effects: { MOV: 1 }, price: 3000 };
      equipAccessory(unit, boots);
      expect(unit.stats.MOV).toBe(origMOV + 1);
      unequipAccessory(unit);
      expect(unit.stats.MOV).toBe(origMOV);
    });

    it('unequip returns null when no accessory equipped', () => {
      const unit = makeUnit();
      const old = unequipAccessory(unit);
      expect(old).toBeNull();
    });
  });

  describe('Loot generation', () => {
    it('can generate accessory loot in act2+', () => {
      // Run many trials to check that accessories can appear
      let foundAccessory = false;
      for (let i = 0; i < 100; i++) {
        const choices = generateLootChoices(
          'act2', gameData.lootTables, gameData.weapons,
          gameData.consumables, 3, 0, gameData.accessories
        );
        if (choices.some(c => c.type === 'accessory')) {
          foundAccessory = true;
          break;
        }
      }
      expect(foundAccessory).toBe(true);
    });
  });

  describe('Shop inventory', () => {
    it('includes accessories in shop stock', () => {
      let foundAccessory = false;
      for (let i = 0; i < 50; i++) {
        const inventory = generateShopInventory(
          'act2', gameData.lootTables, gameData.weapons,
          gameData.consumables, gameData.accessories
        );
        if (inventory.some(entry => entry.type === 'accessory')) {
          foundAccessory = true;
          break;
        }
      }
      expect(foundAccessory).toBe(true);
    });
  });

  describe('Serialization', () => {
    it('unit with accessory survives JSON roundtrip', () => {
      const unit = makeUnit();
      const ring = { name: 'Skill Ring', type: 'Accessory', effects: { SKL: 3 }, price: 1500 };
      equipAccessory(unit, ring);
      const serialized = serializeUnit(unit);
      const json = JSON.stringify(serialized);
      const restored = JSON.parse(json);
      expect(restored.accessory).toEqual(ring);
      expect(restored.stats.SKL).toBe(unit.stats.SKL);
    });
  });
});
