// Vulnerary uses: 2 from the catalog, 3 with Apothecary's Recipe (the `vulneraryUses`
// meta effect), pinned at 3 in the prologue. One rule (engine/VulneraryRecipe.js) read by
// every path that hands the army a Vulnerary; items already owned are never rewritten.
//
// Expected uses are literals (2 / 3), never read back through the helper under test.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (v, min, max) => Math.max(min, Math.min(max, v)) },
  },
}));

import { RunManager, serializeUnit } from '../src/engine/RunManager.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { prepareBattleRewards } from '../src/engine/PendingBattleRewards.js';
import { purchaseShopItem } from '../src/engine/ShopCommands.js';
import { rollVillageRewardItem } from '../src/engine/VillageSystem.js';
import {
  applyVulneraryRecipe,
  consumableCatalogFor,
  consumableTemplateFor,
  vulneraryUsesFor,
} from '../src/engine/VulneraryRecipe.js';
import {
  createBossLordUnit,
  generateBossRecruitCandidates,
} from '../src/engine/BossRecruitSystem.js';
import {
  buildPrologueLootChoices,
  buildPrologueRoster,
  buildPrologueShopStock,
  buildPrologueUnits,
  validatePrologueConfig,
} from '../src/engine/Prologue.js';
import { ShopController } from '../src/ui/ShopController.js';
import { VillageController } from '../src/ui/VillageController.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const WITH_RECIPE = { vulneraryUses: 3 };

const vulneraries = (unit) => (unit.consumables || []).filter((c) => c.name === 'Vulnerary');
const usesOf = (items) => items.map((c) => c.uses);

