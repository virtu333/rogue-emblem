import { afterEach, expect, it, vi } from 'vitest';
import './JourneyTestSetup.js';
vi.mock('../../src/utils/errorReporter.js', () => ({ reportAsyncError: vi.fn() }));
vi.mock('../../src/utils/SceneRouter.js', async (original) => ({
  ...(await original()),
  transitionToSceneWithBlockedRetry: vi.fn(async () => ({ status: 'started' })),
}));
import { transitionToSceneWithBlockedRetry } from '../../src/utils/SceneRouter.js';
import { RunDriver, JourneyStorage } from './RunDriver.js';
import { journeyBattleScene } from './JourneyBattleScene.js';
import { BattleSuspendController } from '../../src/ui/BattleSuspendController.js';
import { createBattleTimeline } from '../../src/engine/BattleTimeline.js';
import { BattleScene } from '../../src/scenes/BattleScene.js';
import { completeBattleAction } from '../../src/ui/BattleActionCompletion.js';
import {
  captureResolvedAction,
  completeResolvedAction,
  presentQueuedLevelUps,
} from '../../src/ui/BattlePresentationCheckpoint.js';
import { BattleTradeController } from '../../src/ui/BattleTradeController.js';
import { unitHolder } from '../../src/engine/ItemTrade.js';
import { VisionRewindController } from '../../src/ui/VisionRewindController.js';
import { EscapeObjectiveController } from '../../src/ui/EscapeObjectiveController.js';

function fixture() {
  const storage = new JourneyStorage();
  vi.stubGlobal('localStorage', storage);
  const driver = new RunDriver(storage);
  driver.run.beginBattleInProgress('retry-battle', { act: 'act1', objective: 'rout' });
  const scene = journeyBattleScene(driver.run, driver.data);
  scene._battleSession = 1;
  scene.playerUnits = driver.run.roster;
  scene.playerUnits.forEach((unit, index) => {
    unit.col = index;
    unit.row = 1;
    scene.addUnitGraphic(unit);
  });
  scene._battleRewindPolicy = 'fixed-v1';
  const suspend = new BattleSuspendController(scene);
  scene._battleSuspendController = suspend;
  expect(suspend.captureCheckpoint({ session: 1 })).toBe(true);
  return { scene, suspend, storage };
}
const durable = (storage) => JSON.parse(storage.getItem('emblem_rogue_slot_1_run'));
// PR167 adds explicit cloud status; both stacked bases keep the local result exact.
function expectLocalDurability(result) {
  const expected = { ok: true };
  if (Object.hasOwn(result, 'cloud')) expected.cloud = { queued: false, reason: 'offline' };
  expect(result).toEqual(expected);
}
const capture = (suspend) => suspend.captureCheckpoint({ session: 1, preserveRng: true });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it(
  'retry persists the frozen resolved boundary with no extra checkpoint or RNG draw',
  { timeout: 20_000 },
  async () => {
    const { scene, suspend, storage } = fixture();
    const before = durable(storage);
    scene.playerUnits[0].currentHP = 9;
    scene.playerUnits[0].hasActed = true;
    scene.goldEarned = 77;
    scene._battleRng();
    const cursor = scene._battleRng.getState();
    storage.failWrites = true;
    expect(capture(suspend)).toBe(false);
    expect(scene._saveRetry.isBlocking()).toBe(true);
    expect(durable(storage)).toEqual(before);
    const expected = structuredClone(suspend._retryCandidate);
    const checkpoint = structuredClone(scene.runManager.battleInProgress.checkpoint);
    storage.failWrites = false;
    await scene._saveRetry.retry();
    const saved = durable(storage);
    delete saved.savedAt;
    delete expected.savedAt;
    expect(saved).toEqual(expected);
    expect(saved.battleInProgress.checkpoint.playerUnits[0]).toMatchObject({
      currentHP: 9,
      hasActed: true,
    });
    expect(saved.battleInProgress.checkpoint.goldEarned).toBe(77);
    expect(scene.runManager.battleInProgress.checkpoint).toEqual(checkpoint);
    expect(scene._battleRng.getState()).toEqual(cursor);
    expect(suspend.hasRetryCandidate()).toBe(false);
    expect(scene._saveRetry.state).toBe('idle');
  },
);

