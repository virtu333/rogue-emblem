import { installFakeDom } from './helpers/fakeDom.js';
import { pushInputScope, popInputScope, dispatchInputAction } from '../src/utils/inputFocus.js';
import { EventEmitter } from 'node:events';
import { installSceneGuard } from '../src/utils/SceneGuard.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
vi.mock('../src/utils/errorReporter.js', () => ({ reportAsyncError: vi.fn() }));
import { SaveRetryController, SAVE_RETRY_COPY } from '../src/ui/SaveRetryController.js';
import { classifySaveResult } from '../src/engine/SavePersistenceStatus.js';
import { BattleScene } from '../src/scenes/BattleScene.js';

function fixture() {
  const scene = new BattleScene();
  scene._battleSession = 1;
  scene._sceneShutdownCleanedUp = false;
  scene.battleState = 'PLAYER_IDLE';
  scene._battleSuspendController = {
    hasRetryCandidate: vi.fn(() => true),
    dropRetryCandidate: vi.fn(),
    retryCheckpoint: vi.fn(() => ({ ok: true })),
  };
  const controller = new SaveRetryController(scene).create();
  scene._saveRetry = controller;
  return { scene, controller, suspend: scene._battleSuspendController };
}
const fail = (controller) =>
  controller.onCheckpointResult({ ok: false, reason: 'quota' }, { session: 1 });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('local save classification', () => {
  it.each(['quota', 'write_error'])('%s needs a candidate and gameplay progress', (reason) => {
    expect(classifySaveResult({ ok: false, reason }, { hasCandidate: true })).toBe('retryable');
    expect(classifySaveResult({ ok: false, reason }, { hasCandidate: false })).toBe('ignored');
    expect(classifySaveResult({ ok: false, reason }, { hasCandidate: true, progress: false })).toBe(
      'presentation_only',
    );
  });
  it.each([
    'stale_session',
    'missing_slot',
    'missing_run',
    'no_battle',
    'unstable_boundary',
    'wrong_phase',
    'missing_persistence',
  ])('%s never opens a dialog', (reason) => {
    const { controller } = fixture();
    controller.onCheckpointResult({ ok: false, reason }, { session: 1 });
    expect(controller.state).toBe('idle');
    expect(controller.whenSettled(1)).toBeNull();
  });
  it.each(['protected_slot', 'offline', 'callback_error'])(
    'durable local with cloud %s stays idle',
    (reason) => {
      const { controller } = fixture();
      controller.onCheckpointResult({ ok: true, cloud: { queued: false, reason } }, { session: 1 });
      expect(controller.isUnsaved()).toBe(false);
    },
  );
  it('copy lines fit the design width', () => {
    for (const value of Object.values(SAVE_RETRY_COPY))
      for (const line of [value].flat()) expect(line.length).toBeLessThanOrEqual(40);
  });
});

it('publishes the block synchronously and releases one shared wait exactly once', async () => {
  const { scene, controller } = fixture();
  fail(controller);
  expect(controller.isBlocking()).toBe(true);
  expect(scene.isStoryInputLocked()).toBe(true);
  expect(scene.canForceEndTurn()).toBe(false);
  const gate = controller.whenSettled(1);
  expect(controller.whenSettled(1)).toBe(gate);
  let continuations = 0;
  const resumed = gate.then(() => continuations++);
  await Promise.resolve();
  expect(continuations).toBe(0);
  controller.keepPlaying();
  controller.keepPlaying();
  await resumed;
  expect(continuations).toBe(1);
  expect(controller.state).toBe('degraded');
  expect(scene.isStoryInputLocked()).toBe(false);
  fail(controller);
  expect(controller.isBlocking()).toBe(false);
});

it('double Retry writes once; Keep playing cannot interrupt a write', async () => {
  const { controller, suspend } = fixture();
  fail(controller);
  let released = 0;
  const resumed = controller.whenSettled(1).then(() => released++);
  const first = controller.retry();
  const second = controller.retry();
  controller.keepPlaying();
  expect(controller.isBlocking()).toBe(true);
  await Promise.all([first, second, resumed]);
  expect(suspend.retryCheckpoint).toHaveBeenCalledExactlyOnceWith({ session: 1 });
  expect(released).toBe(1);
  expect(controller.state).toBe('idle');
});

