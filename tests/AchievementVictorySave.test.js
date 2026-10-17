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
    transitionToSceneWithBlockedRetry: vi.fn(async () => ({ status: 'started' })),
  };
});

import { BattleScene } from '../src/scenes/BattleScene.js';

// A battle's achievements are recorded only once the victory's run save has landed
// (PostCombatController). Recorded before it, a refused save (Keep playing) or a crash
// between the two would replay the battle on resume with its achievements already earned.

/** A won ordinary battle, as the victory flow sees it, with a meta that counts records. */
function wonBattle(saveResult) {
  const scene = new BattleScene();
  scene.battleState = 'PLAYER_IDLE';
  scene.battleParams = { act: 'act1' };
  scene.scene = { isActive: () => true };
  scene.cameras = { main: { centerX: 320, centerY: 240 } };
  scene.add = {
    text: vi.fn(() => ({
      setOrigin() {
        return this;
      },
      setDepth() {
        return this;
      },
      destroy: vi.fn(),
    })),
  };
  const pending = [];
  scene.time = { delayedCall: vi.fn((_ms, cb) => pending.push(cb())) };
  const meta = {
    recordAchievementFacts: vi.fn(() => ['first_blood']),
    getDefeatedByCount: () => 0,
  };
  const audio = { playMusic: vi.fn() };
  scene.registry = { get: (key) => ({ audio, meta })[key] ?? null };
  scene.clearBattleScopedDeltas = vi.fn();
  scene.playerUnits = [{ name: 'Edric', isCommander: true, stats: { HP: 20 }, currentHP: 20 }];
  scene.nonDeployedUnits = [];
  scene.getTurnPressureState = vi.fn(() => ({ goldMultiplier: 1 }));
  scene.goldEarned = 50;
  scene.nodeId = 'act1_2_1';
  scene.gameData = {};
  scene.isBoss = false;
  scene.showLootScreen = vi.fn();
  scene.transitionAfterBattle = vi.fn(async () => true);
  scene._persistBattleRunState = vi.fn(() => saveResult);
  scene.runManager = {
    mode: 'standard',
    roster: [],
    completeBattle: vi.fn(() => true),
    isRunComplete: vi.fn(() => false),
    isActComplete: vi.fn(() => false),
    shouldTriggerThirdLord: vi.fn(() => false),
  };
  return { scene, pending, meta };
}

describe('a victory records its achievements only once its save lands', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records them when the victory save succeeds', async () => {
    const { scene, pending, meta } = wonBattle({ ok: true });
    BattleScene.prototype.onVictory.call(scene);
    await Promise.all(pending);
    expect(scene._persistBattleRunState).toHaveBeenCalled();
    expect(meta.recordAchievementFacts).toHaveBeenCalledTimes(1);
  });

  it('records nothing when the device refuses the save', async () => {
    for (const reason of ['quota', 'write_error', 'missing_slot']) {
      const { scene, pending, meta } = wonBattle({ ok: false, reason });
      BattleScene.prototype.onVictory.call(scene);
      await Promise.all(pending);
      expect(scene._persistBattleRunState, reason).toHaveBeenCalled();
      expect(meta.recordAchievementFacts, reason).not.toHaveBeenCalled();
    }
  });

  it('records nothing when the win did not stand', async () => {
    const { scene, pending, meta } = wonBattle({ ok: true });
    scene.runManager.completeBattle = vi.fn(() => false);
    BattleScene.prototype.onVictory.call(scene);
    await Promise.all(pending);
    expect(meta.recordAchievementFacts).not.toHaveBeenCalled();
  });
});