it.each([
  '_fatalDecision',
  '_fatalCapturePending',
  '_defeatDecision',
  'BATTLE_END',
  'no_battle',
  'missing_token',
])('retry rejects %s without writing or recapturing', { timeout: 20_000 }, (flag) => {
  const { scene, suspend, storage } = fixture();
  storage.failWrites = true;
  capture(suspend);
  const previous = durable(storage);
  const writes = storage.writes;
  storage.failWrites = false;
  if (flag === 'BATTLE_END') scene.battleState = flag;
  else if (flag === 'no_battle') scene.runManager.battleInProgress = null;
  else if (flag !== 'missing_token') scene[flag] = true;
  const result =
    flag === 'missing_token' ? suspend.retryCheckpoint() : suspend.retryCheckpoint({ session: 1 });
  expect(result).toEqual({
    ok: false,
    reason:
      flag === 'missing_token'
        ? 'stale_session'
        : flag === 'no_battle'
          ? 'no_battle'
          : 'unstable_boundary',
  });
  expect(storage.writes).toBe(writes);
  expect(durable(storage)).toEqual(previous);
  scene._saveRetry.destroy();
});

it(
  'a pre-build failure retains the earlier candidate only while live gameplay is unchanged',
  { timeout: 20_000 },
  async () => {
    const { scene, suspend, storage } = fixture();
    storage.failWrites = true;
    capture(suspend);
    const expected = structuredClone(suspend._retryCandidate.battleInProgress.checkpoint);
    suspend._buildCheckpoint = () => {
      throw Error('Injected build failure');
    };
    expect(capture(suspend)).toBe(false);
    expect(suspend.hasRetryCandidate()).toBe(true);
    storage.failWrites = false;
    expectLocalDurability(suspend.retryCheckpoint({ session: 1 }));
    expect(durable(storage).battleInProgress.checkpoint).toEqual(expected);
    expect(scene._saveRetry.isUnsaved()).toBe(false);
  },
);

it(
  'pre-build error after new HP, gold, action and RNG cannot roll back the older boundary',
  { timeout: 20_000 },
  () => {
    const { scene, suspend, storage } = fixture();
    storage.failWrites = true;
    capture(suspend);
    scene._saveRetry.keepPlaying();
    scene.playerUnits[0].currentHP = 9;
    scene.playerUnits[0].hasActed = true;
    scene.goldEarned = 444;
    scene._battleRng();
    const cursor = scene._battleRng.getState();
    suspend._buildCheckpoint = () => {
      throw Error('Injected build failure');
    };
    capture(suspend);
    storage.failWrites = false;
    const writes = storage.writes;
    expect(suspend.retryCheckpoint({ session: 1 })).toEqual({
      ok: false,
      reason: 'checkpoint_replaced',
    });
    expect(storage.writes).toBe(writes);
    expect(scene.playerUnits[0]).toMatchObject({ currentHP: 9, hasActed: true });
    expect(scene.goldEarned).toBe(444);
    expect(scene._battleRng.getState()).toEqual(cursor);
    expect(scene._saveRetry.isUnsaved()).toBe(true);
  },
);

it('post-install serialization failure discards the old candidate', { timeout: 20_000 }, () => {
  const { scene, suspend, storage } = fixture();
  storage.failWrites = true;
  capture(suspend);
  const oldCheckpoint = scene.runManager.battleInProgress.checkpoint;
  scene.runManager.toJSON = () => {
    throw Error('Injected serialization failure');
  };
  capture(suspend);
  expect(scene.runManager.battleInProgress.checkpoint).not.toBe(oldCheckpoint);
  expect(suspend.hasRetryCandidate()).toBe(false);
  expect(suspend.retryCheckpoint({ session: 1 })).toEqual({
    ok: false,
    reason: 'checkpoint_replaced',
  });
  scene._saveRetry.destroy();
});

