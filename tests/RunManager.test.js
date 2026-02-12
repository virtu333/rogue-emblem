import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RunManager, serializeUnit, saveRun, loadRun, hasSavedRun, clearSavedRun } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';
import { NODE_TYPES } from '../src/utils/constants.js';

// Mock localStorage
const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => store[key] ?? null),
  setItem: vi.fn((key, val) => { store[key] = val; }),
  removeItem: vi.fn((key) => { delete store[key]; }),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

describe('RunManager', () => {
  let gameData;
  let rm;

  beforeEach(() => {
    gameData = loadGameData();
    rm = new RunManager(gameData);
  });

  describe('startRun', () => {
    it('creates roster with 2 lords', () => {
      rm.startRun();
      expect(rm.roster.length).toBe(2);
    });

    it('first unit is Edric (Lord)', () => {
      rm.startRun();
      expect(rm.roster[0].name).toBe('Edric');
      expect(rm.roster[0].isLord).toBe(true);
    });

    it('second unit is Sera (Light Sage)', () => {
      rm.startRun();
      expect(rm.roster[1].name).toBe('Sera');
      expect(rm.roster[1].isLord).toBe(true);
    });

    it('Edric has Steel Sword in inventory', () => {
      rm.startRun();
      const edric = rm.roster[0];
      expect(edric.inventory.some(w => w.name === 'Steel Sword')).toBe(true);
    });

    it('Sera has Heal staff in inventory', () => {
      rm.startRun();
      const sera = rm.roster[1];
      expect(sera.inventory.some(w => w.name === 'Heal')).toBe(true);
    });

    it('Sera has Staff proficiency', () => {
      rm.startRun();
      const sera = rm.roster[1];
      expect(sera.proficiencies.some(p => p.type === 'Staff')).toBe(true);
    });

    it('generates act1 node map', () => {
      rm.startRun();
      expect(rm.nodeMap).toBeTruthy();
      expect(rm.nodeMap.actId).toBe('act1');
    });

    it('sets status to active', () => {
      rm.startRun();
      expect(rm.status).toBe('active');
    });

    it('stores selected difficulty and modifiers', () => {
      rm.startRun({ difficultyId: 'hard' });
      expect(rm.difficultyId).toBe('hard');
      expect(rm.getDifficultyModifier('enemyStatBonus', 0)).toBe(gameData.difficulty.modes.hard.enemyStatBonus);
    });

    it('initializes vision charges and rng seed from meta effects', () => {
      const metaEffects = { visionChargesBonus: 2 };
      const rmWithMeta = new RunManager(gameData, metaEffects);
      rmWithMeta.startRun({ runSeed: 1337 });
      expect(rmWithMeta.rngSeed).toBe(1337);
      expect(rmWithMeta.visionChargesRemaining).toBe(3);
      expect(rmWithMeta.visionCount).toBe(0);
    });

    it('initializes unlocked weapon arts for current act', () => {
      rm.startRun();
      const ids = rm.getUnlockedWeaponArtIds();
      expect(ids.length).toBeGreaterThan(0);
      expect(ids).toContain('sword_precise_cut');
    });

    it('activates meta-unlocked weapon arts immediately at run start', () => {
      const metaEffects = { metaUnlockedWeaponArts: ['legend_gemini_tempest', 'not_real_art'] };
      const rmWithMeta = new RunManager(gameData, metaEffects);
      rmWithMeta.startRun();
      expect(rmWithMeta.getMetaUnlockedWeaponArtIds()).toEqual(['legend_gemini_tempest']);
      expect(rmWithMeta.isWeaponArtUnlocked('legend_gemini_tempest')).toBe(true);
      expect(rmWithMeta.isWeaponArtUnlocked('not_real_art')).toBe(false);
    });
  });

  describe('serializeUnit', () => {
    it('strips Phaser fields', () => {
      const unit = {
        name: 'Test', stats: { HP: 20 }, currentHP: 20,
        graphic: { destroy: () => {} },
        label: { destroy: () => {} },
        hpBar: { bg: {}, fill: {} },
        hasMoved: true, hasActed: true,
      };
      const serialized = serializeUnit(unit);
      expect(serialized.graphic).toBeNull();
      expect(serialized.label).toBeNull();
      expect(serialized.hpBar).toBeNull();
      expect(serialized.hasMoved).toBe(false);
      expect(serialized.hasActed).toBe(false);
    });

    it('strips battle-scoped deltas', () => {
      const unit = {
        name: 'Test',
        stats: { HP: 20, DEF: 5 },
        _battleDeltas: { DEF: -2 },
      };
      const serialized = serializeUnit(unit);
      expect(serialized._battleDeltas).toBeUndefined();
    });

    it('resets per-battle flags', () => {
      const unit = { name: 'Test', hasMoved: true, hasActed: true, graphic: null, label: null, hpBar: null };
      const serialized = serializeUnit(unit);
      expect(serialized.hasMoved).toBe(false);
      expect(serialized.hasActed).toBe(false);
    });

    it('resets _miracleUsed flag', () => {
      const unit = { name: 'Test', _miracleUsed: true, hasMoved: false, hasActed: false, graphic: null, label: null, hpBar: null };
      const serialized = serializeUnit(unit);
      expect(serialized._miracleUsed).toBe(false);
    });

    it('preserves stats and inventory', () => {
      const unit = {
        name: 'Edric', stats: { HP: 20, STR: 8 }, currentHP: 15,
        inventory: [{ name: 'Iron Sword' }], skills: ['charisma'],
        graphic: null, label: null, hpBar: null,
        hasMoved: false, hasActed: false,
      };
      const serialized = serializeUnit(unit);
      expect(serialized.name).toBe('Edric');
      expect(serialized.stats.STR).toBe(8);
      expect(serialized.currentHP).toBe(15);
      expect(serialized.inventory[0].name).toBe('Iron Sword');
      expect(serialized.skills[0]).toBe('charisma');
    });

    it('is safe to structuredClone after stripping Phaser fields', () => {
      const unit = {
        name: 'Test',
        stats: { HP: 20 },
        currentHP: 20,
        inventory: [{ name: 'Iron Sword' }],
        skills: [],
        graphic: { destroy: () => {} },
        label: { destroy: () => {} },
        hpBar: { bg: {}, fill: {} },
        factionIndicator: { destroy: () => {} },
        hasMoved: false,
        hasActed: false,
      };

      const serialized = serializeUnit(unit);
      expect(() => structuredClone(serialized)).not.toThrow();
    });
  });

  describe('getAvailableNodes', () => {
    it('returns start node at beginning of act', () => {
      rm.startRun();
      const available = rm.getAvailableNodes();
      expect(available.length).toBe(1);
      expect(available[0].id).toBe(rm.nodeMap.startNodeId);
    });

    it('returns connected nodes after completing a node', () => {
      rm.startRun();
      const startNode = rm.nodeMap.nodes.find(n => n.id === rm.nodeMap.startNodeId);
      rm.markNodeComplete(startNode.id);
      const available = rm.getAvailableNodes();
      expect(available.length).toBeGreaterThan(0);
      // All available nodes should be in the edges of the start node
      for (const node of available) {
        expect(startNode.edges).toContain(node.id);
      }
    });
  });

  describe('completeBattle', () => {
    it('updates roster with surviving units', () => {
      rm.startRun();
      const startNode = rm.nodeMap.nodes.find(n => n.id === rm.nodeMap.startNodeId);
      // Simulate a battle: units gain XP
      const roster = rm.getRoster();
      roster[0].xp = 50;
      roster[0].currentHP = 10;
      rm.completeBattle(roster, startNode.id);
      expect(rm.roster[0].xp).toBe(50);
      expect(rm.roster[0].currentHP).toBe(10);
    });

    it('increments completedBattles', () => {
      rm.startRun();
      expect(rm.completedBattles).toBe(0);
      const startNode = rm.nodeMap.nodes.find(n => n.id === rm.nodeMap.startNodeId);
      rm.completeBattle(rm.getRoster(), startNode.id);
      expect(rm.completedBattles).toBe(1);
    });

    it('marks node as completed', () => {
      rm.startRun();
      const startNode = rm.nodeMap.nodes.find(n => n.id === rm.nodeMap.startNodeId);
      rm.completeBattle(rm.getRoster(), startNode.id);
      expect(startNode.completed).toBe(true);
    });
  });

  describe('rest', () => {
    it('heals all units to full HP', () => {
      rm.startRun();
      rm.roster[0].currentHP = 5;
      rm.roster[1].currentHP = 3;
      rm.rest('someNodeId');
      expect(rm.roster[0].currentHP).toBe(rm.roster[0].stats.HP);
      expect(rm.roster[1].currentHP).toBe(rm.roster[1].stats.HP);
    });
  });

  describe('act progression', () => {
    it('starts at act1', () => {
      rm.startRun();
      expect(rm.currentAct).toBe('act1');
      expect(rm.actIndex).toBe(0);
    });

    it('advanceAct progresses to act2', () => {
      rm.startRun();
      rm.advanceAct();
      expect(rm.currentAct).toBe('act2');
      expect(rm.actIndex).toBe(1);
      expect(rm.nodeMap.actId).toBe('act2');
      expect(rm.currentNodeId).toBeNull();
    });

    it('isRunComplete is false until final boss defeated', () => {
      rm.startRun();
      expect(rm.isRunComplete()).toBe(false);
    });

    it('isActComplete checks boss node', () => {
      rm.startRun();
      expect(rm.isActComplete()).toBe(false);
      // Complete the boss node
      const bossNode = rm.nodeMap.nodes.find(n => n.id === rm.nodeMap.bossNodeId);
      bossNode.completed = true;
      expect(rm.isActComplete()).toBe(true);
    });

    it('unlocks act-gated weapon arts when advancing acts', () => {
      const localData = loadGameData();
      localData.weaponArts.arts.push({
        id: 'test_act2_art',
        name: 'Test Act 2 Art',
        weaponType: 'Sword',
        unlockAct: 'act2',
        requiredRank: 'Prof',
        hpCost: 1,
        perTurnLimit: 1,
        perMapLimit: 3,
        combatMods: { hitBonus: 5, activated: [{ id: 'weapon_art', name: 'Test Act 2 Art' }] },
      });
      const localRm = new RunManager(localData);
      localRm.startRun();
      expect(localRm.isWeaponArtUnlocked('test_act2_art')).toBe(false);
      const unlocked = localRm.advanceAct();
      expect(unlocked).toContain('test_act2_art');
      expect(localRm.isWeaponArtUnlocked('test_act2_art')).toBe(true);
    });

    it('merges meta unlocks before act unlocks deterministically', () => {
      const localData = loadGameData();
      localData.weaponArts.arts.push({
        id: 'test_act2_ordered',
        name: 'Test Act 2 Ordered',
        weaponType: 'Sword',
        unlockAct: 'act2',
        requiredRank: 'Prof',
        hpCost: 1,
        perTurnLimit: 1,
        perMapLimit: 3,
        combatMods: { hitBonus: 5, activated: [{ id: 'weapon_art', name: 'Test Act 2 Ordered' }] },
      });
      const localRm = new RunManager(localData, { metaUnlockedWeaponArts: ['legend_gemini_tempest'] });
      localRm.startRun();
      const ids = localRm.getUnlockedWeaponArtIds();
      const metaIdx = ids.indexOf('legend_gemini_tempest');
      const actIdx = ids.indexOf('sword_precise_cut');
      expect(metaIdx).toBeGreaterThanOrEqual(0);
      expect(actIdx).toBeGreaterThanOrEqual(0);
      expect(metaIdx).toBeLessThan(actIdx);
      expect(localRm.getActUnlockedWeaponArtIds()).not.toContain('legend_gemini_tempest');
    });

    it('does not unlock arts with unknown unlockAct values', () => {
      const localData = loadGameData();
      localData.weaponArts.arts.push({
        id: 'test_bad_unlock_act',
        name: 'Bad Unlock',
        weaponType: 'Sword',
        unlockAct: 'ac2',
        requiredRank: 'Prof',
        hpCost: 1,
        perTurnLimit: 1,
        perMapLimit: 3,
        combatMods: { hitBonus: 5, activated: [{ id: 'weapon_art', name: 'Bad Unlock' }] },
      });
      const localRm = new RunManager(localData);
      localRm.startRun();
      expect(localRm.isWeaponArtUnlocked('test_bad_unlock_act')).toBe(false);
      localRm.advanceAct();
      expect(localRm.isWeaponArtUnlocked('test_bad_unlock_act')).toBe(false);
    });
  });

  describe('failRun', () => {
    it('sets status to defeat', () => {
      rm.startRun();
      rm.failRun();
      expect(rm.status).toBe('defeat');
    });
  });

  describe('convoy', () => {
    it('starts with an empty convoy', () => {
      rm.startRun();
      expect(rm.getConvoyCounts()).toEqual({ weapons: 0, consumables: 0 });
    });

    it('stores weapons and consumables in separate convoy pools', () => {
      rm.startRun();
      const sword = gameData.weapons.find(w => w.name === 'Iron Sword');
      const vuln = gameData.consumables.find(c => c.name === 'Vulnerary');
      expect(rm.addToConvoy(sword)).toBe(true);
      expect(rm.addToConvoy(vuln)).toBe(true);
      expect(rm.getConvoyCounts()).toEqual({ weapons: 1, consumables: 1 });
      expect(rm.convoy.weapons[0].name).toBe('Iron Sword');
      expect(rm.convoy.consumables[0].name).toBe('Vulnerary');
    });

    it('takeFromConvoy removes and returns an item', () => {
      rm.startRun();
      const sword = gameData.weapons.find(w => w.name === 'Iron Sword');
      rm.addToConvoy(sword);
      const pulled = rm.takeFromConvoy('weapon', 0);
      expect(pulled?.name).toBe('Iron Sword');
      expect(rm.getConvoyCounts().weapons).toBe(0);
    });

    it('takeFromConvoy returns null for invalid type', () => {
      rm.startRun();
      const sword = gameData.weapons.find(w => w.name === 'Iron Sword');
      rm.addToConvoy(sword);
      const pulled = rm.takeFromConvoy('invalid-type', 0);
      expect(pulled).toBeNull();
      expect(rm.getConvoyCounts().weapons).toBe(1);
    });

    it('rejects non-convoy item categories', () => {
      rm.startRun();
      const accessory = gameData.accessories[0];
      const scroll = { name: 'Astra Scroll', type: 'Scroll' };
      const unknown = { name: 'Mystery Crate', type: 'Mystery' };
      expect(rm.canAddToConvoy(accessory)).toBe(false);
      expect(rm.canAddToConvoy(scroll)).toBe(false);
      expect(rm.canAddToConvoy(unknown)).toBe(false);
      expect(rm.addToConvoy(accessory)).toBe(false);
      expect(rm.addToConvoy(scroll)).toBe(false);
      expect(rm.addToConvoy(unknown)).toBe(false);
      expect(rm.getConvoyCounts()).toEqual({ weapons: 0, consumables: 0 });
    });

    it('getConvoyItems returns cloned snapshots', () => {
      rm.startRun();
      const sword = gameData.weapons.find(w => w.name === 'Iron Sword');
      rm.addToConvoy(sword);
      const snapshot = rm.getConvoyItems();
      snapshot.weapons[0].name = 'Mutated';
      const fresh = rm.getConvoyItems();
      expect(fresh.weapons[0].name).toBe('Iron Sword');
    });

    it('fromJSON migrates missing convoy to defaults', () => {
      rm.startRun();
      const saved = rm.toJSON();
      delete saved.convoy;
      const restored = RunManager.fromJSON(saved, gameData);
      expect(restored.convoy).toEqual({ weapons: [], consumables: [] });
    });

    it('toJSON/fromJSON preserves convoy data', () => {
      rm.startRun();
      const sword = gameData.weapons.find(w => w.name === 'Iron Sword');
      const vuln = gameData.consumables.find(c => c.name === 'Vulnerary');
      rm.addToConvoy(sword);
      rm.addToConvoy(vuln);
      const restored = RunManager.fromJSON(rm.toJSON(), gameData);
      expect(restored.getConvoyCounts()).toEqual({ weapons: 1, consumables: 1 });
    });
  });

  describe('settleEndRunRewards', () => {
    it('applies defeat rewards to meta exactly once', () => {
      rm.startRun();
      rm.failRun();
      rm.actIndex = 2;
      rm.completedBattles = 4;
      const meta = {
        addValor: vi.fn(),
        addSupply: vi.fn(),
        incrementRunsCompleted: vi.fn(),
        recordMilestone: vi.fn(),
      };

      const first = rm.settleEndRunRewards(meta, 'defeat');
      const second = rm.settleEndRunRewards(meta, 'defeat');

      expect(first.valor).toBeGreaterThan(0);
      expect(first.supply).toBeGreaterThan(0);
      expect(second).toEqual(first);
      expect(meta.addValor).toHaveBeenCalledTimes(1);
      expect(meta.addValor).toHaveBeenCalledWith(first.valor);
      expect(meta.addSupply).toHaveBeenCalledTimes(1);
      expect(meta.addSupply).toHaveBeenCalledWith(first.supply);
      expect(meta.incrementRunsCompleted).toHaveBeenCalledTimes(1);
      expect(meta.recordMilestone).toHaveBeenCalledWith('beatAct1');
      expect(meta.recordMilestone).toHaveBeenCalledWith('beatAct2');
    });

    it('allows deferred meta application when rewards were settled before meta was available', () => {
      rm.startRun();
      rm.failRun();
      rm.actIndex = 1;
      rm.completedBattles = 2;

      const settled = rm.settleEndRunRewards(null, 'defeat');
      const meta = {
        addValor: vi.fn(),
        addSupply: vi.fn(),
        incrementRunsCompleted: vi.fn(),
        recordMilestone: vi.fn(),
      };
      const replayed = rm.settleEndRunRewards(meta, 'defeat');

      expect(replayed.valor).toBe(settled.valor);
      expect(replayed.supply).toBe(settled.supply);
      expect(meta.addValor).toHaveBeenCalledTimes(1);
      expect(meta.addValor).toHaveBeenCalledWith(settled.valor);
      expect(meta.addSupply).toHaveBeenCalledTimes(1);
      expect(meta.addSupply).toHaveBeenCalledWith(settled.supply);
      expect(meta.incrementRunsCompleted).toHaveBeenCalledTimes(1);
    });
  });

  describe('getRoster', () => {
    it('returns copies of roster units', () => {
      rm.startRun();
      const roster = rm.getRoster();
      expect(roster.length).toBe(2);
      // Modifying returned roster shouldn't affect internal state
      roster[0].name = 'CHANGED';
      expect(rm.roster[0].name).not.toBe('CHANGED');
    });
  });

  describe('toJSON / fromJSON', () => {
    it('round-trips run state correctly', () => {
      rm.startRun();
      rm.gold = 500;
      rm.completedBattles = 3;
      const startNode = rm.nodeMap.nodes.find(n => n.id === rm.nodeMap.startNodeId);
      rm.markNodeComplete(startNode.id);

      const json = rm.toJSON();
      const restored = RunManager.fromJSON(json, gameData);

      expect(restored.status).toBe('active');
      expect(restored.actIndex).toBe(0);
      expect(restored.gold).toBe(500);
      expect(restored.completedBattles).toBe(3);
      expect(restored.currentNodeId).toBe(startNode.id);
      expect(restored.roster.length).toBe(2);
      expect(restored.roster[0].name).toBe('Edric');
      expect(restored.nodeMap.actId).toBe('act1');
    });

    it('toJSON includes version field', () => {
      rm.startRun();
      const json = rm.toJSON();
      expect(json.version).toBe(1);
    });

    it('fromJSON restores gameData reference', () => {
      rm.startRun();
      const json = rm.toJSON();
      const restored = RunManager.fromJSON(json, gameData);
      expect(restored.gameData).toBe(gameData);
    });

    it('round-trips source-separated weapon arts through save/load', () => {
      const localData = loadGameData();
      localData.weaponArts.arts.push({
        id: 'test_manual_unlock',
        name: 'Manual Unlock',
        weaponType: 'Sword',
        unlockAct: 'act3',
        requiredRank: 'Prof',
        hpCost: 1,
        perTurnLimit: 1,
        perMapLimit: 3,
        combatMods: { hitBonus: 5, activated: [{ id: 'weapon_art', name: 'Manual Unlock' }] },
      });
      const localRm = new RunManager(localData, { metaUnlockedWeaponArts: ['legend_starfall_volley'] });
      localRm.startRun();
      expect(localRm.unlockWeaponArt('test_manual_unlock')).toBe(true);
      const restored = RunManager.fromJSON(localRm.toJSON(), localData);
      expect(restored.getMetaUnlockedWeaponArtIds()).toContain('legend_starfall_volley');
      expect(restored.getActUnlockedWeaponArtIds()).toContain('test_manual_unlock');
      expect(restored.isWeaponArtUnlocked('test_manual_unlock')).toBe(true);
    });

    it('migrates saves without unlockedWeaponArts by syncing current-act defaults', () => {
      rm.startRun();
      const json = rm.toJSON();
      delete json.unlockedWeaponArts;
      delete json.metaUnlockedWeaponArts;
      delete json.actUnlockedWeaponArts;
      const restored = RunManager.fromJSON(json, gameData);
      expect(restored.getUnlockedWeaponArtIds().length).toBeGreaterThan(0);
      expect(restored.isWeaponArtUnlocked('sword_precise_cut')).toBe(true);
    });

    it('migrates legacy merged unlockedWeaponArts into act unlock source', () => {
      rm.startRun();
      const json = rm.toJSON();
      json.unlockedWeaponArts = [...json.unlockedWeaponArts, 'legend_gemini_tempest'];
      delete json.metaUnlockedWeaponArts;
      delete json.actUnlockedWeaponArts;
      const restored = RunManager.fromJSON(json, gameData);
      expect(restored.getActUnlockedWeaponArtIds()).toContain('legend_gemini_tempest');
      expect(restored.getMetaUnlockedWeaponArtIds()).not.toContain('legend_gemini_tempest');
    });

    it('initializes blessings state to safe defaults', () => {
      rm.startRun();
      expect(Array.isArray(rm.activeBlessings)).toBe(true);
      expect(Array.isArray(rm.blessingHistory)).toBe(true);
    });

    it('migrates old saves without blessings fields to defaults', () => {
      rm.startRun();
      const json = rm.toJSON();
      delete json.activeBlessings;
      delete json.blessingHistory;
      delete json.blessingSelectionTelemetry;
      const restored = RunManager.fromJSON(json, gameData);
      expect(restored.activeBlessings).toEqual([]);
      expect(restored.blessingHistory).toEqual([]);
      expect(restored.blessingSelectionTelemetry).toBeNull();
    });

    it('round-trips activeBlessings through save/load', () => {
      rm.startRun();
      rm.activeBlessings = ['blessed_vigor'];
      const json = rm.toJSON();
      const restored = RunManager.fromJSON(json, gameData);
      expect(restored.activeBlessings).toEqual(['blessed_vigor']);
    });

    it('round-trips difficulty selection through save/load', () => {
      rm.startRun({ difficultyId: 'hard' });
      const json = rm.toJSON();
      const restored = RunManager.fromJSON(json, gameData);
      expect(restored.difficultyId).toBe('hard');
      expect(restored.actSequence).toEqual(gameData.difficulty.modes.hard.actsIncluded);
    });

    it('round-trips vision and rng state through save/load', () => {
      rm.startRun({ runSeed: 999 });
      rm.rngSeed = 424242;
      rm.visionChargesRemaining = 2;
      rm.visionCount = 1;
      const json = rm.toJSON();
      const restored = RunManager.fromJSON(json, gameData);
      expect(restored.rngSeed).toBe(424242);
      expect(restored.visionChargesRemaining).toBe(2);
      expect(restored.visionCount).toBe(1);
    });

    it('migrates old saves without difficulty fields to normal defaults', () => {
      rm.startRun({ difficultyId: 'hard' });
      const json = rm.toJSON();
      delete json.difficultyId;
      delete json.difficultyModifiers;
      delete json.actSequence;
      const restored = RunManager.fromJSON(json, gameData);
      expect(restored.difficultyId).toBe('normal');
      expect(restored.actSequence).toEqual(gameData.difficulty.modes.normal.actsIncluded);
    });
  });

  describe('saveRun / loadRun / hasSavedRun / clearSavedRun', () => {
    beforeEach(() => {
      for (const key of Object.keys(store)) delete store[key];
      vi.clearAllMocks();
    });

    it('saveRun persists to localStorage', () => {
      rm.startRun();
      saveRun(rm);
      expect(localStorageMock.setItem).toHaveBeenCalled();
      expect(store['emblem_rogue_run_save']).toBeTruthy();
    });

    it('hasSavedRun returns true after save', () => {
      rm.startRun();
      saveRun(rm);
      expect(hasSavedRun()).toBe(true);
    });

    it('hasSavedRun returns false when no save exists', () => {
      expect(hasSavedRun()).toBe(false);
    });

    it('loadRun restores a saved run', () => {
      rm.startRun();
      rm.gold = 999;
      saveRun(rm);
      const restored = loadRun(gameData);
      expect(restored).not.toBeNull();
      expect(restored.gold).toBe(999);
      expect(restored.roster[0].name).toBe('Edric');
    });

    it('loadRun returns null when no save exists', () => {
      expect(loadRun(gameData)).toBeNull();
    });

    it('clearSavedRun removes the save', () => {
      rm.startRun();
      saveRun(rm);
      expect(hasSavedRun()).toBe(true);
      clearSavedRun();
      expect(hasSavedRun()).toBe(false);
    });
  });

  describe('starting equipment meta effects', () => {
    it('weapon_forge applies forge levels to Edric combat weapons', () => {
      const metaEffects = { startingWeaponForge: 2 };
      const rmMeta = new RunManager(gameData, metaEffects);
      rmMeta.startRun();
      const edric = rmMeta.roster[0];
      // Edric has default Iron Sword (5 might) + Steel Sword (8 might)
      // Both get +2 forges of might
      const steelSword = edric.inventory.find(w => w._baseName === 'Steel Sword');
      expect(steelSword._forgeLevel).toBe(2);
      expect(steelSword.might).toBe(10); // 8 + 2
    });

    it('deadlyArsenal gives Edric a weapon from the Sword pool', () => {
      const metaEffects = { deadlyArsenal: 1 };
      const rmMeta = new RunManager(gameData, metaEffects);
      rmMeta.startRun();
      const edric = rmMeta.roster[0];
      const pool = ['Silver Sword', 'Killing Edge', 'Brave Sword', 'Ragnarok', 'Soulreaver', 'Gemini'];
      const hasPoolWeapon = edric.inventory.some(w => pool.includes(w.name));
      expect(hasPoolWeapon).toBe(true);
      expect(edric.inventory.some(w => w.name === 'Steel Sword')).toBe(false);
    });

    it('deadlyArsenal gives Sera a Light combat weapon from pool', () => {
      const metaEffects = { deadlyArsenal: 1 };
      const rmMeta = new RunManager(gameData, metaEffects);
      rmMeta.startRun();
      const sera = rmMeta.roster[1];
      const pool = ['Aura', 'Luce'];
      const hasPoolWeapon = sera.inventory.some(w => pool.includes(w.name));
      expect(hasPoolWeapon).toBe(true);
    });

    it('deadlyArsenal + weapon_forge stacks forges on pool weapon', () => {
      const metaEffects = { deadlyArsenal: 1, startingWeaponForge: 3 };
      const rmMeta = new RunManager(gameData, metaEffects);
      rmMeta.startRun();
      const edric = rmMeta.roster[0];
      const pool = ['Silver Sword', 'Killing Edge', 'Brave Sword', 'Ragnarok', 'Soulreaver', 'Gemini'];
      const poolWeapon = edric.inventory.find(w => pool.includes(w._baseName));
      expect(poolWeapon).toBeTruthy();
      expect(poolWeapon._forgeLevel).toBe(3);
    });

    it('starting_accessory equips Goddess Icon on Edric at tier 1', () => {
      const metaEffects = { startingAccessoryTier: 1 };
      const rmMeta = new RunManager(gameData, metaEffects);
      rmMeta.startRun();
      const edric = rmMeta.roster[0];
      expect(edric.accessory).toBeTruthy();
      expect(edric.accessory.name).toBe('Goddess Icon');
    });

    it('starting_accessory tier 3 equips Veteran\'s Crest', () => {
      const metaEffects = { startingAccessoryTier: 3 };
      const rmMeta = new RunManager(gameData, metaEffects);
      rmMeta.startRun();
      const edric = rmMeta.roster[0];
      expect(edric.accessory.name).toBe("Veteran's Crest");
    });

    it('staff_upgrade gives Sera Mend at tier 1', () => {
      const metaEffects = { startingStaffTier: 1 };
      const rmMeta = new RunManager(gameData, metaEffects);
      rmMeta.startRun();
      const sera = rmMeta.roster[1];
      expect(sera.inventory.some(w => w.name === 'Mend')).toBe(true);
      expect(sera.inventory.some(w => w.name === 'Heal')).toBe(false);
    });

    it('staff_upgrade gives Sera Recover at tier 2', () => {
      const metaEffects = { startingStaffTier: 2 };
      const rmMeta = new RunManager(gameData, metaEffects);
      rmMeta.startRun();
      const sera = rmMeta.roster[1];
      expect(sera.inventory.some(w => w.name === 'Recover')).toBe(true);
    });

    it('forge does not apply to staves', () => {
      const metaEffects = { startingWeaponForge: 2 };
      const rmMeta = new RunManager(gameData, metaEffects);
      rmMeta.startRun();
      const sera = rmMeta.roster[1];
      const staff = sera.inventory.find(w => w.type === 'Staff');
      expect(staff._forgeLevel).toBeUndefined();
    });
  });

  describe('starting skills meta effects', () => {
    it('assigns starting skills to lords', () => {
      const metaEffects = { startingSkills: { Edric: ['sol', 'vantage'], Sera: ['miracle'] } };
      const rmMeta = new RunManager(gameData, metaEffects);
      rmMeta.startRun();
      const edric = rmMeta.roster[0];
      const sera = rmMeta.roster[1];
      expect(edric.skills).toContain('sol');
      expect(edric.skills).toContain('vantage');
      expect(sera.skills).toContain('miracle');
    });

    it('does not duplicate existing personal skill', () => {
      // Edric's personal is 'charisma'
      const metaEffects = { startingSkills: { Edric: ['charisma'] } };
      const rmMeta = new RunManager(gameData, metaEffects);
      rmMeta.startRun();
      const edric = rmMeta.roster[0];
      const charismaCount = edric.skills.filter(s => s === 'charisma').length;
      expect(charismaCount).toBe(1);
    });

    it('preserves personal skill when adding starting skills', () => {
      const metaEffects = { startingSkills: { Edric: ['sol'] } };
      const rmMeta = new RunManager(gameData, metaEffects);
      rmMeta.startRun();
      const edric = rmMeta.roster[0];
      expect(edric.skills).toContain('charisma');
      expect(edric.skills).toContain('sol');
    });

    it('handles empty skill assignments gracefully', () => {
      const metaEffects = { startingSkills: {} };
      const rmMeta = new RunManager(gameData, metaEffects);
      rmMeta.startRun();
      const edric = rmMeta.roster[0];
      // Should just have personal skill
      expect(edric.skills).toContain('charisma');
      expect(edric.skills.length).toBe(1);
    });
  });
});

