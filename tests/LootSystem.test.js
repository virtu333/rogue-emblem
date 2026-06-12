import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadGameData } from './testData.js';
import {
  calculateKillGold,
  calculateKillReward,
  calculateBattleGold,
  calculateSkipLootBonus,
  getSellPrice,
  generateLootChoices,
  generateShopInventory,
  generateRandomLegendary,
} from '../src/engine/LootSystem.js';
import {
  GOLD_PER_KILL_BASE,
  GOLD_PER_LEVEL_BONUS,
  GOLD_BATTLE_BONUS,
  GOLD_BOSS_BONUS,
  GOLD_PER_KILL_SOFT_CAP,
  GOLD_PER_KILL_EXCESS_RATE,
  GOLD_PROMOTED_BONUS_START_LEVEL,
  GOLD_PROMOTED_BONUS_PER_LEVEL,
  GOLD_PROMOTED_BONUS_MAX,
  SHOP_SELL_RATIO,
  LOOT_CHOICES,
  SHOP_ITEM_COUNT,
  NODE_GOLD_MULTIPLIER,
  GOLD_BATTLE_REWARD_MULTIPLIER,
  GOLD_LOOT_REWARD_MULTIPLIER,
} from '../src/utils/constants.js';

describe('LootSystem', () => {
  let gameData;

  beforeAll(() => {
    gameData = loadGameData();
  });

  describe('calculateKillGold', () => {
    it('returns base + level bonus for normal enemy', () => {
      const gold = calculateKillGold({ level: 1 });
      expect(gold).toBe(GOLD_PER_KILL_BASE + 1 * GOLD_PER_LEVEL_BONUS);
    });

    it('scales with enemy level', () => {
      const gold5 = calculateKillGold({ level: 5 });
      const gold10 = calculateKillGold({ level: 10 });
      expect(gold10).toBeGreaterThan(gold5);
      expect(gold5).toBe(GOLD_PER_KILL_BASE + 5 * GOLD_PER_LEVEL_BONUS);
    });

    it('uses soft-cap compression and delayed promoted bonus ramp', () => {
      const level = 20;
      const baseRaw = GOLD_PER_KILL_BASE + level * GOLD_PER_LEVEL_BONUS;
      const expectedSoft =
        baseRaw <= GOLD_PER_KILL_SOFT_CAP
          ? baseRaw
          : GOLD_PER_KILL_SOFT_CAP +
            Math.floor((baseRaw - GOLD_PER_KILL_SOFT_CAP) * GOLD_PER_KILL_EXCESS_RATE);
      const expectedPromoted = Math.min(
        GOLD_PROMOTED_BONUS_MAX,
        Math.max(0, level - GOLD_PROMOTED_BONUS_START_LEVEL) * GOLD_PROMOTED_BONUS_PER_LEVEL,
      );
      expect(calculateKillGold({ level, tier: 'promoted' })).toBe(expectedSoft + expectedPromoted);
    });

    it('matches promoted non-boss acceptance values', () => {
      const expected = new Map([
        [10, 108],
        [12, 118],
        [14, 128],
        [16, 141],
        [18, 155],
        [20, 168],
      ]);
      for (const [level, total] of expected) {
        expect(calculateKillGold({ level, tier: 'promoted', isBoss: false })).toBe(total);
      }
    });

    it('is monotonic for promoted non-boss levels 1..40', () => {
      let prev = calculateKillGold({ level: 1, tier: 'promoted', isBoss: false });
      for (let level = 2; level <= 40; level++) {
        const current = calculateKillGold({ level, tier: 'promoted', isBoss: false });
        expect(current).toBeGreaterThan(prev);
        prev = current;
      }
    });

    it('adds boss bonus for boss enemies', () => {
      const normal = calculateKillGold({ level: 5 });
      const boss = calculateKillGold({ level: 5, isBoss: true });
      expect(boss).toBe(normal + GOLD_BOSS_BONUS);
    });

    it('applies boss bonus after soft-cap compression and promoted bonus', () => {
      const promoted = calculateKillGold({ level: 24, tier: 'promoted', isBoss: false });
      const bossPromoted = calculateKillGold({ level: 24, tier: 'promoted', isBoss: true });
      expect(bossPromoted).toBe(promoted + GOLD_BOSS_BONUS);
    });
  });

  describe('calculateKillReward', () => {
    it('applies reward and pressure multipliers to base kill gold', () => {
      const enemy = { faction: 'enemy', level: 4, isBoss: false };
      const reward = calculateKillReward(enemy, null, {
        rewardMultiplier: 1.5,
        pressureGoldMultiplier: 2,
      });
      expect(reward).toBe(Math.floor(calculateKillGold(enemy) * 1.5 * 2));
    });

    it('adds flat bounty without applying multipliers to bounty bonus', () => {
      const enemy = { faction: 'enemy', level: 3, isBoss: false };
      const killer = { accessory: { combatEffects: { goldPerKill: 500 } } };
      const reward = calculateKillReward(enemy, killer, {
        rewardMultiplier: 2,
        pressureGoldMultiplier: 3,
      });
      expect(reward).toBe(Math.floor(calculateKillGold(enemy) * 2 * 3) + 500);
    });

    it('supports legacy bounty alias and ignores non-enemy targets', () => {
      const enemy = { faction: 'enemy', level: 2, isBoss: false };
      const killer = { accessory: { combatEffects: { bountyGoldOnKill: 250 } } };
      expect(calculateKillReward(enemy, killer)).toBe(calculateKillGold(enemy) + 250);
      expect(calculateKillReward({ faction: 'player', level: 2 }, killer)).toBe(0);
    });
  });

  describe('calculateBattleGold', () => {
    it('adds completion bonus to kill gold', () => {
      expect(calculateBattleGold(200)).toBe(
        Math.floor((200 + GOLD_BATTLE_BONUS) * GOLD_BATTLE_REWARD_MULTIPLIER),
      );
    });

    it('gives at least completion bonus for zero kills', () => {
      expect(calculateBattleGold(0)).toBe(
        Math.floor(GOLD_BATTLE_BONUS * GOLD_BATTLE_REWARD_MULTIPLIER),
      );
    });

    it('applies node type multiplier for recruit nodes', () => {
      const gold = calculateBattleGold(200, 'recruit');
      expect(gold).toBe(
        Math.floor(
          (Math.floor(200 * NODE_GOLD_MULTIPLIER.recruit) + GOLD_BATTLE_BONUS) *
            GOLD_BATTLE_REWARD_MULTIPLIER,
        ),
      );
    });

    it('applies node type multiplier for boss nodes', () => {
      const gold = calculateBattleGold(200, 'boss');
      expect(gold).toBe(
        Math.floor(
          (Math.floor(200 * NODE_GOLD_MULTIPLIER.boss) + GOLD_BATTLE_BONUS) *
            GOLD_BATTLE_REWARD_MULTIPLIER,
        ),
      );
    });

    it('uses 1.0 multiplier for unknown node types', () => {
      expect(calculateBattleGold(200, 'unknown')).toBe(
        Math.floor((200 + GOLD_BATTLE_BONUS) * GOLD_BATTLE_REWARD_MULTIPLIER),
      );
    });

    it('uses 1.0 multiplier when nodeType is undefined', () => {
      expect(calculateBattleGold(200)).toBe(
        Math.floor((200 + GOLD_BATTLE_BONUS) * GOLD_BATTLE_REWARD_MULTIPLIER),
      );
    });
  });

  describe('calculateSkipLootBonus', () => {
    it('returns 50% of battle gold', () => {
      const bonus = calculateSkipLootBonus(200);
      expect(bonus).toBe(100);
    });
  });

  describe('getSellPrice', () => {
    it('returns 50% of item price', () => {
      expect(getSellPrice({ price: 1000 })).toBe(500);
    });

    it('returns 0 for items with no price', () => {
      expect(getSellPrice({})).toBe(0);
      expect(getSellPrice({ price: 0 })).toBe(0);
    });

    it('floors fractional prices', () => {
      expect(getSellPrice({ price: 701 })).toBe(350);
    });
  });

  describe('generateLootChoices', () => {
    it('returns correct number of choices', () => {
      const choices = generateLootChoices(
        'act1',
        gameData.lootTables,
        gameData.weapons,
        gameData.consumables,
      );
      expect(choices.length).toBe(LOOT_CHOICES);
    });

    it('each choice has valid type', () => {
      for (let i = 0; i < 20; i++) {
        const choices = generateLootChoices(
          'act1',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
        );
        for (const choice of choices) {
          expect([
            'weapon',
            'healing',
            'statBooster',
            'promotion',
            'skillScroll',
            'weaponArtScroll',
            'legendaryWeapon',
            'gold',
            'accessory',
            'forge',
          ]).toContain(choice.type);
        }
      }
    });

    it('weapon choices have valid item data', () => {
      for (let i = 0; i < 30; i++) {
        const choices = generateLootChoices(
          'act1',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
        );
        const weaponChoices = choices.filter((c) => c.type === 'weapon');
        for (const choice of weaponChoices) {
          expect(choice.item).toBeTruthy();
          expect(choice.item.name).toBeTruthy();
          expect(choice.item.type).toBeTruthy();
        }
      }
    });

    it('non-gold loot choices include item uid', () => {
      const choices = generateLootChoices(
        'act2',
        gameData.lootTables,
        gameData.weapons,
        gameData.consumables,
        12,
        0,
        gameData.accessories,
        gameData.whetstones,
      );
      for (const choice of choices.filter((entry) => entry.item)) {
        expect(typeof choice.item.uid).toBe('string');
        expect(choice.item.uid.length).toBeGreaterThan(0);
      }
    });

    it('gold choices have goldAmount within range', () => {
      const [min, max] = gameData.lootTables.act1.goldRange;
      const scaledMin = Math.floor(min * GOLD_LOOT_REWARD_MULTIPLIER);
      const scaledMax = Math.floor(max * GOLD_LOOT_REWARD_MULTIPLIER);
      for (let i = 0; i < 50; i++) {
        const choices = generateLootChoices(
          'act1',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
        );
        const goldChoices = choices.filter((c) => c.type === 'gold');
        for (const choice of goldChoices) {
          expect(choice.goldAmount).toBeGreaterThanOrEqual(scaledMin);
          expect(choice.goldAmount).toBeLessThanOrEqual(scaledMax);
        }
      }
    });

    it('no duplicate item names in a single roll', () => {
      for (let i = 0; i < 30; i++) {
        const choices = generateLootChoices(
          'act2',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
        );
        const itemNames = choices.filter((c) => c.item).map((c) => c.item.name);
        expect(new Set(itemNames).size).toBe(itemNames.length);
      }
    });

    it('falls back to act3 table for unknown act', () => {
      const choices = generateLootChoices(
        'unknownAct',
        gameData.lootTables,
        gameData.weapons,
        gameData.consumables,
      );
      expect(choices.length).toBe(LOOT_CHOICES);
    });

    it('handles missing goldRange without NaN gold rewards', () => {
      const customTables = {
        act1: {
          weapons: [],
          healing: [],
          statBooster: [],
          promotion: [],
          skillScroll: [],
          weaponArtScroll: [],
          legendaryWeapon: [],
          accessories: [],
          forge: [],
          weights: { gold: 100 },
        },
      };
      const choices = generateLootChoices(
        'act1',
        customTables,
        gameData.weapons,
        gameData.consumables,
        3,
      );
      expect(choices.length).toBe(3);
      expect(choices.every((c) => c.type === 'gold')).toBe(true);
      for (const choice of choices) {
        expect(Number.isFinite(choice.goldAmount)).toBe(true);
        expect(Number.isNaN(choice.goldAmount)).toBe(false);
      }
    });

    it('handles malformed goldRange without NaN gold rewards', () => {
      const customTables = {
        act1: {
          weapons: [],
          healing: [],
          statBooster: [],
          promotion: [],
          skillScroll: [],
          weaponArtScroll: [],
          legendaryWeapon: [],
          accessories: [],
          forge: [],
          weights: { gold: 100 },
          goldRange: ['bad', -9],
        },
      };
      const choices = generateLootChoices(
        'act1',
        customTables,
        gameData.weapons,
        gameData.consumables,
        3,
      );
      expect(choices.length).toBe(3);
      expect(choices.every((c) => c.type === 'gold')).toBe(true);
      for (const choice of choices) {
        expect(Number.isFinite(choice.goldAmount)).toBe(true);
        expect(choice.goldAmount).toBeGreaterThanOrEqual(0);
      }
    });

    it('finalBoss returns exactly LOOT_CHOICES gold-only choices', () => {
      for (let i = 0; i < 10; i++) {
        const choices = generateLootChoices(
          'finalBoss',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
        );
        expect(choices.length).toBe(LOOT_CHOICES);
        expect(choices.every((c) => c.type === 'gold')).toBe(true);
      }
    });

    it('act2 can include skill/weapon-art/legendary drops', () => {
      let foundRareLikeDrop = false;
      for (let i = 0; i < 100; i++) {
        const choices = generateLootChoices(
          'act2',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
        );
        if (
          choices.some((c) =>
            ['skillScroll', 'weaponArtScroll', 'legendaryWeapon'].includes(c.type),
          )
        ) {
          foundRareLikeDrop = true;
          break;
        }
      }
      expect(foundRareLikeDrop).toBe(true);
    });

    it('does not force weapon upgrades without quality bonus', () => {
      const customTables = {
        act1: {
          weapons: ['Iron Sword'],
          healing: [],
          statBooster: [],
          promotion: [],
          skillScroll: [],
          weaponArtScroll: [],
          legendaryWeapon: [],
          accessories: [],
          forge: [],
          weights: { weapon: 100, gold: 0 },
          goldRange: [1, 1],
        },
      };
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      const choices = generateLootChoices(
        'act1',
        customTables,
        gameData.weapons,
        gameData.consumables,
        1,
        0,
      );
      randomSpy.mockRestore();
      expect(choices[0].type).toBe('weapon');
      expect(choices[0].item.tier).toBe('Iron');
    });

    it('upgrades loot weapon tiers with quality bonus', () => {
      const customTables = {
        act1: {
          weapons: ['Steel Axe'],
          healing: [],
          statBooster: [],
          promotion: [],
          skillScroll: [],
          weaponArtScroll: [],
          legendaryWeapon: [],
          accessories: [],
          forge: [],
          weights: { weapon: 100, gold: 0 },
          goldRange: [1, 1],
        },
      };
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      const choices = generateLootChoices(
        'act1',
        customTables,
        gameData.weapons,
        gameData.consumables,
        1,
        100,
      );
      randomSpy.mockRestore();
      expect(choices[0].type).toBe('weapon');
      expect(choices[0].item.tier).toBe('Legend');
    });

    it('upgrades one quality tier with 10% quality bonus when roll succeeds', () => {
      const customWeapons = [
        { name: 'Iron Axe', type: 'Axe', tier: 'Iron' },
        { name: 'Steel Axe', type: 'Axe', tier: 'Steel' },
        { name: 'Silver Axe', type: 'Axe', tier: 'Silver' },
        { name: 'Legend Axe', type: 'Axe', tier: 'Legend' },
      ];
      const customTables = {
        act1: {
          weapons: ['Iron Axe'],
          healing: [],
          statBooster: [],
          promotion: [],
          skillScroll: [],
          weaponArtScroll: [],
          legendaryWeapon: [],
          accessories: [],
          forge: [],
          weights: { weapon: 100, gold: 0 },
          goldRange: [1, 1],
        },
      };

      const randomValues = [0.5, 0.5, 0.05, 0.5, 0.95, 0.5];
      let randomIndex = 0;
      const randomSpy = vi
        .spyOn(Math, 'random')
        .mockImplementation(() => randomValues[randomIndex++] ?? 0);

      const choices = generateLootChoices('act1', customTables, customWeapons, [], 1, 10);

      randomSpy.mockRestore();
      expect(choices[0].type).toBe('weapon');
      expect(choices[0].item.tier).toBe('Steel');
    });

    it('can chain multiple upgrades at 20% quality bonus', () => {
      const customWeapons = [
        { name: 'Iron Axe', type: 'Axe', tier: 'Iron' },
        { name: 'Steel Axe', type: 'Axe', tier: 'Steel' },
        { name: 'Silver Axe', type: 'Axe', tier: 'Silver' },
        { name: 'Legend Axe', type: 'Axe', tier: 'Legend' },
      ];
      const customTables = {
        act1: {
          weapons: ['Iron Axe'],
          healing: [],
          statBooster: [],
          promotion: [],
          skillScroll: [],
          weaponArtScroll: [],
          legendaryWeapon: [],
          accessories: [],
          forge: [],
          weights: { weapon: 100, gold: 0 },
          goldRange: [1, 1],
        },
      };

      const randomValues = [0.5, 0.5, 0.05, 0.5, 0.05, 0.5, 0.05, 0.5];
      let randomIndex = 0;
      const randomSpy = vi
        .spyOn(Math, 'random')
        .mockImplementation(() => randomValues[randomIndex++] ?? 0);

      const choices = generateLootChoices('act1', customTables, customWeapons, [], 1, 20);

      randomSpy.mockRestore();
      expect(choices[0].type).toBe('weapon');
      expect(choices[0].item.tier).toBe('Legend');
    });
  });

  describe('generateRandomLegendary', () => {
    it('assigns uid and returns unique instances', () => {
      const a = generateRandomLegendary(gameData.weapons);
      const b = generateRandomLegendary(gameData.weapons);
      expect(typeof a.uid).toBe('string');
      expect(typeof b.uid).toBe('string');
      expect(a.uid).not.toBe(b.uid);
    });
  });

  describe('generateShopInventory', () => {
    it('returns correct number of items', () => {
      for (let i = 0; i < 20; i++) {
        const inv = generateShopInventory(
          'act1',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
        );
        expect(inv.length).toBeGreaterThanOrEqual(SHOP_ITEM_COUNT.min);
        expect(inv.length).toBeLessThanOrEqual(SHOP_ITEM_COUNT.max);
      }
    });

    it('always includes at least 1 weapon', () => {
      for (let i = 0; i < 20; i++) {
        const inv = generateShopInventory(
          'act1',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
        );
        expect(inv.some((i) => i.type === 'weapon')).toBe(true);
      }
    });

    it('always includes at least 1 consumable', () => {
      for (let i = 0; i < 20; i++) {
        const inv = generateShopInventory(
          'act1',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
        );
        expect(inv.some((i) => i.type === 'consumable')).toBe(true);
      }
    });

    it('all items have valid prices', () => {
      const inv = generateShopInventory(
        'act2',
        gameData.lootTables,
        gameData.weapons,
        gameData.consumables,
      );
      for (const entry of inv) {
        expect(entry.price).toBeGreaterThan(0);
        expect(entry.item.name).toBeTruthy();
      }
    });

    it('classifies scroll shop entries as scroll type', () => {
      const customTables = {
        act2: {
          weapons: ['Windsweep Scroll'],
          healing: ['Vulnerary'],
          statBooster: [],
          promotion: [],
          skillScroll: [],
          weaponArtScroll: [],
          legendaryWeapon: [],
          accessories: [],
          forge: [],
          weights: {
            weapon: 100,
            healing: 1,
            statBooster: 0,
            promotion: 0,
            skillScroll: 0,
            weaponArtScroll: 0,
            legendaryWeapon: 0,
            accessory: 0,
            forge: 0,
            gold: 0,
          },
          goldRange: [1, 1],
        },
      };
      const inv = generateShopInventory(
        'act2',
        customTables,
        gameData.weapons,
        gameData.consumables,
        gameData.accessories,
      );
      const scrollEntry = inv.find((entry) => entry.item.name === 'Windsweep Scroll');
      expect(scrollEntry).toBeTruthy();
      expect(scrollEntry.type).toBe('scroll');
    });

    it('respects roster weapon type filter for shop scroll pools', () => {
      const customTables = {
        act2: {
          weapons: ['Windsweep Scroll'],
          healing: ['Vulnerary'],
          statBooster: [],
          promotion: [],
          skillScroll: [],
          weaponArtScroll: [],
          legendaryWeapon: [],
          accessories: [],
          forge: [],
          weights: {
            weapon: 100,
            healing: 1,
            statBooster: 0,
            promotion: 0,
            skillScroll: 0,
            weaponArtScroll: 0,
            legendaryWeapon: 0,
            accessory: 0,
            forge: 0,
            gold: 0,
          },
          goldRange: [1, 1],
        },
      };
      const roster = [
        {
          proficiencies: [{ type: 'Axe', rank: 'Prof' }],
        },
      ];
      const inv = generateShopInventory(
        'act2',
        customTables,
        gameData.weapons,
        gameData.consumables,
        gameData.accessories,
        roster,
      );
      expect(inv.some((entry) => entry.item.name === 'Windsweep Scroll')).toBe(false);
    });

    it('no Legend-tier items in shop', () => {
      for (let i = 0; i < 30; i++) {
        const inv = generateShopInventory(
          'act3',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
        );
        for (const entry of inv) {
          expect(entry.item.tier).not.toBe('Legend');
        }
      }
    });

    it('no duplicate items', () => {
      for (let i = 0; i < 20; i++) {
        const inv = generateShopInventory(
          'act2',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
        );
        const names = inv.map((e) => e.item.name);
        expect(new Set(names).size).toBe(names.length);
      }
    });

    it('binds meta-unlocked art to spawned steel/iron shop weapons', () => {
      const customTables = {
        act1: {
          weapons: ['Steel Sword'],
          healing: ['Vulnerary'],
          statBooster: [],
          promotion: [],
          skillScroll: [],
          weaponArtScroll: [],
          legendaryWeapon: [],
          accessories: [],
          forge: [],
          weights: {
            weapon: 100,
            healing: 1,
            statBooster: 0,
            promotion: 0,
            skillScroll: 0,
            weaponArtScroll: 0,
            legendaryWeapon: 0,
            accessory: 0,
            forge: 0,
            gold: 0,
          },
          goldRange: [1, 1],
        },
      };
      const inv = generateShopInventory(
        'act1',
        customTables,
        gameData.weapons,
        gameData.consumables,
        gameData.accessories,
        null,
        {
          unlockedWeaponArtIds: ['sword_wrath_strike'],
          weaponArtCatalog: gameData.weaponArts.arts,
        },
      );
      const steelSword = inv.find((entry) => entry.item.name === 'Steel Sword')?.item;
      expect(steelSword).toBeTruthy();
      expect(steelSword.weaponArtId).toBe('sword_wrath_strike');
      expect(steelSword.weaponArtSource).toBe('meta_innate');
    });

    it('does not bind legendary-only arts onto non-legendary shop weapons', () => {
      const customTables = {
        act1: {
          weapons: ['Steel Sword'],
          healing: ['Vulnerary'],
          statBooster: [],
          promotion: [],
          skillScroll: [],
          weaponArtScroll: [],
          legendaryWeapon: [],
          accessories: [],
          forge: [],
          weights: {
            weapon: 100,
            healing: 1,
            statBooster: 0,
            promotion: 0,
            skillScroll: 0,
            weaponArtScroll: 0,
            legendaryWeapon: 0,
            accessory: 0,
            forge: 0,
            gold: 0,
          },
          goldRange: [1, 1],
        },
      };
      const inv = generateShopInventory(
        'act1',
        customTables,
        gameData.weapons,
        gameData.consumables,
        gameData.accessories,
        null,
        {
          unlockedWeaponArtIds: ['legend_gemini_tempest'],
          weaponArtCatalog: gameData.weaponArts.arts,
        },
      );
      const steelSword = inv.find((entry) => entry.item.name === 'Steel Sword')?.item;
      expect(steelSword).toBeTruthy();
      expect(steelSword.weaponArtId).toBeUndefined();
      expect(steelSword.weaponArtSource).toBeUndefined();
    });
  });

  describe('forge loot', () => {
    it('act2+ can include forge loot choices', () => {
      let foundForge = false;
      for (let i = 0; i < 200; i++) {
        const choices = generateLootChoices(
          'act2',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
          LOOT_CHOICES,
          0,
          gameData.accessories,
          gameData.whetstones,
        );
        if (choices.some((c) => c.type === 'forge')) {
          foundForge = true;
          break;
        }
      }
      expect(foundForge).toBe(true);
    });

    it('act1 forge pool excludes Crit and Silver whetstones', () => {
      const pool = gameData.lootTables.act1.forge;
      expect(pool).not.toContain('Crit Whetstone');
      expect(pool).not.toContain('Silver Whetstone');
      expect(pool).toContain('Might Whetstone');
    });

    it('act2 forge pool includes Silver Whetstone', () => {
      const pool = gameData.lootTables.act2.forge;
      expect(pool).toContain('Silver Whetstone');
      expect(pool).toContain('Crit Whetstone');
    });

    it('forge loot items have Whetstone type', () => {
      for (let i = 0; i < 200; i++) {
        const choices = generateLootChoices(
          'act2',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
          LOOT_CHOICES,
          0,
          gameData.accessories,
          gameData.whetstones,
        );
        for (const c of choices) {
          if (c.type === 'forge') {
            expect(c.item.type).toBe('Whetstone');
          }
        }
      }
    });
  });

  describe('roster weapon filtering', () => {
    const swordLanceRoster = [
      {
        proficiencies: [
          { type: 'Sword', rank: 'Proficient' },
          { type: 'Lance', rank: 'Proficient' },
        ],
      },
    ];

    it('shop weapons filtered to roster proficiencies', () => {
      for (let i = 0; i < 30; i++) {
        const inv = generateShopInventory(
          'act1',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
          gameData.accessories,
          swordLanceRoster,
        );
        for (const entry of inv) {
          if (entry.type === 'weapon') {
            const wpnData = gameData.weapons.find((w) => w.name === entry.item.name);
            if (wpnData) {
              expect(['Sword', 'Lance']).toContain(wpnData.type);
            }
          }
        }
      }
    });

    it('loot weapons filtered to roster proficiencies', () => {
      for (let i = 0; i < 50; i++) {
        const choices = generateLootChoices(
          'act1',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
          LOOT_CHOICES,
          0,
          gameData.accessories,
          gameData.whetstones,
          swordLanceRoster,
        );
        for (const c of choices) {
          if (c.type === 'weapon' && c.item) {
            const wpnData = gameData.weapons.find((w) => w.name === c.item.name);
            if (wpnData) {
              expect(['Sword', 'Lance']).toContain(wpnData.type);
            }
          }
        }
      }
    });

    it('non-weapon categories unaffected by roster filter', () => {
      let foundHealing = false;
      for (let i = 0; i < 50; i++) {
        const choices = generateLootChoices(
          'act1',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
          LOOT_CHOICES,
          0,
          gameData.accessories,
          gameData.whetstones,
          swordLanceRoster,
        );
        if (choices.some((c) => c.type === 'healing')) {
          foundHealing = true;
          break;
        }
      }
      expect(foundHealing).toBe(true);
    });

    it('shop still works without roster (no filter)', () => {
      const inv = generateShopInventory(
        'act1',
        gameData.lootTables,
        gameData.weapons,
        gameData.consumables,
      );
      expect(inv.length).toBeGreaterThanOrEqual(SHOP_ITEM_COUNT.min);
    });
  });

  describe('loot pool rebalance', () => {
    it('act1 weapon pool has no Iron weapons', () => {
      const pool = gameData.lootTables.act1.weapons;
      expect(pool).not.toContain('Iron Sword');
      expect(pool).not.toContain('Iron Lance');
      expect(pool).not.toContain('Iron Axe');
      expect(pool).not.toContain('Iron Bow');
    });

    it('act1 weapon pool has Steel weapons and specials', () => {
      const pool = gameData.lootTables.act1.weapons;
      expect(pool).toContain('Steel Sword');
      expect(pool).toContain('Steel Lance');
      expect(pool).toContain('Steel Axe');
      expect(pool).toContain('Steel Bow');
      expect(pool).not.toContain('Wo Dao');
      expect(pool).toContain('Lancereaver');
      expect(pool).toContain('Wind Sword');
    });

    it('act1 healing/promotion pools are split correctly', () => {
      const healing = gameData.lootTables.act1.healing;
      const promotion = gameData.lootTables.act1.promotion;
      const vulnCount = healing.filter((n) => n === 'Vulnerary').length;
      const sealCount = promotion.filter((n) => n === 'Master Seal').length;
      expect(vulnCount).toBe(4);
      expect(sealCount).toBe(1);
      expect(healing.length).toBe(4);
      expect(promotion.length).toBe(1);
    });

    it('act1 weights are rebalanced (more gold, less weapon)', () => {
      const w = gameData.lootTables.act1.weights;
      expect(w.weapon).toBe(20);
      expect(w.gold).toBe(35);
      expect(w.healing).toBe(12);
      expect(w.statBooster).toBe(0);
      expect(w.promotion).toBe(3);
      expect(w.accessory).toBe(15);
      expect(w.forge).toBe(15);
      expect(w.skillScroll).toBe(0);
      expect(w.weaponArtScroll).toBe(0);
      expect(w.legendaryWeapon).toBe(0);
    });

    it('act2 weapon pool has killers and advanced weapons', () => {
      const pool = gameData.lootTables.act2.weapons;
      expect(pool).toContain('Killing Edge');
      expect(pool).toContain('Killer Lance');
      expect(pool).toContain('Hammer');
      expect(pool).toContain('Spear');
      expect(pool).toContain('Physic');
      expect(pool).toContain('Bolganone');
      expect(pool).toContain('Aura');
    });

    it('act2/act3 weapon-art split pools include advanced weapon-art scrolls', () => {
      const act2Rare = gameData.lootTables.act2.weaponArtScroll;
      const act3Rare = gameData.lootTables.act3.weaponArtScroll;
      const expected = [
        'Knightkneeler Scroll',
        'Vengeance Scroll',
        'Encloser Scroll',
        'Seraphim Scroll',
      ];
      for (const name of expected) {
        expect(act2Rare).toContain(name);
        expect(act3Rare).toContain(name);
      }
    });

    it('act2 statBooster pool includes stat boosters', () => {
      const pool = gameData.lootTables.act2.statBooster;
      expect(pool).toContain('Energy Drop');
      expect(pool).toContain('Spirit Dust');
      expect(pool).toContain('Speedwing');
      expect(pool).toContain('Angelic Robe');
    });

    it('act3 statBooster pool includes stat boosters', () => {
      const pool = gameData.lootTables.act3.statBooster;
      expect(pool).toContain('Energy Drop');
      expect(pool).toContain('Dracoshield');
      expect(pool).toContain('Talisman');
      expect(pool).toContain('Secret Book');
      expect(pool).toContain('Speedwing');
      expect(pool).toContain('Angelic Robe');
    });

    it('act2 weights are rebalanced', () => {
      const w = gameData.lootTables.act2.weights;
      expect(w.weapon).toBe(20);
      expect(w.gold).toBe(20);
      expect(w.healing).toBe(3);
      expect(w.statBooster).toBe(10);
      expect(w.promotion).toBe(2);
      expect(w.skillScroll).toBe(4);
      expect(w.weaponArtScroll).toBe(6);
      expect(w.legendaryWeapon).toBe(0);
      expect(w.forge).toBe(20);
    });
  });

  describe('act4 loot table integrity', () => {
    it('act4 entry exists with all required keys', () => {
      const act4 = gameData.lootTables.act4;
      expect(act4).toBeDefined();
      const requiredKeys = [
        'weapons',
        'healing',
        'statBooster',
        'promotion',
        'skillScroll',
        'weaponArtScroll',
        'legendaryWeapon',
        'accessories',
        'forge',
        'weights',
        'goldRange',
      ];
      for (const key of requiredKeys) {
        expect(act4[key]).toBeDefined();
      }
    });

    it('act4 goldRange is [1400, 2000]', () => {
      expect(gameData.lootTables.act4.goldRange).toEqual([1400, 2000]);
    });

    it('act4 legendary weapon weight is 10', () => {
      expect(gameData.lootTables.act4.weights.legendaryWeapon).toBe(10);
    });

    it('act4 weapons pool includes Fortify', () => {
      expect(gameData.lootTables.act4.weapons).toContain('Fortify');
    });

    it('act4 accessories pool includes Nullify Ring', () => {
      expect(gameData.lootTables.act4.accessories).toContain('Nullify Ring');
    });

    it('act4 inherits act3 weapon pools plus additions', () => {
      const act3Weapons = gameData.lootTables.act3.weapons;
      const act4Weapons = gameData.lootTables.act4.weapons;
      for (const weapon of act3Weapons) {
        expect(act4Weapons).toContain(weapon);
      }
      expect(act4Weapons).toContain('Fortify');
    });

    it('act4 accessories include Nullify Ring', () => {
      const act4Accessories = gameData.lootTables.act4.accessories;
      expect(act4Accessories).toContain('Nullify Ring');
    });

    it('act4 loot generation produces valid choices', () => {
      const choices = generateLootChoices(
        'act4',
        gameData.lootTables,
        gameData.weapons,
        gameData.consumables,
      );
      expect(choices.length).toBe(LOOT_CHOICES);
    });
  });

  describe('stat booster shop exclusion', () => {
    it('shop never sells stat boosters in act2', () => {
      const statBoosterNames = [
        'Energy Drop',
        'Spirit Dust',
        'Secret Book',
        'Speedwing',
        'Dracoshield',
        'Talisman',
        'Angelic Robe',
      ];
      for (let i = 0; i < 50; i++) {
        const inv = generateShopInventory(
          'act2',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
        );
        for (const entry of inv) {
          expect(statBoosterNames).not.toContain(entry.item.name);
        }
      }
    });

    it('shop never sells stat boosters in act3', () => {
      const statBoosterNames = [
        'Energy Drop',
        'Spirit Dust',
        'Secret Book',
        'Speedwing',
        'Dracoshield',
        'Talisman',
        'Angelic Robe',
      ];
      for (let i = 0; i < 50; i++) {
        const inv = generateShopInventory(
          'act3',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
        );
        for (const entry of inv) {
          expect(statBoosterNames).not.toContain(entry.item.name);
        }
      }
    });
  });

  describe('boss loot (isBoss flag)', () => {
    it('boss flag shifts distribution toward high-value categories', () => {
      const counts = {
        skillScroll: 0,
        weaponArtScroll: 0,
        legendaryWeapon: 0,
        accessory: 0,
        forge: 0,
        weapon: 0,
        gold: 0,
        healing: 0,
        statBooster: 0,
        promotion: 0,
      };
      const bossCountsObj = {
        skillScroll: 0,
        weaponArtScroll: 0,
        legendaryWeapon: 0,
        accessory: 0,
        forge: 0,
        weapon: 0,
        gold: 0,
        healing: 0,
        statBooster: 0,
        promotion: 0,
      };
      const trials = 200;
      for (let i = 0; i < trials; i++) {
        const normal = generateLootChoices(
          'act2',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
          LOOT_CHOICES,
          0,
          gameData.accessories,
          gameData.whetstones,
          null,
          false,
        );
        for (const c of normal) counts[c.type] = (counts[c.type] || 0) + 1;
        const boss = generateLootChoices(
          'act2',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
          LOOT_CHOICES,
          0,
          gameData.accessories,
          gameData.whetstones,
          null,
          true,
        );
        for (const c of boss) bossCountsObj[c.type] = (bossCountsObj[c.type] || 0) + 1;
      }
      // Boss should have more high-value categories than normal
      const normalHighValue =
        counts.skillScroll +
        counts.weaponArtScroll +
        counts.legendaryWeapon +
        counts.accessory +
        counts.forge;
      const bossHighValue =
        bossCountsObj.skillScroll +
        bossCountsObj.weaponArtScroll +
        bossCountsObj.legendaryWeapon +
        bossCountsObj.accessory +
        bossCountsObj.forge;
      expect(bossHighValue).toBeGreaterThan(normalHighValue);
    });

    it('boss gold range is 1.5x normal', () => {
      const [min, max] = gameData.lootTables.act2.goldRange;
      const bossMin = Math.floor(min * 1.5 * GOLD_LOOT_REWARD_MULTIPLIER);
      const bossMax = Math.floor(max * 1.5 * GOLD_LOOT_REWARD_MULTIPLIER);
      for (let i = 0; i < 100; i++) {
        const choices = generateLootChoices(
          'act2',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
          LOOT_CHOICES,
          0,
          gameData.accessories,
          gameData.whetstones,
          null,
          true,
        );
        const goldChoices = choices.filter((c) => c.type === 'gold');
        for (const c of goldChoices) {
          expect(c.goldAmount).toBeGreaterThanOrEqual(bossMin);
          expect(c.goldAmount).toBeLessThanOrEqual(bossMax);
        }
      }
    });
  });

  describe('elite loot (isElite flag)', () => {
    it('elite applies lighter weight shifts than boss', () => {
      const normalCounts = {
        skillScroll: 0,
        weaponArtScroll: 0,
        legendaryWeapon: 0,
        accessory: 0,
        forge: 0,
        weapon: 0,
        gold: 0,
      };
      const eliteCounts = {
        skillScroll: 0,
        weaponArtScroll: 0,
        legendaryWeapon: 0,
        accessory: 0,
        forge: 0,
        weapon: 0,
        gold: 0,
      };
      const bossCounts = {
        skillScroll: 0,
        weaponArtScroll: 0,
        legendaryWeapon: 0,
        accessory: 0,
        forge: 0,
        weapon: 0,
        gold: 0,
      };
      const trials = 300;
      for (let i = 0; i < trials; i++) {
        const normal = generateLootChoices(
          'act2',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
          LOOT_CHOICES,
          0,
          gameData.accessories,
          gameData.whetstones,
          null,
          false,
          null,
          false,
        );
        for (const c of normal) normalCounts[c.type] = (normalCounts[c.type] || 0) + 1;
        const elite = generateLootChoices(
          'act2',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
          LOOT_CHOICES,
          0,
          gameData.accessories,
          gameData.whetstones,
          null,
          false,
          null,
          true,
        );
        for (const c of elite) eliteCounts[c.type] = (eliteCounts[c.type] || 0) + 1;
        const boss = generateLootChoices(
          'act2',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
          LOOT_CHOICES,
          0,
          gameData.accessories,
          gameData.whetstones,
          null,
          true,
          null,
          false,
        );
        for (const c of boss) bossCounts[c.type] = (bossCounts[c.type] || 0) + 1;
      }
      // Elite should shift toward high-value more than normal, but less than boss
      const normalHV =
        normalCounts.skillScroll +
        normalCounts.weaponArtScroll +
        normalCounts.legendaryWeapon +
        normalCounts.accessory +
        normalCounts.forge;
      const eliteHV =
        eliteCounts.skillScroll +
        eliteCounts.weaponArtScroll +
        eliteCounts.legendaryWeapon +
        eliteCounts.accessory +
        eliteCounts.forge;
      const bossHV =
        bossCounts.skillScroll +
        bossCounts.weaponArtScroll +
        bossCounts.legendaryWeapon +
        bossCounts.accessory +
        bossCounts.forge;
      expect(eliteHV).toBeGreaterThan(normalHV);
      expect(bossHV).toBeGreaterThan(eliteHV);
    });

    it('isBoss takes precedence when both isBoss and isElite are true', () => {
      const bossOnlyCounts = {
        skillScroll: 0,
        weaponArtScroll: 0,
        legendaryWeapon: 0,
        accessory: 0,
        forge: 0,
      };
      const bothCounts = {
        skillScroll: 0,
        weaponArtScroll: 0,
        legendaryWeapon: 0,
        accessory: 0,
        forge: 0,
      };
      const trials = 300;
      for (let i = 0; i < trials; i++) {
        const bossOnly = generateLootChoices(
          'act2',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
          LOOT_CHOICES,
          0,
          gameData.accessories,
          gameData.whetstones,
          null,
          true,
          null,
          false,
        );
        for (const c of bossOnly)
          if (bossOnlyCounts[c.type] !== undefined) bossOnlyCounts[c.type]++;
        const both = generateLootChoices(
          'act2',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
          LOOT_CHOICES,
          0,
          gameData.accessories,
          gameData.whetstones,
          null,
          true,
          null,
          true,
        );
        for (const c of both) if (bothCounts[c.type] !== undefined) bothCounts[c.type]++;
      }
      // When both flags are true, isBoss block fires first; isElite block is else-if so skipped
      // Distributions should be statistically similar (both get boss shifts)
      const bossHV =
        bossOnlyCounts.skillScroll +
        bossOnlyCounts.weaponArtScroll +
        bossOnlyCounts.legendaryWeapon +
        bossOnlyCounts.accessory +
        bossOnlyCounts.forge;
      const bothHV =
        bothCounts.skillScroll +
        bothCounts.weaponArtScroll +
        bothCounts.legendaryWeapon +
        bothCounts.accessory +
        bothCounts.forge;
      // Allow ±20% variance due to randomness
      expect(Math.abs(bossHV - bothHV)).toBeLessThan(bossHV * 0.2 + 10);
    });

    it('elite gold range is 1.25x normal', () => {
      const [min, max] = gameData.lootTables.act2.goldRange;
      const eliteMin = Math.floor(min * 1.25 * GOLD_LOOT_REWARD_MULTIPLIER);
      const eliteMax = Math.floor(max * 1.25 * GOLD_LOOT_REWARD_MULTIPLIER);
      for (let i = 0; i < 100; i++) {
        const choices = generateLootChoices(
          'act2',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
          LOOT_CHOICES,
          0,
          gameData.accessories,
          gameData.whetstones,
          null,
          false,
          null,
          true,
        );
        const goldChoices = choices.filter((c) => c.type === 'gold');
        for (const c of goldChoices) {
          expect(c.goldAmount).toBeGreaterThanOrEqual(eliteMin);
          expect(c.goldAmount).toBeLessThanOrEqual(eliteMax);
        }
      }
    });
  });

  describe('meta-innate loot binding', () => {
    it('binds meta-unlocked art to steel/iron loot weapons', () => {
      const customTables = {
        act1: {
          weapons: ['Steel Sword'],
          healing: ['Vulnerary'],
          statBooster: [],
          promotion: [],
          skillScroll: [],
          weaponArtScroll: [],
          legendaryWeapon: [],
          accessories: [],
          forge: [],
          weights: {
            weapon: 100,
            healing: 1,
            statBooster: 0,
            promotion: 0,
            skillScroll: 0,
            weaponArtScroll: 0,
            legendaryWeapon: 0,
            accessory: 0,
            forge: 0,
            gold: 0,
          },
          goldRange: [1, 1],
        },
      };
      const choices = generateLootChoices(
        'act1',
        customTables,
        gameData.weapons,
        gameData.consumables,
        3,
        0,
        gameData.accessories,
        gameData.whetstones,
        null,
        false,
        null,
        false,
        {
          unlockedWeaponArtIds: ['sword_wrath_strike'],
          weaponArtCatalog: gameData.weaponArts.arts,
        },
      );
      const steelSword = choices.find((choice) => choice.item?.name === 'Steel Sword')?.item;
      expect(steelSword).toBeTruthy();
      expect(steelSword.weaponArtId).toBe('sword_wrath_strike');
      expect(steelSword.weaponArtSource).toBe('meta_innate');
    });

    it('maps allowedTypes magic arts onto Light and Tome pools', () => {
      const customArt = {
        id: 'magic_test_art',
        name: 'Magic Test Art',
        weaponType: 'Tome',
        allowedTypes: ['Tome', 'Light'],
        unlockAct: 'act2',
        requiredRank: 'Prof',
        hpCost: 1,
        perMapLimit: 3,
        combatMods: { atkBonus: 3 },
      };
      const customTables = {
        act2: {
          weapons: ['Elfire', 'Shine'],
          healing: ['Vulnerary'],
          statBooster: [],
          promotion: [],
          skillScroll: [],
          weaponArtScroll: [],
          legendaryWeapon: [],
          accessories: [],
          forge: [],
          weights: {
            weapon: 100,
            healing: 1,
            statBooster: 0,
            promotion: 0,
            skillScroll: 0,
            weaponArtScroll: 0,
            legendaryWeapon: 0,
            accessory: 0,
            forge: 0,
            gold: 0,
          },
          goldRange: [1, 1],
        },
      };

      const tomeChoices = generateLootChoices(
        'act2',
        { act2: { ...customTables.act2, weapons: ['Elfire'] } },
        gameData.weapons,
        gameData.consumables,
        1,
        0,
        gameData.accessories,
        gameData.whetstones,
        null,
        false,
        null,
        false,
        { steelArms: true, weaponArtCatalog: [customArt] },
      );
      const elfire = tomeChoices.find((choice) => choice.item?.name === 'Elfire')?.item;
      expect(elfire?.weaponArtId).toBe('magic_test_art');
      expect(elfire?.weaponArtSource).toBe('meta_innate');

      const lightChoices = generateLootChoices(
        'act2',
        { act2: { ...customTables.act2, weapons: ['Shine'] } },
        gameData.weapons,
        gameData.consumables,
        1,
        0,
        gameData.accessories,
        gameData.whetstones,
        null,
        false,
        null,
        false,
        { steelArms: true, weaponArtCatalog: [customArt] },
      );
      const shine = lightChoices.find((choice) => choice.item?.name === 'Shine')?.item;
      expect(shine?.weaponArtId).toBe('magic_test_art');
      expect(shine?.weaponArtSource).toBe('meta_innate');
    });
  });

  describe('guaranteed shop consumables', () => {
    it('every shop includes Vulnerary', () => {
      for (let i = 0; i < 50; i++) {
        const shop = generateShopInventory(
          'act1',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
          gameData.accessories,
        );
        const hasVulnerary = shop.some((s) => s.item.name === 'Vulnerary');
        expect(hasVulnerary).toBe(true);
      }
    });

    it('every shop includes Elixir', () => {
      for (let i = 0; i < 50; i++) {
        const shop = generateShopInventory(
          'act2',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
          gameData.accessories,
        );
        const hasElixir = shop.some((s) => s.item.name === 'Elixir');
        expect(hasElixir).toBe(true);
      }
    });

    it('no duplicate Vulnerary or Elixir entries', () => {
      for (let i = 0; i < 100; i++) {
        const shop = generateShopInventory(
          'act2',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
          gameData.accessories,
        );
        const vulnCount = shop.filter((s) => s.item.name === 'Vulnerary').length;
        const elixirCount = shop.filter((s) => s.item.name === 'Elixir').length;
        expect(vulnCount).toBeLessThanOrEqual(1);
        expect(elixirCount).toBeLessThanOrEqual(1);
      }
    });

    it('shop still includes a weapon alongside pinned consumables', () => {
      for (let i = 0; i < 50; i++) {
        const shop = generateShopInventory(
          'act1',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
          gameData.accessories,
        );
        const hasWeapon = shop.some((s) => s.type === 'weapon');
        expect(hasWeapon).toBe(true);
      }
    });

    it('positive itemCountBonus increases inventory size', () => {
      for (let i = 0; i < 20; i++) {
        const inv = generateShopInventory(
          'act1',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
          null,
          null,
          null,
          { itemCountBonus: 3 },
        );
        expect(inv.length).toBeGreaterThanOrEqual(SHOP_ITEM_COUNT.min + 3);
        expect(inv.length).toBeLessThanOrEqual(SHOP_ITEM_COUNT.max + 3);
      }
    });

    it('negative itemCountBonus reduces inventory (min 1)', () => {
      for (let i = 0; i < 20; i++) {
        const inv = generateShopInventory(
          'act1',
          gameData.lootTables,
          gameData.weapons,
          gameData.consumables,
          null,
          null,
          null,
          { itemCountBonus: -100 },
        );
        expect(inv.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('shopCureGating', () => {
    it('adds Herb and Remedy when shopCureGating[act] is true', () => {
      const shopCureGating = { act1: false, act2: false, act3: true, act4: true, finalBoss: true };
      const inv = generateShopInventory(
        'act3',
        gameData.lootTables,
        gameData.weapons,
        gameData.consumables,
        null,
        null,
        null,
        { shopCureGating },
      );
      const names = inv.map((i) => i.item.name);
      expect(names).toContain('Herb');
      expect(names).toContain('Remedy');
      expect(names).toContain('Restore');
    });

    it('does NOT add Herb/Remedy when shopCureGating[act] is false', () => {
      const shopCureGating = { act1: false, act2: false, act3: true, act4: true, finalBoss: true };
      const inv = generateShopInventory(
        'act1',
        gameData.lootTables,
        gameData.weapons,
        gameData.consumables,
        null,
        null,
        null,
        { shopCureGating },
      );
      const names = inv.map((i) => i.item.name);
      expect(names).not.toContain('Herb');
      expect(names).not.toContain('Remedy');
    });

    // act2+ pools legitimately carry cure items now (countermeasure rollout),
    // so the no-gating assertions use act1 — the only act with cure-free pools.
    it('does NOT add cures when shopCureGating is null', () => {
      const inv = generateShopInventory(
        'act1',
        gameData.lootTables,
        gameData.weapons,
        gameData.consumables,
        null,
        null,
        null,
        { shopCureGating: null },
      );
      const names = inv.map((i) => i.item.name);
      expect(names).not.toContain('Herb');
      expect(names).not.toContain('Remedy');
      expect(names).not.toContain('Restore');
    });

    it('does NOT add cures when shopCureGating is omitted', () => {
      const inv = generateShopInventory(
        'act1',
        gameData.lootTables,
        gameData.weapons,
        gameData.consumables,
      );
      const names = inv.map((i) => i.item.name);
      expect(names).not.toContain('Herb');
      expect(names).not.toContain('Remedy');
      expect(names).not.toContain('Restore');
    });
  });
});