it(
  'retry that newly encounters quota trims optional history and adopts the saved candidate',
  { timeout: 20_000 },
  () => {
    const { scene, suspend } = fixture();
    scene.runManager.battleInProgress.timeline = {
      ...createBattleTimeline(),
      presentation: { nextId: 2, frames: ['large frame'] },
    };
    const actualWriter = scene._persistBattleRunState.bind(scene);
    scene._persistBattleRunState = () => ({ ok: false, reason: 'write_error' });
    capture(suspend);
    let attempts = 0;
    scene._persistBattleRunState = (candidate, options) => {
      attempts++;
      return candidate.battleInProgress.timeline.presentation
        ? { ok: false, reason: 'quota' }
        : actualWriter(candidate, options);
    };
    expectLocalDurability(suspend.retryCheckpoint({ session: 1 }));
    expect(attempts).toBe(2);
    expect(scene.runManager.battleInProgress.timeline.presentation).toBeNull();
    expect(scene._battleTimeline).toBe(scene.runManager.battleInProgress.timeline);
  },
);

it.each(['missing_slot', 'no_battle', 'portrait'])(
  '%s does not prompt or block',
  { timeout: 20_000 },
  (world) => {
    const { scene, suspend, storage } = fixture();
    storage.failWrites = true;
    if (world === 'missing_slot') scene.registry = { get: () => null };
    if (world === 'no_battle') scene.runManager.battleInProgress = null;
    suspend.captureCheckpoint({ session: 1, progress: world !== 'portrait' });
    expect(scene._saveRetry.isBlocking()).toBe(false);
    expect(scene._saveRetryGate(1)).toBeNull();
    expect(suspend.hasRetryCandidate()).toBe(world === 'portrait');
  },
);

it('later durable capture supersedes a degraded episode', { timeout: 20_000 }, () => {
  const { scene, suspend, storage } = fixture();
  storage.failWrites = true;
  capture(suspend);
  scene._saveRetry.keepPlaying();
  scene.playerUnits[0].currentHP = 8;
  storage.failWrites = false;
  capture(suspend);
  expect(scene._saveRetry.isUnsaved()).toBe(false);
  expect(suspend.hasRetryCandidate()).toBe(false);
  expect(durable(storage).battleInProgress.checkpoint.playerUnits[0].currentHP).toBe(8);
});

it('restart resets status and parks the old episode', { timeout: 20_000 }, async () => {
  const { scene, suspend, storage } = fixture();
  storage.failWrites = true;
  capture(suspend);
  const old = scene._saveRetry;
  let released = false;
  scene._saveRetryGate(1).then(() => {
    released = true;
  });
  scene._cancelLifecycleAwaits = BattleScene.prototype._cancelLifecycleAwaits;
  scene.init({ gameData: scene.gameData, runManager: scene.runManager });
  await old.retry();
  old.keepPlaying();
  await Promise.resolve();
  expect(released).toBe(false);
  expect(scene._saveRetry).toBeNull();
  expect(scene._checkpointPersistenceResult).toBeNull();
  expect(scene._saveRetryGate(2)).toBeNull();
});