describe('Fallen unit tracking and revival', () => {
  let gameData;

  beforeEach(() => {
    gameData = loadGameData();
  });

  it('fallenUnits tracks units lost in battle', () => {
    const rm = new RunManager(gameData, null);
    rm.startRun();

    // Add a third unit to the roster
    const recruit = { name: 'TestRecruit', stats: { HP: 25 }, currentHP: 25, level: 1, className: 'Myrmidon' };
    rm.roster.push(recruit);

    // Simulate battle: 2 units survive, 1 falls
    const survivors = [rm.roster[0], rm.roster[1]];
    rm.completeBattle(survivors, 'node1', 100);

    expect(rm.fallenUnits.length).toBe(1);
    expect(rm.fallenUnits[0].name).toBe('TestRecruit');
  });

  it('reviveFallenUnit restores unit to roster at 1 HP', () => {
    const rm = new RunManager(gameData, null);
    rm.startRun();
    
    // Kill a unit
    const fallen = rm.roster[0];
    const fallenName = fallen.name;
    rm.roster = rm.roster.slice(1); // Remove first unit
    rm.fallenUnits.push(fallen);
    rm.gold = 2000;
    
    const success = rm.reviveFallenUnit(fallenName, 1000);
    expect(success).toBe(true);
    expect(rm.roster.length).toBe(2); // Back to 2 (was 1, revived 1)
    expect(rm.roster.find(u => u.name === fallenName).currentHP).toBe(1);
  });

  it('reviveFallenUnit deducts gold and removes from fallenUnits', () => {
    const rm = new RunManager(gameData, null);
    rm.startRun();
    
    const fallen = rm.roster[0];
    const fallenName = fallen.name;
    rm.roster = rm.roster.slice(1);
    rm.fallenUnits.push(fallen);
    rm.gold = 2000;
    
    rm.reviveFallenUnit(fallenName, 1000);
    expect(rm.gold).toBe(1000); // 2000 - 1000
    expect(rm.fallenUnits.length).toBe(0);
  });

  it('reviveFallenUnit fails if insufficient gold or roster full', () => {
    const rm = new RunManager(gameData, null);
    rm.startRun();
    
    const fallen = rm.roster[0];
    const fallenName = fallen.name;
    rm.roster = rm.roster.slice(1);
    rm.fallenUnits.push(fallen);
    
    // Test insufficient gold
    rm.gold = 500;
    let success = rm.reviveFallenUnit(fallenName, 1000);
    expect(success).toBe(false);
    expect(rm.fallenUnits.length).toBe(1); // Still fallen
    
    // Test roster full (max = 12 by default)
    rm.gold = 2000;
    rm.roster = Array(12).fill(null).map((_, i) => ({ name: `Unit${i}`, stats: { HP: 30 }, currentHP: 30 }));
    success = rm.reviveFallenUnit(fallenName, 1000);
    expect(success).toBe(false);
  });

  it('fallenUnits serializes and deserializes correctly', () => {
    const rm = new RunManager(gameData, null);
    rm.startRun();

    // Add fallen unit
    const fallen = rm.roster[0];
    rm.roster = rm.roster.slice(1);
    rm.fallenUnits.push(fallen);

    // Save and restore
    const json = rm.toJSON();
    const restored = RunManager.fromJSON(json, gameData);

    expect(restored.fallenUnits.length).toBe(1);
    expect(restored.fallenUnits[0].name).toBe(fallen.name);
  });
});