beforeEach(() => {
  const storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function startedRun(effects, options = {}) {
  const run = new RunManager(data, effects);
  run.startRun({ runSeed: 11, applyBlessingsAtStart: false, ...options });
  return run;
}

describe('the data', () => {
  it('a Vulnerary has 2 uses and costs 300 (the price does not move with the Recipe)', () => {
    const vulnerary = data.consumables.find((c) => c.name === 'Vulnerary');
    expect(vulnerary.uses).toBe(2);
    expect(vulnerary.price).toBe(300);
  });

  it("Apothecary's Recipe is a 200-valor Economy upgrade behind Field Supplies", () => {
    const upgrade = data.metaUpgrades.find((u) => u.id === 'apothecary_recipe');
    expect(upgrade.name).toBe("Apothecary's Recipe");
    expect(upgrade.category).toBe('economy');
    expect(upgrade.maxLevel).toBe(1);
    expect(upgrade.costs).toEqual([200]);
    expect(upgrade.effects).toEqual([{ vulneraryUses: 3 }]);
    expect(upgrade.requires).toEqual({ upgrades: [{ id: 'starting_vulnerary', level: 1 }] });
  });

  it('the upgrade reaches the run only once bought, and only after Field Supplies', () => {
    const meta = new MetaProgressionManager(data.metaUpgrades, 'recipe-test');
    expect(meta.getActiveEffects().vulneraryUses).toBe(0);
    meta.purchasedUpgrades.starting_vulnerary = 1;
    expect(meta.getActiveEffects().vulneraryUses).toBe(0);
    meta.purchasedUpgrades.apothecary_recipe = 1;
    expect(meta.getActiveEffects().vulneraryUses).toBe(3);
    expect(meta.getPrerequisiteInfo('apothecary_recipe').missing).toEqual([]);
    const fresh = new MetaProgressionManager(data.metaUpgrades, 'recipe-test-2');
    expect(fresh.getPrerequisiteInfo('apothecary_recipe').missing.length).toBe(1);
  });
});

describe('the helper', () => {
  const template = { name: 'Vulnerary', type: 'Consumable', uses: 2, price: 200 };

  it('is 2 without the upgrade and 3 with it', () => {
    expect(vulneraryUsesFor(2, null)).toBe(2);
    expect(vulneraryUsesFor(2, {})).toBe(2);
    expect(vulneraryUsesFor(2, { vulneraryUses: 0 })).toBe(2);
    expect(vulneraryUsesFor(2, WITH_RECIPE)).toBe(3);
  });

  it('never lowers a catalog that already has more uses', () => {
    expect(vulneraryUsesFor(5, WITH_RECIPE)).toBe(5);
  });

  it('lifts only the Vulnerary, never mutates the shared template', () => {
    const lifted = applyVulneraryRecipe(template, WITH_RECIPE);
    expect(lifted.uses).toBe(3);
    expect(lifted.price).toBe(200);
    expect(template.uses).toBe(2);
    const elixir = { name: 'Elixir', type: 'Consumable', uses: 1 };
    expect(applyVulneraryRecipe(elixir, WITH_RECIPE)).toBe(elixir);
    expect(applyVulneraryRecipe(template, null)).toBe(template);
  });

  it('builds a catalog and a template lookup the same way', () => {
    const catalog = [template, { name: 'Elixir', type: 'Consumable', uses: 1 }];
    expect(consumableCatalogFor(catalog, WITH_RECIPE).map((c) => c.uses)).toEqual([3, 1]);
    expect(consumableCatalogFor(catalog, null).map((c) => c.uses)).toEqual([2, 1]);
    expect(consumableTemplateFor(catalog, 'Vulnerary', WITH_RECIPE).uses).toBe(3);
    expect(consumableTemplateFor(catalog, 'Missing', WITH_RECIPE)).toBeNull();
    expect(consumableCatalogFor(undefined, WITH_RECIPE)).toEqual([]);
  });
});

describe('starting kits', () => {
  it('every starting lord has a 2-use Vulnerary; the commander extra is 2 too', () => {
    const run = startedRun({ extraVulnerary: 1 });
    const [commander, partner] = run.roster;
    expect(usesOf(vulneraries(commander))).toEqual([2, 2]);
    expect(usesOf(vulneraries(partner))).toEqual([2]);
  });

  it("with Apothecary's Recipe every starting Vulnerary has 3 uses", () => {
    const run = startedRun({ extraVulnerary: 1, vulneraryUses: 3 });
    const [commander, partner] = run.roster;
    expect(usesOf(vulneraries(commander))).toEqual([3, 3]);
    expect(usesOf(vulneraries(partner))).toEqual([3]);
  });

  it('starting kits keep the catalog price', () => {
    const run = startedRun({ vulneraryUses: 3 });
    expect(vulneraries(run.roster[0])[0].price).toBe(300);
  });

  it('an extra starter (Field Supplies II) gets a Vulnerary with the run uses', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const plain = startedRun({ extraStartingUnitTier: 1, recruitStartingVulnerary: 1 });
    expect(usesOf(vulneraries(plain.roster[3]))).toEqual([2]);
    const upgraded = startedRun({
      extraStartingUnitTier: 1,
      recruitStartingVulnerary: 1,
      vulneraryUses: 3,
    });
    expect(usesOf(vulneraries(upgraded.roster[3]))).toEqual([3]);
  });

  it('a boss-recruit candidate (Field Supplies II) gets the run uses', () => {
    const roster = startedRun(null).roster;
    const candidates = (effects) =>
      generateBossRecruitCandidates('act1', roster, data, effects, [], []).filter((c) => !c.isLord);
    const plain = candidates({ recruitStartingVulnerary: 1 });
    expect(plain.length).toBeGreaterThan(0);
    for (const c of plain) expect(usesOf(vulneraries(c.unit))).toEqual([2]);
    const upgraded = candidates({ recruitStartingVulnerary: 1, vulneraryUses: 3 });
    for (const c of upgraded) expect(usesOf(vulneraries(c.unit))).toEqual([3]);
  });

  it('a boss lord recruit carries a Vulnerary with the run uses', () => {
    const lordDef = data.lords.find((l) => l.name === 'Kira');
    const classData = data.classes.find((c) => c.name === lordDef.class);
    const make = (effects) =>
      createBossLordUnit(lordDef, classData, data.weapons, 5, effects, {
        consumables: data.consumables,
      });
    expect(usesOf(vulneraries(make(null)))).toEqual([2]);
    expect(usesOf(vulneraries(make(WITH_RECIPE)))).toEqual([3]);
  });
});

describe('blessings', () => {
  it('Field Medic gives every unit a Vulnerary with the run uses', () => {
    for (const [effects, expected] of [
      [null, 2],
      [WITH_RECIPE, 3],
    ]) {
      const run = startedRun(effects);
      const beforeCounts = run.roster.map((u) => vulneraries(u).length);
      run._applySingleRunStartBlessingEffect('field_medic', {
        type: 'starting_consumable_all',
        params: { name: 'Vulnerary' },
      });
      run.roster.forEach((unit, i) => {
        const added = vulneraries(unit).slice(beforeCounts[i]);
        expect(usesOf(added)).toEqual([expected]);
      });
    }
  });

  it('Field Medic gives a later recruit the run uses, through the bag or the convoy', () => {
    for (const [effects, expected] of [
      [null, 2],
      [WITH_RECIPE, 3],
    ]) {
      const run = startedRun(effects);
      run.activeBlessings = [{ id: 'field_medic' }];
      const recruit = { ...structuredClone(run.roster[0]), consumables: [] };
      run.grantRecruitBlessingConsumables(recruit);
      expect(usesOf(vulneraries(recruit))).toEqual([expected]);
      const full = {
        ...structuredClone(run.roster[0]),
        consumables: [0, 1, 2].map((i) => ({ name: `Filler ${i}`, type: 'Consumable', uses: 1 })),
      };
      run.grantRecruitBlessingConsumables(full);
      expect(usesOf(vulneraries(run.convoy))).toEqual([expected]);
    }
  });

  it('an extra-consumable blessing that names the Vulnerary uses the run uses too', () => {
    for (const [effects, expected] of [
      [null, 2],
      [WITH_RECIPE, 3],
    ]) {
      const run = startedRun(effects);
      const lord = run.roster.find((u) => u.isLord);
      const before = vulneraries(lord).length;
      run._applySingleRunStartBlessingEffect('test', {
        type: 'extra_consumable',
        params: { itemName: 'Vulnerary', value: 1 },
      });
      expect(usesOf(vulneraries(lord).slice(before))).toEqual([expected]);
    }
  });
});

describe('shops', () => {
  function openShop(run) {
    const shown = [];
    const scene = {
      registry: { get: () => null },
      gameData: data,
      runManager: run,
      applyDifficultyShopPricing: (items) => items,
      applyRuinsMarkup: (items) => items,
      applyAmbushDiscount: (items) => items,
      showShopOverlay: (node, items) => shown.push(items),
      _isPendingAmbushNode: () => false,
      _clearPendingAmbushForNode: () => {},
    };
    new ShopController(scene).handleShop({ id: 'shop-1', type: 'shop' });
    return shown[0];
  }

  it('the stock shows, and a purchase delivers, the uses the run has', () => {
    for (const [effects, expected] of [
      [null, 2],
      [WITH_RECIPE, 3],
    ]) {
      const run = startedRun(effects);
      const stock = openShop(run);
      const entry = stock.find((e) => e.item.name === 'Vulnerary');
      expect(entry, 'a shop always stocks a Vulnerary').toBeTruthy();
      expect(entry.item.uses).toBe(expected);
      expect(entry.price).toBe(300); // 3 uses or 2, the same price
      run.gold = 1000;
      const buyer = run.roster[0];
      buyer.consumables = [];
      expect(purchaseShopItem(run, stock, entry, buyer).ok).toBe(true);
      expect(usesOf(vulneraries(buyer))).toEqual([expected]);
    }
  });

  it('a reroll draws from the same catalog', () => {
    const run = startedRun(WITH_RECIPE);
    const stock = openShop(run);
    expect(usesOf(stock.filter((e) => e.item.name === 'Vulnerary').map((e) => e.item))).toEqual([
      3,
    ]);
  });
});

describe('loot and villages', () => {
  function seededRandom(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function lootedVulneraries(effects) {
    const found = [];
    for (let seed = 1; seed <= 60; seed++) {
      const run = startedRun(effects);
      vi.spyOn(Math, 'random').mockImplementation(seededRandom(seed));
      const record = prepareBattleRewards(run, data, {
        isElite: true,
        goldEarned: 100,
        completionGoldAward: 100,
        metaEffects: effects,
      });
      vi.restoreAllMocks();
      for (const choice of record.choices)
        if (choice.item?.name === 'Vulnerary') found.push(choice);
    }
    return found;
  }

  it('a rolled Vulnerary reward carries the run uses and comes two at a time', () => {
    const plain = lootedVulneraries(null);
    expect(plain.length).toBeGreaterThan(0);
    for (const choice of plain) {
      expect(choice.item.uses).toBe(2);
      expect(choice.quantity).toBe(2);
    }
    const upgraded = lootedVulneraries(WITH_RECIPE);
    expect(upgraded.length).toBeGreaterThan(0);
    for (const choice of upgraded) {
      expect(choice.item.uses).toBe(3);
      expect(choice.quantity).toBe(2);
    }
  });

  it('a village reward Vulnerary carries the run uses', () => {
    for (const [effects, expected] of [
      [null, 2],
      [WITH_RECIPE, 3],
    ]) {
      const run = startedRun(effects);
      const catalog = run.getConsumableCatalog();
      const item = rollVillageRewardItem('act1', data.lootTables, catalog, () => 0);
      expect(item.name).toBe('Vulnerary');
      expect(item.uses).toBe(expected);

      const delivered = [];
      const scene = {
        _battleSession: 1,
        battleConfig: { villageTile: { col: 4, row: 6 } },
        battleParams: { act: 'act1' },
        gameData: data,
        playerUnits: [],
        enemyUnits: [],
        npcUnits: [],
        goldEarned: 0,
        runManager: { addToConvoy: (i) => delivered.push(i) && true, ...bind(run) },
        grid: { gridToPixel: () => ({ x: 0, y: 0 }), setTerrainAt: () => true },
        registry: { get: () => null },
        cameras: { main: { centerX: 320, height: 480 } },
        add: {
          text: () => stub(),
          rectangle: () => stub(),
        },
        tweens: { add: () => {}, killTweensOf: () => {} },
        time: { delayedCall: () => {} },
        showBriefBanner: () => Promise.resolve(),
        updateObjectiveText: () => {},
        _reduceMotion: () => true,
      };
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const controller = new VillageController(scene);
      controller.create();
      expect(
        controller.handleUnitActionEnd({ faction: 'player', col: 4, row: 6, currentHP: 20 }),
      ).toBe(true);
      expect(delivered[0].name).toBe('Vulnerary');
      expect(delivered[0].uses).toBe(expected);
      vi.restoreAllMocks();
    }
  });
});

function bind(run) {
  return { getConsumableCatalog: () => run.getConsumableCatalog() };
}
function stub() {
  const obj = {
    setOrigin: () => obj,
    setDepth: () => obj,
    setAlpha: () => obj,
    destroy: () => {},
  };
  return obj;
}

describe('the prologue', () => {
  const prologue = data.prologue;

  it('every authored Vulnerary has 3 uses (the prologue applies no meta effects)', () => {
    const roster = buildPrologueRoster(prologue, data, prologue.chapters[0]);
    const all = roster.flatMap(vulneraries);
    expect(all.length).toBeGreaterThan(0);
    expect(usesOf(all).every((u) => u === 3)).toBe(true);
    const edric = buildPrologueUnits(prologue, data, ['Edric'])[0];
    expect(usesOf(vulneraries(edric))).toEqual([3]);
  });

  it('authored loot and stock Vulneraries have 3 uses', () => {
    const lootChapter = prologue.chapters.find((c) =>
      (c.loot || []).some((l) => l.item === 'Vulnerary'),
    );
    const choices = buildPrologueLootChoices(lootChapter.loot, data);
    expect(choices.find((c) => c.item?.name === 'Vulnerary').item.uses).toBe(3);
    const stockNode = prologue.route.nodes.find((n) => (n.stock || []).includes('Vulnerary'));
    const stock = buildPrologueShopStock(stockNode.stock, data);
    const entries = stock.filter((e) => e.item.name === 'Vulnerary');
    expect(entries.length).toBeGreaterThan(0);
    expect(usesOf(entries.map((e) => e.item)).every((u) => u === 3)).toBe(true);
  });

  it("a chapter's authored Vulnerary reward keeps its authored bundle of 3 (not the rolled 2)", () => {
    const lootChapter = prologue.chapters.find((c) =>
      (c.loot || []).some((l) => l.item === 'Vulnerary' && l.quantity === 3),
    );
    expect(lootChapter, 'a chapter authors a bundle of 3').toBeTruthy();
    const run = new RunManager(data, null);
    run.startPrologue(data);
    const record = prepareBattleRewards(run, data, {
      authoredLoot: lootChapter.loot,
      goldEarned: 0,
      completionGoldAward: 0,
    });
    const choice = record.choices.find((c) => c.item?.name === 'Vulnerary');
    expect(choice.quantity).toBe(3);
    expect(choice.item.uses).toBe(3);
  });

  it('the prologue run acquires 3-use Vulneraries whatever the meta says', () => {
    const run = new RunManager(data, null);
    run.startPrologue(data);
    expect(run.getConsumableTemplate('Vulnerary').uses).toBe(3);
    expect(usesOf(vulneraries(run.roster[0]))).toEqual([3]);
    const standard = new RunManager(data, null);
    expect(standard.getConsumableTemplate('Vulnerary').uses).toBe(2);
  });

  it('the data says so and the validator holds it', () => {
    expect(prologue.consumableEffects).toEqual({ vulneraryUses: 3 });
    const broken = structuredClone(prologue);
    delete broken.consumableEffects;
    expect(validatePrologueConfig(broken, data).errors).toContain(
      'consumableEffects.vulneraryUses must be an integer >= 1',
    );
  });
});

describe('saves', () => {
  it('a 3-use Vulnerary from a run saved before the change loads unchanged', () => {
    const run = startedRun(null);
    const old = vulneraries(run.roster[0])[0];
    old.uses = 3;
    old.price = 300;
    const loaded = RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), data);
    const kept = vulneraries(loaded.roster[0])[0];
    expect(kept.uses).toBe(3);
    expect(kept.price).toBe(300);
  });

  it('a half-used Vulnerary keeps its remaining uses through a save', () => {
    const run = startedRun(WITH_RECIPE);
    vulneraries(run.roster[0])[0].uses = 1;
    const loaded = RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), data);
    expect(vulneraries(loaded.roster[0])[0].uses).toBe(1);
  });

  it("the run remembers Apothecary's Recipe: a loaded run still acquires 3-use Vulneraries", () => {
    const run = startedRun(WITH_RECIPE);
    const loaded = RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), data);
    expect(loaded.getConsumableTemplate('Vulnerary').uses).toBe(3);
    expect(loaded.getConsumableCatalog().find((c) => c.name === 'Vulnerary').uses).toBe(3);
    const plain = RunManager.fromJSON(JSON.parse(JSON.stringify(startedRun(null).toJSON())), data);
    expect(plain.getConsumableTemplate('Vulnerary').uses).toBe(2);
  });

  it('a run saved before the effect existed acquires the catalog uses, and loads', () => {
    const saved = JSON.parse(JSON.stringify(startedRun({ extraVulnerary: 1 }).toJSON()));
    expect(saved.metaEffects.vulneraryUses).toBeUndefined();
    const loaded = RunManager.fromJSON(saved, data);
    expect(loaded.getConsumableTemplate('Vulnerary').uses).toBe(2);
  });

  it('serializing a unit and the shared catalog never write back to the data', () => {
    const run = startedRun(WITH_RECIPE);
    serializeUnit(run.roster[0]);
    expect(data.consumables.find((c) => c.name === 'Vulnerary').uses).toBe(2);
  });
});