it(
  'enemy turn-start pipeline waits before terrain, RNG effects or another enemy action',
  { timeout: 20_000 },
  async () => {
    const { scene, suspend, storage } = fixture();
    storage.failWrites = true;
    capture(suspend);
    scene.turnManager.currentPhase = 'enemy';
    scene.showPhaseBanner = () => {};
    scene.dangerZone = { hide() {} };
    scene.updateAntiTurtlePressure = () => {};
    scene.processTerrainDamage = vi.fn(async () => {});
    scene.processTurnStartEffects = vi.fn(async () => {});
    scene.processZombieRevival = async () => {};
    scene.processBallistaFire = async () => {};
    scene.applyDueHybridOverridesForTurn = () => {};
    scene.startEnemyPhase = vi.fn(async () => {});
    let pipeline;
    scene._scheduleSafeDelayedAsync = (_ms, _label, callback) => {
      pipeline = callback;
    };
    scene.onPhaseChange('enemy', 1);
    const cursor = scene._battleRng.getState();
    const work = pipeline();
    await Promise.resolve();
    expect(scene.processTerrainDamage).not.toHaveBeenCalled();
    expect(scene.processTurnStartEffects).not.toHaveBeenCalled();
    expect(scene.startEnemyPhase).not.toHaveBeenCalled();
    expect(scene._battleRng.getState()).toEqual(cursor);
    scene._saveRetry.keepPlaying();
    await work;
    expect(scene.processTerrainDamage).toHaveBeenCalledOnce();
    expect(scene.processTurnStartEffects).toHaveBeenCalledOnce();
    expect(scene.startEnemyPhase).toHaveBeenCalledOnce();
  },
);

it(
  'enemy action loop pauses after its checkpoint finally before the next enemy',
  { timeout: 20_000 },
  async () => {
    const { scene, storage } = fixture();
    const enemy = { ...scene.playerUnits[0], name: 'Enemy', faction: 'enemy', hasActed: false };
    scene.enemyUnits = [enemy];
    scene.turnManager.currentPhase = 'enemy';
    scene.turnManager.endEnemyPhase = vi.fn();
    scene.battleState = 'ENEMY_PHASE';
    scene.battleConfig = { objective: 'rout' };
    scene.isDevToolsEnabled = () => false;
    scene.createEnemyPhaseAiStats = () => ({});
    scene.finalizeEnemyPhaseAiStats = () => {};
    scene.processTerrainDamage = async () => {};
    scene.applyReinforcementsForTurn = () => {};
    let nextEnemy = 0;
    scene.aiController = {
      processEnemyPhase: async (_enemies, _players, _npcs, callbacks) => {
        await callbacks.onUnitDone(enemy);
        nextEnemy++;
      },
    };
    storage.failWrites = true;
    const cursor = scene._battleRng.getState();
    const work = scene.startEnemyPhase();
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(scene._saveRetry.isBlocking()).toBe(true);
    expect(scene._enemyActionCheckpoint).toBe(false);
    expect(nextEnemy).toBe(0);
    expect(scene.turnManager.endEnemyPhase).not.toHaveBeenCalled();
    expect(scene._battleRng.getState()).toEqual(cursor);
    storage.failWrites = false;
    await scene._saveRetry.retry();
    await work;
    expect(nextEnemy).toBe(1);
    expect(scene.turnManager.endEnemyPhase).toHaveBeenCalledOnce();
    expect(durable(storage).battleInProgress.checkpoint.enemyUnits[0].hasActed).toBe(true);
  },
);

it(
  'shipping Save & Exit callback flushes before clearing battle deltas or transitioning',
  { timeout: 20_000 },
  async () => {
    const { scene } = fixture();
    transitionToSceneWithBlockedRetry.mockClear();
    scene.clearBattleScopedDeltas = vi.fn();
    scene._saveRetry.ensureDurableForExit = vi.fn(async () => false);
    scene.showPauseMenu();
    await scene.pauseOverlay.options.onSaveAndExit();
    expect(scene._saveRetry.ensureDurableForExit).toHaveBeenCalledExactlyOnceWith({ session: 1 });
    expect(scene.clearBattleScopedDeltas).not.toHaveBeenCalled();
    expect(transitionToSceneWithBlockedRetry).not.toHaveBeenCalled();
    expect(scene.battleState).toBe('PLAYER_IDLE');
  },
);