describe('weapon reference integrity (relinkWeapon)', () => {
  let gameData;

  beforeEach(() => {
    gameData = loadGameData();
  });

  it('getRoster() preserves weapon === inventory[idx] after clone', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const cloned = rm.getRoster();
    for (const unit of cloned) {
      if (unit.weapon) {
        expect(unit.inventory).toContain(unit.weapon);
      }
    }
  });

  it('getRoster() sanitizes invalid roster entries', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    rm.roster.push(undefined);
    rm.roster.push(null);
    rm.roster.push({ name: 'BrokenUnit' });

    const cloned = rm.getRoster();

    expect(cloned.every(u => u && u.stats && u.name)).toBe(true);
    expect(rm.roster.every(u => u && u.stats && u.name)).toBe(true);
  });

  it('fromJSON() round-trip preserves weapon === inventory[idx]', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const json = rm.toJSON();
    const restored = RunManager.fromJSON(json, gameData);
    for (const unit of restored.roster) {
      if (unit.weapon) {
        expect(unit.inventory).toContain(unit.weapon);
      }
    }
  });

  it('fromJSON() drops invalid roster/fallen entries from corrupted saves', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const json = rm.toJSON();
    json.roster.push(null, { name: 'Corrupt' });
    json.fallenUnits = [null, { foo: 'bar' }, ...json.fallenUnits];

    const restored = RunManager.fromJSON(json, gameData);

    expect(restored.roster.every(u => u && u.stats && u.name)).toBe(true);
    expect(restored.fallenUnits.every(u => u && u.stats && u.name)).toBe(true);
  });

  it('relink handles empty inventory → weapon null', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    rm.roster[0].inventory = [];
    rm.roster[0].weapon = { name: 'Ghost Sword' };
    const json = rm.toJSON();
    const restored = RunManager.fromJSON(json, gameData);
    expect(restored.roster[0].weapon).toBeNull();
  });

  it('relink handles forged weapon metadata correctly', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    // Simulate a forged weapon in inventory
    const unit = rm.roster[0];
    const forgedWeapon = { ...unit.inventory[0], _forgeLevel: 2, _forgeBonuses: { might: 2 } };
    unit.inventory[0] = forgedWeapon;
    unit.weapon = { ...forgedWeapon }; // separate object with same data
    const json = rm.toJSON();
    const restored = RunManager.fromJSON(json, gameData);
    const restoredUnit = restored.roster[0];
    expect(restoredUnit.weapon).not.toBeNull();
    expect(restoredUnit.inventory).toContain(restoredUnit.weapon);
    expect(restoredUnit.weapon._forgeLevel).toBe(2);
  });

  it('relink with fallenUnits preserves weapon references', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const fallen = rm.roster[0];
    rm.fallenUnits.push(fallen);
    rm.roster = rm.roster.slice(1);
    const json = rm.toJSON();
    const restored = RunManager.fromJSON(json, gameData);
    const restoredFallen = restored.fallenUnits[0];
    if (restoredFallen.weapon) {
      expect(restoredFallen.inventory).toContain(restoredFallen.weapon);
    }
  });

  it('fromJSON migrates inventory before relinking (no stale consumable weapon)', () => {
    // Simulate old save format: consumable in inventory[0], weapon references it
    const rm = new RunManager(gameData);
    rm.startRun();
    const json = rm.toJSON();
    const unit = json.roster[0];
    // Inject a Consumable at inventory[0] to simulate pre-migration save
    const vuln = { name: 'Vulnerary', type: 'Consumable', effect: 'heal', value: 10, uses: 3, price: 300 };
    unit.inventory.unshift(vuln);
    // Clear weapon name to force relink fallback to inventory[0]
    unit.weapon = { name: 'NonExistentWeapon' };
    // Remove consumables array to trigger migration
    delete unit.consumables;

    const restored = RunManager.fromJSON(json, gameData);
    const restoredUnit = restored.roster[0];
    // After migration, Consumable should be in consumables, not inventory
    expect(restoredUnit.inventory.every(w => w.type !== 'Consumable')).toBe(true);
    // Weapon should NOT be the consumable (migration ran first)
    if (restoredUnit.weapon) {
      expect(restoredUnit.weapon.type).not.toBe('Consumable');
    }
  });

  it('fromJSON migrates missing class innate skills (e.g. Dancer dance)', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    // Inject a Dancer unit without the 'dance' skill (simulates pre-fix boss recruit save)
    const dancerUnit = {
      name: 'Sylvie', className: 'Dancer', tier: 'base', level: 5, xp: 0,
      isLord: false, personalGrowths: null,
      growths: { HP: 50, STR: 30, MAG: 40, SKL: 45, SPD: 60, DEF: 20, RES: 35, LCK: 50 },
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      skills: [],  // BUG: missing 'dance'
      stats: { HP: 20, STR: 5, MAG: 6, SKL: 8, SPD: 10, DEF: 3, RES: 5, LCK: 7, MOV: 6 },
      currentHP: 20, mov: 6, moveType: 'foot', faction: 'player',
      weapon: null, inventory: [], consumables: [], accessory: null,
      weaponRank: 'Prof', hasMoved: false, hasActed: false,
      graphic: null, label: null, hpBar: null,
    };
    rm.roster.push(dancerUnit);
    const json = rm.toJSON();

    const restored = RunManager.fromJSON(json, gameData);
    const restoredDancer = restored.roster.find(u => u.name === 'Sylvie');
    expect(restoredDancer.skills).toContain('dance');
  });

  it('fromJSON class innate migration is idempotent (does not duplicate skills)', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    // Dancer that ALREADY has 'dance' — migration should not duplicate it
    const dancerUnit = {
      name: 'Sylvie', className: 'Dancer', tier: 'base', level: 5, xp: 0,
      isLord: false, personalGrowths: null,
      growths: { HP: 50, STR: 30, MAG: 40, SKL: 45, SPD: 60, DEF: 20, RES: 35, LCK: 50 },
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      skills: ['dance'],  // already correct
      stats: { HP: 20, STR: 5, MAG: 6, SKL: 8, SPD: 10, DEF: 3, RES: 5, LCK: 7, MOV: 6 },
      currentHP: 20, mov: 6, moveType: 'foot', faction: 'player',
      weapon: null, inventory: [], consumables: [], accessory: null,
      weaponRank: 'Prof', hasMoved: false, hasActed: false,
      graphic: null, label: null, hpBar: null,
    };
    rm.roster.push(dancerUnit);
    const json = rm.toJSON();

    const restored = RunManager.fromJSON(json, gameData);
    const restoredDancer = restored.roster.find(u => u.name === 'Sylvie');
    expect(restoredDancer.skills.filter(s => s === 'dance')).toHaveLength(1);
  });

  it('fromJSON migrates innate skills for promoted units including base class skills', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    // Swordmaster (promoted from Myrmidon) without its 'crit_plus_15' innate skill
    const swordmaster = {
      name: 'TestUnit', className: 'Swordmaster', tier: 'promoted', level: 1, xp: 0,
      isLord: false, personalGrowths: null,
      growths: { HP: 50, STR: 45, MAG: 10, SKL: 55, SPD: 60, DEF: 25, RES: 20, LCK: 40 },
      proficiencies: [{ type: 'Sword', rank: 'Mast' }],
      skills: [],  // missing 'crit_plus_15'
      stats: { HP: 28, STR: 12, MAG: 3, SKL: 16, SPD: 18, DEF: 8, RES: 5, LCK: 9, MOV: 6 },
      currentHP: 28, mov: 6, moveType: 'foot', faction: 'player',
      weapon: null, inventory: [], consumables: [], accessory: null,
      weaponRank: 'Mast', hasMoved: false, hasActed: false,
      graphic: null, label: null, hpBar: null,
    };
    rm.roster.push(swordmaster);
    const json = rm.toJSON();

    const restored = RunManager.fromJSON(json, gameData);
    const restoredUnit = restored.roster.find(u => u.name === 'TestUnit');
    expect(restoredUnit.skills).toContain('crit_plus_15');
  });

  it('fromJSON migrates innate skills for fallen units too', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const dancerUnit = {
      name: 'FallenDancer', className: 'Dancer', tier: 'base', level: 3, xp: 0,
      isLord: false, personalGrowths: null,
      growths: { HP: 50, STR: 30, MAG: 40, SKL: 45, SPD: 60, DEF: 20, RES: 35, LCK: 50 },
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      skills: [],
      stats: { HP: 18, STR: 4, MAG: 5, SKL: 7, SPD: 9, DEF: 2, RES: 4, LCK: 6, MOV: 6 },
      currentHP: 0, mov: 6, moveType: 'foot', faction: 'player',
      weapon: null, inventory: [], consumables: [], accessory: null,
      weaponRank: 'Prof', hasMoved: false, hasActed: false,
      graphic: null, label: null, hpBar: null,
    };
    rm.fallenUnits.push(dancerUnit);
    const json = rm.toJSON();

    const restored = RunManager.fromJSON(json, gameData);
    const fallen = restored.fallenUnits.find(u => u.name === 'FallenDancer');
    expect(fallen.skills).toContain('dance');
  });

  it('fromJSON migrates class-learned skills at new thresholds', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const json = rm.toJSON();
    json.roster.push({
      name: 'BaseMage',
      className: 'Mage',
      tier: 'base',
      level: 15,
      xp: 0,
      isLord: false,
      personalGrowths: null,
      growths: { HP: 50, STR: 0, MAG: 60, SKL: 35, SPD: 40, DEF: 15, RES: 45, LCK: 25 },
      proficiencies: [{ type: 'Tome', rank: 'Prof' }],
      skills: [],
      col: 0, row: 0, mov: 4, moveType: 'Infantry',
      stats: { HP: 20, STR: 1, MAG: 12, SKL: 8, SPD: 9, DEF: 3, RES: 10, LCK: 5, MOV: 4 },
      currentHP: 20, faction: 'player',
      weapon: null, inventory: [], consumables: [], accessory: null,
      weaponRank: 'Prof', hasMoved: false, hasActed: false,
      graphic: null, label: null, hpBar: null,
    });
    json.roster.push({
      name: 'PromoPaladin',
      className: 'Paladin',
      tier: 'promoted',
      level: 10,
      xp: 0,
      isLord: false,
      personalGrowths: null,
      growths: { HP: 60, STR: 45, MAG: 10, SKL: 40, SPD: 40, DEF: 35, RES: 20, LCK: 30 },
      proficiencies: [{ type: 'Lance', rank: 'Mast' }, { type: 'Sword', rank: 'Prof' }],
      skills: [],
      col: 0, row: 0, mov: 7, moveType: 'Cavalry',
      stats: { HP: 30, STR: 14, MAG: 4, SKL: 11, SPD: 11, DEF: 12, RES: 6, LCK: 8, MOV: 7 },
      currentHP: 30, faction: 'player',
      weapon: null, inventory: [], consumables: [], accessory: null,
      weaponRank: 'Mast', hasMoved: false, hasActed: false,
      graphic: null, label: null, hpBar: null,
    });

    const restored = RunManager.fromJSON(json, gameData);
    const baseMage = restored.roster.find(u => u.name === 'BaseMage');
    const promoPaladin = restored.roster.find(u => u.name === 'PromoPaladin');

    expect(baseMage.skills).toContain('luna');
    expect(promoPaladin.skills).toContain('sol');
  });

  it('relinkWeapon fallback skips non-proficient inventory[0]', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const unit = rm.roster[0]; // Edric (Sword proficiency)
    // Add a non-proficient lance at inventory[0]
    const lance = { name: 'Iron Lance', type: 'Lance', tier: 'Iron', rankRequired: 'Prof',
      might: 7, hit: 80, crit: 0, weight: 8, range: '1', price: 500 };
    unit.inventory.unshift(lance);
    // Set weapon to something that won't match any inventory item
    unit.weapon = { name: 'GhostBlade' };
    const json = rm.toJSON();
    const restored = RunManager.fromJSON(json, gameData);
    const restoredUnit = restored.roster[0];
    // Should NOT equip the non-proficient lance at [0]
    if (restoredUnit.weapon) {
      expect(restoredUnit.weapon.name).not.toBe('Iron Lance');
    }
  });

  it('relinkWeapon replaces in-inventory but non-proficient equipped weapon', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const unit = rm.roster[0]; // Edric (Sword proficiency)
    // Put a lance in inventory and set it as equipped weapon
    const lance = { name: 'Iron Lance', type: 'Lance', tier: 'Iron', rankRequired: 'Prof',
      might: 7, hit: 80, crit: 0, weight: 8, range: '1', price: 500 };
    unit.inventory.push(lance);
    unit.weapon = lance; // in-inventory but non-proficient
    const json = rm.toJSON();
    const restored = RunManager.fromJSON(json, gameData);
    const restoredUnit = restored.roster[0];
    // Should NOT keep the non-proficient lance, should pick a proficient weapon instead
    if (restoredUnit.weapon) {
      expect(restoredUnit.weapon.type).not.toBe('Lance');
    }
  });

  describe('class-innate migration', () => {
    function makeLegacyUnit(className, tier = 'base', skills = []) {
      return {
        name: `Legacy_${className}`,
        className,
        tier,
        level: 10,
        xp: 0,
        isLord: false,
        personalGrowths: null,
        growths: { HP: 0, STR: 0, MAG: 0, SKL: 0, SPD: 0, DEF: 0, RES: 0, LCK: 0 },
        proficiencies: [],
        skills: [...skills],
        col: 0,
        row: 0,
        mov: 5,
        moveType: 'Infantry',
        stats: { HP: 20, STR: 5, MAG: 5, SKL: 5, SPD: 5, DEF: 5, RES: 5, LCK: 5, MOV: 5 },
        currentHP: 20,
        faction: 'player',
        weapon: null,
        inventory: [],
        consumables: [],
        accessory: null,
        weaponRank: 'Prof',
        hasMoved: false,
        hasActed: false,
        graphic: null,
        label: null,
        hpBar: null,
      };
    }

    it('fromJSON adds missing class innates', () => {
      const rm = new RunManager(gameData);
      rm.startRun();
      const json = rm.toJSON();
      json.roster.push(makeLegacyUnit('Dancer', 'base', []));
      const restored = RunManager.fromJSON(json, gameData);
      const dancer = restored.roster.find(u => u.className === 'Dancer');
      expect(dancer.skills).toContain('dance');
    });

    it('migration is idempotent', () => {
      const rm = new RunManager(gameData);
      rm.startRun();
      const json = rm.toJSON();
      json.roster.push(makeLegacyUnit('Dancer', 'base', ['dance']));
      const restored1 = RunManager.fromJSON(json, gameData);
      const restored2 = RunManager.fromJSON(restored1.toJSON(), gameData);
      const dancer = restored2.roster.find(u => u.className === 'Dancer');
      expect(dancer.skills.filter(s => s === 'dance')).toHaveLength(1);
    });

    it('migration applies to fallenUnits and promoted base innates', () => {
      const rm = new RunManager(gameData);
      rm.startRun();
      const json = rm.toJSON();
      json.fallenUnits = [makeLegacyUnit('Bard', 'promoted', [])];
      const restored = RunManager.fromJSON(json, gameData);
      expect(restored.fallenUnits).toHaveLength(1);
      expect(restored.fallenUnits[0].skills).toContain('dance');
    });
  });
});

