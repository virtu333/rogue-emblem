import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('../src/utils/SceneRouter.js', async () => {
  const actual = await vi.importActual('../src/utils/SceneRouter.js');
  return {
    ...actual,
    transitionToScene: vi.fn(async () => true),
  };
});

import { BattleScene } from '../src/scenes/BattleScene.js';
import { transitionToScene, TRANSITION_REASONS } from '../src/utils/SceneRouter.js';

describe('BattleScene onVictory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('transitions to NodeMap and skips loot/recruit when completeBattle is a no-op', async () => {
    const scene = new BattleScene();
    scene.battleState = 'PLAYER_IDLE';
    scene.battleParams = { tutorialMode: false };
    scene.scene = { isActive: () => true };
    scene.cameras = { main: { centerX: 320, centerY: 240 } };
    scene.add = {
      text: vi.fn(() => ({
        setOrigin() { return this; },
        setDepth() { return this; },
      })),
    };
    const pending = [];
    scene.time = {
      delayedCall: vi.fn((_ms, cb) => {
        pending.push(cb());
      }),
    };
    const audio = { playMusic: vi.fn() };
    scene.registry = { get: (key) => (key === 'audio' ? audio : null) };
    scene.clearBattleScopedDeltas = vi.fn();
    scene.playerUnits = [{ name: 'Edric', stats: { HP: 20 } }];
    scene.nonDeployedUnits = [];
    scene.getTurnPressureState = vi.fn(() => ({ goldMultiplier: 1 }));
    scene.goldEarned = 50;
    scene.nodeId = 'node_1';
    scene.gameData = {};
    scene.isBoss = true;
    scene.showBossRecruitScreen = vi.fn();
    scene.showLootScreen = vi.fn();
    scene.runManager = {
      completeBattle: vi.fn(() => false),
    };

    BattleScene.prototype.onVictory.call(scene);
    await Promise.all(pending);

    expect(scene.runManager.completeBattle).toHaveBeenCalledTimes(1);
    expect(scene.showBossRecruitScreen).not.toHaveBeenCalled();
    expect(scene.showLootScreen).not.toHaveBeenCalled();
    expect(transitionToScene).toHaveBeenCalledTimes(1);
    expect(transitionToScene).toHaveBeenCalledWith(
      scene,
      'NodeMap',
      { gameData: scene.gameData, runManager: scene.runManager },
      { reason: TRANSITION_REASONS.BATTLE_COMPLETE }
    );
  });
});
