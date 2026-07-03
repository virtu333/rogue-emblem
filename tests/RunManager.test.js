import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RunManager,
  serializeUnit,
  getReviveCost,
  saveRun,
  loadRun,
  hasSavedRun,
  clearSavedRun,
} from '../src/engine/RunManager.js';
import * as NodeMapGenerator from '../src/engine/NodeMapGenerator.js';
import { loadGameData } from './testData.js';
import { NODE_TYPES, ELITE_GOLD_MULTIPLIER, ROSTER_CAP } from '../src/utils/constants.js';
import { calculateBattleGold } from '../src/engine/LootSystem.js';
import { getStartupTelemetry } from '../src/utils/startupTelemetry.js';

// Mock localStorage
const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => store[key] ?? null),
  setItem: vi.fn((key, val) => {
    store[key] = val;
  }),
  removeItem: vi.fn((key) => {
    delete store[key];
  }),
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

    it('adds exactly one extra starter when extraStartingUnitTier is active', () => {
      const rmMeta = new RunManager(gameData, { extraStartingUnitTier: 1 });
      rmMeta.startRun();
      expect(rmMeta.roster).toHaveLength(3);
      expect(rmMeta.roster[2].className).toBe('Archer');
      expect(rmMeta.usedRecruitNames[rmMeta.roster[2].className]).toContain(rmMeta.roster[2].name);
    });

    it('extra starter class is constrained to unlocked tier pool', () => {
      const rmMeta = new RunManager(gameData, { extraStartingUnitTier: 3 });
      rmMeta.startRun();
      const extra = rmMeta.roster[2];
      const allowed = new Set(['Archer', 'Knight', 'Cavalier']);
      expect(allowed.has(extra.className)).toBe(true);
    });

    it('extra starter receives one additional Lethal Armory weapon', () => {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      try {
        const rmMeta = new RunManager(gameData, { extraStartingUnitTier: 1, lethalArmoryTier: 2 });
        rmMeta.startRun();
        const extra = rmMeta.roster[2];
        // Archer recruit gets: base bow + Longbow (recruit perk) + Lethal Armory weapon = 3
        expect(extra.inventory.length).toBe(3);
        expect(extra.weapon).toBe(extra.inventory[extra.inventory.length - 1]);
        expect(extra.weapon.type).toBe('Bow');
      } finally {
        randomSpy.mockRestore();
      }
    });

    it('extra starter receives recruit meta bonuses and random skill', () => {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      try {
        const baselineRm = new RunManager(gameData, { extraStartingUnitTier: 1 });
        baselineRm.startRun();
        const baseline = baselineRm.roster[2];

        const boostedRm = new RunManager(gameData, {
          extraStartingUnitTier: 1,
          statBonuses: { HP: 2, STR: 3 },
          growthBonuses: { STR: 7 },
          recruitRandomSkill: true,
        });
        boostedRm.startRun();
        const boosted = boostedRm.roster[2];

        expect(boosted.stats.HP).toBe(baseline.stats.HP + 2);
        expect(boosted.currentHP).toBe(baseline.currentHP + 2);
        expect(boosted.stats.STR).toBe(baseline.stats.STR + 3);
        expect(boosted.growths.STR).toBe(baseline.growths.STR + 7);
        expect(boosted.skills.length).toBeGreaterThan(0);
      } finally {
        randomSpy.mockRestore();
      }
    });

    it('extra starter gets secondary weapons when masterOfArms is active', () => {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      try {
        const rmMeta = new RunManager(gameData, { extraStartingUnitTier: 1, masterOfArms: true });
        const poolSpy = vi
          .spyOn(rmMeta, '_resolveExtraStarterClassPoolByTier')
          .mockReturnValue(['Ranger']);
        try {
          rmMeta.startRun();
          const extra = rmMeta.roster[rmMeta.roster.length - 1];
          expect(extra.className).toBe('Ranger');
          const invTypes = new Set(extra.inventory.map((w) => w?.type).filter(Boolean));
          expect(invTypes.has('Sword')).toBe(true);
          expect(invTypes.has('Bow')).toBe(true);
        } finally {
          poolSpy.mockRestore();
        }
      } finally {
        randomSpy.mockRestore();
      }
    });

    it('extra starter secondaries use spawn tier, not Lethal Armory tier', () => {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      try {
        const rmMeta = new RunManager(gameData, {
          extraStartingUnitTier: 1,
          masterOfArms: true,
          lethalArmoryTier: 1,
        });
        const poolSpy = vi
          .spyOn(rmMeta, '_resolveExtraStarterClassPoolByTier')
          .mockReturnValue(['Ranger']);
        try {
          rmMeta.startRun();
          const extra = rmMeta.roster[rmMeta.roster.length - 1];
          expect(extra.className).toBe('Ranger');
          const bow = extra.inventory.find((w) => w?.type === 'Bow');
          expect(extra.inventory.some((w) => w?.type === 'Sword' && w?.tier === 'Steel')).toBe(
            true,
          );
          expect(bow).toBeTruthy();
          expect(bow?.tier).toBe('Iron');
        } finally {
          poolSpy.mockRestore();
        }
      } finally {
        randomSpy.mockRestore();
      }
    });

    it('extra starter receives a Vulnerary when recruit_field_supplies is active', () => {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      try {
        const rmMeta = new RunManager(gameData, {
          extraStartingUnitTier: 1,
          recruitStartingVulnerary: 1,
        });
        rmMeta.startRun();
        const extra = rmMeta.roster[2];
        expect(extra.consumables.some((c) => c.name === 'Vulnerary')).toBe(true);
      } finally {
        randomSpy.mockRestore();
      }
    });

    it('paladin extra starter uses fixed Iron Sword + Steel Lance loadout', () => {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
      try {
        const rmMeta = new RunManager(gameData, { extraStartingUnitTier: 4 });
        rmMeta.startRun();
        const extra = rmMeta.roster[2];
        expect(extra.className).toBe('Paladin');

        const names = extra.inventory.map((w) => w.name).sort();
        expect(names).toEqual(['Iron Sword', 'Steel Lance']);
        expect(extra.inventory.some((w) => w.name === 'Iron Lance')).toBe(false);
        expect(extra.inventory.map((w) => w.name)).toContain(extra.weapon?.name);
        expect(extra.proficiencies.some((p) => p.type === extra.weapon?.type)).toBe(true);
      } finally {
        randomSpy.mockRestore();
      }
    });

    it('Edric has Steel Sword in inventory', () => {
      rm.startRun();
      const edric = rm.roster[0];
      expect(edric.inventory.some((w) => w.name === 'Steel Sword')).toBe(true);
    });

    it('Sera has Heal staff in inventory', () => {
      rm.startRun();
      const sera = rm.roster[1];
      expect(sera.inventory.some((w) => w.name === 'Heal')).toBe(true);
    });

    it('Sera has Staff proficiency', () => {
      rm.startRun();
      const sera = rm.roster[1];
      expect(sera.proficiencies.some((p) => p.type === 'Staff')).toBe(true);
    });

    it('stamps uid on starter consumables and starter accessory instances', () => {
      const rmMeta = new RunManager(gameData, { extraVulnerary: 1, startingAccessoryTier: 1 });
      rmMeta.startRun();
      const [edric, sera] = rmMeta.roster;

      expect(
        edric.consumables.every((item) => typeof item.uid === 'string' && item.uid.length > 0),
      ).toBe(true);
      expect(
        sera.consumables.every((item) => typeof item.uid === 'string' && item.uid.length > 0),
      ).toBe(true);
      expect(typeof edric.accessory?.uid).toBe('string');
      expect(edric.accessory?.uid?.length || 0).toBeGreaterThan(0);
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
      expect(rm.getDifficultyModifier('enemyStatBonus', 0)).toBe(
        gameData.difficulty.modes.hard.enemyStatBonus,
      );
    });

    it('initializes vision charges and rng seed from meta effects', () => {
      const metaEffects = { visionChargesBonus: 5 };
      const rmWithMeta = new RunManager(gameData, metaEffects);
      rmWithMeta.startRun({ runSeed: 1337 });
      expect(rmWithMeta.rngSeed).toBe(1337);
      expect(rmWithMeta.visionChargesRemaining).toBe(6);
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

    it('forwards colosseum node generation config to generateNodeMap in startRun', () => {
      const spy = vi.spyOn(NodeMapGenerator, 'generateNodeMap');
      try {
        rm.startRun();
        expect(spy).toHaveBeenCalled();
        const options = spy.mock.calls.at(-1)?.[3];
        expect(options?.colosseumConfig).toEqual(gameData.colosseum?.nodeGeneration ?? null);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('serializeUnit', () => {
    it('strips Phaser fields', () => {
      const unit = {
        name: 'Test',
        stats: { HP: 20 },
        currentHP: 20,
        graphic: { destroy: () => {} },
        label: { destroy: () => {} },
        hpBar: { bg: {}, fill: {} },
        hasMoved: true,
        hasActed: true,
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

    it('strips Tier 5 timed weapon-art buff runtime state', () => {
      const unit = {
        name: 'Test',
        stats: { HP: 20, STR: 12, MOV: 6 },
        mov: 6,
        _battleTimedWeaponArtBuffs: [
          {
            key: 'axe_war_cry::Edric::Test',
            stats: { STR: 3, CRIT: 10 },
            expiryPhase: 'player',
            expiryTurn: 2,
          },
        ],
        _battleTimedWeaponArtAppliedStats: { STR: 3, MOV: 1 },
        _battleTimedWeaponArtAppliedCombatMods: { critBonus: 10 },
      };
      const serialized = serializeUnit(unit);
      expect(serialized._battleTimedWeaponArtBuffs).toBeUndefined();
      expect(serialized._battleTimedWeaponArtAppliedStats).toBeUndefined();
      expect(serialized._battleTimedWeaponArtAppliedCombatMods).toBeUndefined();
      expect(serialized.stats.STR).toBe(9);
      expect(serialized.stats.MOV).toBe(5);
      expect(serialized.mov).toBe(5);
      expect(unit.stats.STR).toBe(12);
      expect(unit.stats.MOV).toBe(6);
    });

    it('resets per-battle flags', () => {
      const unit = {
        name: 'Test',
        hasMoved: true,
        hasActed: true,
        graphic: null,
        label: null,
        hpBar: null,
      };
      const serialized = serializeUnit(unit);
      expect(serialized.hasMoved).toBe(false);
      expect(serialized.hasActed).toBe(false);
    });

    it('resets _miracleUsed flag', () => {
      const unit = {
        name: 'Test',
        _miracleUsed: true,
        hasMoved: false,
        hasActed: false,
        graphic: null,
        label: null,
        hpBar: null,
      };
      const serialized = serializeUnit(unit);
      expect(serialized._miracleUsed).toBe(false);
    });

    it('resets _phoenixBroochUsed flag', () => {
      const unit = {
        name: 'Test',
        _phoenixBroochUsed: true,
        hasMoved: false,
        hasActed: false,
        graphic: null,
        label: null,
        hpBar: null,
      };
      const serialized = serializeUnit(unit);
      expect(serialized._phoenixBroochUsed).toBe(false);
    });

    it('does not persist _movementSpent', () => {
      const unit = {
        name: 'Test',
        _movementSpent: 4,
        hasMoved: false,
        hasActed: false,
        graphic: null,
        label: null,
        hpBar: null,
      };
      const serialized = serializeUnit(unit);
      expect(serialized._movementSpent).toBeUndefined();
    });

    it('preserves stats and inventory', () => {
      const unit = {
        name: 'Edric',
        stats: { HP: 20, STR: 8 },
        currentHP: 15,
        inventory: [{ name: 'Iron Sword' }],
        skills: ['charisma'],
        graphic: null,
        label: null,
        hpBar: null,
        hasMoved: false,
        hasActed: false,
      };
      const serialized = serializeUnit(unit);
      expect(serialized.name).toBe('Edric');
      expect(serialized.stats.STR).toBe(8);
      expect(serialized.currentHP).toBe(15);
      expect(serialized.inventory[0].name).toBe('Iron Sword');
      expect(serialized.skills[0]).toBe('charisma');
    });

    it('deep-clones inventory so original mutations do not affect serialized copy (M6)', () => {
      const weapon = { name: 'Iron Sword', might: 5 };
      const unit = {
        name: 'Test',
        stats: { HP: 20 },
        inventory: [weapon],
        weapon: weapon,
        skills: ['sol'],
        consumables: [{ name: 'Vulnerary', uses: 3 }],
        proficiencies: [{ type: 'Sword', rank: 'Prof' }],
        accessory: { name: 'Power Ring', effects: { STR: 2 } },
        graphic: null,
        label: null,
        hpBar: null,
        hasMoved: false,
        hasActed: false,
      };
      const serialized = serializeUnit(unit);

      // Mutate originals — serialized should be unaffected
      unit.inventory.push({ name: 'Steel Sword' });
      unit.skills.push('luna');
      unit.consumables[0].uses = 0;
      weapon.might = 99;

      expect(serialized.inventory).toHaveLength(1);
      expect(serialized.inventory[0].might).toBe(5);
      expect(serialized.skills).toEqual(['sol']);
      expect(serialized.consumables[0].uses).toBe(3);
      // Weapon identity: serialized weapon should be in serialized inventory
      expect(serialized.inventory.includes(serialized.weapon)).toBe(true);
    });

    it('prefers uid to preserve weapon linkage when object identity differs', () => {
      const inventoryWeapon = {
        name: 'Iron Sword',
        type: 'Sword',
        rankRequired: 'Prof',
        uid: 'itm_a',
      };
      const unit = {
        name: 'Test',
        stats: { HP: 20 },
        inventory: [inventoryWeapon],
        weapon: { ...inventoryWeapon, might: 99 },
        skills: [],
        proficiencies: [{ type: 'Sword', rank: 'Prof' }],
        consumables: [],
        graphic: null,
        label: null,
        hpBar: null,
        hasMoved: false,
        hasActed: false,
      };
      const serialized = serializeUnit(unit);
      expect(serialized.weapon).toBe(serialized.inventory[0]);
      expect(serialized.weapon.uid).toBe('itm_a');
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
      const startNode = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);
      rm.markNodeComplete(startNode.id);
      const available = rm.getAvailableNodes();
      expect(available.length).toBeGreaterThan(0);
      // All available nodes should be in the edges of the start node
      for (const node of available) {
        expect(startNode.edges).toContain(node.id);
      }
    });

    it('returns only the uncommitted current node when it is not completed', () => {
      rm.startRun();
      const startNode = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);
      rm.markNodeComplete(startNode.id);
      const siblings = rm.getAvailableNodes();
      expect(siblings.length).toBeGreaterThan(0);

      // Simulate clicking a non-battle node (shop/church): set currentNodeId without completing
      const target = siblings[0];
      rm.currentNodeId = target.id;
      const available = rm.getAvailableNodes();
      expect(available).toHaveLength(1);
      expect(available[0].id).toBe(target.id);
    });

    it('returns forward edges once the uncommitted node is completed', () => {
      rm.startRun();
      const startNode = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);
      rm.markNodeComplete(startNode.id);
      const siblings = rm.getAvailableNodes();
      const target = siblings[0];

      // Commit without completing
      rm.currentNodeId = target.id;
      expect(rm.getAvailableNodes()).toHaveLength(1);

      // Now complete it
      rm.markNodeComplete(target.id);
      const forward = rm.getAvailableNodes();
      // Should return forward edges (or empty if boss), not the node itself
      for (const node of forward) {
        expect(target.edges).toContain(node.id);
      }
    });
  });

  describe('ambush pending state', () => {
    it('getAmbushPendingNode resolves pending node id from the current map', () => {
      rm.startRun();
      const startNode = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);
      rm.pendingAmbushNodeId = startNode.id;

      expect(rm.getAmbushPendingNode()).toBe(startNode);
    });

    it('clearAmbushPendingNode only clears when id matches (or id is omitted)', () => {
      rm.startRun();
      const startNode = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);
      rm.pendingAmbushNodeId = startNode.id;

      expect(rm.clearAmbushPendingNode('different-node')).toBe(false);
      expect(rm.pendingAmbushNodeId).toBe(startNode.id);

      expect(rm.clearAmbushPendingNode(startNode.id)).toBe(true);
      expect(rm.pendingAmbushNodeId).toBeNull();

      rm.pendingAmbushNodeId = startNode.id;
      expect(rm.clearAmbushPendingNode()).toBe(true);
      expect(rm.pendingAmbushNodeId).toBeNull();
    });
  });

  describe('gold methods', () => {
    it('applies meta goldBonus to starting gold', () => {
      const baseline = new RunManager(gameData);
      const rmMeta = new RunManager(gameData, { goldBonus: 750 });
      expect(rmMeta.gold - baseline.gold).toBe(750);
    });

    it('addGold and awardGold add flat amounts', () => {
      const rmMeta = new RunManager(gameData);
      const startGold = rmMeta.gold;
      rmMeta.addGold(100);
      rmMeta.awardGold(40);
      expect(rmMeta.gold - startGold).toBe(140);
    });

    it('awardGold ignores non-positive values', () => {
      const rmMeta = new RunManager(gameData);
      const startGold = rmMeta.gold;
      expect(rmMeta.awardGold(0)).toBe(0);
      expect(rmMeta.awardGold(-12)).toBe(0);
      expect(rmMeta.gold).toBe(startGold);
    });
  });

  describe('completeBattle', () => {
    it('updates roster with surviving units', () => {
      rm.startRun();
      const startNode = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);
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
      const startNode = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);
      rm.completeBattle(rm.getRoster(), startNode.id);
      expect(rm.completedBattles).toBe(1);
    });

    it('marks node as completed', () => {
      rm.startRun();
      const startNode = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);
      rm.completeBattle(rm.getRoster(), startNode.id);
      expect(startNode.completed).toBe(true);
    });

    it('applies battle reward multiplier exactly once', () => {
      rm.startRun();
      const startNode = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);
      const startGold = rm.gold;
      rm.completeBattle(rm.getRoster(), startNode.id, 100);

      const expectedGain = calculateBattleGold(100, startNode?.type);
      expect(rm.gold - startGold).toBe(expectedGain);
    });

    it('applies elite, meta, and difficulty multipliers exactly once each', () => {
      // Set up RunManager with non-1 multipliers
      const metaEffects = { battleGoldMultiplier: 0.2 }; // getBattleGoldMultiplier() → 1.2
      const rmMeta = new RunManager(gameData, metaEffects);
      rmMeta.startRun();
      rmMeta.difficultyModifiers = { ...rmMeta.difficultyModifiers, goldMultiplier: 0.9 };

      // Mark first node as elite
      const node = rmMeta.nodeMap.nodes.find((n) => n.id === rmMeta.nodeMap.startNodeId);
      if (!node.battleParams) node.battleParams = {};
      node.battleParams.isElite = true;

      const startGold = rmMeta.gold;
      const killGold = 200;
      rmMeta.completeBattle(rmMeta.getRoster(), node.id, killGold);

      const baseGold = calculateBattleGold(killGold, node.type);
      const expectedGain = Math.floor(baseGold * ELITE_GOLD_MULTIPLIER * 1.2 * 0.9);
      expect(rmMeta.gold - startGold).toBe(expectedGain);
      // Guard: if GOLD_BATTLE_REWARD_MULTIPLIER were applied twice, this would be strictly larger
      expect(expectedGain).toBeGreaterThan(0);
    });

    it('respects completionGoldOverride in completeBattle options', () => {
      const control = new RunManager(gameData);
      const overridden = new RunManager(gameData);
      control.startRun();
      overridden.startRun();

      const controlNode = control.nodeMap.nodes.find((n) => n.id === control.nodeMap.startNodeId);
      const overriddenNode = overridden.nodeMap.nodes.find(
        (n) => n.id === overridden.nodeMap.startNodeId,
      );
      const controlStartGold = control.gold;
      const overriddenStartGold = overridden.gold;

      control.completeBattle(control.getRoster(), controlNode.id, 0);
      overridden.completeBattle(overridden.getRoster(), overriddenNode.id, 0, {
        completionGoldOverride: 0,
      });

      const controlGain = control.gold - controlStartGold;
      const overriddenGain = overridden.gold - overriddenStartGold;
      expect(controlGain).toBeGreaterThan(0);
      expect(overriddenGain).toBe(0);
    });

    it('sets pending ambush state when an ambush battle is completed', () => {
      rm.startRun();
      const node = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);
      node.type = 'shop';
      node.isAmbush = true;
      node.ambushCleared = false;

      const applied = rm.completeBattle(rm.getRoster(), node.id, 0);

      expect(applied).toBe(true);
      expect(node.ambushCleared).toBe(true);
      expect(rm.pendingAmbushNodeId).toBe(node.id);
      expect(rm.getAmbushPendingNode()?.id).toBe(node.id);
    });

    it('uses battle gold multiplier path for ambush battles on shop nodes', () => {
      rm.startRun();
      const node = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);
      node.type = 'shop';
      node.isAmbush = true;
      node.ambushCleared = false;

      const killGold = 100;
      const startGold = rm.gold;
      const applied = rm.completeBattle(rm.getRoster(), node.id, killGold);

      expect(applied).toBe(true);
      expect(rm.gold - startGold).toBe(calculateBattleGold(killGold, NODE_TYPES.BATTLE));
    });

    it('is a full no-op for invalid node ids', () => {
      rm.startRun();
      const stateBefore = {
        currentNodeId: rm.currentNodeId,
        roster: structuredClone(rm.roster),
        fallenUnits: structuredClone(rm.fallenUnits),
        convoy: structuredClone(rm.convoy),
        accessories: structuredClone(rm.accessories),
        completedBattles: rm.completedBattles,
        gold: rm.gold,
        visionChargesRemaining: rm.visionChargesRemaining,
      };

      const applied = rm.completeBattle(rm.getRoster(), 'invalid-node-id', 999);

      expect(applied).toBe(false);
      expect(rm.currentNodeId).toBe(stateBefore.currentNodeId);
      expect(rm.roster).toEqual(stateBefore.roster);
      expect(rm.fallenUnits).toEqual(stateBefore.fallenUnits);
      expect(rm.convoy).toEqual(stateBefore.convoy);
      expect(rm.accessories).toEqual(stateBefore.accessories);
      expect(rm.completedBattles).toBe(stateBefore.completedBattles);
      expect(rm.gold).toBe(stateBefore.gold);
      expect(rm.visionChargesRemaining).toBe(stateBefore.visionChargesRemaining);
    });

    it('is a full no-op when completeBattle is called twice for the same node', () => {
      rm.startRun();
      const startNode = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);
      const firstApplied = rm.completeBattle(rm.getRoster(), startNode.id, 100);

      const stateBeforeSecondCall = {
        currentNodeId: rm.currentNodeId,
        roster: structuredClone(rm.roster),
        fallenUnits: structuredClone(rm.fallenUnits),
        convoy: structuredClone(rm.convoy),
        accessories: structuredClone(rm.accessories),
        completedBattles: rm.completedBattles,
        gold: rm.gold,
        visionChargesRemaining: rm.visionChargesRemaining,
      };
      const alteredSurvivors = rm.getRoster();
      alteredSurvivors[0].xp = (alteredSurvivors[0].xp || 0) + 50;

      const secondApplied = rm.completeBattle(alteredSurvivors, startNode.id, 999);

      expect(firstApplied).toBe(true);
      expect(secondApplied).toBe(false);
      expect(rm.currentNodeId).toBe(stateBeforeSecondCall.currentNodeId);
      expect(rm.roster).toEqual(stateBeforeSecondCall.roster);
      expect(rm.fallenUnits).toEqual(stateBeforeSecondCall.fallenUnits);
      expect(rm.convoy).toEqual(stateBeforeSecondCall.convoy);
      expect(rm.accessories).toEqual(stateBeforeSecondCall.accessories);
      expect(rm.completedBattles).toBe(stateBeforeSecondCall.completedBattles);
      expect(rm.gold).toBe(stateBeforeSecondCall.gold);
      expect(rm.visionChargesRemaining).toBe(stateBeforeSecondCall.visionChargesRemaining);
    });

    it('grants +1 vision on first completion of an act2 boss node', () => {
      rm.startRun();
      const startNode = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);
      rm.nodeMap.actId = 'act2';
      rm.nodeMap.bossNodeId = startNode.id;
      startNode.type = 'boss';
      const initialVision = rm.visionChargesRemaining;

      rm.completeBattle(rm.getRoster(), startNode.id, 0);

      expect(rm.visionChargesRemaining).toBe(initialVision + 1);
    });

    it('grants +1 vision on first completion of an act3 boss node', () => {
      rm.startRun();
      const startNode = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);
      rm.nodeMap.actId = 'act3';
      rm.nodeMap.bossNodeId = startNode.id;
      startNode.type = 'boss';
      const initialVision = rm.visionChargesRemaining;

      rm.completeBattle(rm.getRoster(), startNode.id, 0);

      expect(rm.visionChargesRemaining).toBe(initialVision + 1);
    });

    it('grants +1 vision on first completion of an act4 boss node', () => {
      rm.startRun();
      const startNode = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);
      rm.nodeMap.actId = 'act4';
      rm.nodeMap.bossNodeId = startNode.id;
      startNode.type = 'boss';
      const initialVision = rm.visionChargesRemaining;

      rm.completeBattle(rm.getRoster(), startNode.id, 0);

      expect(rm.visionChargesRemaining).toBe(initialVision + 1);
    });

    it('does not grant vision for non-boss nodes, act1, or finalBoss', () => {
      const nonBossType = new RunManager(gameData);
      nonBossType.startRun();
      const nonBossTypeNode = nonBossType.nodeMap.nodes.find(
        (n) => n.id === nonBossType.nodeMap.startNodeId,
      );
      nonBossType.nodeMap.actId = 'act2';
      nonBossType.nodeMap.bossNodeId = nonBossTypeNode.id;
      nonBossTypeNode.type = 'battle';
      const nonBossTypeInitialVision = nonBossType.visionChargesRemaining;
      nonBossType.completeBattle(nonBossType.getRoster(), nonBossTypeNode.id, 0);
      expect(nonBossType.visionChargesRemaining).toBe(nonBossTypeInitialVision);

      const nonBossId = new RunManager(gameData);
      nonBossId.startRun();
      const nonBossIdNode = nonBossId.nodeMap.nodes.find(
        (n) => n.id === nonBossId.nodeMap.startNodeId,
      );
      nonBossId.nodeMap.actId = 'act2';
      nonBossId.nodeMap.bossNodeId = 'different-node-id';
      nonBossIdNode.type = 'boss';
      const nonBossIdInitialVision = nonBossId.visionChargesRemaining;
      nonBossId.completeBattle(nonBossId.getRoster(), nonBossIdNode.id, 0);
      expect(nonBossId.visionChargesRemaining).toBe(nonBossIdInitialVision);

      const nonTargetAct = new RunManager(gameData);
      nonTargetAct.startRun();
      const nonTargetActNode = nonTargetAct.nodeMap.nodes.find(
        (n) => n.id === nonTargetAct.nodeMap.startNodeId,
      );
      nonTargetAct.nodeMap.actId = 'act1';
      nonTargetAct.nodeMap.bossNodeId = nonTargetActNode.id;
      nonTargetActNode.type = 'boss';
      const nonTargetActInitialVision = nonTargetAct.visionChargesRemaining;
      nonTargetAct.completeBattle(nonTargetAct.getRoster(), nonTargetActNode.id, 0);
      expect(nonTargetAct.visionChargesRemaining).toBe(nonTargetActInitialVision);

      const finalBossAct = new RunManager(gameData);
      finalBossAct.startRun();
      const finalBossActNode = finalBossAct.nodeMap.nodes.find(
        (n) => n.id === finalBossAct.nodeMap.startNodeId,
      );
      finalBossAct.nodeMap.actId = 'finalBoss';
      finalBossAct.nodeMap.bossNodeId = finalBossActNode.id;
      finalBossActNode.type = 'boss';
      const finalBossInitialVision = finalBossAct.visionChargesRemaining;
      finalBossAct.completeBattle(finalBossAct.getRoster(), finalBossActNode.id, 0);
      expect(finalBossAct.visionChargesRemaining).toBe(finalBossInitialVision);
    });

    it('does not grant vision more than once for the same boss completion', () => {
      rm.startRun();
      const startNode = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);
      rm.nodeMap.actId = 'act2';
      rm.nodeMap.bossNodeId = startNode.id;
      startNode.type = 'boss';
      const initialVision = rm.visionChargesRemaining;

      rm.completeBattle(rm.getRoster(), startNode.id, 0);
      rm.completeBattle(rm.getRoster(), startNode.id, 0);

      expect(rm.visionChargesRemaining).toBe(initialVision + 1);
    });

    it('uses nodeMap.actId as authoritative when act index and node map drift', () => {
      const mapAuthoritative = new RunManager(gameData);
      mapAuthoritative.startRun();
      const mapAuthoritativeNode = mapAuthoritative.nodeMap.nodes.find(
        (n) => n.id === mapAuthoritative.nodeMap.startNodeId,
      );
      mapAuthoritative.actIndex = 0; // currentAct = act1
      mapAuthoritative.nodeMap.actId = 'act2';
      mapAuthoritative.nodeMap.bossNodeId = mapAuthoritativeNode.id;
      mapAuthoritativeNode.type = 'boss';
      const mapAuthoritativeInitialVision = mapAuthoritative.visionChargesRemaining;
      mapAuthoritative.completeBattle(mapAuthoritative.getRoster(), mapAuthoritativeNode.id, 0);
      expect(mapAuthoritative.visionChargesRemaining).toBe(mapAuthoritativeInitialVision + 1);

      const currentActWouldReward = new RunManager(gameData);
      currentActWouldReward.startRun();
      const currentActWouldRewardNode = currentActWouldReward.nodeMap.nodes.find(
        (n) => n.id === currentActWouldReward.nodeMap.startNodeId,
      );
      const act3Index = currentActWouldReward.actSequence.indexOf('act3');
      currentActWouldReward.actIndex = act3Index >= 0 ? act3Index : 0;
      currentActWouldReward.nodeMap.actId = 'act1';
      currentActWouldReward.nodeMap.bossNodeId = currentActWouldRewardNode.id;
      currentActWouldRewardNode.type = 'boss';
      const currentActWouldRewardInitialVision = currentActWouldReward.visionChargesRemaining;
      currentActWouldReward.completeBattle(
        currentActWouldReward.getRoster(),
        currentActWouldRewardNode.id,
        0,
      );
      expect(currentActWouldReward.visionChargesRemaining).toBe(currentActWouldRewardInitialVision);
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

    it('currentAct clamps out-of-bounds actIndex to last act', () => {
      rm.startRun();
      rm.actIndex = 999;
      expect(rm.currentAct).toBe(rm.actSequence[rm.actSequence.length - 1]);
    });

    it('currentAct clamps negative actIndex to first act', () => {
      rm.startRun();
      rm.actIndex = -1;
      expect(rm.currentAct).toBe(rm.actSequence[0]);
    });

    it('currentAct treats NaN actIndex as 0', () => {
      rm.startRun();
      rm.actIndex = NaN;
      expect(rm.currentAct).toBe(rm.actSequence[0]);
    });

    it('currentAct treats undefined actIndex as 0', () => {
      rm.startRun();
      rm.actIndex = undefined;
      expect(rm.currentAct).toBe(rm.actSequence[0]);
    });

    it('currentAct floors fractional actIndex to integer', () => {
      rm.startRun();
      rm.actIndex = 1.7;
      expect(rm.currentAct).toBe(rm.actSequence[1]);
    });

    it('forwards colosseum node generation config to generateNodeMap in advanceAct', () => {
      const spy = vi.spyOn(NodeMapGenerator, 'generateNodeMap');
      try {
        rm.startRun();
        spy.mockClear();
        rm.advanceAct();
        expect(spy).toHaveBeenCalledTimes(1);
        const options = spy.mock.calls[0]?.[3];
        expect(options?.colosseumConfig).toEqual(gameData.colosseum?.nodeGeneration ?? null);
      } finally {
        spy.mockRestore();
      }
    });

    it('isRunComplete is false until final boss defeated', () => {
      rm.startRun();
      expect(rm.isRunComplete()).toBe(false);
    });

    it('isActComplete checks boss node', () => {
      rm.startRun();
      expect(rm.isActComplete()).toBe(false);
      // Complete the boss node
      const bossNode = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.bossNodeId);
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
      const { unlockedArtIds: unlocked } = localRm.advanceAct();
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
      const localRm = new RunManager(localData, {
        metaUnlockedWeaponArts: ['legend_gemini_tempest'],
      });
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

    it('captures defeat context for narrative memory', () => {
      rm.startRun();
      rm.failRun({ defeatedBy: 'Iron Captain', wasBoss: true });
      expect(rm.defeatContext).toEqual({ defeatedBy: 'Iron Captain', wasBoss: true });
    });

    it('clears defeat context when called without one (abandon/retreat)', () => {
      rm.startRun();
      rm.failRun({ defeatedBy: 'Iron Captain', wasBoss: true });
      rm.failRun();
      expect(rm.defeatContext).toBeNull();
    });

    it('sanitizes malformed context', () => {
      rm.startRun();
      rm.failRun({ defeatedBy: 42, wasBoss: 'yes' });
      expect(rm.defeatContext).toEqual({ defeatedBy: null, wasBoss: false });
    });
  });

  describe('narrative memory (storyFlags capture/flush)', () => {
    const makeMeta = (extra = {}) => ({
      addValor: vi.fn(),
      addSupply: vi.fn(),
      incrementRunsCompleted: vi.fn(),
      recordMilestone: vi.fn(),
      hasMilestone: vi.fn(() => false),
      recordRunEnd: vi.fn(),
      ...extra,
    });

    it('completeBattle records non-commander lord falls', () => {
      rm.startRun();
      const startNode = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);
      const roster = rm.getRoster();
      const partner = roster.find((u) => u.isLord && !u.isCommander);
      expect(partner).toBeTruthy();
      const survivors = roster.filter((u) => u.name !== partner.name);
      rm.completeBattle(survivors, startNode.id);
      expect(rm.runLordFalls).toEqual([partner.name]);
    });

    it('completeBattle ignores fallen non-lords and commanders', () => {
      rm.startRun();
      const startNode = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);
      rm.roster.push({
        ...serializeUnit(rm.roster[0]),
        name: 'Test Recruit',
        isLord: false,
        isCommander: false,
      });
      const survivors = rm.getRoster().filter((u) => u.name !== 'Test Recruit');
      rm.completeBattle(survivors, startNode.id);
      expect(rm.runLordFalls).toEqual([]);
    });

    it('flushes recordRunEnd exactly once with defeat context and lord falls', () => {
      rm.startRun();
      rm.runLordFalls = ['Sera'];
      rm.failRun({ defeatedBy: 'Warchief', wasBoss: true });
      rm.actIndex = 1;
      rm.completedBattles = 3;
      const meta = makeMeta();
      rm.settleEndRunRewards(meta, 'defeat');
      rm.settleEndRunRewards(meta, 'defeat');
      expect(meta.recordRunEnd).toHaveBeenCalledTimes(1);
      expect(meta.recordRunEnd).toHaveBeenCalledWith({
        result: 'defeat',
        act: rm.currentAct,
        difficultyId: 'normal',
        defeatedBy: 'Warchief',
        wasBossDefeat: true,
        lordFalls: ['Sera'],
      });
      expect(rm.endRunRewards.firstClear).toBe(false);
    });

    it('stamps firstClear only on a first full victory', () => {
      rm.startRun();
      rm.actIndex = 3;
      const freshMeta = makeMeta();
      const summary = rm.settleEndRunRewards(freshMeta, 'victory');
      expect(summary.firstClear).toBe(true);
      expect(freshMeta.recordMilestone).toHaveBeenCalledWith('beatGame');

      const rm2 = new RunManager(gameData);
      rm2.startRun();
      rm2.actIndex = 3;
      const veteranMeta = makeMeta({ hasMilestone: vi.fn((m) => m === 'beatGame') });
      const summary2 = rm2.settleEndRunRewards(veteranMeta, 'victory');
      expect(summary2.firstClear).toBe(false);
    });

    it('does not stamp firstClear on defeat or partial runs', () => {
      rm.startRun();
      rm.actIndex = 2;
      const summary = rm.settleEndRunRewards(makeMeta(), 'victory');
      expect(summary.firstClear).toBe(false);
    });

    it('tolerates a minimal meta without recordRunEnd/hasMilestone', () => {
      rm.startRun();
      rm.failRun();
      const meta = {
        addValor: vi.fn(),
        addSupply: vi.fn(),
        incrementRunsCompleted: vi.fn(),
        recordMilestone: vi.fn(),
      };
      expect(() => rm.settleEndRunRewards(meta, 'defeat')).not.toThrow();
      expect(rm.endRunRewards.firstClear).toBe(false);
    });

    it('round-trips defeatContext and runLordFalls through toJSON/fromJSON', () => {
      rm.startRun();
      rm.runLordFalls = ['Sera', 'Kira'];
      rm.failRun({ defeatedBy: 'Iron Captain', wasBoss: true });
      const restored = RunManager.fromJSON(rm.toJSON(), gameData);
      expect(restored.defeatContext).toEqual({ defeatedBy: 'Iron Captain', wasBoss: true });
      expect(restored.runLordFalls).toEqual(['Sera', 'Kira']);
    });

    it('legacy saves without narrative fields default cleanly', () => {
      rm.startRun();
      const saved = rm.toJSON();
      delete saved.defeatContext;
      delete saved.runLordFalls;
      const restored = RunManager.fromJSON(saved, gameData);
      expect(restored.defeatContext).toBeNull();
      expect(restored.runLordFalls).toEqual([]);
    });

    it('startRun resets narrative capture state', () => {
      rm.startRun();
      rm.runLordFalls = ['Sera'];
      rm.failRun({ defeatedBy: 'Warchief', wasBoss: true });
      rm.startRun();
      expect(rm.defeatContext).toBeNull();
      expect(rm.runLordFalls).toEqual([]);
    });
  });

  describe('convoy', () => {
    it('starts with an empty convoy', () => {
      rm.startRun();
      expect(rm.getConvoyCounts()).toEqual({ weapons: 0, consumables: 0 });
    });

    it('stores weapons and consumables in separate convoy pools', () => {
      rm.startRun();
      const sword = gameData.weapons.find((w) => w.name === 'Iron Sword');
      const vuln = gameData.consumables.find((c) => c.name === 'Vulnerary');
      expect(rm.addToConvoy(sword)).toBe(true);
      expect(rm.addToConvoy(vuln)).toBe(true);
      expect(rm.getConvoyCounts()).toEqual({ weapons: 1, consumables: 1 });
      expect(rm.convoy.weapons[0].name).toBe('Iron Sword');
      expect(rm.convoy.consumables[0].name).toBe('Vulnerary');
    });

    it('takeFromConvoy removes and returns an item', () => {
      rm.startRun();
      const sword = gameData.weapons.find((w) => w.name === 'Iron Sword');
      rm.addToConvoy(sword);
      const pulled = rm.takeFromConvoy('weapon', 0);
      expect(pulled?.name).toBe('Iron Sword');
      expect(rm.getConvoyCounts().weapons).toBe(0);
    });

    it('takeFromConvoy returns null for invalid type', () => {
      rm.startRun();
      const sword = gameData.weapons.find((w) => w.name === 'Iron Sword');
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
      const sword = gameData.weapons.find((w) => w.name === 'Iron Sword');
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
      const sword = gameData.weapons.find((w) => w.name === 'Iron Sword');
      const vuln = gameData.consumables.find((c) => c.name === 'Vulnerary');
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

    it('records beatHard milestone on Hard victory', () => {
      rm.startRun();
      rm.status = 'victory';
      rm.actIndex = 3;
      rm.completedBattles = 6;
      rm.difficultyId = 'hard';
      const meta = {
        addValor: vi.fn(),
        addSupply: vi.fn(),
        incrementRunsCompleted: vi.fn(),
        recordMilestone: vi.fn(),
      };
      rm.settleEndRunRewards(meta, 'victory');
      expect(meta.recordMilestone).toHaveBeenCalledWith('beatHard');
      expect(meta.recordMilestone).not.toHaveBeenCalledWith('beatLunatic');
    });

    it('does NOT record beatHard on Normal victory', () => {
      rm.startRun();
      rm.status = 'victory';
      rm.actIndex = 3;
      rm.completedBattles = 6;
      rm.difficultyId = 'normal';
      const meta = {
        addValor: vi.fn(),
        addSupply: vi.fn(),
        incrementRunsCompleted: vi.fn(),
        recordMilestone: vi.fn(),
      };
      rm.settleEndRunRewards(meta, 'victory');
      expect(meta.recordMilestone).not.toHaveBeenCalledWith('beatHard');
      expect(meta.recordMilestone).not.toHaveBeenCalledWith('beatLunatic');
    });

    it('records beatLunatic milestone on Lunatic victory', () => {
      rm.startRun();
      rm.status = 'victory';
      rm.actIndex = 3;
      rm.completedBattles = 6;
      rm.difficultyId = 'lunatic';
      const meta = {
        addValor: vi.fn(),
        addSupply: vi.fn(),
        incrementRunsCompleted: vi.fn(),
        recordMilestone: vi.fn(),
      };
      rm.settleEndRunRewards(meta, 'victory');
      expect(meta.recordMilestone).toHaveBeenCalledWith('beatLunatic');
      expect(meta.recordMilestone).not.toHaveBeenCalledWith('beatHard');
    });

    it('H1 regression: two different meta objects across scene transitions get rewards applied exactly once', () => {
      rm.startRun();
      rm.status = 'victory';
      rm.actIndex = 3;
      rm.completedBattles = 8;

      // First call simulates BattleScene settling rewards
      const meta1 = {
        addValor: vi.fn(),
        addSupply: vi.fn(),
        incrementRunsCompleted: vi.fn(),
        recordMilestone: vi.fn(),
      };
      const first = rm.settleEndRunRewards(meta1, 'victory');
      expect(first.valor).toBeGreaterThan(0);
      expect(meta1.addValor).toHaveBeenCalledTimes(1);
      expect(meta1.incrementRunsCompleted).toHaveBeenCalledTimes(1);

      // Second call simulates RunCompleteScene with a fresh meta reference
      const meta2 = {
        addValor: vi.fn(),
        addSupply: vi.fn(),
        incrementRunsCompleted: vi.fn(),
        recordMilestone: vi.fn(),
      };
      const second = rm.settleEndRunRewards(meta2, 'victory');
      expect(second).toEqual(first); // Returns cached rewards
      // meta2 should NOT receive rewards — appliedToMeta was set to true by first call
      expect(meta2.addValor).not.toHaveBeenCalled();
      expect(meta2.addSupply).not.toHaveBeenCalled();
      expect(meta2.incrementRunsCompleted).not.toHaveBeenCalled();
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
      const startNode = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);
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
      const localRm = new RunManager(localData, {
        metaUnlockedWeaponArts: ['legend_starfall_volley'],
      });
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
      expect(restored.activeBlessings).toEqual([{ id: 'blessed_vigor', rolledCost: null }]);
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

    it('round-trips pendingAmbushNodeId through save/load', () => {
      rm.startRun({ runSeed: 999 });
      const startNode = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);
      rm.pendingAmbushNodeId = startNode.id;

      const json = rm.toJSON();
      const restored = RunManager.fromJSON(json, gameData);

      expect(restored.pendingAmbushNodeId).toBe(startNode.id);
      expect(restored.getAmbushPendingNode()?.id).toBe(startNode.id);
    });

    it('preserves vision charges above 3 through save/load', () => {
      rm.startRun({ runSeed: 321 });
      rm.visionChargesRemaining = 7;
      const json = rm.toJSON();
      const restored = RunManager.fromJSON(json, gameData);
      expect(restored.visionChargesRemaining).toBe(7);
    });

    it('uses getBaseVisionCharges fallback when saved vision charges are missing', () => {
      const rmWithMeta = new RunManager(gameData, { visionChargesBonus: 5 });
      rmWithMeta.startRun();
      const json = rmWithMeta.toJSON();
      delete json.visionChargesRemaining;
      const restored = RunManager.fromJSON(json, gameData);
      expect(restored.visionChargesRemaining).toBe(restored.getBaseVisionCharges());
      expect(restored.visionChargesRemaining).toBe(6);
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

    it('resumes legacy hard saves without act4 metadata using legacy-safe sequence', () => {
      rm.startRun({ difficultyId: 'hard' });
      const json = rm.toJSON();
      json.difficultyId = 'hard';
      json.actIndex = 3;
      json.nodeMap = {
        actId: 'finalBoss',
        nodes: [
          {
            id: 'finalBoss_0_0',
            row: 0,
            col: 0,
            type: NODE_TYPES.BOSS,
            edges: [],
            battleParams: { act: 'finalBoss', objective: 'seize', battleSeed: 1 },
            completed: false,
          },
        ],
        startNodeId: 'finalBoss_0_0',
        bossNodeId: 'finalBoss_0_0',
      };
      delete json.difficultyModifiers;
      delete json.actSequence;
      const restored = RunManager.fromJSON(json, gameData);
      expect(restored.actSequence).toEqual(['act1', 'act2', 'act3', 'finalBoss']);
      expect(restored.currentAct).toBe('finalBoss');
      expect(restored.nodeMap?.actId).toBe('finalBoss');
    });

    it('sanitizes unknown acts out of saved actSequence', () => {
      rm.startRun();
      const json = rm.toJSON();
      json.actSequence = ['act1', 'act2', 'unknown_act', 'finalBoss'];
      const restored = RunManager.fromJSON(json, gameData);
      expect(restored.actSequence).toEqual(['act1', 'act2', 'finalBoss']);
    });

    it('fromJSON normalizes weapon instance art binding fields', () => {
      rm.startRun();
      const json = rm.toJSON();
      const artId = gameData.weaponArts.arts[0].id;
      json.roster[0].inventory[0].weaponArtBinding = { artId, source: 'scroll' };
      json.roster[0].inventory[0].weaponArt = 'bad_legacy_id';
      json.roster[0].inventory[0].weaponArtSource = 'bad_source';
      const restored = RunManager.fromJSON(json, gameData);
      const weapon = restored.roster[0].inventory[0];
      expect(weapon.weaponArtIds).toEqual([artId]);
      expect(weapon.weaponArtSources).toEqual(['scroll']);
      expect(weapon.weaponArtId).toBe(artId);
      expect(weapon.weaponArtSource).toBe('scroll');
      expect(weapon.weaponArtBinding).toBeUndefined();
      expect(weapon.weaponArt).toBeUndefined();
    });

    it('fromJSON recovers legacy binding when weaponArtId is invalid', () => {
      rm.startRun();
      const json = rm.toJSON();
      const artId = gameData.weaponArts.arts[0].id;
      json.roster[0].inventory[0].weaponArtId = 'missing_art';
      json.roster[0].inventory[0].weaponArtBinding = { artId, source: 'scroll' };
      const restored = RunManager.fromJSON(json, gameData);
      const weapon = restored.roster[0].inventory[0];
      expect(weapon.weaponArtIds).toEqual([artId]);
      expect(weapon.weaponArtSources).toEqual(['scroll']);
      expect(weapon.weaponArtId).toBe(artId);
      expect(weapon.weaponArtSource).toBe('scroll');
    });

    it('fromJSON strips invalid scroll weapon-art metadata fail-closed', () => {
      rm.startRun();
      const json = rm.toJSON();
      json.scrolls = [
        {
          name: 'Test Art Scroll',
          type: 'Scroll',
          teachesWeaponArtId: 'missing_art',
          allowedWeaponTypes: [' sword ', 'SWORD', 'Blade', '', 42],
        },
      ];
      const restored = RunManager.fromJSON(json, gameData);
      expect(restored.scrolls[0].teachesWeaponArtId).toBeUndefined();
      expect(restored.scrolls[0].allowedWeaponTypes).toEqual(['Sword']);
    });
  });

  describe('saveRun / loadRun / hasSavedRun / clearSavedRun', () => {
    beforeEach(() => {
      for (const key of Object.keys(store)) delete store[key];
      vi.clearAllMocks();
      delete globalThis.__emblemRogueStartupTelemetry;
    });

    it('saveRun persists to localStorage', () => {
      rm.startRun();
      saveRun(rm, null, 1);
      expect(localStorageMock.setItem).toHaveBeenCalled();
      expect(store['emblem_rogue_slot_1_run']).toBeTruthy();
    });

    it('saveRun writes a numeric savedAt timestamp', () => {
      rm.startRun();
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1234567890);
      try {
        saveRun(rm, null, 1);
      } finally {
        nowSpy.mockRestore();
      }

      const saved = JSON.parse(store['emblem_rogue_slot_1_run']);
      expect(saved.savedAt).toBe(1234567890);
      expect(Number.isFinite(saved.savedAt)).toBe(true);
    });

    it('saveRun keeps savedAt monotonic when system clock goes backward', () => {
      rm.startRun();
      store['emblem_rogue_slot_1_run'] = JSON.stringify({ savedAt: 500 });
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(100);
      try {
        saveRun(rm, null, 1);
      } finally {
        nowSpy.mockRestore();
      }

      const saved = JSON.parse(store['emblem_rogue_slot_1_run']);
      expect(saved.savedAt).toBe(501);
    });

    it('saveRun respects remote conflict clock floor for monotonic savedAt', () => {
      rm.startRun();
      store['emblem_rogue_slot_1_run'] = JSON.stringify({ savedAt: 300 });
      store['emblem_rogue_slot_1_run_clock_floor'] = '800';
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(400);
      try {
        saveRun(rm, null, 1);
      } finally {
        nowSpy.mockRestore();
      }

      const saved = JSON.parse(store['emblem_rogue_slot_1_run']);
      expect(saved.savedAt).toBe(801);
    });

    it('hasSavedRun returns true after save', () => {
      rm.startRun();
      saveRun(rm, null, 1);
      expect(hasSavedRun(1)).toBe(true);
    });

    it('hasSavedRun returns false when no save exists', () => {
      expect(hasSavedRun(1)).toBe(false);
    });

    it('loadRun restores a saved run', () => {
      rm.startRun();
      rm.gold = 999;
      saveRun(rm, null, 1);
      const restored = loadRun(gameData, 1);
      expect(restored).not.toBeNull();
      expect(restored.gold).toBe(999);
      expect(restored.roster[0].name).toBe('Edric');
    });

    it('loadRun returns null when no save exists', () => {
      expect(loadRun(gameData, 1)).toBeNull();
    });

    it('loadRun supports legacy saves without savedAt', () => {
      rm.startRun();
      const legacy = rm.toJSON();
      delete legacy.savedAt;
      store['emblem_rogue_slot_1_run'] = JSON.stringify(legacy);

      const restored = loadRun(gameData, 1);
      expect(restored).not.toBeNull();
      expect(restored.roster[0].name).toBe('Edric');
    });

    it('loadRun falls back to a non-null runSeed for legacy saves predating runSeed', () => {
      rm.startRun();
      const legacy = rm.toJSON();
      delete legacy.runSeed;
      delete legacy.rngSeed;
      store['emblem_rogue_slot_1_run'] = JSON.stringify(legacy);

      const restored = loadRun(gameData, 1);
      expect(restored).not.toBeNull();
      expect(restored.runSeed).not.toBeNull();
      expect(typeof restored.runSeed).toBe('number');
      expect(Number.isFinite(restored.runSeed)).toBe(true);
    });

    it('clearSavedRun removes the save', () => {
      rm.startRun();
      saveRun(rm, null, 1);
      expect(hasSavedRun(1)).toBe(true);
      clearSavedRun(null, 1);
      expect(hasSavedRun(1)).toBe(false);
    });

    it('clearSavedRun removes run clock floor metadata for the slot', () => {
      rm.startRun();
      store['emblem_rogue_slot_1_run_clock_floor'] = '999';

      clearSavedRun(null, 1);

      expect(store['emblem_rogue_slot_1_run_clock_floor']).toBeUndefined();
    });

    it('saveRun returns { ok: false } when slotNumber is missing', () => {
      rm.startRun();
      const result = saveRun(rm);
      expect(result).toEqual({ ok: false, reason: 'missing_slot' });
    });

    it('loadRun returns null when slotNumber is missing', () => {
      expect(loadRun(gameData)).toBeNull();
    });

    it('hasSavedRun returns false when slotNumber is missing', () => {
      expect(hasSavedRun()).toBe(false);
    });

    it('clearSavedRun resolves missing slotNumber from persisted active slot', () => {
      rm.startRun();
      saveRun(rm, null, 2);
      store['emblem_rogue_active_slot'] = '2';
      const cb = vi.fn();

      clearSavedRun(cb);

      expect(hasSavedRun(2)).toBe(false);
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith(2);
      const telemetry = getStartupTelemetry();
      expect(
        telemetry?.markers.some((marker) => marker.name === 'run_clear_slot_fallback_used'),
      ).toBe(true);
    });

    it('clearSavedRun is a no-op when slotNumber and persisted active slot are missing', () => {
      const cb = vi.fn();
      clearSavedRun(cb);
      expect(cb).not.toHaveBeenCalled();
      const telemetry = getStartupTelemetry();
      expect(
        telemetry?.markers.some(
          (marker) => marker.name === 'run_clear_missing_slot_resolution_failed',
        ),
      ).toBe(true);
    });
  });

  describe('starting equipment meta effects', () => {
    it('ironArms assigns arts to Iron weapons only at run start', () => {
      const localData = loadGameData();
      localData.weaponArts.arts = [
        {
          id: 'iron_sword_art_a',
          name: 'Iron Sword Art A',
          weaponType: 'Sword',
          unlockAct: 'act1',
          requiredRank: 'Prof',
          hpCost: 1,
          perTurnLimit: 1,
          perMapLimit: 3,
          combatMods: { hitBonus: 5 },
        },
        {
          id: 'steel_sword_art_a',
          name: 'Steel Sword Art A',
          weaponType: 'Sword',
          unlockAct: 'act2',
          requiredRank: 'Prof',
          hpCost: 1,
          perTurnLimit: 1,
          perMapLimit: 3,
          combatMods: { hitBonus: 5 },
        },
      ];
      const rmMeta = new RunManager(localData, { ironArms: 1 });
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      try {
        rmMeta.startRun();
      } finally {
        randomSpy.mockRestore();
      }

      const edric = rmMeta.roster[0];
      const ironSword = edric.inventory.find((w) => w.type === 'Sword' && w.tier === 'Iron');
      const steelSword = edric.inventory.find((w) => w.type === 'Sword' && w.tier === 'Steel');
      expect(ironSword?.weaponArtIds).toEqual(['iron_sword_art_a']);
      expect(steelSword?.weaponArtIds || []).toEqual([]);
    });

    it('artAdept adds one extra non-duplicate art to one eligible starting weapon', () => {
      const localData = loadGameData();
      localData.weaponArts.arts = [
        {
          id: 'iron_sword_art_a',
          name: 'Iron Sword Art A',
          weaponType: 'Sword',
          unlockAct: 'act1',
          requiredRank: 'Prof',
          hpCost: 1,
          perTurnLimit: 1,
          perMapLimit: 3,
          combatMods: { hitBonus: 5 },
        },
        {
          id: 'iron_sword_art_b',
          name: 'Iron Sword Art B',
          weaponType: 'Sword',
          unlockAct: 'act1',
          requiredRank: 'Prof',
          hpCost: 1,
          perTurnLimit: 1,
          perMapLimit: 3,
          combatMods: { hitBonus: 5 },
        },
        {
          id: 'steel_sword_art_a',
          name: 'Steel Sword Art A',
          weaponType: 'Sword',
          unlockAct: 'act2',
          requiredRank: 'Prof',
          hpCost: 1,
          perTurnLimit: 1,
          perMapLimit: 3,
          combatMods: { hitBonus: 5 },
        },
        {
          id: 'steel_sword_art_b',
          name: 'Steel Sword Art B',
          weaponType: 'Sword',
          unlockAct: 'act2',
          requiredRank: 'Prof',
          hpCost: 1,
          perTurnLimit: 1,
          perMapLimit: 3,
          combatMods: { hitBonus: 5 },
        },
      ];
      const rmMeta = new RunManager(localData, { ironArms: 1, steelArms: 1, artAdept: 1 });
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      try {
        rmMeta.startRun();
      } finally {
        randomSpy.mockRestore();
      }

      const edric = rmMeta.roster[0];
      const ironSword = edric.inventory.find((w) => w.type === 'Sword' && w.tier === 'Iron');
      const steelSword = edric.inventory.find((w) => w.type === 'Sword' && w.tier === 'Steel');
      const ironIds = ironSword?.weaponArtIds || [];
      const steelIds = steelSword?.weaponArtIds || [];
      expect(ironIds).toHaveLength(2);
      expect(new Set(ironIds).size).toBe(2);
      expect(steelIds).toHaveLength(1);
      expect([...ironIds, ...steelIds]).toHaveLength(3);
    });

    it('weapon_forge applies forge levels to Edric combat weapons', () => {
      const metaEffects = { startingWeaponForge: 2 };
      const rmMeta = new RunManager(gameData, metaEffects);
      rmMeta.startRun();
      const edric = rmMeta.roster[0];
      // Edric has default Iron Sword + Steel Sword — both get 2 forges (random stats)
      const steelSword = edric.inventory.find((w) => w._baseName === 'Steel Sword');
      expect(steelSword._forgeLevel).toBe(2);
    });

    it('deadlyArsenalTier 1 replaces Edric Steel Sword with Rapier', () => {
      const metaEffects = { deadlyArsenalTier: 1 };
      const rmMeta = new RunManager(gameData, metaEffects);
      rmMeta.startRun();
      const edric = rmMeta.roster[0];
      expect(edric.inventory.some((w) => w.name === 'Rapier')).toBe(true);
      expect(edric.inventory.some((w) => w.name === 'Steel Sword')).toBe(false);
    });

    it('deadlyArsenalTier 2 gives Edric Rapier + Silver Sword and auto-equips Silver Sword', () => {
      const metaEffects = { deadlyArsenalTier: 2 };
      const rmMeta = new RunManager(gameData, metaEffects);
      rmMeta.startRun();
      const edric = rmMeta.roster[0];
      expect(edric.inventory.some((w) => w.name === 'Rapier')).toBe(true);
      expect(edric.inventory.some((w) => w.name === 'Silver Sword')).toBe(true);
      expect(edric.inventory.some((w) => w.name === 'Steel Sword')).toBe(false);
      expect(edric.weapon?.name).toBe('Silver Sword');
    });

    it('deadlyArsenalTier 2 + weapon_forge stacks forges on Silver Sword', () => {
      const metaEffects = { deadlyArsenalTier: 2, startingWeaponForge: 3 };
      const rmMeta = new RunManager(gameData, metaEffects);
      rmMeta.startRun();
      const edric = rmMeta.roster[0];
      const silverSword = edric.inventory.find((w) => w._baseName === 'Silver Sword');
      expect(silverSword).toBeTruthy();
      expect(silverSword._forgeLevel).toBe(3);
    });

    it('weapon_forge at level 3 applies 3 unique stats (T3)', () => {
      const metaEffects = { startingWeaponForge: 3 };
      const rmMeta = new RunManager(gameData, metaEffects);
      rmMeta.startRun();
      const edric = rmMeta.roster[0];
      const sword = edric.inventory.find((w) => w.type === 'Sword' && w._forgeLevel === 3);
      expect(sword).toBeTruthy();
      // _forgeHistory entries are { stat, cost } objects
      const history = sword._forgeHistory;
      expect(history).toHaveLength(3);
      const stats = history.map((h) => h.stat);
      // All 3 stats should be unique
      expect(new Set(stats).size).toBe(3);
    });

    it('weapon_forge at level 1 still works (single stat)', () => {
      const metaEffects = { startingWeaponForge: 1 };
      const rmMeta = new RunManager(gameData, metaEffects);
      rmMeta.startRun();
      const edric = rmMeta.roster[0];
      const sword = edric.inventory.find((w) => w.type === 'Sword' && w._forgeLevel === 1);
      expect(sword).toBeTruthy();
      expect(sword._forgeHistory).toHaveLength(1);
    });

    it('deadlyArsenalTier does not grant Sera a random Light combat weapon', () => {
      const metaEffects = { deadlyArsenalTier: 2 };
      const rmMeta = new RunManager(gameData, metaEffects);
      rmMeta.startRun();
      const sera = rmMeta.roster[1];
      const lightWeapons = sera.inventory.filter((w) => w.type === 'Light');
      expect(lightWeapons).toHaveLength(1);
      expect(lightWeapons[0].name).toBe('Lightning');
    });

    it('starting_accessory equips Goddess Icon on Edric at tier 1', () => {
      const metaEffects = { startingAccessoryTier: 1 };
      const rmMeta = new RunManager(gameData, metaEffects);
      rmMeta.startRun();
      const edric = rmMeta.roster[0];
      expect(edric.accessory).toBeTruthy();
      expect(edric.accessory.name).toBe('Goddess Icon');
    });

    it("starting_accessory tier 3 equips Veteran's Crest", () => {
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
      expect(sera.inventory.some((w) => w.name === 'Mend')).toBe(true);
      expect(sera.inventory.some((w) => w.name === 'Heal')).toBe(false);
    });

    it('staff_upgrade gives Sera Recover at tier 2', () => {
      const metaEffects = { startingStaffTier: 2 };
      const rmMeta = new RunManager(gameData, metaEffects);
      rmMeta.startRun();
      const sera = rmMeta.roster[1];
      expect(sera.inventory.some((w) => w.name === 'Recover')).toBe(true);
    });

    it('startingReclassSeal adds one Infantry Seal to convoy at run start', () => {
      const rmMeta = new RunManager(gameData, { startingReclassSeal: 1 });
      rmMeta.startRun();
      const seals = rmMeta.convoy.consumables.filter((item) => item.name === 'Infantry Seal');
      expect(seals).toHaveLength(1);
      expect(seals[0].effect).toBe('reclass');
      expect(seals[0].subEffect).toBe('infantry');
    });

    it('forge does not apply to staves', () => {
      const metaEffects = { startingWeaponForge: 2 };
      const rmMeta = new RunManager(gameData, metaEffects);
      rmMeta.startRun();
      const sera = rmMeta.roster[1];
      const staff = sera.inventory.find((w) => w.type === 'Staff');
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
      const charismaCount = edric.skills.filter((s) => s === 'charisma').length;
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
    const startNode = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);

    // Add a third unit to the roster
    const recruit = {
      name: 'TestRecruit',
      stats: { HP: 25 },
      currentHP: 25,
      level: 1,
      className: 'Myrmidon',
    };
    rm.roster.push(recruit);

    // Simulate battle: 2 units survive, 1 falls
    const survivors = [rm.roster[0], rm.roster[1]];
    rm.completeBattle(survivors, startNode.id, 100);

    expect(rm.fallenUnits.length).toBe(1);
    expect(rm.fallenUnits[0].name).toBe('TestRecruit');
  });

  it('completeBattle transfers fallen weapons/consumables to convoy and accessory to team pool', () => {
    const rm = new RunManager(gameData, null);
    rm.startRun();
    const startNode = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);

    const profType = rm.roster[0].proficiencies?.[0]?.type || 'Sword';
    const weaponA =
      gameData.weapons.find((w) => w.type === profType) ||
      gameData.weapons.find((w) => w.type === 'Sword');
    const weaponB =
      gameData.weapons.find((w) => w.type === profType && w.name !== weaponA?.name) ||
      gameData.weapons.find((w) => w.type === 'Sword' && w.name !== weaponA?.name) ||
      weaponA;
    const vuln =
      gameData.consumables.find((c) => c.name === 'Vulnerary') || gameData.consumables[0];
    const accessory = gameData.accessories[0];

    const fallen = structuredClone(rm.roster[0]);
    fallen.name = 'FallenRecruit';
    fallen.inventory = [structuredClone(weaponA), structuredClone(weaponB)];
    fallen.weapon = fallen.inventory[0];
    fallen.consumables = [structuredClone(vuln)];
    fallen.accessory = structuredClone(accessory);
    rm.roster.push(fallen);

    const survivors = [rm.roster[0], rm.roster[1]];
    rm.completeBattle(survivors, startNode.id, 100);

    expect(rm.getConvoyCounts()).toEqual({ weapons: 2, consumables: 1 });
    expect(rm.accessories.some((a) => a.name === accessory.name)).toBe(true);

    const stored = rm.fallenUnits.find((u) => u.name === 'FallenRecruit');
    expect(stored).toBeTruthy();
    expect(stored.inventory).toEqual([]);
    expect(stored.consumables).toEqual([]);
    expect(stored.weapon).toBeNull();
    expect(stored.accessory).toBeNull();
  });

  it('keeps fallen weapon/consumable on fallen unit when convoy buckets are full', () => {
    const rm = new RunManager(gameData, null);
    rm.startRun();
    const startNode = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);

    const sword = gameData.weapons.find((w) => w.type === 'Sword') || gameData.weapons[0];
    const vuln =
      gameData.consumables.find((c) => c.name === 'Vulnerary') || gameData.consumables[0];
    const caps = rm.getConvoyCapacities();
    for (let i = 0; i < caps.weapons; i++) rm.addToConvoy(sword);
    for (let i = 0; i < caps.consumables; i++) rm.addToConvoy(vuln);

    const accessory = gameData.accessories[0];
    const fallen = structuredClone(rm.roster[0]);
    fallen.name = 'ConvoyFullFallen';
    fallen.inventory = [structuredClone(sword)];
    fallen.weapon = fallen.inventory[0];
    fallen.consumables = [structuredClone(vuln)];
    fallen.accessory = structuredClone(accessory);
    rm.roster.push(fallen);

    const survivors = [rm.roster[0], rm.roster[1]];
    rm.completeBattle(survivors, startNode.id, 100);

    expect(rm.getConvoyCounts()).toEqual(caps);
    expect(rm.accessories.some((a) => a.name === accessory.name)).toBe(true);

    const stored = rm.fallenUnits.find((u) => u.name === 'ConvoyFullFallen');
    expect(stored).toBeTruthy();
    expect(stored.inventory).toHaveLength(1);
    expect(stored.inventory[0].name).toBe(sword.name);
    expect(stored.consumables).toHaveLength(1);
    expect(stored.consumables[0].name).toBe(vuln.name);
    expect(stored.accessory).toBeNull();
  });

  it('transfers available buckets and keeps only blocked bucket items on fallen unit', () => {
    const rm = new RunManager(gameData, null);
    rm.startRun();
    const startNode = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);

    const sword = gameData.weapons.find((w) => w.type === 'Sword') || gameData.weapons[0];
    const vuln =
      gameData.consumables.find((c) => c.name === 'Vulnerary') || gameData.consumables[0];
    const caps = rm.getConvoyCapacities();
    for (let i = 0; i < caps.weapons; i++) rm.addToConvoy(sword);

    const accessory = gameData.accessories[0];
    const fallen = structuredClone(rm.roster[0]);
    fallen.name = 'PartialTransferFallen';
    fallen.inventory = [structuredClone(sword)];
    fallen.weapon = fallen.inventory[0];
    fallen.consumables = [structuredClone(vuln)];
    fallen.accessory = structuredClone(accessory);
    rm.roster.push(fallen);

    const survivors = [rm.roster[0], rm.roster[1]];
    rm.completeBattle(survivors, startNode.id, 100);

    expect(rm.getConvoyCounts()).toEqual({ weapons: caps.weapons, consumables: 1 });
    expect(rm.accessories.some((a) => a.name === accessory.name)).toBe(true);

    const stored = rm.fallenUnits.find((u) => u.name === 'PartialTransferFallen');
    expect(stored).toBeTruthy();
    expect(stored.inventory).toHaveLength(1);
    expect(stored.inventory[0].name).toBe(sword.name);
    expect(stored.consumables).toEqual([]);
    expect(stored.accessory).toBeNull();
  });

  it('does not double-transfer equipped weapon when it matches inventory by value only', () => {
    const rm = new RunManager(gameData, null);
    rm.startRun();
    const startNode = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);

    const profType = rm.roster[0].proficiencies?.[0]?.type || 'Sword';
    const weapon =
      gameData.weapons.find((w) => w.type === profType) ||
      gameData.weapons.find((w) => w.type === 'Sword') ||
      gameData.weapons[0];

    const fallen = structuredClone(rm.roster[0]);
    fallen.name = 'ValueMatchFallen';
    fallen.inventory = [structuredClone(weapon)];
    fallen.weapon = structuredClone(weapon); // distinct object, same content
    fallen.consumables = [];
    fallen.accessory = null;
    rm.roster.push(fallen);

    const survivors = [rm.roster[0], rm.roster[1]];
    rm.completeBattle(survivors, startNode.id, 100);

    expect(rm.getConvoyCounts()).toEqual({ weapons: 1, consumables: 0 });
    const stored = rm.fallenUnits.find((u) => u.name === 'ValueMatchFallen');
    expect(stored).toBeTruthy();
    expect(stored.inventory).toEqual([]);
    expect(stored.weapon).toBeNull();
  });

  it('keeps equipped weapon on fallen unit when convoy is full and weapon is missing from inventory', () => {
    const rm = new RunManager(gameData, null);
    rm.startRun();
    const startNode = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);

    const profType = rm.roster[0].proficiencies?.[0]?.type || 'Sword';
    const weapon =
      gameData.weapons.find((w) => w.type === profType) ||
      gameData.weapons.find((w) => w.type === 'Sword') ||
      gameData.weapons[0];
    const caps = rm.getConvoyCapacities();
    for (let i = 0; i < caps.weapons; i++) rm.addToConvoy(weapon);

    const fallen = structuredClone(rm.roster[0]);
    fallen.name = 'LegacyMissingEquippedFallen';
    fallen.inventory = [];
    fallen.weapon = structuredClone(weapon);
    fallen.consumables = [];
    fallen.accessory = null;
    rm.roster.push(fallen);

    const survivors = [rm.roster[0], rm.roster[1]];
    rm.completeBattle(survivors, startNode.id, 100);

    expect(rm.getConvoyCounts()).toEqual({ weapons: caps.weapons, consumables: 0 });
    const stored = rm.fallenUnits.find((u) => u.name === 'LegacyMissingEquippedFallen');
    expect(stored).toBeTruthy();
    expect(stored.inventory).toHaveLength(1);
    expect(stored.inventory[0].name).toBe(weapon.name);
    expect(stored.weapon).toBe(stored.inventory[0]);
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
    expect(rm.roster.find((u) => u.name === fallenName).currentHP).toBe(1);
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
    rm.roster = Array(12)
      .fill(null)
      .map((_, i) => ({ name: `Unit${i}`, stats: { HP: 30 }, currentHP: 30 }));
    success = rm.reviveFallenUnit(fallenName, 1000);
    expect(success).toBe(false);
  });

  it('getRosterCap includes meta roster cap bonus', () => {
    const baseRm = new RunManager(gameData, null);
    const boostedRm = new RunManager(gameData, { rosterCapBonus: 3 });

    expect(baseRm.getRosterCap()).toBe(ROSTER_CAP);
    expect(boostedRm.getRosterCap()).toBe(ROSTER_CAP + 3);
  });

  it('reviveFallenUnit consults getRosterCap for capacity checks', () => {
    const rm = new RunManager(gameData, null);
    rm.startRun();

    const fallen = rm.roster[0];
    const fallenName = fallen.name;
    rm.roster = rm.roster.slice(1);
    rm.fallenUnits.push(fallen);
    rm.gold = 2000;

    const capSpy = vi.spyOn(rm, 'getRosterCap').mockReturnValue(1);
    const success = rm.reviveFallenUnit(fallenName, 1000);

    expect(success).toBe(false);
    expect(capSpy).toHaveBeenCalled();
    expect(rm.gold).toBe(2000);
    capSpy.mockRestore();
  });

  it('reviveFallenUnit does not spend gold if unit name not found', () => {
    const rm = new RunManager(gameData, null);
    rm.startRun();
    rm.gold = 2000;
    rm.fallenUnits = [{ name: 'Bob', stats: { HP: 20 }, currentHP: 0 }];
    const success = rm.reviveFallenUnit('NonExistent', 1000);
    expect(success).toBe(false);
    expect(rm.gold).toBe(2000); // Gold untouched
  });

  it('reviveFallenUnit normalizes stale class state after revival', () => {
    const rm = new RunManager(gameData, null);
    rm.startRun();
    rm.gold = 5000;

    // Create a fallen unit with deliberately stale class state
    const myrmidonClass = gameData.classes.find((c) => c.name === 'Myrmidon');
    const fallen = {
      name: 'StaleUnit',
      className: 'Myrmidon',
      tier: undefined, // stale: should be 'base'
      proficiencies: [], // stale: should have Sword
      moveType: 'Cavalry', // stale: Myrmidon is Infantry
      stats: { HP: 20, STR: 8, MAG: 1, SKL: 10, SPD: 12, DEF: 4, RES: 3, LCK: 6, MOV: 5 },
      currentHP: 0,
      level: 3,
      weapon: null,
      inventory: [],
      skills: [],
    };
    rm.fallenUnits = [fallen];

    const success = rm.reviveFallenUnit('StaleUnit', 1000);
    expect(success).toBe(true);

    const revived = rm.roster.find((u) => u.name === 'StaleUnit');
    expect(revived).toBeDefined();
    expect(revived.currentHP).toBe(1);
    expect(revived.tier).toBe(myrmidonClass.tier);
    expect(revived.moveType).toBe(myrmidonClass.moveType);
    expect(revived.proficiencies.length).toBeGreaterThan(0);
    expect(revived.proficiencies.some((p) => p.type === 'Sword')).toBe(true);
  });

  it('getReviveCost scales with level for base class units', () => {
    expect(getReviveCost({ level: 1, tier: 'base' })).toBe(800);
    expect(getReviveCost({ level: 5, tier: 'base' })).toBe(2000);
    expect(getReviveCost({ level: 10, tier: 'base' })).toBe(3500);
  });

  it('getReviveCost applies promotion multiplier', () => {
    expect(getReviveCost({ level: 1, tier: 'promoted' })).toBe(2000);
    expect(getReviveCost({ level: 5, tier: 'promoted' })).toBe(5000);
    expect(getReviveCost({ level: 10, tier: 'promoted' })).toBe(8750);
  });

  it('getReviveCost defaults to L1 base for missing/null unit', () => {
    expect(getReviveCost(null)).toBe(800);
    expect(getReviveCost(undefined)).toBe(800);
    expect(getReviveCost({})).toBe(800);
  });

  it('getReviveCost handles non-numeric level values safely', () => {
    expect(getReviveCost({ level: 'abc' })).toBe(800); // falls back to L1
    expect(getReviveCost({ level: NaN })).toBe(800);
    expect(getReviveCost({ level: -3 })).toBe(800); // below 1 → L1
    expect(getReviveCost({ level: 0 })).toBe(800);
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

    expect(cloned.every((u) => u && u.stats && u.name)).toBe(true);
    expect(rm.roster.every((u) => u && u.stats && u.name)).toBe(true);
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

  it('relinks by uid when payload differs from inventory entry', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const json = rm.toJSON();
    const unit = json.roster[0];
    unit.inventory[0].uid = 'itm_test_1';
    unit.weapon = { ...unit.inventory[0], might: 999, uid: 'itm_test_1' };

    const restored = RunManager.fromJSON(json, gameData);
    expect(restored.roster[0].weapon).toBe(restored.roster[0].inventory[0]);
    expect(restored.roster[0].weapon.uid).toBe('itm_test_1');
  });

  it('fromJSON remains compatible with saves that have no item uid fields', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const json = rm.toJSON();
    for (const unit of json.roster) {
      if (Array.isArray(unit.inventory)) {
        for (const item of unit.inventory) delete item.uid;
      }
      if (Array.isArray(unit.consumables)) {
        for (const item of unit.consumables) delete item.uid;
      }
      if (unit.weapon) delete unit.weapon.uid;
    }
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

    expect(restored.roster.every((u) => u && u.stats && u.name)).toBe(true);
    expect(restored.fallenUnits.every((u) => u && u.stats && u.name)).toBe(true);
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
    const vuln = {
      name: 'Vulnerary',
      type: 'Consumable',
      effect: 'heal',
      value: 10,
      uses: 3,
      price: 300,
    };
    unit.inventory.unshift(vuln);
    // Clear weapon name to force relink fallback to inventory[0]
    unit.weapon = { name: 'NonExistentWeapon' };
    // Remove consumables array to trigger migration
    delete unit.consumables;

    const restored = RunManager.fromJSON(json, gameData);
    const restoredUnit = restored.roster[0];
    // After migration, Consumable should be in consumables, not inventory
    expect(restoredUnit.inventory.every((w) => w.type !== 'Consumable')).toBe(true);
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
      name: 'Sylvie',
      className: 'Dancer',
      tier: 'base',
      level: 5,
      xp: 0,
      isLord: false,
      personalGrowths: null,
      growths: { HP: 50, STR: 30, MAG: 40, SKL: 45, SPD: 60, DEF: 20, RES: 35, LCK: 50 },
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      skills: [], // BUG: missing 'dance'
      stats: { HP: 20, STR: 5, MAG: 6, SKL: 8, SPD: 10, DEF: 3, RES: 5, LCK: 7, MOV: 6 },
      currentHP: 20,
      mov: 6,
      moveType: 'foot',
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
    rm.roster.push(dancerUnit);
    const json = rm.toJSON();

    const restored = RunManager.fromJSON(json, gameData);
    const restoredDancer = restored.roster.find((u) => u.name === 'Sylvie');
    expect(restoredDancer.skills).toContain('dance');
  });

  it('fromJSON class innate migration is idempotent (does not duplicate skills)', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    // Dancer that ALREADY has 'dance' — migration should not duplicate it
    const dancerUnit = {
      name: 'Sylvie',
      className: 'Dancer',
      tier: 'base',
      level: 5,
      xp: 0,
      isLord: false,
      personalGrowths: null,
      growths: { HP: 50, STR: 30, MAG: 40, SKL: 45, SPD: 60, DEF: 20, RES: 35, LCK: 50 },
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      skills: ['dance'], // already correct
      stats: { HP: 20, STR: 5, MAG: 6, SKL: 8, SPD: 10, DEF: 3, RES: 5, LCK: 7, MOV: 6 },
      currentHP: 20,
      mov: 6,
      moveType: 'foot',
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
    rm.roster.push(dancerUnit);
    const json = rm.toJSON();

    const restored = RunManager.fromJSON(json, gameData);
    const restoredDancer = restored.roster.find((u) => u.name === 'Sylvie');
    expect(restoredDancer.skills.filter((s) => s === 'dance')).toHaveLength(1);
  });

  it('fromJSON migrates innate skills for promoted units including base class skills', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    // Swordmaster (promoted from Myrmidon) without its 'crit_plus_15' innate skill
    const swordmaster = {
      name: 'TestUnit',
      className: 'Swordmaster',
      tier: 'promoted',
      level: 1,
      xp: 0,
      isLord: false,
      personalGrowths: null,
      growths: { HP: 50, STR: 45, MAG: 10, SKL: 55, SPD: 60, DEF: 25, RES: 20, LCK: 40 },
      proficiencies: [{ type: 'Sword', rank: 'Mast' }],
      skills: [], // missing 'crit_plus_15'
      stats: { HP: 28, STR: 12, MAG: 3, SKL: 16, SPD: 18, DEF: 8, RES: 5, LCK: 9, MOV: 6 },
      currentHP: 28,
      mov: 6,
      moveType: 'foot',
      faction: 'player',
      weapon: null,
      inventory: [],
      consumables: [],
      accessory: null,
      weaponRank: 'Mast',
      hasMoved: false,
      hasActed: false,
      graphic: null,
      label: null,
      hpBar: null,
    };
    rm.roster.push(swordmaster);
    const json = rm.toJSON();

    const restored = RunManager.fromJSON(json, gameData);
    const restoredUnit = restored.roster.find((u) => u.name === 'TestUnit');
    expect(restoredUnit.skills).toContain('crit_plus_15');
  });

  it('fromJSON migrates innate skills for fallen units too', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const dancerUnit = {
      name: 'FallenDancer',
      className: 'Dancer',
      tier: 'base',
      level: 3,
      xp: 0,
      isLord: false,
      personalGrowths: null,
      growths: { HP: 50, STR: 30, MAG: 40, SKL: 45, SPD: 60, DEF: 20, RES: 35, LCK: 50 },
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      skills: [],
      stats: { HP: 18, STR: 4, MAG: 5, SKL: 7, SPD: 9, DEF: 2, RES: 4, LCK: 6, MOV: 6 },
      currentHP: 0,
      mov: 6,
      moveType: 'foot',
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
    rm.fallenUnits.push(dancerUnit);
    const json = rm.toJSON();

    const restored = RunManager.fromJSON(json, gameData);
    const fallen = restored.fallenUnits.find((u) => u.name === 'FallenDancer');
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
      col: 0,
      row: 0,
      mov: 4,
      moveType: 'Infantry',
      stats: { HP: 20, STR: 1, MAG: 12, SKL: 8, SPD: 9, DEF: 3, RES: 10, LCK: 5, MOV: 4 },
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
      proficiencies: [
        { type: 'Lance', rank: 'Mast' },
        { type: 'Sword', rank: 'Prof' },
      ],
      skills: [],
      col: 0,
      row: 0,
      mov: 7,
      moveType: 'Cavalry',
      stats: { HP: 30, STR: 14, MAG: 4, SKL: 11, SPD: 11, DEF: 12, RES: 6, LCK: 8, MOV: 7 },
      currentHP: 30,
      faction: 'player',
      weapon: null,
      inventory: [],
      consumables: [],
      accessory: null,
      weaponRank: 'Mast',
      hasMoved: false,
      hasActed: false,
      graphic: null,
      label: null,
      hpBar: null,
    });
    json.roster.push({
      name: 'PromoWyvernLord',
      className: 'Wyvern Lord',
      tier: 'promoted',
      level: 10,
      xp: 0,
      isLord: false,
      personalGrowths: null,
      growths: { HP: 65, STR: 50, MAG: 0, SKL: 35, SPD: 35, DEF: 45, RES: 15, LCK: 25 },
      proficiencies: [
        { type: 'Lance', rank: 'Mast' },
        { type: 'Axe', rank: 'Prof' },
      ],
      skills: [],
      col: 0,
      row: 0,
      mov: 5,
      moveType: 'Flying',
      stats: { HP: 34, STR: 16, MAG: 2, SKL: 12, SPD: 11, DEF: 15, RES: 7, LCK: 8, MOV: 5 },
      currentHP: 34,
      faction: 'player',
      weapon: null,
      inventory: [],
      consumables: [],
      accessory: null,
      weaponRank: 'Mast',
      hasMoved: false,
      hasActed: false,
      graphic: null,
      label: null,
      hpBar: null,
    });

    const restored = RunManager.fromJSON(json, gameData);
    const baseMage = restored.roster.find((u) => u.name === 'BaseMage');
    const promoPaladin = restored.roster.find((u) => u.name === 'PromoPaladin');
    const promoWyvernLord = restored.roster.find((u) => u.name === 'PromoWyvernLord');

    expect(baseMage.skills).toContain('luna');
    expect(promoPaladin.skills).toContain('sol');
    expect(promoWyvernLord.skills).toContain('draconic_aura');
  });

  it('relinkWeapon fallback skips non-proficient inventory[0]', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const unit = rm.roster[0]; // Edric (Sword proficiency)
    // Add a non-proficient lance at inventory[0]
    const lance = {
      name: 'Iron Lance',
      type: 'Lance',
      tier: 'Iron',
      rankRequired: 'Prof',
      might: 7,
      hit: 80,
      crit: 0,
      weight: 8,
      range: '1',
      price: 500,
    };
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
    const lance = {
      name: 'Iron Lance',
      type: 'Lance',
      tier: 'Iron',
      rankRequired: 'Prof',
      might: 7,
      hit: 80,
      crit: 0,
      weight: 8,
      range: '1',
      price: 500,
    };
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

  it('fromJSON normalizes stale Wyvern class state and relinks legal weapon', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const json = rm.toJSON();
    const ironSword = gameData.weapons.find((w) => w.name === 'Iron Sword');
    const ironLance = gameData.weapons.find((w) => w.name === 'Iron Lance');
    expect(ironSword).toBeTruthy();
    expect(ironLance).toBeTruthy();

    json.roster.push({
      name: 'LegacyWyvern',
      className: 'Wyvern Rider',
      tier: 'base',
      level: 8,
      xp: 0,
      isLord: false,
      personalGrowths: null,
      growths: { HP: 70, STR: 50, MAG: 0, SKL: 35, SPD: 35, DEF: 40, RES: 15, LCK: 25 },
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      skills: [],
      col: 0,
      row: 0,
      mov: 2,
      moveType: 'Infantry',
      stats: { HP: 25, STR: 9, MAG: 0, SKL: 7, SPD: 7, DEF: 9, RES: 3, LCK: 5, MOV: 5 },
      currentHP: 25,
      faction: 'player',
      weapon: structuredClone(ironSword),
      inventory: [structuredClone(ironSword), structuredClone(ironLance)],
      consumables: [],
      accessory: null,
      weaponRank: 'Prof',
      hasMoved: false,
      hasActed: false,
      graphic: null,
      label: null,
      hpBar: null,
    });

    const restored = RunManager.fromJSON(json, gameData);
    const wyvern = restored.roster.find((u) => u.name === 'LegacyWyvern');

    expect(wyvern).toBeTruthy();
    expect(wyvern.moveType).toBe('Flying');
    expect(wyvern.mov).toBe(5);
    expect(wyvern.stats.MOV).toBe(5);
    expect(wyvern.proficiencies).toEqual([{ type: 'Lance', rank: 'Prof' }]);
    expect(wyvern.weapon?.type).toBe('Lance');
    expect(wyvern.inventory).toContain(wyvern.weapon);
  });

  it('fromJSON normalizes stale promoted tier before class-learnable migration', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const json = rm.toJSON();
    json.roster.push({
      name: 'LegacyPaladinTier',
      className: 'Paladin',
      tier: 'base',
      level: 10,
      xp: 0,
      isLord: false,
      personalGrowths: null,
      growths: { HP: 60, STR: 45, MAG: 10, SKL: 40, SPD: 40, DEF: 35, RES: 20, LCK: 30 },
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      skills: [],
      col: 0,
      row: 0,
      mov: 4,
      moveType: 'Infantry',
      stats: { HP: 30, STR: 14, MAG: 4, SKL: 11, SPD: 11, DEF: 12, RES: 6, LCK: 8, MOV: 7 },
      currentHP: 30,
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
    });

    const restored = RunManager.fromJSON(json, gameData);
    const paladin = restored.roster.find((u) => u.name === 'LegacyPaladinTier');
    expect(paladin).toBeTruthy();
    expect(paladin.tier).toBe('promoted');
    expect(paladin.skills).toContain('sol');
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
      const dancer = restored.roster.find((u) => u.className === 'Dancer');
      expect(dancer.skills).toContain('dance');
    });

    it('migration is idempotent', () => {
      const rm = new RunManager(gameData);
      rm.startRun();
      const json = rm.toJSON();
      json.roster.push(makeLegacyUnit('Dancer', 'base', ['dance']));
      const restored1 = RunManager.fromJSON(json, gameData);
      const restored2 = RunManager.fromJSON(restored1.toJSON(), gameData);
      const dancer = restored2.roster.find((u) => u.className === 'Dancer');
      expect(dancer.skills.filter((s) => s === 'dance')).toHaveLength(1);
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
    expect(a.blessingSelectionTelemetry?.offeredIds).toEqual(
      b.blessingSelectionTelemetry?.offeredIds,
    );
    expect(Array.isArray(a.blessingSelectionTelemetry?.chosenIds)).toBe(true);
    expect(a.blessingSelectionTelemetry?.chosenIds).toEqual([]);
  });

  describe('encounter locking', () => {
    it('locks and returns a deep copy of battle config by node', () => {
      const gameData = loadGameData();
      const rm = new RunManager(gameData);
      rm.startRun();
      const node = rm.nodeMap.nodes.find((n) => n.type === NODE_TYPES.BATTLE && n.battleParams);
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
      const node = rm.nodeMap.nodes.find((n) => n.type === NODE_TYPES.BATTLE && n.battleParams);
      rm.lockBattleConfig(node.id, { cols: 9, rows: 7, objective: 'seize' });
      const restored = RunManager.fromJSON(rm.toJSON(), gameData);
      expect(restored.battleConfigsByNodeId[node.id]).toBeTruthy();
      const restoredNode = restored.nodeMap.nodes.find((n) => n.id === node.id);
      expect(restoredNode.encounterLocked).toBe(true);
    });

    it('persists usedRecruitNames through toJSON/fromJSON', () => {
      const gameData = loadGameData();
      const rm = new RunManager(gameData);
      rm.startRun();
      rm.usedRecruitNames = { Fighter: ['Galvin'], Mage: ['Lira'] };
      const restored = RunManager.fromJSON(rm.toJSON(), gameData);
      expect(restored.usedRecruitNames.Fighter).toEqual(expect.arrayContaining(['Galvin']));
      expect(restored.usedRecruitNames.Mage).toEqual(expect.arrayContaining(['Lira']));
      expect(Array.isArray(restored.usedRecruitNames.__all__)).toBe(true);
    });

    it('getBattleParams returns a copy', () => {
      const gameData = loadGameData();
      const rm = new RunManager(gameData);
      rm.startRun();
      const node = rm.nodeMap.nodes.find((n) => n.type === NODE_TYPES.BATTLE && n.battleParams);
      const params = rm.getBattleParams(node);
      params.enemyStatBonus = 999;
      expect(node.battleParams.enemyStatBonus).toBeUndefined();
    });

    it('getBattleParams injects difficulty combat modifiers', () => {
      const gameData = loadGameData();
      const rm = new RunManager(gameData);
      rm.startRun({ difficultyId: 'hard' });
      const node = rm.nodeMap.nodes.find((n) => n.type === NODE_TYPES.BATTLE && n.battleParams);
      const params = rm.getBattleParams(node);
      expect(params.enemyStatBonus).toBe(gameData.difficulty.modes.hard.enemyStatBonus);
      expect(params.enemyCountBonus).toBe(gameData.difficulty.modes.hard.enemyCountBonus);
      expect(params.xpMultiplier).toBe(gameData.difficulty.modes.hard.xpMultiplier);
      expect(params.enemyPoisonChance).toBe(gameData.difficulty.modes.hard.enemyPoisonChance);
      expect(params.reinforcementTurnOffset).toBe(
        gameData.difficulty.modes.hard.reinforcementTurnOffset,
      );
    });

    it('getBattleParams forwards recruit guardian chance modifier', () => {
      const gameData = loadGameData();
      const rm = new RunManager(gameData);
      rm.startRun();
      rm.difficultyModifiers.recruitGuardianChance = 0.35;
      const node = rm.nodeMap.nodes.find((n) => n.type === NODE_TYPES.BATTLE && n.battleParams);
      const params = rm.getBattleParams(node);
      expect(params.recruitGuardianChance).toBe(0.35);
    });

    it('getBattleParams forwards usedRecruitNames tracker', () => {
      const gameData = loadGameData();
      const rm = new RunManager(gameData);
      rm.startRun();
      rm.usedRecruitNames = { Fighter: ['Galvin'] };
      const node = rm.nodeMap.nodes.find((n) => n.type === NODE_TYPES.BATTLE && n.battleParams);
      const params = rm.getBattleParams(node);
      expect(params.usedRecruitNames.Fighter).toEqual(expect.arrayContaining(['Galvin']));
      expect(Array.isArray(params.usedRecruitNames.__all__)).toBe(true);
    });

    it('getBattleParams repairs duplicate roster names before battle', () => {
      const gameData = loadGameData();
      const rm = new RunManager(gameData);
      rm.startRun();
      const duplicateName = rm.roster[0].name;
      rm.roster.push({
        ...structuredClone(rm.roster[0]),
        className: 'Hero',
        name: duplicateName,
      });

      const node = rm.nodeMap.nodes.find((n) => n.type === NODE_TYPES.BATTLE && n.battleParams);
      rm.getBattleParams(node);

      const names = rm.roster.map((unit) => unit.name);
      expect(new Set(names).size).toBe(names.length);
      expect(names.filter((name) => name === duplicateName)).toHaveLength(1);
      expect(names.some((name) => name.startsWith(`${duplicateName} `))).toBe(true);
      expect(Array.isArray(rm.usedRecruitNames.__all__)).toBe(true);
    });

    it('getBattleParams enforces first-map no-fog and fighter-only rules', () => {
      const gameData = loadGameData();
      const rm = new RunManager(gameData);
      rm.startRun();
      const node = rm.nodeMap.nodes.find((n) => n.type === NODE_TYPES.BATTLE && n.battleParams);
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
    expect(rm.activeBlessings).toEqual([{ id: selected, rolledCost: null }]);
    expect(rm.blessingSelectionTelemetry.chosenIds).toEqual([selected]);
    expect(
      rm.blessingHistory.some((e) => e.eventType === 'selection' && e.blessingId === selected),
    ).toBe(true);
  });

  it('chooseBlessing is idempotent — second call returns true without re-applying effects', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun({ blessingSeed: 1, autoSelectBlessing: false, blessingOptionCount: 3 });
    const offered = rm.blessingSelectionTelemetry.offeredIds;
    expect(offered.length).toBeGreaterThan(0);
    const selected = offered[0];

    expect(rm.chooseBlessing(selected)).toBe(true);
    const historyLen = rm.blessingHistory.length;
    const mods = JSON.stringify(rm.blessingRuntimeModifiers);

    // Second call should be a no-op
    expect(rm.chooseBlessing(selected)).toBe(true);
    expect(rm.blessingHistory.length).toBe(historyLen);
    expect(JSON.stringify(rm.blessingRuntimeModifiers)).toBe(mods);
  });

  it('startRun resets _blessingChosen so subsequent chooseBlessing works', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun({ blessingSeed: 1, autoSelectBlessing: false, blessingOptionCount: 3 });
    const offered = rm.blessingSelectionTelemetry.offeredIds;
    rm.chooseBlessing(offered[0]);
    expect(rm.activeBlessings.length).toBeGreaterThan(0);

    // Second run
    rm.startRun({ blessingSeed: 2, autoSelectBlessing: false, blessingOptionCount: 3 });
    const offered2 = rm.blessingSelectionTelemetry.offeredIds;
    rm.chooseBlessing(offered2[0]);
    expect(rm.activeBlessings.length).toBeGreaterThan(0);
  });

  it('all_act_hit_bonus blessing applies to player units in all acts including finalBoss', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();

    rm.activeBlessings = ['steady_hands'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    expect(rm.getActHitBonusForUnit({ faction: 'player' })).toBe(3);
    expect(rm.getActHitBonusForUnit({ faction: 'enemy' })).toBe(0);

    rm.advanceAct(); // act2
    expect(rm.getActHitBonusForUnit({ faction: 'player' })).toBe(3);

    // Verify finalBoss act is covered (regression guard — was previously omitted)
    expect(rm.getActHitBonusForUnit({ faction: 'player' }, 'finalBoss')).toBe(3);
  });

  it('gold_delta blessing grants starting gold for coin_of_fate', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    const baseGold = rm.gold;
    const baseMultiplier = rm.getBattleGoldMultiplier();
    rm.activeBlessings = ['coin_of_fate'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();
    expect(rm.gold).toBe(baseGold + 500);
    expect(rm.getBattleGoldMultiplier()).toBe(baseMultiplier);
  });

  it('battle_gold_multiplier_delta blessing applies run-gold multiplier penalties for scout_blessing', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    const baseMultiplier = rm.getBattleGoldMultiplier();
    rm.activeBlessings = [
      {
        id: 'scout_blessing',
        rolledCost: {
          label: '-10% battle gold',
          effects: [{ type: 'battle_gold_multiplier_delta', params: { value: -0.1 } }],
        },
      },
    ];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();
    expect(rm.getBattleGoldMultiplier()).toBe(baseMultiplier - 0.1);
  });

  it('battle_gold_multiplier_delta blessing applies run-gold multiplier penalties for scholar_vow', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    const baseMultiplier = rm.getBattleGoldMultiplier();
    rm.activeBlessings = [
      {
        id: 'scholar_vow',
        rolledCost: {
          label: '-10% battle gold',
          effects: [{ type: 'battle_gold_multiplier_delta', params: { value: -0.1 } }],
        },
      },
    ];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();
    expect(rm.getBattleGoldMultiplier()).toBe(baseMultiplier - 0.1);
  });

  it('battle_gold_multiplier_delta blessing changes battle rewards', () => {
    const gameData = loadGameData();
    const control = new RunManager(gameData);
    control.startRun();
    const boosted = new RunManager(gameData);
    boosted.startRun();

    const controlNode = control.nodeMap.nodes.find((n) => n.id === control.nodeMap.startNodeId);
    const boostedNode = boosted.nodeMap.nodes.find((n) => n.id === boosted.nodeMap.startNodeId);
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
    const baseDefs = rm.roster.map((u) => u.stats.DEF);

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
    const baseMov = rm.roster.map((u) => u.stats.MOV);
    const baseRuntimeMov = rm.roster.map((u) => u.mov);

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

    rm.activeBlessings = [
      {
        id: 'merchant_bane',
        rolledCost: {
          label: 'Villages offer -1 item',
          effects: [{ type: 'shop_item_count_delta', params: { value: -1 } }],
        },
      },
    ];
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

  it('shop_price_discount blessing stores and retrieves via getShopPriceDiscount', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();

    rm.activeBlessings = ['pilgrim_coin'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    expect(rm.getShopPriceDiscount()).toBeCloseTo(0.15);
    expect(rm.getShopItemCountDelta()).toBe(1);
  });

  it('healing_effectiveness_delta blessing sets healingEffectivenessMultiplier (T1)', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();

    rm.activeBlessings = [
      {
        id: 'merchant_bane',
        rolledCost: {
          label: 'Staff healing -20% effective',
          effects: [{ type: 'healing_effectiveness_delta', params: { value: -0.2 } }],
        },
      },
    ];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    expect(rm.blessingRuntimeModifiers.healingEffectivenessMultiplier).toBeCloseTo(0.8);
  });

  it('weapon_art_hp_cost_delta blessing sets weaponArtHpCostDelta (T1)', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();

    rm.activeBlessings = [
      {
        id: 'merchant_bane',
        rolledCost: {
          label: 'Weapon arts cost +2 HP',
          effects: [{ type: 'weapon_art_hp_cost_delta', params: { value: 2 } }],
        },
      },
    ];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    expect(rm.blessingRuntimeModifiers.weaponArtHpCostDelta).toBe(2);
  });

  it('all_growths_delta blessing applies to roster growths and recruit growth accessor', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    const baseGrowths = rm.roster.map((u) => ({ ...u.growths }));

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
    const beforeSkills = rm.roster.map((u) => ({
      name: u.name,
      skills: [...(u.skills || [])],
    }));

    rm.activeBlessings = [
      {
        id: 'forbidden_tome',
        rolledCost: {
          label: 'Personal skills disabled until Act 3',
          effects: [{ type: 'disable_personal_skills_until_act', params: { act: 'act3' } }],
        },
      },
    ];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    // Lords should have their personal skill removed
    const lords = rm.roster.filter((u) => u.isLord);
    expect(lords.length).toBeGreaterThan(0);
    lords.forEach((unit) => {
      const before = beforeSkills.find((b) => b.name === unit.name);
      expect(unit.skills.length).toBeLessThan(before.skills.length);
    });

    rm.advanceAct(); // act2 — still suppressed
    lords.forEach((unit) => {
      const before = beforeSkills.find((b) => b.name === unit.name);
      expect(unit.skills.length).toBeLessThan(before.skills.length);
    });

    rm.advanceAct(); // act3 — restored
    rm.roster.forEach((unit, idx) => {
      expect(unit.skills).toEqual(beforeSkills[idx].skills);
    });
  });

  it('personal skill restore displaces a non-personal skill when at MAX_SKILLS', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();

    const lord = rm.roster.find((u) => u.isLord);
    expect(lord).toBeDefined();
    const personalSkillId = lord.skills[0]; // personal skill is always first

    // Fill lord to MAX_SKILLS with filler skills
    const fillerSkills = ['sol', 'luna', 'astra', 'vantage', 'wrath'].filter(
      (s) => s !== personalSkillId,
    );
    lord.skills = [personalSkillId];
    for (const sid of fillerSkills) {
      if (lord.skills.length < 5) lord.skills.push(sid);
    }
    expect(lord.skills.length).toBe(5);
    expect(lord.skills).toContain(personalSkillId);

    // Apply disable blessing
    rm.activeBlessings = [
      {
        id: 'forbidden_tome',
        rolledCost: {
          label: 'Personal skills disabled until Act 3',
          effects: [{ type: 'disable_personal_skills_until_act', params: { act: 'act3' } }],
        },
      },
    ];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    // Personal skill removed, now at 4 skills
    expect(lord.skills).not.toContain(personalSkillId);
    expect(lord.skills.length).toBe(4);

    // Fill back to MAX_SKILLS with another skill
    lord.skills.push('adept');
    expect(lord.skills.length).toBe(5);

    rm.advanceAct(); // act2 — still suppressed
    expect(lord.skills).not.toContain(personalSkillId);

    const { displacedSkills } = rm.advanceAct(); // act3 — force restore
    expect(lord.skills).toContain(personalSkillId);
    expect(lord.skills.length).toBe(5);
    // A non-personal skill should have been displaced
    expect(displacedSkills[lord.name]).toBeDefined();
    expect(displacedSkills[lord.name].replacedBy).toBe(personalSkillId);
  });

  it('personal skill restore uses per-unit innate set, not global roster innates', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();

    const lord = rm.roster.find((u) => u.isLord);
    expect(lord).toBeDefined();
    const personalSkillId = lord.skills[0];

    // Give the lord one own-class innate at the end, plus other-class innates.
    // This lets us distinguish first-pass displacement from fallback displacement.
    lord.className = 'Swordmaster';
    lord.tier = 'promoted';
    const ownInnate = 'crit_plus_15';
    const otherClassInnates = ['pavise', 'aegis', 'colossus', 'sure_shot'].filter(
      (s) => s !== personalSkillId,
    );
    lord.skills = [personalSkillId, 'pavise', 'aegis', 'colossus', ownInnate];
    expect(lord.skills.length).toBe(5);

    // Add dummy roster classes so a buggy global innate-set would over-protect these skills.
    rm.roster.push(
      { name: 'DummyGeneral', className: 'General', skills: [] },
      { name: 'DummyPaladin', className: 'Paladin', skills: [] },
      { name: 'DummyWarrior', className: 'Warrior', skills: [] },
      { name: 'DummySniper', className: 'Sniper', skills: [] },
    );

    // Apply disable blessing
    rm.activeBlessings = [
      {
        id: 'forbidden_tome',
        rolledCost: {
          label: 'Personal skills disabled until Act 3',
          effects: [{ type: 'disable_personal_skills_until_act', params: { act: 'act3' } }],
        },
      },
    ];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    expect(lord.skills).not.toContain(personalSkillId);
    // Fill back to MAX_SKILLS while keeping own innate as the last slot.
    lord.skills = ['pavise', 'aegis', 'colossus', 'sure_shot', ownInnate];
    expect(lord.skills.length).toBe(5);

    rm.advanceAct(); // act2
    const { displacedSkills } = rm.advanceAct(); // act3 — force restore

    expect(lord.skills).toContain(personalSkillId);
    expect(lord.skills.length).toBe(5);
    // With per-unit protection, first pass should skip own innate and displace sure_shot.
    // With a buggy global set, first pass would fail and fallback would displace own innate.
    expect(displacedSkills[lord.name]).toBeDefined();
    expect(displacedSkills[lord.name].replacedBy).toBe(personalSkillId);
    const displaced = displacedSkills[lord.name].displaced;
    expect(displaced).toBe('sure_shot');
    expect(displaced).not.toBe(ownInnate);
    expect(otherClassInnates).toContain(displaced);
  });

  it('personal skill restore falls back to displacing own class innate when no other option', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();

    const lord = rm.roster.find((u) => u.isLord);
    expect(lord).toBeDefined();
    const personalSkillId = lord.skills[0];

    // Promote the lord to a class with known innate skills
    // Use Swordmaster (innate: crit_plus_15) for a clear test
    lord.className = 'Swordmaster';
    lord.tier = 'promoted';

    // Apply disable blessing
    rm.activeBlessings = [
      {
        id: 'forbidden_tome',
        rolledCost: {
          label: 'Personal skills disabled until Act 3',
          effects: [{ type: 'disable_personal_skills_until_act', params: { act: 'act3' } }],
        },
      },
    ];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    expect(lord.skills).not.toContain(personalSkillId);
    // Force first-pass failure: fill to cap with only personal IDs + own-class innate.
    // First pass excludes personal + own innate; fallback must displace own innate.
    lord.skills = ['resolve', 'renewal_aura', 'ride_down', 'skyward', 'crit_plus_15'];
    expect(lord.skills.length).toBe(5);

    rm.advanceAct(); // act2
    const { displacedSkills } = rm.advanceAct(); // act3 — force restore

    // Personal skill MUST be restored — never permanently lost
    expect(lord.skills).toContain(personalSkillId);
    expect(lord.skills.length).toBe(5);
    expect(displacedSkills[lord.name]).toBeDefined();
    expect(displacedSkills[lord.name].replacedBy).toBe(personalSkillId);
    expect(displacedSkills[lord.name].displaced).toBe('crit_plus_15');
  });

  it('keeps blocked personal skills pending when only a subset can be restored', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();

    const lord = rm.roster.find((u) => u.isLord);
    expect(lord).toBeDefined();

    // Corrupted/edge state: unit has two blocked personal skills.
    lord.skills = ['charisma', 'foresight'];
    rm.activeBlessings = [
      {
        id: 'forbidden_tome',
        rolledCost: {
          label: 'Personal skills disabled until Act 3',
          effects: [{ type: 'disable_personal_skills_until_act', params: { act: 'act3' } }],
        },
      },
    ];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    expect(rm.blessingRuntimeModifiers.blockedPersonalSkillsByUnit[lord.name]).toEqual([
      'charisma',
      'foresight',
    ]);

    // Capacity pattern that allows restoring only one blocked skill right now.
    lord.skills = ['resolve', 'renewal_aura', 'ride_down', 'skyward', 'sol'];

    rm.advanceAct(); // act2
    rm.advanceAct(); // act3

    expect(lord.skills).toContain('charisma');
    expect(lord.skills).not.toContain('foresight');
    expect(rm.blessingRuntimeModifiers.disablePersonalSkillsUntilAct).toBe('act3');
    expect(rm.blessingRuntimeModifiers.blockedPersonalSkillsByUnit[lord.name]).toEqual([
      'foresight',
    ]);
  });

  it('arsenal_pact grants one silver-tier weapon and applies act1 DEF penalty', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    const baseDefs = rm.roster.map((u) => u.stats.DEF);
    const silverBefore = rm.roster.reduce(
      (sum, u) => sum + u.inventory.filter((w) => w.tier === 'Silver').length,
      0,
    );

    rm.activeBlessings = [
      {
        id: 'arsenal_pact',
        rolledCost: {
          label: '-1 DEF to all units in Act 1',
          effects: [
            { type: 'act_stat_delta_all_units', params: { act: 'act1', stat: 'DEF', value: -1 } },
          ],
        },
      },
    ];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    const silverAfter = rm.roster.reduce(
      (sum, u) => sum + u.inventory.filter((w) => w.tier === 'Silver').length,
      0,
    );
    expect(silverAfter).toBe(silverBefore + 1);
    rm.roster.forEach((unit, idx) => {
      expect(unit.stats.DEF).toBe(baseDefs[idx] - 1);
    });
  });

  it('arsenal_pact act1 DEF penalty is reverted after advancing to act2', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    const baseDefs = rm.roster.map((u) => u.stats.DEF);

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
    expect(restored.blessingSelectionTelemetry.offeredIds).toEqual([
      'steady_hands',
      'coin_of_fate',
    ]);
    expect(restored.blessingSelectionTelemetry.chosenIds).toEqual([]);
  });

  it('chooseBlessing assigns deterministic rolledCost for offeredIds-only telemetry migration', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun({ runSeed: 4242, blessingSeed: 17, autoSelectBlessing: false });
    const json = rm.toJSON();
    json.blessingSelectionTelemetry = {
      seed: 17,
      candidatePoolIds: ['scout_blessing'],
      offeredIds: ['scout_blessing'],
      chosenIds: [],
      rejectionReasons: [],
      options: { count: 1, forceTier1: false, allowTier4: true },
    };

    const restoredA = RunManager.fromJSON(json, gameData);
    const restoredB = RunManager.fromJSON(json, gameData);
    expect(restoredA.chooseBlessing('scout_blessing')).toBe(true);
    expect(restoredB.chooseBlessing('scout_blessing')).toBe(true);
    expect(restoredA.activeBlessings[0].rolledCost).toBeTruthy();
    expect(restoredA.activeBlessings[0].rolledCost).toEqual(
      restoredB.activeBlessings[0].rolledCost,
    );
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

  it('fromJSON migrates legacy string activeBlessings to object entries with deterministic rolled costs', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun({ runSeed: 4242 });
    const json = rm.toJSON();
    json.activeBlessings = ['scout_blessing'];

    const restoredA = RunManager.fromJSON(json, gameData);
    const restoredB = RunManager.fromJSON(json, gameData);
    expect(restoredA.activeBlessings[0].id).toBe('scout_blessing');
    expect(restoredA.activeBlessings[0].rolledCost).toBeTruthy();
    expect(restoredA.activeBlessings[0].rolledCost).toEqual(
      restoredB.activeBlessings[0].rolledCost,
    );
  });

  it('forge_cost_multiplier maps to forgeCostDiscount sign convention', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    rm.activeBlessings = [
      {
        id: 'scout_blessing',
        rolledCost: {
          label: '+25% forge costs',
          effects: [{ type: 'forge_cost_multiplier', params: { value: 0.25 } }],
        },
      },
    ];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();
    expect(rm.getForgeCostDiscount()).toBeCloseTo(-0.25, 5);
  });

  it('unknown blessing IDs remain inert and do not crash application', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    rm.activeBlessings = ['unknown_future_blessing'];
    rm._runStartBlessingsApplied = false;
    expect(() => rm.applyRunStartBlessingEffects()).not.toThrow();
    expect(rm.activeBlessings).toEqual(['unknown_future_blessing']);
    expect(rm.blessingHistory.some((e) => e.details?.reason === 'unknown_blessing_id')).toBe(true);
  });
});

