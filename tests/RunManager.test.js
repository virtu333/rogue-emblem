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
  });

  describe('failRun', () => {
    it('sets status to defeat', () => {
      rm.startRun();
      rm.failRun();
      expect(rm.status).toBe('defeat');
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
});