it('failed retry stays blocked and preserves its attempt count', async () => {
  const { controller, suspend } = fixture();
  suspend.retryCheckpoint.mockReturnValue({ ok: false, reason: 'write_error' });
  fail(controller);
  await controller.retry();
  expect(controller.isBlocking()).toBe(true);
  expect(controller.episode.attempts).toBe(1);
  controller.keepPlaying();
});

it('a stale episode has inert buttons and a parked wait', async () => {
  const { scene, controller, suspend } = fixture();
  fail(controller);
  let resumed = false;
  controller.whenSettled(1).then(() => {
    resumed = true;
  });
  scene._battleSession = 2;
  await controller.retry();
  controller.keepPlaying();
  controller.exitAnyway();
  controller.stay();
  controller.destroy();
  await Promise.resolve();
  expect(suspend.retryCheckpoint).not.toHaveBeenCalled();
  expect(resumed).toBe(false);
});

it.each(['checkpoint_replaced', 'no_candidate'])(
  '%s releases into degraded state',
  async (reason) => {
    const { controller, suspend } = fixture();
    fail(controller);
    suspend.retryCheckpoint.mockReturnValue({ ok: false, reason });
    const wait = controller.whenSettled(1);
    await controller.retry();
    await wait;
    expect(controller.state).toBe('degraded');
  },
);

it('superseding live write clears the candidate, dialog, and degraded warning', () => {
  const { controller, suspend } = fixture();
  fail(controller);
  controller.keepPlaying();
  controller.onDurableWrite({ session: 2 });
  expect(controller.isUnsaved()).toBe(true);
  controller.onDurableWrite({ session: 1 });
  expect(suspend.dropRetryCandidate).toHaveBeenCalledOnce();
  expect(controller.isUnsaved()).toBe(false);
});

