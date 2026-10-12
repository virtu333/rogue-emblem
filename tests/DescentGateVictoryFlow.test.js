// The gate boss's victory flow (docs/specs/act-v-descent.md §9.3, PostCombatController): the
// gate is a boss battle that is not the act's end, so its victory takes the elite path (loot and
// the third lord), never the boss recruit screen; any other boss keeps the recruit screen.
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

/** A won boss battle that is not the run's end, as the victory flow sees it. */
function bossScene({ battleParams, thirdLord = false }) {
  const scene = new BattleScene();
  scene.battleState = 'PLAYER_IDLE';
  scene.battleParams = battleParams;
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
  scene.nodeId = 'finalBoss_4_2';
  scene.gameData = {};
  scene.isBoss = true;
  scene.showBossRecruitScreen = vi.fn();
  scene.showLootScreen = vi.fn();
  scene._showThirdLordArrival = vi.fn();
  scene.transitionAfterBattle = vi.fn(async () => true);
  scene.runManager = {
    completeBattle: vi.fn(() => true),
    isRunComplete: vi.fn(() => false),
    isActComplete: vi.fn(() => false),
    shouldTriggerThirdLord: vi.fn(() => thirdLord),
  };
  return { scene, pending };
}

describe('the gate boss’s victory flow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('goes to the loot, never the boss recruit screen, and does not end the run', async () => {
    const { scene, pending } = bossScene({ battleParams: { bossRole: 'gate', act: 'finalBoss' } });
    BattleScene.prototype.onVictory.call(scene);
    await Promise.all(pending);
    expect(scene.showBossRecruitScreen).not.toHaveBeenCalled();
    expect(scene.showLootScreen).toHaveBeenCalledTimes(1);
    expect(scene.transitionAfterBattle).not.toHaveBeenCalled();
  });

  it('brings the third lord first when one is due, as the elite path does', async () => {
    const { scene, pending } = bossScene({
      battleParams: { bossRole: 'gate', act: 'finalBoss' },
      thirdLord: true,
    });
    BattleScene.prototype.onVictory.call(scene);
    await Promise.all(pending);
    expect(scene._showThirdLordArrival).toHaveBeenCalledTimes(1);
    expect(scene.showBossRecruitScreen).not.toHaveBeenCalled();
    expect(scene.showLootScreen).not.toHaveBeenCalled();
  });

  it('control: an act boss (no role, or the finale role) keeps the recruit screen', async () => {
    for (const battleParams of [{ act: 'act2' }, { act: 'act2', bossRole: 'finale' }]) {
      const { scene, pending } = bossScene({ battleParams });
      BattleScene.prototype.onVictory.call(scene);
      await Promise.all(pending);
      expect(scene.showBossRecruitScreen, JSON.stringify(battleParams)).toHaveBeenCalledTimes(1);
      expect(scene.showLootScreen).not.toHaveBeenCalled();
    }
  });
});
