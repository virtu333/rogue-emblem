// Ceremonies wired into the existing controllers: the DOM cut-in keeps the
// combat timing contract, the lord-death decision keeps every contract of
// VisionRewindController while staged as FALLEN, and the victory band's skip
// moves the flow on exactly once.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { BlendModes: { ADD: 1 } } }));
vi.mock('../src/utils/SceneRouter.js', async () => {
  const actual = await vi.importActual('../src/utils/SceneRouter.js');
  return { ...actual, transitionToScene: vi.fn(async () => true), restartScene: vi.fn() };
});
import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';
import { ProcBannerController } from '../src/ui/ProcBannerController.js';
import { VisionRewindController } from '../src/ui/VisionRewindController.js';
import { PostCombatController } from '../src/ui/PostCombatController.js';
import { CeremonyController } from '../src/ui/CeremonyController.js';
import { _resetInputFocus, dispatchInputAction } from '../src/utils/inputFocus.js';
import { InputAction } from '../src/utils/InputActions.js';

const gameData = loadGameData();

function emitter() {
  const map = new Map();
  const set = (name) => map.get(name) || map.set(name, new Set()).get(name);
  return {
    on: (name, fn) => set(name).add(fn),
    once: (name, fn) => set(name).add(fn),
    off: (name, fn) => set(name).delete(fn),
    emit: (name) => {
      const fns = [...set(name)];
      set(name).clear();
      fns.forEach((fn) => fn());
    },
  };
}

let dom;
beforeEach(() => {
  dom = installFakeDom(vi);
  _resetInputFocus();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  _resetInputFocus();
});