it.each(['Stay', 'Exit anyway', 'Retry'])(
  'Save & Exit retries first then supports %s',
  async (choice) => {
    const { controller, suspend } = fixture();
    fail(controller);
    controller.keepPlaying();
    suspend.retryCheckpoint.mockReturnValue({ ok: false, reason: 'quota' });
    let answer;
    const exit = controller.ensureDurableForExit({ session: 1 }).then((value) => {
      answer = value;
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(suspend.retryCheckpoint).toHaveBeenCalledOnce();
    expect(controller.isBlocking()).toBe(true);
    expect(answer).toBeUndefined();
    if (choice === 'Stay') controller.stay();
    else if (choice === 'Exit anyway') controller.exitAnyway();
    else {
      suspend.retryCheckpoint.mockReturnValue({ ok: true });
      await controller.retry();
    }
    await exit;
    expect(answer).toBe(choice !== 'Stay');
  },
);

it('a capture bug stays visibly unsaved without a retryable candidate', async () => {
  const { controller, suspend } = fixture();
  suspend.hasRetryCandidate.mockReturnValue(false);
  controller.onCheckpointResult({ ok: false, reason: 'capture_error' }, { session: 1 });
  expect(controller.state).toBe('degraded');
  const exit = controller.ensureDurableForExit({ session: 1 });
  expect(controller.isBlocking()).toBe(true);
  controller.stay();
  expect(await exit).toBe(false);
  expect(suspend.retryCheckpoint).not.toHaveBeenCalled();
});

it.each(['_fatalDecision', '_fatalCapturePending', '_defeatDecision', 'BATTLE_END'])(
  'boundary %s closes and releases without claiming saved',
  async (flag) => {
    const { scene, controller } = fixture();
    fail(controller);
    const wait = controller.whenSettled(1);
    if (flag === 'BATTLE_END') scene.battleState = flag;
    else scene[flag] = true;
    controller.update();
    expect(await wait).toEqual({ saved: false });
    expect(controller.isBlocking()).toBe(false);
  },
);

it('a portrait-only write failure never creates a blocking episode', () => {
  const { controller } = fixture();
  controller.onCheckpointResult({ ok: false, reason: 'quota' }, { session: 1, progress: false });
  expect(controller.state).toBe('idle');
  expect(controller.isUnsaved()).toBe(false);
});

it('SceneGuard exempts a pending save dialog, then detects a stuck battle after Keep playing', () => {
  const { scene, controller } = fixture();
  let now = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.stubGlobal('window', { addEventListener() {} });
  scene.events = new EventEmitter();
  scene.sys = { settings: { key: 'Battle' } };
  scene.battleState = 'ENEMY_PHASE';
  const game = { scene: { scenes: [scene], add() {} }, sound: { sounds: [] } };
  installSceneGuard(game);
  scene.events.emit('create');
  fail(controller);
  now += 20_000;
  for (let i = 0; i < 30; i++) scene.events.emit('update');
  expect(window.__sceneState.errors).toEqual([]);
  controller.keepPlaying();
  now += 20_000;
  for (let i = 0; i < 30; i++) scene.events.emit('update');
  expect(window.__sceneState.errors).toEqual([expect.stringContaining('stuck_blocking')]);
});

it.each([false, true])(
  'failed menu teardown releases its shield/input even with throwing focus cleanup: %s',
  (throwFocus) => {
    const { controller } = fixture();
    fail(controller);
    const root = { remove: vi.fn() };
    const shield = { remove: vi.fn() };
    const owner = {};
    const underlying = vi.fn();
    const modalInput = vi.fn();
    const surface = {
      root,
      shield,
      destroy: () => {
        throw Error('Injected menu destruction failure');
      },
    };
    pushInputScope(owner, underlying);
    pushInputScope(surface, modalInput, (active) => {
      if (!active && throwFocus) throw Error('Injected focus cleanup failure');
    });
    controller.surface = surface;
    try {
      dispatchInputAction('before');
      expect(modalInput).toHaveBeenCalledOnce();
      controller.onDurableWrite({ session: 1 });
      dispatchInputAction('after');
      expect(underlying).toHaveBeenCalledExactlyOnceWith('after', undefined);
      expect(modalInput).toHaveBeenCalledOnce();
      expect(root.remove).toHaveBeenCalledOnce();
      expect(shield.remove).toHaveBeenCalledOnce();
      expect(controller.surface).toBeNull();
      expect(controller.isBlocking()).toBe(false);
    } finally {
      popInputScope(surface);
      popInputScope(owner);
    }
  },
);

it('Retry repaint survives a prior menu teardown failure and still writes once', async () => {
  const { scene, controller, suspend } = fixture();
  scene.events = new EventEmitter();
  fail(controller);
  await Promise.resolve();
  installFakeDom(vi);
  controller.surface = {
    destroy() {
      throw Error('Injected old menu teardown');
    },
    root: { remove() {} },
    shield: { remove() {} },
  };
  const gate = controller.whenSettled(1);
  await expect(controller.retry()).resolves.toEqual({ ok: true });
  expect(await gate).toEqual({ saved: true });
  expect(suspend.retryCheckpoint).toHaveBeenCalledOnce();
  expect(controller.isBlocking()).toBe(false);
});

it.each(['checkpoint_replaced', 'no_candidate'])(
  'a rejected %s Retry resolves Save & Exit as Stay',
  async (reason) => {
    const { controller, suspend } = fixture();
    fail(controller);
    controller.keepPlaying();
    suspend.retryCheckpoint.mockReturnValue({ ok: false, reason: 'quota' });
    const exit = controller.ensureDurableForExit({ session: 1 });
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(controller.exitWait).not.toBeNull();
    suspend.retryCheckpoint.mockReturnValue({ ok: false, reason });
    await controller.retry();
    expect(await exit).toBe(false);
    expect(controller.exitWait).toBeNull();
    expect(controller.state).toBe('degraded');
  },
);
