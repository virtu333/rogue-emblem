import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({
  default: { Scene: class {}, Math: { Clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)) } },
}));
vi.mock('../src/ui/HintDisplay.js', () => ({ showMinorHint: vi.fn(), showImportantHint: vi.fn() }));
const { popupShow } = vi.hoisted(() => ({ popupShow: vi.fn(async () => {}) }));
vi.mock('../src/ui/LevelUpPopup.js', () => ({
  LevelUpPopup: class {
    show() {
      return popupShow();
    }
  },
}));
import { RunManager, saveRun, loadRun } from '../src/engine/RunManager.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { createUnit, canEquip } from '../src/engine/UnitManager.js';
import { ShopController } from '../src/ui/ShopController.js';
import { ChurchController } from '../src/ui/ChurchController.js';
import { ColosseumOverlay } from '../src/ui/ColosseumOverlay.js';
import { NodeMapScene } from '../src/scenes/NodeMapScene.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import {
  presentQueuedLevelUps,
  completeResolvedAction,
} from '../src/ui/BattlePresentationCheckpoint.js';
import { saveServiceRun } from '../src/ui/serviceSave.js';
import { purchaseShopItem, shopOwnedItems, sellShopItem } from '../src/engine/ShopCommands.js';
import { loadGameData } from './testData.js';
const data = loadGameData();
const storage = new Map();
beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  });
  popupShow.mockReset().mockResolvedValue(undefined);
});
function runFixture() {
  const run = new RunManager(data);
  run.startRun({ runSeed: 42 });
  run.gold = 10000;
  const scene = {
    gameData: data,
    runManager: run,
    registry: { get: (key) => (key === 'activeSlot' ? 1 : null) },
    checkActComplete: vi.fn(),
    drawMap: vi.fn(),
    persistRunSave() {
      return NodeMapScene.prototype.persistRunSave.call(this);
    },
  };
  return { run, scene, node: run.nodeMap.nodes[0] };
}
function assertPersisted(run) {
  const loaded = loadRun(data, 1);
  expect(loaded).toBeTruthy();
  expect({
    gold: loaded.gold,
    currentNode: loaded.currentNodeId,
    nodes: loaded.nodeMap.nodes,
    roster: loaded.roster.map((u) => [u.name, u.currentHP, u.level, u.xp]),
    convoy: loaded.convoy,
  }).toEqual({
    gold: run.gold,
    currentNode: run.currentNodeId,
    nodes: run.nodeMap.nodes,
    roster: run.roster.map((u) => [u.name, u.currentHP, u.level, u.xp]),
    convoy: run.convoy,
  });
  return loaded;
}
it.each(['shop', 'church', 'arena'])(
  '%s leave persists completed node and route together with transactions',
  (kind) => {
    const { run, scene, node } = runFixture();
    saveRun(run, null, 1);
    run.gold -= 250;
    run.roster[0].currentHP = 1;
    if (kind === 'shop') {
      Object.assign(scene, {
        shopOverlay: [],
        _shopNode: node,
        closeShopOverlay() {
          this.shopOverlay = null;
        },
      });
      new ShopController(scene).leaveShopNode();
    } else if (kind === 'church') {
      Object.assign(scene, {
        churchOverlay: [],
        _churchNode: node,
        closeChurchOverlay() {
          this.churchOverlay = null;
        },
      });
      new ChurchController(scene).leaveChurchNode();
    } else {
      scene.colosseumOverlay = {};
      NodeMapScene.prototype.leaveColosseumNode.call(scene, node);
    }
    const loaded = assertPersisted(run);
    expect(loaded.nodeMap.nodes.find((n) => n.id === node.id).completed).toBe(true);
    expect(loaded.currentNodeId).toBe(node.id);
  },
);
it('caravan stock and purchased item persist across open, transaction, reload and leave', () => {
  let { run, scene } = runFixture();
  run.pendingCaravanShop = { actId: run.currentAct };
  const install = () => {
    const controller = new ShopController(scene);
    Object.assign(scene, {
      applyDifficultyShopPricing: (items) => controller.applyDifficultyShopPricing(items),
      showShopOverlay(node, items, options) {
        Object.assign(this, {
          shopOverlay: [],
          _shopNode: node,
          shopBuyItems: items,
          _currentShopIsCaravan: options.caravan,
          shopForgesUsed: 0,
          shopRerollCount: 0,
          _shopOriginalSlotCount: items.length,
        });
      },
      closeShopOverlay() {
        this.shopOverlay = null;
      },
    });
    return controller;
  };
  let controller = install();
  controller.handleShop(null, { caravan: true });
  const original = structuredClone(scene.shopBuyItems);
  expect(original.length).toBeGreaterThan(0);
  let loaded = loadRun(data, 1);
  expect(loaded.pendingCaravanShop).toBeNull();
  expect(loaded.activeCaravanShop.shopState.items).toEqual(original);
  const entry = scene.shopBuyItems[0];
  expect(purchaseShopItem(run, scene.shopBuyItems, entry, 'convoy').ok).toBe(true);
  controller._saveShopState();
  saveServiceRun(scene);
  loaded = assertPersisted(run);
  expect(loaded.activeCaravanShop.shopState.items).toEqual(original.slice(1));
  run = loaded;
  scene.runManager = run;
  controller = install();
  controller.handleShop(null, { caravan: true });
  expect(scene.shopBuyItems).toEqual(original.slice(1));
  controller.leaveShopNode();
  expect(loadRun(data, 1).getPendingCaravanShop()).toBeNull();
});
it.each(['win', 'lose', 'draw'])(
  'arena %s is settled and persisted before combat log dismissal, exactly once',
  (outcome) => {
    const { run, scene, node } = runFixture();
    const c = new ColosseumOverlay(scene, run, data);
    c._node = node;
    c._selectedUnit = run.roster[0];
    c._challenger = {
      unit: createUnit(
        data.classes.find((c) => c.name === 'Fighter'),
        1,
        data.weapons,
      ),
    };
    c._colosseumData = data.colosseum;
    c._selectedUnit.xp = 99;
    c._selectedUnit.currentHP = 1;
    c._fightsPerUnit[c._selectedUnit.name] = 1;
    const tier = { entryFee: 100, goldReward: 300, xpMultiplier: 1 };
    const result = c._settleFight(outcome, tier);
    const first = JSON.stringify(run.toJSON());
    expect(c._settleFight(outcome, tier)).toBe(result);
    expect(JSON.stringify(run.toJSON())).toBe(first);
    const loaded = assertPersisted(run);
    expect(loaded.nodeMap.nodes[0].colosseumState.fightsPerUnit[c._selectedUnit.name]).toBe(1);
    expect(loaded.gold).toBe(outcome === 'win' ? 10300 : outcome === 'lose' ? 9900 : 10000);
  },
);
it('mercenary hire persists unit identity and the one-hire-per-visit limit', () => {
  const { run, scene, node } = runFixture();
  const c = new ColosseumOverlay(scene, run, data);
  const recruit = createUnit(
    data.classes.find((c) => c.name === 'Fighter'),
    1,
    data.weapons,
    { name: 'Persist Merc' },
  );
  c._node = node;
  c._mercCandidates = [{ unit: recruit, hireCost: 100 }];
  c._showMercBrowse = vi.fn();
  expect(c._hireMercenary(0)).toBe(true);
  expect(c._hireMercenary(0)).toBe(false);
  const loaded = assertPersisted(run);
  expect(loaded.nodeMap.nodes[0].colosseumState.mercHired).toBe(true);
  const restored = loaded.roster.find((u) => u.name === 'Persist Merc');
  expect(restored.inventory).toContain(restored.weapon);
  expect(canEquip(restored, restored.weapon)).toBe(true);
});
it('real arena combat saves damage, rewards and fight count before showing its dismissible log', () => {
  const { run, scene, node } = runFixture();
  const c = new ColosseumOverlay(scene, run, data);
  c._node = node;
  c._colosseumData = data.colosseum;
  c._maxFights = 3;
  c._selectedUnit = run.roster[0];
  c._selectedUnit.stats.STR = 999;
  c._selectedUnit.weapon.hit = 999;
  c._challenger = {
    unit: createUnit(
      data.classes.find((c) => c.name === 'Fighter'),
      1,
      data.weapons,
    ),
  };
  c._selectedTier = { entryFee: 100, goldReward: 300, xpMultiplier: 1 };
  c._showCombatLog = vi.fn(() => {
    const loaded = assertPersisted(run);
    expect(loaded.gold).toBe(10300);
    expect(loaded.nodeMap.nodes[0].colosseumState.fightsPerUnit[c._selectedUnit.name]).toBe(1);
  });
  c._executeFight();
  c._executeFight();
  expect(c._showCombatLog).toHaveBeenCalledTimes(1);
});
it('casualty notices persist transferred and convoy-full retained gear without discarding either', () => {
  const { run } = runFixture();
  const fallen = structuredClone(run.roster[1]);
  fallen.consumables = [{ name: 'Vulnerary', type: 'Consumable', uses: 3 }];
  fallen.accessory = { name: 'Ring', type: 'Accessory' };
  while (run.canAddToConvoy(fallen.inventory[0])) run.addToConvoy(fallen.inventory[0]);
  run._transferFallenUnitItems(fallen);
  expect(fallen._fallenItemsNotice).toContain('Convoy full:');
  expect(fallen._fallenItemsNotice).toContain('Accessory returned to the team pool');
  expect(fallen.inventory.length).toBeGreaterThan(0);
  expect(fallen.consumables).toHaveLength(0);
  run.fallenUnits.push(fallen);
  saveRun(run, null, 1);
  const loaded = loadRun(data, 1);
  expect(loaded.fallenUnits[0]._fallenItemsNotice).toBe(fallen._fallenItemsNotice);
  expect(loaded.accessories.some((a) => a.name === 'Ring')).toBe(true);
});
it('abandon preview equals actual persisted payout and settling twice does not duplicate it', () => {
  const { run } = runFixture();
  run.completedBattles = 4;
  run.actIndex = 1;
  const meta = new MetaProgressionManager(data.metaUpgrades, 'test_meta');
  const expected = run.previewEndRunRewards();
  run.failRun();
  run.settleEndRunRewards(meta, 'defeat');
  run.settleEndRunRewards(meta, 'defeat');
  const loaded = new MetaProgressionManager(data.metaUpgrades, 'test_meta');
  expect(loaded.totalValor).toBe(expected.valor);
  expect(loaded.totalSupply).toBe(expected.supply);
  expect(loaded.runsCompleted).toBe(1);
});
it('shared scroll/accessory sales remove only the owned pool item, pay once and persist', () => {
  const { run, scene } = runFixture();
  run.scrolls = [{ name: 'Unused scroll', type: 'Scroll', price: 2500 }];
  run.accessories = [{ name: 'Spare ring', type: 'Accessory', price: 1000 }];
  const rows = shopOwnedItems(run).filter((r) => ['scroll', 'accessory'].includes(r.kind));
  for (const row of rows) {
    expect(sellShopItem(run, row).ok).toBe(true);
    expect(sellShopItem(run, row).ok).toBe(false);
  }
  saveServiceRun(scene);
  const loaded = assertPersisted(run);
  expect(loaded.scrolls).toEqual([]);
  expect(loaded.accessories).toEqual([]);
  expect(loaded.gold).toBe(11750);
});