describe('DOM critical / weapon-art cut-in', () => {
  function cutScene({ speed = 'normal', reduce = false, quality = 'high' } = {}) {
    const scene = {
      gameData,
      textures: { exists: () => false },
      time: { now: 10000 },
      game: { canvas: dom.canvas },
      _reduceMotion: () => reduce,
      _effectsQuality: () => quality,
      registry: { get: () => ({ getBattleSpeed: () => speed }) },
      events: emitter(),
      add: { text: vi.fn(), rectangle: vi.fn(), container: vi.fn(), image: vi.fn() },
      seen: [],
    };
    scene._awaitSceneTween = vi.fn(async (config, opts) => {
      scene.seen.push({
        label: opts.label,
        duration: config.duration,
        layers: dom.doc.querySelectorAll('.ce-cutin-layer').length,
      });
      for (const [key, value] of Object.entries(config))
        if (typeof value === 'number' && key in config.targets) config.targets[key] = value;
      config.onUpdate?.();
      config.onComplete?.();
    });
    scene._awaitSceneDelay = vi.fn(async (ms, opts) => {
      scene.seen.push({ label: opts.label, duration: ms });
    });
    return scene;
  }
  const edric = {
    name: 'Edric',
    faction: 'player',
    isLord: true,
    weapon: { name: 'Rapier' },
  };

  it('runs on the same awaited labels and durations as the canvas strip', async () => {
    const scene = cutScene();
    const banner = new ProcBannerController(scene);
    const shown = banner.showCutIn({
      unit: edric,
      unitName: 'Edric',
      weaponName: 'Rapier',
      label: 'CRITICAL HIT',
      category: 'offense',
      side: 'left',
    });
    const layer = dom.doc.querySelector('.ce-cutin-layer');
    expect(layer.querySelector('.ce-cutin-big').textContent).toBe('CRITICAL');
    expect(layer.querySelector('.ce-cutin-small').textContent).toBe('EDRIC · RAPIER');
    expect(layer.classList.contains('is-blocking')).toBe(false);
    await shown;
    expect(scene.seen.map(({ label, duration }) => [label, duration])).toEqual([
      ['proc_cutin_in', 140],
      ['proc_cutin_hold', 240],
      ['proc_cutin_out', 140],
    ]);
    // Visible through the whole hold; gone afterwards.
    expect(scene.seen[0].layers).toBe(1);
    expect(dom.doc.querySelector('.ce-cutin-layer')).toBeNull();
    expect(scene.add.text).not.toHaveBeenCalled();
  });

  it('reduced motion and low quality stay static on the same timeline', async () => {
    for (const opts of [{ reduce: true }, { quality: 'low' }]) {
      const scene = cutScene(opts);
      await new ProcBannerController(scene).showCutIn({
        unit: edric,
        label: 'CRITICAL HIT',
        category: 'offense',
        side: 'left',
      });
      expect(scene.seen.map((s) => s.duration)).toEqual([0, 240, 0]);
    }
  });

  it('Instant speed skips the cut-in entirely', async () => {
    const scene = cutScene({ speed: 'instant' });
    await new ProcBannerController(scene).showCutIn({
      unit: edric,
      label: 'CRITICAL HIT',
      category: 'offense',
      side: 'left',
    });
    expect(scene.seen).toEqual([]);
    expect(dom.doc.querySelector('.ce-cutin-layer')).toBeNull();
  });

  it('keeps the throttle and mirrors enemy cut-ins; weapon arts show their name', async () => {
    const scene = cutScene();
    const banner = new ProcBannerController(scene);
    await banner.showCutIn({
      unit: edric,
      label: 'Galeforce Assault',
      category: 'art',
      side: 'left',
    });
    expect(scene.seen).toHaveLength(3);
    await banner.showCutIn({
      unit: edric,
      label: 'CRITICAL HIT',
      category: 'offense',
      side: 'left',
    });
    expect(scene.seen).toHaveLength(3); // throttled
    scene.time.now += 2000;
    let layerClass = '';
    scene._awaitSceneDelay = vi.fn(async () => {
      layerClass = dom.doc.querySelector('.ce-cutin-layer').className;
    });
    await banner.showCutIn({
      unit: { name: 'Fighter', faction: 'enemy', weapon: { name: 'Iron Axe' } },
      label: 'CRITICAL HIT',
      category: 'offense',
      side: 'right',
    });
    expect(layerClass).toContain('ce-cutin-layer--enemy');
  });

  it('destroy() mid-hold removes the strip (scene shutdown)', async () => {
    const scene = cutScene();
    const banner = new ProcBannerController(scene);
    let release;
    scene._awaitSceneDelay = vi.fn(() => new Promise((r) => (release = r)));
    const shown = banner.showCutIn({ unit: edric, label: 'CRITICAL HIT', side: 'left' });
    await Promise.resolve();
    await Promise.resolve();
    expect(dom.doc.querySelector('.ce-cutin-layer')).not.toBeNull();
    banner.destroy();
    expect(dom.doc.querySelector('.ce-cutin-layer')).toBeNull();
    release();
    await shown;
    expect(dom.win.listenerCount('resize')).toBe(0);
  });
});