it(
  'throwing recovery DOM cannot turn a durable retry into a failure or strand its gate',
  { timeout: 20_000 },
  async () => {
    const { scene, suspend, storage } = fixture();
    storage.failWrites = true;
    scene.playerUnits[0].currentHP = 11;
    capture(suspend);
    const controller = scene._saveRetry;
    const gate = scene._saveRetryGate(1);
    controller._close = () => {
      throw Error('Injected DOM teardown failure');
    };
    controller._toast = () => {
      throw Error('Injected toast failure');
    };
    storage.failWrites = false;
    expectLocalDurability(suspend.retryCheckpoint({ session: 1 }));
    expect(await gate).toEqual({ saved: true });
    expect(controller.isBlocking()).toBe(false);
    expect(controller.isUnsaved()).toBe(false);
    expect(scene._checkpointPersistenceResult.ok).toBe(true);
    expect(durable(storage).battleInProgress.checkpoint.playerUnits[0].currentHP).toBe(11);
  },
);

it.each(['_fatalDecision', '_fatalCapturePending', '_defeatDecision', 'BATTLE_END'])(
  'rejected Save & Exit cannot overwrite terminal decision %s with the pre-pause state',
  { timeout: 20_000 },
  async (flag) => {
    const { scene } = fixture();
    transitionToSceneWithBlockedRetry.mockClear();
    scene.clearBattleScopedDeltas = vi.fn();
    scene._saveRetry.ensureDurableForExit = async () => {
      if (flag === 'BATTLE_END') scene.battleState = flag;
      else scene[flag] = true;
      return false;
    };
    scene.showPauseMenu();
    await scene.pauseOverlay.options.onSaveAndExit();
    expect(scene.battleState).toBe(flag === 'BATTLE_END' ? 'BATTLE_END' : 'PAUSED');
    expect(scene.clearBattleScopedDeltas).not.toHaveBeenCalled();
    expect(transitionToSceneWithBlockedRetry).not.toHaveBeenCalled();
  },
);

it.each(['_fatalDecision', '_fatalCapturePending', '_defeatDecision', 'BATTLE_END'])(
  'adversarial: successful save await must not steal terminal decision %s',
  { timeout: 20000 },
  async (flag) => {
    const { scene } = fixture();
    transitionToSceneWithBlockedRetry.mockClear();
    scene.clearBattleScopedDeltas = vi.fn();
    scene._saveRetry.ensureDurableForExit = async () => {
      if (flag === 'BATTLE_END') scene.battleState = flag;
      else scene[flag] = true;
      return true;
    };
    scene.showPauseMenu();
    await scene.pauseOverlay.options.onSaveAndExit();
    expect(scene.clearBattleScopedDeltas).not.toHaveBeenCalled();
    expect(transitionToSceneWithBlockedRetry).not.toHaveBeenCalled();
  },
);

it.each(['_fatalDecision', '_fatalCapturePending', '_defeatDecision', 'BATTLE_END'])(
  'Save & Exit respects terminal decision %s even without a retry controller',
  { timeout: 20_000 },
  async (flag) => {
    const { scene } = fixture();
    transitionToSceneWithBlockedRetry.mockClear();
    scene.clearBattleScopedDeltas = vi.fn();
    scene.showPauseMenu();
    delete scene._saveRetry;
    if (flag === 'BATTLE_END') scene.battleState = flag;
    else scene[flag] = true;
    await scene.pauseOverlay.options.onSaveAndExit();
    expect(scene.clearBattleScopedDeltas).not.toHaveBeenCalled();
    expect(transitionToSceneWithBlockedRetry).not.toHaveBeenCalled();
  },
);

it(
  'the production durable writer hook clears a degraded episode independently of capture reporting',
  { timeout: 20_000 },
  async () => {
    const { scene, suspend, storage } = fixture();
    storage.failWrites = true;
    capture(suspend);
    const first = scene._saveRetryGate(1);
    scene._saveRetry.keepPlaying();
    expect(await first).toEqual({ saved: false });
    expect(scene._saveRetry.isUnsaved()).toBe(true);
    storage.failWrites = false;
    // This is the production persistence helper; no capture result is published.
    expectLocalDurability(scene._persistBattleRunState(null, { session: 1 }));
    expect(scene._saveRetry.state).toBe('idle');
    expect(suspend.hasRetryCandidate()).toBe(false);
    expect(scene._saveRetryGate(1)).toBeNull();
  },
);