it('popup checkpoint contains applied XP/skills and resumes the final action, not another attack', async () => {
  const { run } = runFixture();
  const scene = new BattleScene();
  const unit = createUnit(
    data.classes.find((c) => c.name === 'Fighter'),
    14,
    data.weapons,
    { name: 'Popup Veteran' },
  );
  unit.xp = 99;
  unit.col = 1;
  unit.row = 1;
  Object.assign(scene, {
    playerUnits: [unit],
    enemyUnits: [],
    npcUnits: [],
    gameData: data,
    runManager: run,
    battleState: 'COMBAT_RESOLVING',
    battleParams: {},
    turnManager: { currentPhase: 'player', turnNumber: 1 },
    grid: { gridToPixel: () => ({ x: 0, y: 0 }), clearAttackHighlights: vi.fn() },
    add: {
      text: () => ({
        setOrigin() {
          return this;
        },
        setDepth() {
          return this;
        },
        destroy() {},
      }),
    },
    tweens: { add: vi.fn() },
    updateHPBar: vi.fn(),
    commitVisionSnapshotIfPending: vi.fn(),
    _playLevelUpSfx: vi.fn(),
    _stopLevelUpSfx: vi.fn(),
    reseedBattleRng: vi.fn(),
    _persistBattleRunState: () => saveRun(run, null, 1),
  });
  run.beginBattleInProgress(run.nodeMap.nodes[0].id, { battleParams: {} });
  await scene.awardScaledXP(unit, 20);
  expect(unit.level).toBe(15);
  expect(popupShow).not.toHaveBeenCalled();
  popupShow.mockImplementation(async () => {
    const checkpoint = loadRun(data, 1).battleInProgress.checkpoint;
    expect(checkpoint.playerUnits[0].level).toBe(15);
    expect(checkpoint.playerUnits[0].skills).toEqual(unit.skills);
    expect(checkpoint.pendingActionCompletion).toEqual({ kind: 'combat', unitName: unit.name });
  });
  await presentQueuedLevelUps(scene, { kind: 'combat', unitName: unit.name });
  const checkpoint = loadRun(data, 1).battleInProgress.checkpoint;
  scene.playerUnits = [];
  scene.enemyUnits = [];
  scene.npcUnits = [];
  scene.addUnitGraphic = vi.fn();
  scene.dimUnit = vi.fn();
  new BattleSuspendController(scene).applyUnits(checkpoint);
  scene.checkBattleEnd = vi.fn(() => false);
  scene.finishUnitAction = vi.fn();
  completeResolvedAction(scene, checkpoint.pendingActionCompletion);
  expect(scene.finishUnitAction).toHaveBeenCalledWith(scene.playerUnits[0], { skipCanto: false });
  expect(scene.playerUnits[0].level).toBe(15);
  expect(popupShow).toHaveBeenCalledTimes(1);
});