describe('lord falls: FALLEN band + Sera offer over the unchanged decision', () => {
  function fateScene() {
    const hudHost = dom.doc.createElement('aside');
    hudHost.className = 'mobile-battle-hud';
    dom.host.append(hudHost);
    const scene = {
      gameData,
      events: emitter(),
      battleState: 'PLAYER_IDLE',
      visionSnapshot: { id: 'anchor' },
      visionDialog: null,
      playerUnits: [{ name: 'Sera', className: 'Light Sage', isLord: true, faction: 'player' }],
      escapedUnits: [],
      _fallenCommander: { name: 'Edric', className: 'Lord' },
      textures: { exists: () => false },
      game: { canvas: dom.canvas },
      refreshEndTurnControl: vi.fn(),
      onDefeat: vi.fn(),
      _reduceMotion: () => false,
    };
    const runManager = {
      roster: [{ name: 'Edric' }, { name: 'Sera' }],
      visionChargesRemaining: 1,
    };
    const controller = new VisionRewindController(scene, runManager);
    return { scene, controller, hudHost };
  }

  it("stages the decision as FALLEN with name · class and Sera's offer", () => {
    const { scene, controller, hudHost } = fateScene();
    expect(controller.showLordDeathPrompt()).toBe(true);
    const fate = dom.doc.querySelector('.ce-fate');
    expect(fate.getAttribute('aria-label')).toBe("Sera's vision fractures!");
    expect(fate.querySelector('.ce-band-word').textContent).toBe('FALLEN');
    expect(fate.querySelector('.ce-band-sub').textContent).toBe('Edric · Lord');
    expect(fate.querySelector('.ce-offer-line').textContent).toContain('once more');
    const labels = fate.querySelectorAll('button').map((b) => b.textContent);
    expect(labels).toEqual(['Rewind · 1 left', 'Accept fate']);
    // Primary focused; the rail stays in view but cannot be reached.
    expect(dom.doc.activeElement.textContent).toBe('Rewind · 1 left');
    expect(hudHost.inert).toBe(true);
    expect(scene.battleState).toBe('PAUSED');
    // Framed on the map (622 px beside the rail in an 844 px viewport): the
    // frame's distance from each screen edge feeds the band's safe insets.
    expect(fate.style.getPropertyValue('--ce-frame-l')).toBe('0px');
    expect(fate.style.getPropertyValue('--ce-frame-r')).toBe('222px');
  });

  it('Accept fate settles defeat exactly once and releases everything', () => {
    const { scene, controller, hudHost } = fateScene();
    controller.showLordDeathPrompt();
    const accept = dom.doc.querySelector('.ce-fate').querySelectorAll('button')[1];
    accept.click();
    accept.click();
    expect(scene.onDefeat).toHaveBeenCalledTimes(1);
    expect(scene.visionDialog).toBeNull();
    expect(dom.doc.querySelector('.ce-fate')).toBeNull();
    expect(hudHost.inert).toBe(false);
    expect(dom.win.listenerCount('resize')).toBe(0);
  });

  it('Escape and shield taps never accept fate: the decision is not dismissible', () => {
    const { scene, controller } = fateScene();
    controller.showLordDeathPrompt();
    const root = dom.doc.querySelector('.ce-fate');
    root.dispatchEvent(new dom.FakeEvent('keydown', { key: 'Escape' }));
    dispatchInputAction(InputAction.CANCEL);
    controller.dismissDialog();
    expect(scene.onDefeat).not.toHaveBeenCalled();
    expect(scene.visionDialog).not.toBeNull();
    // The header close slot is gone; Accept fate stays reachable in the offer row.
    const labels = root.querySelectorAll('button').map((b) => b.textContent);
    expect(labels).toEqual(['Rewind · 1 left', 'Accept fate']);
    const row = root.querySelector('.ce-offer-actions').querySelectorAll('button');
    expect(row.map((b) => b.dataset.visionAction)).toEqual(['confirm', 'cancel']);
  });

  it('after a reload the band still names the fallen commander', () => {
    const { controller, scene } = fateScene();
    scene._fallenCommander = null;
    scene._battleCommanderName = 'Edric';
    controller.runManager.roster = [
      { name: 'Edric', className: 'Lord' },
      { name: 'Sera', className: 'Light Sage' },
    ];
    controller.showLordDeathPrompt();
    const fate = dom.doc.querySelector('.ce-fate');
    expect(fate.querySelector('.ce-band-sub').textContent).toBe('Edric · Lord');
  });

  it('Rewind confirms once through the same path (gamepad confirm activates focus)', () => {
    const { scene, controller } = fateScene();
    const rewind = vi.spyOn(controller, 'executeRewind').mockReturnValue(true);
    controller.showLordDeathPrompt();
    dispatchInputAction(InputAction.CONFIRM);
    dispatchInputAction(InputAction.CONFIRM);
    expect(rewind).toHaveBeenCalledTimes(1);
    expect(scene.onDefeat).not.toHaveBeenCalled();
    expect(scene.visionDialog).toBeNull();
  });

  it('without Sera the offer is generic and has no portrait', () => {
    const { scene, controller } = fateScene();
    scene.playerUnits = [];
    controller.runManager.roster = [{ name: 'Kira' }, { name: 'Voss' }];
    scene._fallenCommander = { name: 'Kira', className: 'Tactician' };
    controller.showLordDeathPrompt();
    const fate = dom.doc.querySelector('.ce-fate');
    expect(fate.getAttribute('aria-label')).toBe('A vision fractures!');
    expect(fate.querySelector('.ce-band-sub').textContent).toBe('Kira · Tactician');
    expect(fate.querySelector('.ce-offer-face')).toBeNull();
    expect(fate.querySelector('.ce-offer-line').textContent).toContain('A vision fractures');
  });

  it('other vision dialogs are not staged', () => {
    const { controller } = fateScene();
    controller.showDialog({
      title: 'Rewind was not saved',
      body: 'Try again',
      confirmLabel: 'Retry',
      cancelLabel: 'Cancel',
      onConfirm: () => {},
      onCancel: () => {},
    });
    expect(dom.doc.querySelector('.ce-fate')).toBeNull();
  });
});