it(
  'consecutive production save failures each hold a fresh unresolved gate',
  { timeout: 20_000 },
  async () => {
    const { scene, suspend, storage } = fixture();
    storage.failWrites = true;
    capture(suspend);
    const first = scene._saveRetryGate(1);
    storage.failWrites = false;
    await scene._saveRetry.retry();
    expect(await first).toEqual({ saved: true });
    scene.playerUnits[0].currentHP = 7;
    storage.failWrites = true;
    capture(suspend);
    const second = scene._saveRetryGate(1);
    expect(second).not.toBe(first);
    let released = false;
    const continuation = second.then(() => {
      released = true;
    });
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(released).toBe(false);
    expect(scene._saveRetry.isBlocking()).toBe(true);
    scene._saveRetry.keepPlaying();
    await continuation;
    expect(released).toBe(true);
  },
);

it(
  'failed capture and failed Retry keep full frozen history until storage genuinely requires a trimmed successful write',
  { timeout: 20_000 },
  () => {
    const { scene, suspend, storage } = fixture();
    scene.runManager.battleInProgress.timeline = {
      ...createBattleTimeline(),
      presentation: { nextId: 2, frames: ['full frozen history'] },
    };
    const writer = scene._persistBattleRunState.bind(scene);
    scene._persistBattleRunState = () => ({ ok: false, reason: 'quota' });
    expect(capture(suspend)).toBe(false);
    const frozen = structuredClone(suspend._retryCandidate);
    const cursor = scene._battleRng.getState();
    expect(frozen.battleInProgress.timeline.presentation.frames).toEqual(['full frozen history']);
    expect(suspend.retryCheckpoint({ session: 1 })).toEqual({ ok: false, reason: 'quota' });
    expect(suspend._retryCandidate).toEqual(frozen);
    scene._persistBattleRunState = writer;
    expectLocalDurability(suspend.retryCheckpoint({ session: 1 }));
    expect(durable(storage).battleInProgress.timeline).toEqual(frozen.battleInProgress.timeline);
    expect(scene._battleRng.getState()).toEqual(cursor);
  },
);

