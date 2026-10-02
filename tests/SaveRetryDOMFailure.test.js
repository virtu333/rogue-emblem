import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/utils/errorReporter.js', () => ({ reportAsyncError: vi.fn() }));
import { BattleScene } from '../src/scenes/BattleScene.js';
import { SaveRetryController } from '../src/ui/SaveRetryController.js';
import { installFakeDom } from './helpers/fakeDom.js';
import { hasOpenOverlay } from '../src/utils/overlayStack.js';
import { pushInputScope, popInputScope, dispatchInputAction } from '../src/utils/inputFocus.js';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fixture() {
  const scene = new BattleScene();
  scene._battleSession = 1;
  scene._sceneShutdownCleanedUp = false;
  scene._battleSuspendController = { hasRetryCandidate: () => true, dropRetryCandidate: vi.fn() };
  return { scene, controller: new SaveRetryController(scene) };
}
const fail = (controller) =>
  controller.onCheckpointResult({ ok: false, reason: 'quota' }, { session: 1 });
it('initial constructor failure releases acquired modal ownership and the pending action', async () => {
  const { scene, controller } = fixture();
  scene.events = new EventEmitter();
  const { host } = installFakeDom(vi);
  const owner = {};
  const input = vi.fn();
  pushInputScope(owner, input);
  const append = host.append.bind(host);
  host.append = (node) => {
    if (node.classList.contains('re-modal-shield')) throw Error('Injected host append');
    append(node);
  };
  try {
    fail(controller);
    const gate = controller.whenSettled(1);
    await Promise.resolve();
    expect(controller.state).toBe('degraded');
    expect(await gate).toEqual({ saved: false });
    expect(hasOpenOverlay(scene)).toBe(false);
    expect(scene.events.listenerCount('shutdown')).toBe(1); // overlayStack's shared reset only
    dispatchInputAction('resumed');
    expect(input).toHaveBeenCalledExactlyOnceWith('resumed', undefined);
    expect(host.querySelector('.re-modal-shield')).toBeNull();
  } finally {
    controller.destroy();
    popInputScope(owner);
  }
});

it.each([true, false])(
  'a broken Retry renderer keeps the gate until the writer settles: %s',
  async (saved) => {
    const { scene, controller } = fixture();
    scene.events = new EventEmitter();
    const writer = vi.fn(() => ({ ok: saved, ...(saved ? {} : { reason: 'quota' }) }));
    scene._battleSuspendController.retryCheckpoint = writer;
    fail(controller);
    await Promise.resolve(); // No DOM is an intentional pending fixture.
    const { host } = installFakeDom(vi);
    const append = host.append.bind(host);
    host.append = (node) => {
      if (node.classList.contains('re-modal-shield')) throw Error('Injected Retry host append');
      append(node);
    };
    const gate = controller.whenSettled(1);
    const pending = controller.retry();
    expect(writer).not.toHaveBeenCalled();
    expect(controller.isBlocking()).toBe(true);
    expect(controller.episode.busy).toBe(true);
    expect(await pending).toMatchObject({ ok: saved });
    expect(await gate).toEqual({ saved });
    expect(writer).toHaveBeenCalledOnce();
    expect(controller.state).toBe(saved ? 'idle' : 'degraded');
    expect(hasOpenOverlay(scene)).toBe(false);
    controller.destroy();
  },
);

it('a warned exit without a candidate offers Stay and Exit anyway, with no inert Retry', async () => {
  const { controller, scene } = fixture();
  scene.events = new EventEmitter();
  installFakeDom(vi);
  scene._battleSuspendController.hasRetryCandidate = () => false;
  scene._battleSuspendController.retryCheckpoint = vi.fn();
  controller.onCheckpointResult({ ok: false, reason: 'capture_error' }, { session: 1 });
  const exit = controller.ensureDurableForExit({ session: 1 });
  const actions = controller.surface.body.children
    .filter((n) => n.dataset.saveRetryAction)
    .map((n) => n.dataset.saveRetryAction);
  expect(actions).toEqual(['exit', 'stay']);
  controller.stay();
  expect(await exit).toBe(false);
  expect(scene._battleSuspendController.retryCheckpoint).not.toHaveBeenCalled();
  controller.destroy();
});