describe('victory band', () => {
  function victoryScene() {
    const delayed = [];
    const scene = {
      gameData,
      events: emitter(),
      battleState: 'PLAYER_IDLE',
      battleParams: { tutorialMode: false, act: 'act1' },
      battleConfig: { objective: 'rout' },
      turnManager: { turnNumber: 7 },
      turnPar: 8,
      turnBonusConfig: {
        brackets: [
          { threshold: 0, rating: 'S', bonusMultiplier: 1 },
          { threshold: Infinity, rating: 'C', bonusMultiplier: 0 },
        ],
      },
      registry: { get: () => null },
      scene: { isActive: () => true },
      time: {
        delayedCall: vi.fn((ms, cb) => {
          const entry = { ms, cb, removed: false, remove: vi.fn(() => (entry.removed = true)) };
          delayed.push(entry);
          return entry;
        }),
      },
      add: { text: vi.fn() },
      _pinToScreen: vi.fn(),
      playerUnits: [],
      nonDeployedUnits: [],
      runManager: null,
      _tutorialController: { recordCompletion: vi.fn() },
      _transitionTutorialToTitle: vi.fn(),
    };
    scene._getCeremonies = () => (scene._ceremonies ||= new CeremonyController(scene));
    return { scene, delayed };
  }

  it('shows the objective word with turn · par · rank; no canvas text', () => {
    const { scene } = victoryScene();
    new PostCombatController(scene).onVictory();
    const band = dom.doc.querySelector('.ce-band-layer--victory');
    expect(band.querySelector('.ce-band-word').textContent).toBe('ROUTED');
    expect(band.querySelector('.ce-band-sub').textContent).toBe('Turn 7 · Par 8 · Rank S');
    expect(scene.add.text).not.toHaveBeenCalled();
    expect(typeof scene._victoryBanner.destroy).toBe('function');
  });

  it('tapping moves the victory flow on once; the timer then does nothing', async () => {
    vi.useFakeTimers();
    const { scene, delayed } = victoryScene();
    scene.runManager = null;
    // Standalone branch uses its own restart timer; use the tutorial branch to
    // observe the shared continuation.
    scene.battleParams.tutorialMode = true;
    const hints = await import('../src/ui/HintDisplay.js');
    const important = vi.spyOn(hints, 'showImportantHint').mockResolvedValue();
    new PostCombatController(scene).onVictory();
    const continuation = delayed.find((d) => d.ms === 1500);
    expect(continuation).toBeTruthy();
    vi.advanceTimersByTime(250);
    const band = dom.doc.querySelector('.ce-band-layer--victory');
    band.dispatchEvent(new dom.FakeEvent('pointerdown', { button: 0 }));
    expect(continuation.remove).toHaveBeenCalled();
    continuation.cb();
    await vi.advanceTimersByTimeAsync(400);
    expect(important).toHaveBeenCalledTimes(1);
    expect(scene._transitionTutorialToTitle).toHaveBeenCalledTimes(1);
    expect(dom.doc.querySelector('.ce-band-layer--victory')).toBeNull();
    important.mockRestore();
  });
});