describe('RunManager growth bonus scaling', () => {
  it('_scaleGrowthBonuses scales values by multiplier and rounds', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    const bonuses = { HP: 10, STR: 5, SPD: 3 };
    const scaled = rm._scaleGrowthBonuses(bonuses, 0.5);
    expect(scaled).toEqual({ HP: 5, STR: 3, SPD: 2 });
  });

  it('_scaleGrowthBonuses returns original when multiplier is 1', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    const bonuses = { HP: 10 };
    expect(rm._scaleGrowthBonuses(bonuses, 1)).toBe(bonuses);
  });

  it('_scaleGrowthBonuses returns null when all values round to 0', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    const bonuses = { HP: 1 };
    // 1 * 0.3 rounds to 0
    expect(rm._scaleGrowthBonuses(bonuses, 0.3)).toBeNull();
  });

  it('_getGrowthBonusMultiplier reads from difficulty modifiers', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.difficultyModifiers = { growthBonusMultiplier: 0.8 };
    expect(rm._getGrowthBonusMultiplier()).toBe(0.8);
  });

  it('_getGrowthBonusMultiplier defaults to 1 without modifiers', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    expect(rm._getGrowthBonusMultiplier()).toBe(1);
  });

  it('getEffectiveRecruitGrowthBonuses applies difficulty scaling', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData, {
      growthBonuses: { HP: 10, STR: 10, MAG: 10, SKL: 10, SPD: 10, DEF: 10, RES: 10, LCK: 10 },
    });
    rm.startRun();
    rm.difficultyModifiers.growthBonusMultiplier = 0.5;
    const bonuses = rm.getEffectiveRecruitGrowthBonuses();
    expect(bonuses.HP).toBe(5);
    expect(bonuses.STR).toBe(5);
  });

  it('getEffectiveLordGrowthBonuses applies difficulty scaling', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData, {
      lordGrowthBonuses: { HP: 10, STR: 10, MAG: 10, SKL: 10, SPD: 10, DEF: 10, RES: 10, LCK: 10 },
    });
    rm.startRun();
    rm.difficultyModifiers.growthBonusMultiplier = 0.8;
    const bonuses = rm.getEffectiveLordGrowthBonuses();
    expect(bonuses.HP).toBe(8);
    expect(bonuses.STR).toBe(8);
  });

  it('lord growth parity: run-start mutations match getEffective at 0.5x', () => {
    const gameData = loadGameData();
    // Meta lord growth +5 STR, blessing all_growths +5
    const rm = new RunManager(gameData, {
      lordGrowthBonuses: { STR: 5 },
    });
    rm.startRun();
    // Set multiplier AFTER startRun (startRun resets difficultyModifiers)
    rm.difficultyModifiers.growthBonusMultiplier = 0.5;
    rm.blessingRuntimeModifiers.allGrowthsDelta = 5;

    // getEffective should scale each source independently:
    // meta STR: round(5 * 0.5) = 3, blessing all STR: round(5 * 0.5) = 3 => 6
    const effective = rm.getEffectiveLordGrowthBonuses();
    expect(effective.STR).toBe(Math.round(5 * 0.5) + Math.round(5 * 0.5));
    expect(effective.STR).toBe(6);
  });

  it('recruit growth parity: scale-then-merge matches per-source rounding at 0.5x', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData, {
      growthBonuses: { STR: 5, SPD: 3 },
    });
    rm.difficultyModifiers = { growthBonusMultiplier: 0.5 };
    rm.blessingRuntimeModifiers.allGrowthsDelta = 5;

    const effective = rm.getEffectiveRecruitGrowthBonuses();
    // Meta STR: round(5 * 0.5) = 3, blessing all STR: round(5 * 0.5) = 3 => 6
    expect(effective.STR).toBe(Math.round(5 * 0.5) + Math.round(5 * 0.5));
    // Meta SPD: round(3 * 0.5) = 2, blessing all SPD: round(5 * 0.5) = 3 => 5
    expect(effective.SPD).toBe(Math.round(3 * 0.5) + Math.round(5 * 0.5));
  });

  it('growth parity: divergence case that old merge-then-scale got wrong', () => {
    // With values 5+5 at 0.5x: merge-then-scale = round(10*0.5) = 5
    // scale-then-merge = round(5*0.5) + round(5*0.5) = 3 + 3 = 6
    // The new code should produce 6 (matching run-start per-source rounding)
    const gameData = loadGameData();
    const rm = new RunManager(gameData, {
      lordGrowthBonuses: { STR: 5 },
    });
    rm.difficultyModifiers = { growthBonusMultiplier: 0.5 };
    rm.blessingRuntimeModifiers.allGrowthsDelta = 5;

    const effective = rm.getEffectiveLordGrowthBonuses();
    // Per-source: round(5*0.5)=3 + round(5*0.5)=3 = 6 (NOT round(10*0.5)=5)
    expect(effective.STR).toBe(6);
  });

  it('growth parity: stacked all_growths_delta entries scale per effect at 0.5x', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.difficultyModifiers = { growthBonusMultiplier: 0.5 };
    rm.blessingRuntimeModifiers.allGrowthsDelta = 2;
    rm.blessingRuntimeModifiers.allGrowthsDeltas = [1, 1];

    const effective = rm.getEffectiveRecruitGrowthBonuses();
    // Two +1 entries should round independently: round(1*0.5)+round(1*0.5)=2
    expect(effective.STR).toBe(2);
  });

  it('growth parity: stacked targeted_growths_delta entries scale per effect at 0.5x', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.difficultyModifiers = { growthBonusMultiplier: 0.5 };
    rm.blessingRuntimeModifiers.targetedGrowthsDeltas = [
      { stats: ['STR'], value: 1, scope: 'recruits' },
      { stats: ['STR'], value: 1, scope: 'recruits' },
    ];

    const effective = rm.getEffectiveRecruitGrowthBonuses();
    // Two +1 entries should round independently: round(1*0.5)+round(1*0.5)=2
    expect(effective.STR).toBe(2);
  });
});