it('JSON-resumed resolved action enters real Canto with only its unspent movement', () => {
  const scene = new BattleScene();
  const unit = {
    name: 'Rider',
    faction: 'player',
    currentHP: 20,
    stats: { MOV: 7 },
    skills: ['canto'],
    _movementSpent: 4,
  };
  Object.assign(scene, {
    playerUnits: [unit],
    grid: { clearAttackHighlights: vi.fn() },
    checkBattleEnd: () => false,
    commitVisionSnapshotIfPending: vi.fn(),
    _clearCombatRollSession: vi.fn(),
    hideActionMenu: vi.fn(),
    _clearSelectedWeaponArt: vi.fn(),
    startCantoMove: vi.fn(),
    _captureSuspendCheckpoint: vi.fn(),
  });
  completeResolvedAction(scene, JSON.parse(JSON.stringify({ kind: 'finish', unitName: 'Rider' })));
  expect(scene.startCantoMove).toHaveBeenCalledExactlyOnceWith(unit, 3);
  expect(unit.hasActed).toBe(true);
  expect(scene.selectedUnit).toBe(unit);
  expect(scene._pendingActionCompletion).toBeNull();
});

it('JSON-resumed Gambit refreshes only nearby living units and captures one new RNG boundary', () => {
  const scene = new BattleScene();
  const units = [
    { name: 'Lord', col: 1, row: 1, currentHP: 20 },
    { name: 'Near', col: 2, row: 1, currentHP: 20 },
    { name: 'Far', col: 4, row: 1, currentHP: 20 },
    { name: 'Dead', col: 1, row: 2, currentHP: 0 },
  ].map((unit) => ({
    ...unit,
    hasActed: true,
    hasMoved: true,
    _movementCommitted: true,
    _movementSpent: 3,
  }));
  Object.assign(scene, {
    playerUnits: units,
    checkBattleEnd: () => false,
    grid: { clearAttackHighlights: vi.fn() },
    commitVisionSnapshotIfPending: vi.fn(),
    _captureSuspendCheckpoint: vi.fn(),
    finishUnitAction: vi.fn(),
  });
  completeResolvedAction(
    scene,
    JSON.parse(JSON.stringify({ kind: 'combat', unitName: 'Lord', gambitTriggered: true })),
  );
  expect(units.map((u) => u.hasActed)).toEqual([false, false, true, true]);
  expect(units.map((u) => u._movementSpent)).toEqual([0, 0, 3, 3]);
  expect(units[0]._gambitUsedThisTurn).toBe(true);
  expect(scene._captureSuspendCheckpoint).toHaveBeenCalledTimes(1);
  expect(scene.finishUnitAction).not.toHaveBeenCalled();
});

