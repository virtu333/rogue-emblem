import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';
import { CeremonyController } from '../src/ui/CeremonyController.js';
import {
  _resetInputFocus,
  activeInputOwner,
  dispatchInputAction,
} from '../src/utils/inputFocus.js';
import { hasOpenOverlay, cancelTopOverlay } from '../src/utils/overlayStack.js';
import { InputAction } from '../src/utils/InputActions.js';

const gameData = loadGameData();

function makeScene({ reduceMotion = false, speed = 'normal' } = {}) {
  const handlers = new Map();
  const listeners = (name) => handlers.get(name) || handlers.set(name, new Set()).get(name);
  return {
    gameData,
    textures: { exists: () => false },
    registry: {
      get: (key) =>
        key === 'settings'
          ? { getReduceMotion: () => reduceMotion, getBattleSpeed: () => speed }
          : null,
    },
    events: {
      once: (name, fn) => listeners(name).add(fn),
      off: (name, fn) => listeners(name).delete(fn),
      emit: (name) => {
        const fns = [...listeners(name)];
        listeners(name).clear();
        for (const fn of fns) fn();
      },
    },
  };
}

let dom;
beforeEach(() => {
  vi.useFakeTimers();
  dom = installFakeDom(vi);
  _resetInputFocus();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  _resetInputFocus();
});

const layers = () => dom.doc.querySelectorAll('.ce-layer');
const pointer = (node) =>
  node.dispatchEvent(new dom.FakeEvent('pointerdown', { button: 0, pointerId: 1 }));

describe('CeremonyController — boss encounter card', () => {
  const rider = { name: 'Dark Rider', className: 'Dark Knight', isBoss: true, faction: 'enemy' };

  it('shows NAME, epithet and act·class over the map frame, blocking until it times out', async () => {
    const scene = makeScene();
    const c = new CeremonyController(scene);
    const done = c.showBossIntro({ unit: rider, actId: 'act2' });
    const card = layers()[0];
    expect(card.classList.contains('ce-boss-layer')).toBe(true);
    expect(card.dataset.frame).toBe('map');
    expect(card.style.width).toBe('622px'); // the map area, never the rail
    expect(card.querySelector('.ce-boss-name').textContent).toBe('Dark Rider');
    expect(card.querySelector('.ce-boss-epithet').textContent).toBe('Bearer of the Sealed Orders');
    expect(card.querySelector('.ce-kicker').textContent).toBe('Act II · Dark Knight');
    expect(c.isBlocking()).toBe(true);
    expect(hasOpenOverlay(scene)).toBe(true);
    await vi.advanceTimersByTimeAsync(4300);
    await vi.advanceTimersByTimeAsync(400);
    await expect(done).resolves.toBe(true);
    expect(layers()).toHaveLength(0);
    expect(c.isBlocking()).toBe(false);
    expect(hasOpenOverlay(scene)).toBe(false);
    expect(activeInputOwner()).toBeNull();
  });

  it.each([
    ['tap', (card) => pointer(card)],
    ['Enter', () => dom.key('Enter')],
    ['Escape', () => dom.key('Escape')],
    ['gamepad confirm', () => dispatchInputAction(InputAction.CONFIRM)],
    ['gamepad back / rail Back', (card, scene) => cancelTopOverlay(scene)],
  ])('%s skips it (after a short guard) and releases input once', async (_label, act) => {
    const scene = makeScene();
    const c = new CeremonyController(scene);
    let settled = false;
    const done = c.showBossIntro({ unit: rider, actId: 'act2' }).then(() => (settled = true));
    const card = layers()[0];
    act(card, scene); // inside the guard: ignored
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    vi.advanceTimersByTime(250);
    act(card, scene);
    await vi.advanceTimersByTimeAsync(400);
    await done;
    expect(settled).toBe(true);
    expect(layers()).toHaveLength(0);
    expect(activeInputOwner()).toBeNull();
    expect(dom.win.listenerCount('keydown')).toBe(0);
  });

  it('the Entity gets no name card, only the wordless mark', async () => {
    const c = new CeremonyController(makeScene());
    void c.showBossIntro({
      unit: { name: 'The Entity', className: 'Entity', isEntity: true, isBoss: true },
      actId: 'finalBoss',
    });
    const card = layers()[0];
    expect(card.classList.contains('ce-boss-layer--entity')).toBe(true);
    expect(card.querySelector('.ce-boss-name')).toBeNull();
    expect(card.querySelector('.ce-boss-mark').textContent).toBe('· · ·');
    c.destroy();
  });

  it('reduced motion and Instant speed render the end state (static)', () => {
    const reduced = new CeremonyController(makeScene({ reduceMotion: true }));
    void reduced.showBossIntro({ unit: rider, actId: 'act2' });
    expect(layers()[0].classList.contains('is-static')).toBe(true);
    reduced.destroy();
    const instant = new CeremonyController(makeScene({ speed: 'instant' }));
    void instant.showBossIntro({ unit: rider, actId: 'act2' });
    expect(layers()[0].classList.contains('is-static')).toBe(true);
    instant.destroy();
  });

  it('scene shutdown removes the DOM, listeners, scopes and resolves the waiter', async () => {
    const scene = makeScene();
    const c = new CeremonyController(scene);
    const done = c.showBossIntro({ unit: rider, actId: 'act2' });
    expect(dom.win.listenerCount('keydown')).toBe(1);
    scene.events.emit('shutdown');
    await expect(done).resolves.toBe(true);
    expect(layers()).toHaveLength(0);
    expect(dom.win.listenerCount('keydown')).toBe(0);
    expect(dom.win.listenerCount('resize')).toBe(0);
    expect(activeInputOwner()).toBeNull();
    expect(c.destroyed).toBe(true);
    expect(c.showPhase({ phase: 'player', turn: 2 })).toBeNull();
  });

  it('never renders without a DOM host (canvas fallback owns it)', async () => {
    vi.unstubAllGlobals();
    const c = new CeremonyController(makeScene());
    await expect(c.showBossIntro({ unit: rider, actId: 'act2' })).resolves.toBe(false);
    expect(c.showVictory({ objective: 'rout', turn: 3 })).toBeNull();
    expect(c.showActCard({ actId: 'act1' })).toBeNull();
  });
});