describe('RunManager church promotion tracker', () => {
  it('getChurchPromotionCount returns 0 for unknown node', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    expect(rm.getChurchPromotionCount('node_1')).toBe(0);
  });

  it('setChurchPromotionCount persists and getChurchPromotionCount retrieves', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.setChurchPromotionCount('node_1', 2);
    expect(rm.getChurchPromotionCount('node_1')).toBe(2);
  });

  it('getChurchPromotionCount returns 0 for different node', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.setChurchPromotionCount('node_1', 2);
    expect(rm.getChurchPromotionCount('node_2')).toBe(0);
  });

  it('church counter survives toJSON/fromJSON', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    rm.setChurchPromotionCount('node_1', 2);

    const saved = rm.toJSON();
    expect(saved.churchPromotionTracker).toEqual({ nodeId: 'node_1', count: 2 });

    const rm2 = RunManager.fromJSON(saved, gameData);
    expect(rm2.getChurchPromotionCount('node_1')).toBe(2);
    expect(rm2.getChurchPromotionCount('node_2')).toBe(0);
  });

  it('fromJSON handles missing churchPromotionTracker gracefully', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();
    const saved = rm.toJSON();
    delete saved.churchPromotionTracker;

    const rm2 = RunManager.fromJSON(saved, gameData);
    expect(rm2.getChurchPromotionCount('any_node')).toBe(0);
  });
});

