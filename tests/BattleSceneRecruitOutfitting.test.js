// Recruit-focused meta upgrade hooks at the BattleScene NPC spawn site:
// recruit_weapon_forge (Quartermaster's Craft) and recruit_accessory
// (Outfitted Recruits). Modeled on BattleSceneLethalArmory.test.js.
import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

vi.mock('../src/engine/Grid.js', () => ({
  Grid: class {
    constructor() {
      this.fogEnabled = false;
      this.gridToPixel = (col, row) => ({ x: col * 16, y: row * 16 });
      this.updateFogOfWar = vi.fn();
      this.clearHighlights = vi.fn();
    }
  },
  computeEffectivePath: vi.fn(),
}));

vi.mock('../src/engine/TurnManager.js', () => ({
  TurnManager: vi.fn(function () {
    this.init = vi.fn();
    this.startBattle = vi.fn();
  }),
}));

vi.mock('../src/engine/AIController.js', () => ({
  AIController: vi.fn(function () {}),
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { loadGameData } from './testData.js';

function makeDisplayObject() {
  return {
    setOrigin: vi.fn().mockReturnThis(),
    setDepth: vi.fn().mockReturnThis(),
    setVisible: vi.fn().mockReturnThis(),
    setInteractive: vi.fn().mockReturnThis(),
    on: vi.fn().mockReturnThis(),
    destroy: vi.fn(),
  };
}

function makeBattleSceneWithRecruit(metaEffects = {}) {
  const gameData = loadGameData();
  const scene = new BattleScene();

  const battleConfig = {
    cols: 4,
    rows: 4,
    mapLayout: Array.from({ length: 4 }, () => Array(4).fill(0)),
    playerSpawns: [
      { col: 1, row: 1 },
      { col: 2, row: 1 },
    ],
    enemySpawns: [],
    npcSpawn: {
      className: 'Fighter',
      name: 'Test Recruit',
      col: 1,
      row: 2,
      level: 1,
    },
    objective: 'rout',
  };

  const runManager = {
    metaEffects,
    getLockedBattleConfig: vi.fn(() => battleConfig),
    getEffectiveRecruitGrowthBonuses: vi.fn(() => null),
  };

  scene.gameData = { ...gameData, lords: [] }; // Empty lords to skip recruit-node lord roll
  scene.runManager = runManager;
  scene.battleParams = {
    act: 'act1',
    tutorialMode: false,
    fogEnabled: false,
    isRecruitBattle: true,
  };
  scene.nodeId = 'battle-recruit-node';
  scene.roster = [{ name: 'Edric', isLord: true, level: 1, col: 0, row: 0, className: 'Edric' }];

  scene.registry = {
    get: (key) => {
      if (key === 'startupFlags') return { isMobile: false };
      if (key === 'audio') return null;
      if (key === 'hints') return { shouldShow: () => false };
      return null;
    },
  };
  scene.events = { once: vi.fn() };
  scene.input = {
    mouse: { disableContextMenu: vi.fn() },
    on: vi.fn(),
    keyboard: { on: vi.fn(), addKey: vi.fn(() => ({ on: vi.fn() })) },
  };
  scene.cameras = { main: { width: 640, height: 480 } };
  scene.game = { events: { on: vi.fn(), off: vi.fn() } };
  scene.time = { delayedCall: vi.fn() };
  scene.tweens = { add: vi.fn() };

  scene.add = {
    rectangle: vi.fn(() => makeDisplayObject()),
    text: vi.fn(() => makeDisplayObject()),
  };

  scene.initializeAntiTurtleState = vi.fn();
  scene.initializeVisionState = vi.fn();
  scene.installBattleRng = vi.fn();
  scene.addUnitGraphic = vi.fn();
  scene.addEnemyFromSpawn = vi.fn();
  scene.updateObjectiveText = vi.fn();
  scene.updateTopLeftHudLayout = vi.fn();
  scene.updateEnemyVisibility = vi.fn();
  scene.updateVisionHud = vi.fn();
  scene._clearTutorialGuideHighlights = vi.fn();
  scene.cancelTouchInspectHold = vi.fn();
  scene._hideMenuTooltip = vi.fn();
  scene._restoreBattleRng = vi.fn();
  scene._isReducedEffects = vi.fn(() => true);
  scene._onDangerClick = vi.fn();
  scene._onRosterClick = vi.fn();
  scene.forceEndTurn = vi.fn();
  scene.requestCancel = vi.fn();
  scene.requestVisionRewind = vi.fn();
  scene.refreshEndTurnControl = vi.fn();
  scene.openUnitDetailOverlay = vi.fn();
  scene.showLootRoster = vi.fn();
  scene.hideLootRoster = vi.fn();
  scene._cycleForecastWeapon = vi.fn();

  return scene;
}

describe('BattleScene recruit NPC Quartermaster’s Craft path', () => {
  it('forges the recruit join weapon when recruitWeaponForge is active', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const scene = makeBattleSceneWithRecruit({ recruitWeaponForge: 2 });
      BattleScene.prototype.beginBattle.call(scene, scene.roster);

      expect(scene.npcUnits).toHaveLength(1);
      const recruit = scene.npcUnits[0];
      expect(recruit.inventory).toHaveLength(1);
      expect(recruit.weapon._forgeLevel).toBe(2);
      expect(recruit.weapon.name).toMatch(/\+2$/);
      // Equipped weapon is the (mutated-in-place) inventory item
      expect(recruit.weapon).toBe(recruit.inventory[0]);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('forges the Lethal Armory grant too when both upgrades are active', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const scene = makeBattleSceneWithRecruit({ lethalArmoryTier: 2, recruitWeaponForge: 1 });
      BattleScene.prototype.beginBattle.call(scene, scene.roster);

      expect(scene.npcUnits).toHaveLength(1);
      const recruit = scene.npcUnits[0];
      expect(recruit.inventory).toHaveLength(2);
      for (const weapon of recruit.inventory) {
        expect(weapon._forgeLevel).toBe(1);
        expect(weapon.name).toMatch(/\+1$/);
      }
      expect(recruit.inventory.some((w) => w.name.startsWith('Steel Axe'))).toBe(true);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('does not forge recruit weapons when recruitWeaponForge is absent', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.25);
    try {
      const scene = makeBattleSceneWithRecruit({});
      BattleScene.prototype.beginBattle.call(scene, scene.roster);

      expect(scene.npcUnits).toHaveLength(1);
      const recruit = scene.npcUnits[0];
      for (const weapon of recruit.inventory) {
        expect(weapon._forgeLevel || 0).toBe(0);
      }
    } finally {
      randomSpy.mockRestore();
    }
  });
});

describe('BattleScene recruit NPC Outfitted Recruits path', () => {
  it('equips a stat accessory on the recruit when recruitStartingAccessory is active', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const scene = makeBattleSceneWithRecruit({ recruitStartingAccessory: 1 });
      BattleScene.prototype.beginBattle.call(scene, scene.roster);

      expect(scene.npcUnits).toHaveLength(1);
      const recruit = scene.npcUnits[0];
      expect(recruit.accessory).toBeTruthy();
      // Fighter is physical: Power Ring is the first eligible pool entry at rng=0
      expect(recruit.accessory.name).toBe('Power Ring');
      expect(typeof recruit.accessory.uid).toBe('string');
      // Accessory stat bonus is applied on equip
      const gameData = loadGameData();
      const powerRing = gameData.accessories.find((a) => a.name === 'Power Ring');
      expect(powerRing.effects.STR).toBeGreaterThan(0);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('does not grant an accessory when recruitStartingAccessory is absent', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.25);
    try {
      const scene = makeBattleSceneWithRecruit({});
      BattleScene.prototype.beginBattle.call(scene, scene.roster);

      expect(scene.npcUnits).toHaveLength(1);
      expect(scene.npcUnits[0].accessory).toBeNull();
    } finally {
      randomSpy.mockRestore();
    }
  });
});