describe('CeremonyController — bands', () => {
  it('victory shows the objective word; a tap moves the flow on exactly once', async () => {
    const c = new CeremonyController(makeScene());
    const onSkip = vi.fn();
    const band = c.showVictory({ objective: 'seize', turn: 9, par: 10, rating: 'S' }, { onSkip });
    const layer = layers()[0];
    expect(layer.querySelector('.ce-band-word').textContent).toBe('SEIZED');
    expect(layer.querySelector('.ce-band-sub').textContent).toBe('Turn 9 · Par 10 · Rank S');
    vi.advanceTimersByTime(250);
    pointer(layer);
    pointer(layer);
    expect(onSkip).toHaveBeenCalledTimes(1);
    const closing = band.release();
    await vi.advanceTimersByTimeAsync(400);
    await closing;
    expect(layers()).toHaveLength(0);
    band.destroy(); // idempotent
  });

  it('FOE VANQUISHED leaves by itself and never blocks the map', async () => {
    const scene = makeScene();
    const c = new CeremonyController(scene);
    c.showBossFelled({ objective: 'rout', remaining: 2 });
    const layer = layers()[0];
    expect(layer.classList.contains('is-blocking')).toBe(false);
    expect(layer.querySelector('.ce-band-sub').textContent).toBe('2 foes remain');
    expect(hasOpenOverlay(scene)).toBe(false);
    await vi.advanceTimersByTimeAsync(2200 + 400 + 50);
    expect(layers()).toHaveLength(0);
  });

  it('phase band keeps the existing reading windows and replaces itself', async () => {
    const c = new CeremonyController(makeScene());
    const first = c.showPhase({ phase: 'player', turn: 1, place: 'Border Marches — Ford' });
    expect(layers()[0].querySelector('.ce-phase-sub').textContent).toBe('Border Marches — Ford');
    expect(first.visible).toBe(true);
    first.destroy();
    await vi.advanceTimersByTimeAsync(0);
    expect(first.visible).toBe(false);
    const second = c.showPhase({ phase: 'enemy', turn: 1 });
    expect(layers()[0].classList.contains('ce-phase-layer--enemy')).toBe(true);
    await vi.advanceTimersByTimeAsync(300 + 800 + 300 + 20);
    expect(second.visible).toBe(false);
    expect(layers()).toHaveLength(0);
  });

  it('defeat band names the fallen commander', () => {
    const c = new CeremonyController(makeScene());
    c.showDefeat({ commanderName: 'Edric' });
    expect(layers()[0].querySelector('.ce-band-sub').textContent).toBe('Edric has fallen');
    c.destroy();
    expect(layers()).toHaveLength(0);
  });
});

describe('CeremonyController — act title and run end', () => {
  it('act card covers the screen; with lines it closes when they end', async () => {
    const c = new CeremonyController(makeScene());
    const card = c.showActCard({ actId: 'act2', withLines: true });
    const layer = layers()[0];
    expect(layer.dataset.frame).toBe('screen');
    expect(layer.classList.contains('has-lines')).toBe(true);
    expect(layer.classList.contains('is-revealing')).toBe(true);
    expect(layer.querySelector('.ce-act-kicker').textContent).toBe('Act II');
    expect(layer.querySelector('.ce-act-title').textContent).toBe('Old Kingdom Roads');
    expect(layer.querySelector('.ce-act-grade').textContent).toBe('Iron Rain');
    await vi.advanceTimersByTimeAsync(1200);
    expect(layer.classList.contains('is-revealing')).toBe(false);
    const closing = card.close();
    await vi.advanceTimersByTimeAsync(500);
    await closing;
    expect(layers()).toHaveLength(0);
  });

  it('without lines it holds its reading window, skippable, blocking meanwhile', async () => {
    const scene = makeScene();
    const c = new CeremonyController(scene);
    const card = c.showActCard({ actId: 'act1', withLines: false });
    let finished = false;
    const done = card.finish().then(() => (finished = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(c.isBlocking()).toBe(true);
    expect(layers()[0].classList.contains('is-blocking')).toBe(true);
    vi.advanceTimersByTime(300);
    dom.key('Enter');
    await vi.advanceTimersByTimeAsync(600);
    await done;
    expect(finished).toBe(true);
    expect(c.isBlocking()).toBe(false);
    expect(layers()).toHaveLength(0);
  });

  it('THE THREAD IS CUT names where and when', () => {
    const c = new CeremonyController(makeScene());
    c.showRunEnd({
      result: 'defeat',
      commander: 'Edric',
      actId: 'act1',
      turn: 9,
      defeatContext: { defeatedBy: 'Iron Captain', wasBoss: true },
    });
    const layer = layers()[0];
    expect(layer.querySelector('.ce-runend-word').textContent).toBe('THE THREAD IS CUT');
    expect(layer.querySelector('.ce-runend-sub').textContent).toBe(
      'Edric fell to the Iron Captain',
    );
    expect(layer.querySelector('.ce-runend-meta').textContent).toBe(
      'Border Marches · Act I · Turn 9',
    );
    c.destroy();
  });
});