describe('RunManager win streak', () => {
  let gameData;
  let rm;

  beforeEach(() => {
    gameData = loadGameData();
    rm = new RunManager(gameData);
    rm.startRun();
  });

  function completeBattleOnNode(runMgr, nodeId) {
    const node = runMgr.nodeMap.nodes.find((n) => n.id === nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    return runMgr.completeBattle(runMgr.roster, nodeId, 100);
  }

  it('starts at 0', () => {
    expect(rm.winStreak).toBe(0);
    expect(rm.maxWinStreak).toBe(0);
  });

  it('increments on completeBattle', () => {
    const available = rm.getAvailableNodes();
    completeBattleOnNode(rm, available[0].id);
    expect(rm.winStreak).toBe(1);
    expect(rm.maxWinStreak).toBe(1);
  });

  it('increments across multiple battles', () => {
    const first = rm.getAvailableNodes();
    completeBattleOnNode(rm, first[0].id);
    const second = rm.getAvailableNodes();
    if (second.length > 0 && second[0].type !== 'shop' && second[0].type !== 'church') {
      completeBattleOnNode(rm, second[0].id);
      expect(rm.winStreak).toBe(2);
      expect(rm.maxWinStreak).toBe(2);
    }
  });

  it('resets to 0 on failRun', () => {
    const available = rm.getAvailableNodes();
    completeBattleOnNode(rm, available[0].id);
    expect(rm.winStreak).toBe(1);
    rm.failRun();
    expect(rm.winStreak).toBe(0);
    expect(rm.maxWinStreak).toBe(1); // maxWinStreak preserved
  });

  it('roundtrips through toJSON/fromJSON', () => {
    const available = rm.getAvailableNodes();
    completeBattleOnNode(rm, available[0].id);
    const saved = rm.toJSON();
    expect(saved.winStreak).toBe(1);
    expect(saved.maxWinStreak).toBe(1);

    const rm2 = RunManager.fromJSON(saved, gameData);
    expect(rm2.winStreak).toBe(1);
    expect(rm2.maxWinStreak).toBe(1);
  });

  it('defaults to 0 for old saves without streak', () => {
    const saved = rm.toJSON();
    delete saved.winStreak;
    delete saved.maxWinStreak;

    const rm2 = RunManager.fromJSON(saved, gameData);
    expect(rm2.winStreak).toBe(0);
    expect(rm2.maxWinStreak).toBe(0);
  });

  it('defaults malformed values to 0', () => {
    const saved = rm.toJSON();
    const badValues = [-1, NaN, 'three', null, undefined];
    for (const bad of badValues) {
      saved.winStreak = bad;
      saved.maxWinStreak = bad;
      const rm2 = RunManager.fromJSON(saved, gameData);
      expect(rm2.winStreak).toBe(0);
      expect(rm2.maxWinStreak).toBe(0);
    }
    // Fractional values get truncated
    saved.winStreak = 1.5;
    saved.maxWinStreak = 2.7;
    const rm3 = RunManager.fromJSON(saved, gameData);
    expect(rm3.winStreak).toBe(1);
    expect(rm3.maxWinStreak).toBe(2);
  });
});

describe('RunManager noMetaMode', () => {
  let gameData;

  beforeEach(() => {
    gameData = loadGameData();
  });

  it('defaults to false', () => {
    const rm = new RunManager(gameData);
    expect(rm.noMetaMode).toBe(false);
  });

  it('can be set post-construction', () => {
    const rm = new RunManager(gameData);
    rm.noMetaMode = true;
    expect(rm.noMetaMode).toBe(true);
  });

  it('with metaEffects=null has no meta bonuses', () => {
    const rm = new RunManager(gameData, null);
    rm.noMetaMode = true;
    rm.startRun();
    expect(rm.metaEffects).toBeNull();
    expect(rm.gold).toBe(200); // STARTING_GOLD only, no goldBonus
  });

  it('roundtrips through toJSON/fromJSON with true', () => {
    const rm = new RunManager(gameData);
    rm.noMetaMode = true;
    rm.startRun();
    const saved = rm.toJSON();
    expect(saved.noMetaMode).toBe(true);

    const rm2 = RunManager.fromJSON(saved, gameData);
    expect(rm2.noMetaMode).toBe(true);
  });

  it('roundtrips through toJSON/fromJSON with false', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const saved = rm.toJSON();
    expect(saved.noMetaMode).toBe(false);

    const rm2 = RunManager.fromJSON(saved, gameData);
    expect(rm2.noMetaMode).toBe(false);
  });

  it('defaults to false for old saves without noMetaMode', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const saved = rm.toJSON();
    delete saved.noMetaMode;

    const rm2 = RunManager.fromJSON(saved, gameData);
    expect(rm2.noMetaMode).toBe(false);
  });

  it('rejects non-boolean values in fromJSON', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const saved = rm.toJSON();

    for (const bad of ['true', 1, {}, [], 'yes']) {
      saved.noMetaMode = bad;
      const rm2 = RunManager.fromJSON(saved, gameData);
      expect(rm2.noMetaMode).toBe(false);
    }
  });

  it('fromJSON throws when no lord in roster after filtering', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const saved = rm.toJSON();

    // Replace roster with units that have no lord flag and names not matching any lord
    saved.roster = [
      {
        name: 'GenericSoldier',
        class: 'Soldier',
        level: 1,
        stats: { hp: 20, str: 8, mag: 0, skl: 5, spd: 5, lck: 3, def: 6, res: 1, mov: 5 },
        maxHp: 20,
        weapon: null,
        skills: [],
        isLord: false,
      },
    ];

    expect(() => RunManager.fromJSON(saved, gameData)).toThrow('no lord');
  });

  it('fromJSON repairs missing isLord flag on ALL lord-named units', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const saved = rm.toJSON();

    // Collect all lord names present in the roster
    const lordNames = new Set(gameData.lords.map((l) => l.name));
    const lordUnitsInRoster = saved.roster.filter((u) => lordNames.has(u.name));
    expect(lordUnitsInRoster.length).toBeGreaterThan(0);

    // Strip isLord from ALL roster units to trigger repair
    for (const u of saved.roster) {
      u.isLord = false;
    }

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rm2 = RunManager.fromJSON(saved, gameData);

    // Verify every lord-named unit got repaired
    for (const lordUnit of lordUnitsInRoster) {
      const repaired = rm2.roster.find((u) => u.name === lordUnit.name);
      expect(repaired).toBeDefined();
      expect(repaired.isLord).toBe(true);
    }

    // Verify warn was called for each repaired lord
    expect(warnSpy).toHaveBeenCalledTimes(lordUnitsInRoster.length);
    for (const lordUnit of lordUnitsInRoster) {
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('repaired missing isLord'),
        lordUnit.name,
      );
    }
    warnSpy.mockRestore();
  });

  it('fromJSON repairs partially-corrupted roster where one lord is flagged and another is not', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const saved = rm.toJSON();

    // Need at least two lord names from gameData
    expect(gameData.lords.length).toBeGreaterThanOrEqual(2);
    const secondLordName = gameData.lords[1].name;

    // Inject a second lord-named unit with isLord: false
    const fakeSecondLord = {
      ...saved.roster[0],
      name: secondLordName,
      isLord: false,
    };
    saved.roster.push(fakeSecondLord);

    // First lord keeps isLord: true — so .some(u => u.isLord) would have been true
    // under the old code, skipping repair entirely
    const firstLordName = saved.roster.find((u) => u.isLord)?.name;
    expect(firstLordName).toBeDefined();

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rm2 = RunManager.fromJSON(saved, gameData);

    // Both lords should have isLord: true — assert against deserialized output
    const repairedFirst = rm2.roster.find((u) => u.name === firstLordName);
    expect(repairedFirst).toBeDefined();
    expect(repairedFirst.isLord).toBe(true);
    const repairedSecond = rm2.roster.find((u) => u.name === secondLordName);
    expect(repairedSecond).toBeDefined();
    expect(repairedSecond.isLord).toBe(true);

    // Only the unflagged lord triggered a warn
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('repaired missing isLord'),
      secondLordName,
    );
    warnSpy.mockRestore();
  });
});

