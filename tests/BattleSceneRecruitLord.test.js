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

function makeBattleSceneWithLords({ lordRecruitChanceBonus = 0 } = {}) {
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
    metaEffects: { lordRecruitChanceBonus },
    roster: [
      { name: 'Edric', className: 'Lord', isLord: true, level: 5, faction: 'player' },
      { name: 'Sera', className: 'Light Sage', isLord: true, level: 5, faction: 'player' },
    ],
    fallenUnits: [],
    getLockedBattleConfig: vi.fn(() => battleConfig),
    getEffectiveRecruitGrowthBonuses: vi.fn(() => null),
    getEffectiveMetaEffects: vi.fn(() => ({ lordRecruitChanceBonus })),
    getRecruitLevelBonus: vi.fn(() => 0),
  };

  scene.gameData = gameData;  // includes lords data with Kira/Voss
  scene.runManager = runManager;
  scene.battleParams = { act: 'act1', tutorialMode: false, fogEnabled: false, isRecruitBattle: true };
  scene.nodeId = 'battle-recruit-node';
  scene.roster = [{ name: 'Edric', isLord: true, level: 5, col: 0, row: 0, className: 'Lord' }];

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

describe('BattleScene recruit-node lord meta bonus', () => {
  it('lordRecruitChanceBonus increases recruit-node lord chance', () => {
    // 0.30 is above base 0.25 but below 0.25+0.16=0.41
    let callCount = 0;
    const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
      callCount++;
      // Call 1: recruit level roll (< 0.5 check)
      // Call 2: lord chance check — 0.30 should pass with bonus
      // Call 3+: lord selection and other shuffles
      if (callCount === 2) return 0.30;
      return 0.1;
    });
    try {
      const scene = makeBattleSceneWithLords({ lordRecruitChanceBonus: 0.16 });
      BattleScene.prototype.beginBattle.call(scene, scene.roster);
      expect(scene.npcUnits.some(u => u.isLord)).toBe(true);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('does not spawn lord at same random value without bonus', () => {
    // Same 0.30 value — should NOT trigger at base 0.25
    let callCount = 0;
    const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
      callCount++;
      if (callCount === 2) return 0.30;
      return 0.1;
    });
    try {
      const scene = makeBattleSceneWithLords({ lordRecruitChanceBonus: 0 });
      BattleScene.prototype.beginBattle.call(scene, scene.roster);
      expect(scene.npcUnits.every(u => !u.isLord)).toBe(true);
    } finally {
      randomSpy.mockRestore();
    }
  });
});