describe('blessing run-start effect application', () => {
  it('startRun deterministic blessing selection with same seed', () => {
    const gameData = loadGameData();
    const a = new RunManager(gameData);
    const b = new RunManager(gameData);
    a.startRun({ blessingSeed: 1234, autoSelectBlessing: false, blessingOptionCount: 3 });
    b.startRun({ blessingSeed: 1234, autoSelectBlessing: false, blessingOptionCount: 3 });
    expect(a.activeBlessings).toEqual(b.activeBlessings);
    expect(a.blessingSelectionTelemetry?.seed).toBe(1234);
    expect(Array.isArray(a.blessingSelectionTelemetry?.candidatePoolIds)).toBe(true);
    expect(Array.isArray(a.blessingSelectionTelemetry?.offeredIds)).toBe(true);
    expect(a.blessingSelectionTelemetry?.offeredIds).toEqual(b.blessingSelectionTelemetry?.offeredIds);
    expect(Array.isArray(a.blessingSelectionTelemetry?.chosenIds)).toBe(true);
    expect(a.blessingSelectionTelemetry?.chosenIds).toEqual([]);
  });

  describe('encounter locking', () => {
    it('locks and returns a deep copy of battle config by node', () => {
      const gameData = loadGameData();
      const rm = new RunManager(gameData);
      rm.startRun();
      const node = rm.nodeMap.nodes.find(n => n.type === NODE_TYPES.BATTLE && n.battleParams);
      expect(node).toBeTruthy();
      const config = { cols: 10, rows: 8, objective: 'rout', enemySpawns: [{ col: 5, row: 5 }] };
      rm.lockBattleConfig(node.id, config);

      const locked = rm.getLockedBattleConfig(node.id);
      expect(locked).toEqual(config);
      expect(node.encounterLocked).toBe(true);

      locked.enemySpawns[0].col = 99;
      const lockedAgain = rm.getLockedBattleConfig(node.id);
      expect(lockedAgain.enemySpawns[0].col).toBe(5);
    });

    it('persists battleConfigsByNodeId through toJSON/fromJSON', () => {
      const gameData = loadGameData();
      const rm = new RunManager(gameData);
      rm.startRun();
      const node = rm.nodeMap.nodes.find(n => n.type === NODE_TYPES.BATTLE && n.battleParams);
      rm.lockBattleConfig(node.id, { cols: 9, rows: 7, objective: 'seize' });
      const restored = RunManager.fromJSON(rm.toJSON(), gameData);
      expect(restored.battleConfigsByNodeId[node.id]).toBeTruthy();
      const restoredNode = restored.nodeMap.nodes.find(n => n.id === node.id);
      expect(restoredNode.encounterLocked).toBe(true);
    });

    it('persists usedRecruitNames through toJSON/fromJSON', () => {
      const gameData = loadGameData();
      const rm = new RunManager(gameData);
      rm.startRun();
      rm.usedRecruitNames = { Fighter: ['Galvin'], Mage: ['Lira'] };
      const restored = RunManager.fromJSON(rm.toJSON(), gameData);
      expect(restored.usedRecruitNames).toEqual({ Fighter: ['Galvin'], Mage: ['Lira'] });
    });

    it('getBattleParams returns a copy', () => {
      const gameData = loadGameData();
      const rm = new RunManager(gameData);
      rm.startRun();
      const node = rm.nodeMap.nodes.find(n => n.type === NODE_TYPES.BATTLE && n.battleParams);
      const params = rm.getBattleParams(node);
      params.enemyStatBonus = 999;
      expect(node.battleParams.enemyStatBonus).toBeUndefined();
    });

    it('getBattleParams injects difficulty combat modifiers', () => {
      const gameData = loadGameData();
      const rm = new RunManager(gameData);
      rm.startRun({ difficultyId: 'hard' });
      const node = rm.nodeMap.nodes.find(n => n.type === NODE_TYPES.BATTLE && n.battleParams);
      const params = rm.getBattleParams(node);
      expect(params.enemyStatBonus).toBe(gameData.difficulty.modes.hard.enemyStatBonus);
      expect(params.enemyCountBonus).toBe(gameData.difficulty.modes.hard.enemyCountBonus);
      expect(params.xpMultiplier).toBe(gameData.difficulty.modes.hard.xpMultiplier);
    });

    it('getBattleParams forwards usedRecruitNames tracker', () => {
      const gameData = loadGameData();
      const rm = new RunManager(gameData);
      rm.startRun();
      rm.usedRecruitNames = { Fighter: ['Galvin'] };
      const node = rm.nodeMap.nodes.find(n => n.type === NODE_TYPES.BATTLE && n.battleParams);
      const params = rm.getBattleParams(node);
      expect(params.usedRecruitNames).toEqual({ Fighter: ['Galvin'] });
    });

    it('getBattleParams enforces first-map no-fog and fighter-only rules', () => {
      const gameData = loadGameData();
      const rm = new RunManager(gameData);
      rm.startRun();
      const node = rm.nodeMap.nodes.find(n => n.type === NODE_TYPES.BATTLE && n.battleParams);
      node.fogEnabled = true;

      const firstParams = rm.getBattleParams(node);
      expect(firstParams.fogEnabled).toBe(false);
      expect(firstParams.firstBattleFightersOnly).toBe(true);

      rm.completedBattles = 1;
      const laterParams = rm.getBattleParams(node);
      expect(laterParams.fogEnabled).toBe(true);
      expect(laterParams.firstBattleFightersOnly).toBe(false);
    });
  });

  it('applies run_start_max_hp_bonus exactly once', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    const baseHp = rm.roster[0].stats.HP;
    rm.activeBlessings = ['blessed_vigor'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();
    expect(rm.roster[0].stats.HP).toBe(baseHp + 2);
    rm.applyRunStartBlessingEffects();
    expect(rm.roster[0].stats.HP).toBe(baseHp + 2);
  });

  it('chooseBlessing applies offered blessing and persists chosenIds telemetry', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun({ blessingSeed: 1, autoSelectBlessing: false, blessingOptionCount: 3 });
    const offered = rm.blessingSelectionTelemetry.offeredIds;
    expect(offered.length).toBeGreaterThan(0);
    const selected = offered[0];
    expect(rm.chooseBlessing(selected)).toBe(true);
    expect(rm.activeBlessings).toEqual([selected]);
    expect(rm.blessingSelectionTelemetry.chosenIds).toEqual([selected]);
    expect(rm.blessingHistory.some(e => e.eventType === 'selection' && e.blessingId === selected)).toBe(true);
  });

  it('act_hit_bonus blessing applies to player units in target act only', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();

    rm.activeBlessings = ['steady_hands'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    expect(rm.getActHitBonusForUnit({ faction: 'player' })).toBe(5);
    expect(rm.getActHitBonusForUnit({ faction: 'enemy' })).toBe(0);

    rm.advanceAct(); // act2
    expect(rm.getActHitBonusForUnit({ faction: 'player' })).toBe(0);
  });

  it('gold_delta blessing changes starting run gold', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    const baseGold = rm.gold;
    rm.activeBlessings = ['coin_of_fate'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();
    expect(rm.gold).toBe(baseGold + 100);
  });

  it('battle_gold_multiplier_delta blessing changes battle rewards', () => {
    const gameData = loadGameData();
    const control = new RunManager(gameData);
    control.startRun();
    const boosted = new RunManager(gameData);
    boosted.startRun();

    const controlNode = control.nodeMap.nodes.find(n => n.id === control.nodeMap.startNodeId);
    const boostedNode = boosted.nodeMap.nodes.find(n => n.id === boosted.nodeMap.startNodeId);
    const controlStartGold = control.gold;
    const boostedStartGold = boosted.gold;

    boosted.activeBlessings = ['merchant_bane'];
    boosted._runStartBlessingsApplied = false;
    boosted.applyRunStartBlessingEffects();

    control.completeBattle(control.getRoster(), controlNode.id, 100);
    boosted.completeBattle(boosted.getRoster(), boostedNode.id, 100);
    const controlGain = control.gold - controlStartGold;
    const boostedGain = boosted.gold - boostedStartGold;
    expect(boostedGain).toBeGreaterThan(controlGain);
  });

  it('deploy_cap_delta blessing contributes to deploy bonus accessor', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData, { deployBonus: 1 });
    rm.startRun();
    rm.activeBlessings = ['scout_blessing'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();
    expect(rm.getDeployBonus()).toBe(2);
  });

  it('lord_stat_bonus applies only to lords for iron_oath', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    rm.roster.push({
      name: 'Mercenary',
      isLord: false,
      stats: { DEF: 5, HP: 20, MOV: 5 },
      currentHP: 20,
      mov: 5,
      inventory: [],
      consumables: [],
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    });
    const baseDefs = rm.roster.map(u => u.stats.DEF);

    rm.activeBlessings = ['iron_oath'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    rm.roster.forEach((unit, idx) => {
      if (unit.isLord) {
        expect(unit.stats.DEF).toBe(baseDefs[idx] + 2);
      } else {
        expect(unit.stats.DEF).toBe(baseDefs[idx]);
      }
    });
  });

  it('all_units_stat_delta applies MOV bonus and syncs unit.mov', () => {
    const gameData = loadGameData();
    gameData.blessings.blessings.push({
      id: 'test_worldly_stride',
      name: 'Test Worldly Stride',
      tier: 4,
      description: '+1 MOV all units.',
      boons: [{ type: 'all_units_stat_delta', params: { stat: 'MOV', value: 1 } }],
      costs: [],
    });
    const rm = new RunManager(gameData);
    rm.startRun();
    const baseMov = rm.roster.map(u => u.stats.MOV);
    const baseRuntimeMov = rm.roster.map(u => u.mov);

    rm.activeBlessings = ['test_worldly_stride'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    rm.roster.forEach((unit, idx) => {
      expect(unit.stats.MOV).toBe(baseMov[idx] + 1);
      expect(unit.mov).toBe((baseRuntimeMov[idx] ?? baseMov[idx]) + 1);
    });
  });

  it('merchant_bane applies persistent -1 shop inventory delta', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();

    rm.activeBlessings = ['merchant_bane'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    expect(rm.consumeSkipFirstShop()).toBe(false);
    expect(rm.getShopItemCountDelta()).toBe(-1);
  });

  it('shop_item_count_delta blessing tracks shop inventory delta', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();

    rm.activeBlessings = ['pilgrim_coin'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    expect(rm.getShopItemCountDelta()).toBe(1);
  });

  it('all_growths_delta blessing applies to roster growths and recruit growth accessor', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    const baseGrowths = rm.roster.map(u => ({ ...u.growths }));

    rm.activeBlessings = ['forbidden_tome'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    rm.roster.forEach((unit, idx) => {
      for (const stat of ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK']) {
        expect(unit.growths[stat]).toBe((baseGrowths[idx][stat] || 0) + 15);
      }
    });
    const recruitGrowthBonuses = rm.getEffectiveRecruitGrowthBonuses();
    expect(recruitGrowthBonuses.HP).toBe(15);
    expect(recruitGrowthBonuses.STR).toBe(15);
    expect(recruitGrowthBonuses.SPD).toBe(15);
  });

  it('disable_personal_skills_until_act removes and restores lord personal skills at target act', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    const beforeSkills = rm.roster.map(u => ({
      name: u.name,
      skills: [...(u.skills || [])],
    }));

    rm.activeBlessings = ['forbidden_tome'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    rm.roster.forEach((unit, idx) => {
      expect(unit.skills.length).toBeLessThanOrEqual(beforeSkills[idx].skills.length);
    });

    rm.advanceAct(); // act2
    rm.roster.forEach((unit, idx) => {
      expect(unit.skills.length).toBeLessThanOrEqual(beforeSkills[idx].skills.length);
    });

    rm.advanceAct(); // act3
    rm.roster.forEach((unit, idx) => {
      expect(unit.skills).toEqual(beforeSkills[idx].skills);
    });
  });

  it('arsenal_pact grants one silver-tier weapon and applies act1 DEF penalty', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    const baseDefs = rm.roster.map(u => u.stats.DEF);
    const silverBefore = rm.roster.reduce((sum, u) => sum + u.inventory.filter(w => w.tier === 'Silver').length, 0);

    rm.activeBlessings = ['arsenal_pact'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    const silverAfter = rm.roster.reduce((sum, u) => sum + u.inventory.filter(w => w.tier === 'Silver').length, 0);
    expect(silverAfter).toBe(silverBefore + 1);
    rm.roster.forEach((unit, idx) => {
      expect(unit.stats.DEF).toBe(baseDefs[idx] - 1);
    });
  });

  it('arsenal_pact act1 DEF penalty is reverted after advancing to act2', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    const baseDefs = rm.roster.map(u => u.stats.DEF);

    rm.activeBlessings = ['arsenal_pact'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();
    rm.advanceAct();

    rm.roster.forEach((unit, idx) => {
      expect(unit.stats.DEF).toBe(baseDefs[idx]);
    });
  });

  it('fromJSON migrates legacy blessing telemetry chosenIds to offeredIds', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun({ blessingSeed: 99, autoSelectBlessing: false });
    const json = rm.toJSON();
    json.blessingSelectionTelemetry = {
      seed: 99,
      candidatePoolIds: ['a', 'b'],
      chosenIds: ['steady_hands', 'coin_of_fate'],
      rejectionReasons: [],
      options: { count: 3, forceTier1: true, allowTier4: true },
    };
    const restored = RunManager.fromJSON(json, gameData);
    expect(restored.blessingSelectionTelemetry.offeredIds).toEqual(['steady_hands', 'coin_of_fate']);
    expect(restored.blessingSelectionTelemetry.chosenIds).toEqual([]);
  });

  it('fromJSON normalizes legacy skill names to canonical ids', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    rm.roster[1].skills = ['Renewal Aura'];

    const restored = RunManager.fromJSON(rm.toJSON(), gameData);
    expect(restored.roster[1].skills).toContain('renewal_aura');
    expect(restored.roster[1].skills).not.toContain('Renewal Aura');
  });

  it('fromJSON initializes missing actHitBonusByAct runtime modifier', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    const json = rm.toJSON();
    delete json.blessingRuntimeModifiers.actHitBonusByAct;
    const restored = RunManager.fromJSON(json, gameData);
    expect(restored.blessingRuntimeModifiers.actHitBonusByAct).toEqual({});
  });

  it('unknown blessing IDs remain inert and do not crash application', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    rm.activeBlessings = ['unknown_future_blessing'];
    rm._runStartBlessingsApplied = false;
    expect(() => rm.applyRunStartBlessingEffects()).not.toThrow();
    expect(rm.activeBlessings).toEqual(['unknown_future_blessing']);
    expect(rm.blessingHistory.some(e => e.details?.reason === 'unknown_blessing_id')).toBe(true);
  });
});