describe('seeded node map (Phase 6.6)', () => {
  const nodeSignature = (nodeMap) =>
    nodeMap.nodes
      .map((n) => ({
        id: n.id,
        row: n.row,
        col: n.col,
        type: n.type,
        edges: [...n.edges].sort(),
        templateId: n.templateId ?? null,
        fogEnabled: !!n.fogEnabled,
        objective: n.battleParams?.objective ?? null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

  it('same runSeed produces an identical node graph', () => {
    const a = new RunManager(loadGameData());
    const b = new RunManager(loadGameData());
    a.startRun({ runSeed: 424242 });
    b.startRun({ runSeed: 424242 });
    expect(nodeSignature(a.nodeMap)).toEqual(nodeSignature(b.nodeMap));
    expect(a.nodeMap.startNodeId).toBe(b.nodeMap.startNodeId);
    expect(a.nodeMap.bossNodeId).toBe(b.nodeMap.bossNodeId);
  });

  it('different runSeeds generally produce different graphs', () => {
    const seeds = [1, 2, 3, 4, 5];
    const signatures = seeds.map((seed) => {
      const rm = new RunManager(loadGameData());
      rm.startRun({ runSeed: seed });
      return JSON.stringify(nodeSignature(rm.nodeMap));
    });
    const distinct = new Set(signatures);
    // Not all five identical — the seed actually drives generation.
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('advanceAct is deterministic for a given runSeed', () => {
    const a = new RunManager(loadGameData());
    const b = new RunManager(loadGameData());
    a.startRun({ runSeed: 999 });
    b.startRun({ runSeed: 999 });
    a.advanceAct();
    b.advanceAct();
    expect(a.currentAct).toBe(b.currentAct);
    expect(nodeSignature(a.nodeMap)).toEqual(nodeSignature(b.nodeMap));
  });
});