it('reopening a persisted arena visit restores fight limits, XP caps and the hired board', () => {
  const { run, scene, node } = runFixture();
  const first = new ColosseumOverlay(scene, run, data);
  first._node = node;
  first._fightsPerUnit = { [run.roster[0].name]: 3 };
  first._levelsGainedThisVisit = { [run.roster[0].name]: 2 };
  const merc = createUnit(
    data.classes.find((c) => c.name === 'Fighter'),
    1,
    data.weapons,
    { name: 'Arena Restore' },
  );
  first._mercCandidates = [{ unit: merc, hireCost: 100 }];
  first._showMercBrowse = vi.fn();
  expect(first._hireMercenary(0)).toBe(true);
  const loaded = loadRun(data, 1);
  const reopened = new ColosseumOverlay(scene, loaded, data);
  reopened._showMenu = vi.fn();
  reopened._showMercBrowse = vi.fn();
  reopened.show(loaded.nodeMap.nodes[0], vi.fn());
  expect(reopened._showMenu).toHaveBeenCalledTimes(1);
  expect(reopened._fightsPerUnit).toEqual(first._fightsPerUnit);
  expect(reopened._levelsGainedThisVisit).toEqual(first._levelsGainedThisVisit);
  expect(reopened._mercHired).toBe(true);
  expect(reopened._hireMercenary(0)).toBe(false);
  expect(reopened._mercCandidates[0].unit.inventory).toContain(
    reopened._mercCandidates[0].unit.weapon,
  );
  expect(loaded.gold).toBe(run.gold);
});

it('arena threshold level grants its class skill before saving and matches reload', () => {
  const { run, scene, node } = runFixture();
  const unit = createUnit(
    data.classes.find((c) => c.name === 'Fighter'),
    14,
    data.weapons,
    { name: 'Arena Threshold' },
  );
  unit.xp = 99;
  unit.skills = [];
  run.roster.push(unit);
  const arena = new ColosseumOverlay(scene, run, data);
  Object.assign(arena, {
    _node: node,
    _selectedUnit: unit,
    _challenger: { unit: structuredClone(unit) },
    _colosseumData: data.colosseum,
  });
  const result = arena._settleFight('win', { entryFee: 100, goldReward: 300, xpMultiplier: 1 });
  expect(unit.level).toBe(15);
  expect(unit.skills).toContain('wrath');
  expect(result.levelUpInfo.learnedSkills).toContain('wrath');
  const restored = loadRun(data, 1).roster.find((u) => u.name === unit.name);
  expect(restored.skills).toEqual(unit.skills);
  expect(restored.level).toBe(unit.level);
});