// The routing matrix drives actual capture owners with a real RunManager and
// writer. Per-action HP/cost/RNG settlement matrices live beside their owners.
const captureOwners = [
  [
    'resolved action',
    (scene, actor) =>
      captureResolvedAction(scene, { kind: 'finish', unitName: actor.name }, { session: 1 }),
  ],
  ['Wait / Canto completion', (scene, actor) => completeBattleAction(scene, actor, { session: 1 })],
  [
    'removed actor continuation',
    (scene) =>
      completeResolvedAction(scene, { kind: 'finish', unitName: 'removed actor' }, { session: 1 }),
  ],
  [
    'level-up continuation',
    (scene, actor) => {
      actor.xp = 95;
      scene.awardScaledXP(actor, 20, { present: false });
      expect(scene._pendingLevelUpPopups).toHaveLength(1);
      return presentQueuedLevelUps(scene, { kind: 'finish', unitName: actor.name }, { session: 1 });
    },
  ],
  [
    'ambush movement',
    (scene, actor) => {
      scene.showMinorHintAt = () => {};
      scene._resolveAmbush(actor, { faction: 'enemy', col: 2, row: 2 });
    },
  ],
  [
    'committed attack intent',
    (scene, actor) => {
      const enemy = { ...actor, name: 'Enemy', faction: 'enemy' };
      scene.enemyUnits = [enemy];
      scene.addUnitGraphic(enemy);
      scene._ensureCombatRollSession = () => null;
      scene._commitCombatIntent(actor, enemy);
    },
  ],
  [
    'turn-start handoff recovery',
    (scene) => {
      scene.battleState = 'ENEMY_PHASE';
      scene._settleUnitSpritesAfterError = () => {};
      scene.showBriefBanner = () => {};
      expect(scene._recoverPlayerHandoff(1, Error('Injected handoff failure'))).toBe(true);
    },
  ],
  [
    'Vision restore',
    (scene) => {
      scene.captureVisionSnapshot();
      vi.spyOn(scene._visionController, 'playRewindEffect').mockImplementation(() => {});
      expect(scene.applyVisionSnapshot()).toBe(true);
    },
  ],
  [
    'parked activation',
    (scene) => {
      scene.goldEarned = 77;
      new VisionRewindController(scene, scene.runManager).settleParkedActivation();
    },
  ],
  ...[false, true].map((queued) => [
    queued ? 'turn-start before level-up' : 'turn-start final checkpoint',
    async (scene) => {
      scene.showPhaseBanner = () => {};
      scene.dangerZone = { hide() {} };
      scene.renderTurnCounter = () => {};
      scene.processTurnStartEffects = async () => {};
      scene.processBallistaFire = async () => {};
      if (queued) {
        const actor = scene.playerUnits[0];
        actor.xp = 95;
        scene.awardScaledXP(actor, 20, { present: false });
        expect(scene._pendingLevelUpPopups).toHaveLength(1);
      }
      let pipeline;
      scene._scheduleSafeDelayedAsync = (_ms, label, callback) => {
        if (label === 'player_phase_turn_start_pipeline') pipeline = callback;
      };
      const captures = vi.spyOn(scene, '_captureSuspendCheckpoint');
      scene.onPhaseChange('player', 1);
      await pipeline();
      expect(captures).toHaveBeenCalledTimes(queued ? 2 : 1);
      if (queued) expect(captures.mock.calls[0][0]).toEqual({ session: 1 });
    },
  ]),
  ['End Turn', (scene) => scene.forceEndTurn()],
  [
    'escape',
    (scene, actor) => {
      actor.isLord = false;
      new EscapeObjectiveController(scene).executeEscape(actor);
    },
  ],
  [
    'trade reorder',
    (scene, actor) => {
      const other = scene.playerUnits[1];
      other.col = actor.col + 1;
      other.row = actor.row;
      actor.consumables = [
        { name: 'Vulnerary', type: 'Consumable', effect: 'heal', value: 10, uses: 3 },
        { name: 'Elixir', type: 'Consumable', effect: 'healFull', uses: 1 },
      ];
      scene.battleState = 'TRADING';
      scene.selectedUnit = actor;
      const controller = new BattleTradeController(scene);
      const slot = (item) => ({ holder: unitHolder(actor), bag: 'consumables', item });
      expect(
        controller.reorder(actor, other, slot(actor.consumables[0]), slot(actor.consumables[1])).ok,
      ).toBe(true);
    },
  ],
  [
    'trade',
    (scene, actor) => {
      const other = scene.playerUnits[1];
      other.col = actor.col + 1;
      other.row = actor.row;
      actor.consumables = [
        { name: 'Vulnerary', type: 'Consumable', effect: 'heal', value: 10, uses: 3 },
      ];
      other.consumables = [];
      scene.battleState = 'TRADING';
      scene.selectedUnit = actor;
      const controller = new BattleTradeController(scene);
      const from = { holder: unitHolder(actor), bag: 'consumables', item: actor.consumables[0] };
      const to = { holder: unitHolder(other), bag: 'consumables', item: null };
      expect(controller.commit(actor, other, from, to).ok).toBe(true);
    },
  ],
];
it.each(captureOwners)(
  '%s capture routes local quota into a held retry gate',
  { timeout: 20_000 },
  async (_label, execute) => {
    const { scene, storage } = fixture();
    const before = durable(storage);
    storage.failWrites = true;
    await execute(scene, scene.playerUnits[0]);
    expect(durable(storage)).toEqual(before);
    expect(scene._saveRetry.isBlocking()).toBe(true);
    const gate = scene._saveRetryGate(1);
    let released = false;
    const work = gate.then(() => {
      released = true;
    });
    await Promise.resolve();
    expect(released).toBe(false);
    scene._saveRetry.keepPlaying();
    await work;
    expect(released).toBe(true);
  },
);
