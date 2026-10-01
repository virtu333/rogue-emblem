import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PORTRAIT_BATTLE_STORAGE_KEY,
  applyPortraitQuery,
  canSwitchBattlePresentation,
  getPortraitBattlePreference,
  isLandscapeLockedShell,
  isPhoneSized,
  isPortraitSize,
  PHONE_MAX_SHORT_SIDE,
  portraitBattlesAvailable,
  portraitDefault,
  portraitBattlesEnabled,
  portraitQueryOverride,
  setPortraitBattlePreference,
  showPortraitBattleSetting,
  storedPortraitChoice,
  PORTRAIT_UI_CHANGE_EVENT,
  installPortraitUi,
  portraitUiActive,
  wantsPortraitBattle,
} from '../src/utils/portraitBattle.js';
import { battleCanvasSize, uiBand } from '../src/ui/BattlefieldLab.js';
import { PortraitBattleController } from '../src/ui/PortraitBattleController.js';
import { pushInputScope, _resetInputFocus } from '../src/utils/inputFocus.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

const coarse = (on) => (query) => ({ matches: query === '(pointer: coarse)' ? on : false });

describe('portrait battle preference', () => {
  it('parses ?portrait= links', () => {
    expect(portraitQueryOverride('?portrait=1')).toBe(true);
    expect(portraitQueryOverride('?a=b&portrait=on')).toBe(true);
    expect(portraitQueryOverride('?portrait=0')).toBe(false);
    expect(portraitQueryOverride('?portrait=off')).toBe(false);
    expect(portraitQueryOverride('?portrait=maybe')).toBeNull();
    expect(portraitQueryOverride('')).toBeNull();
  });

  it('is off by default without a touch phone, device-local, and set by a link', () => {
    const env = { localStorage: memoryStorage(), location: { search: '' } };
    expect(getPortraitBattlePreference(env)).toBe(false);
    env.location.search = '?portrait=1';
    expect(applyPortraitQuery(env)).toBe(true);
    expect(env.localStorage.getItem(PORTRAIT_BATTLE_STORAGE_KEY)).toBe('on');
    env.location.search = '';
    expect(applyPortraitQuery(env)).toBe(true); // persists without the link
    expect(setPortraitBattlePreference(false, env)).toBe(true);
    expect(getPortraitBattlePreference(env)).toBe(false);
  });

  it('is on by default on a touch phone, and ?portrait=0 turns it off for good', () => {
    const env = {
      localStorage: memoryStorage(),
      location: { search: '' },
      screen: { width: 390, height: 844 },
      matchMedia: coarse(true),
    };
    expect(storedPortraitChoice(env)).toBeNull();
    expect(getPortraitBattlePreference(env)).toBe(true);
    expect(applyPortraitQuery(env)).toBe(true); // no link: nothing stored
    expect(env.localStorage.getItem(PORTRAIT_BATTLE_STORAGE_KEY)).toBeNull();
    env.location.search = '?portrait=0';
    expect(applyPortraitQuery(env)).toBe(false);
    // Off is stored, not cleared: clearing would fall back to the phone's default (on).
    expect(env.localStorage.getItem(PORTRAIT_BATTLE_STORAGE_KEY)).toBe('off');
    env.location.search = '';
    expect(applyPortraitQuery(env)).toBe(false);
    expect(setPortraitBattlePreference(true, env)).toBe(true);
    expect(getPortraitBattlePreference(env)).toBe(true);
  });

  it('defaults off on tablets and desktops, which can still opt in', () => {
    const tablet = { localStorage: memoryStorage(), screen: { width: 820, height: 1180 } };
    tablet.matchMedia = coarse(true);
    expect(getPortraitBattlePreference(tablet)).toBe(false);
    const desktop = { localStorage: memoryStorage(), screen: { width: 390, height: 844 } };
    desktop.matchMedia = coarse(false);
    expect(getPortraitBattlePreference(desktop)).toBe(false);
    setPortraitBattlePreference(true, tablet);
    expect(getPortraitBattlePreference(tablet)).toBe(true);
  });

  it('measures a phone by its screen, whichever way it is held', () => {
    expect(isPhoneSized({ screen: { width: 390, height: 844 } })).toBe(true);
    expect(isPhoneSized({ screen: { width: 932, height: 430 } })).toBe(true);
    expect(isPhoneSized({ screen: { width: 744, height: 1133 } })).toBe(false); // iPad mini
    expect(isPhoneSized({ screen: { width: 1280, height: 800 } })).toBe(false);
    // No screen: the viewport stands in.
    expect(isPhoneSized({ innerWidth: 375, innerHeight: 667 })).toBe(true);
    expect(isPhoneSized({})).toBe(false);
    expect(PHONE_MAX_SHORT_SIDE).toBe(600);
  });

  it('ignores a stored value it does not know (falls back to the default)', () => {
    const env = { localStorage: memoryStorage(), screen: { width: 390, height: 844 } };
    env.matchMedia = coarse(true);
    env.localStorage.setItem(PORTRAIT_BATTLE_STORAGE_KEY, 'maybe');
    expect(storedPortraitChoice(env)).toBeNull();
    expect(getPortraitBattlePreference(env)).toBe(true);
  });

  it('survives blocked storage', () => {
    const env = {
      get localStorage() {
        throw new Error('blocked');
      },
    };
    expect(getPortraitBattlePreference(env)).toBe(false);
    expect(setPortraitBattlePreference(true, env)).toBe(false);
  });

  it('turning it on releases a landscape lock from the rotate prompt', () => {
    const unlock = vi.fn();
    const env = { localStorage: memoryStorage(), screen: { orientation: { unlock } } };
    setPortraitBattlePreference(false, env);
    expect(unlock).not.toHaveBeenCalled();
    setPortraitBattlePreference(true, env);
    expect(unlock).toHaveBeenCalledTimes(1);
  });

  it('announces a change so a live battle can follow it', () => {
    const env = { localStorage: memoryStorage(), dispatchEvent: vi.fn() };
    setPortraitBattlePreference(true, env);
    expect(env.dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('needs the opt-in, the phone layout and an upright viewport', () => {
    expect(isPortraitSize(390, 844)).toBe(true);
    expect(isPortraitSize(844, 390)).toBe(false);
    expect(isPortraitSize(500, 500)).toBe(false);
    expect(wantsPortraitBattle({ enabled: true, phoneLayout: true, portrait: true })).toBe(true);
    expect(wantsPortraitBattle({ enabled: false, phoneLayout: true, portrait: true })).toBe(false);
    expect(wantsPortraitBattle({ enabled: true, phoneLayout: false, portrait: true })).toBe(false);
    expect(wantsPortraitBattle({ enabled: true, phoneLayout: true, portrait: false })).toBe(false);
  });

  it('switches only at a clean player idle boundary of a saved battle', () => {
    const safe = {
      hasRunCheckpoint: true,
      boundary: 'destination',
      phase: 'player',
      battleState: 'PLAYER_IDLE',
      transitioning: false,
      modalOpen: false,
    };
    expect(canSwitchBattlePresentation(safe)).toBe(true);
    for (const [key, value] of [
      ['hasRunCheckpoint', false],
      ['boundary', 'recovery'],
      ['phase', 'enemy'],
      ['battleState', 'UNIT_ACTION_MENU'],
      ['battleState', 'SHOWING_FORECAST'],
      ['transitioning', true],
      ['modalOpen', true],
      ['gestureActive', true],
    ]) {
      expect(canSwitchBattlePresentation({ ...safe, [key]: value })).toBe(false);
    }
    expect(canSwitchBattlePresentation(null)).toBe(false);
  });
});

// The iOS app on an iPad (Info.plist ~ipad: landscape only) can never show an upright
// screen. The iPhone app and the installed web app can.
const nativeApp = () => ({
  nativePromise: () => Promise.resolve(),
  isNativePlatform: () => true,
});
const displayMode = (mode) => (query) => ({ matches: query === `(display-mode: ${mode})` });
const PHONE = { width: 390, height: 844 };
const IPAD = { width: 820, height: 1180 };

describe('landscape-locked shells', () => {
  it('is only the iPad app', () => {
    expect(isLandscapeLockedShell({ Capacitor: nativeApp(), screen: IPAD })).toBe(true);
    expect(isLandscapeLockedShell({ Capacitor: nativeApp(), screen: PHONE })).toBe(false);
  });

  it('leaves browser tabs and installed web apps free', () => {
    for (const mode of ['browser', 'standalone', 'fullscreen', 'minimal-ui'])
      expect(isLandscapeLockedShell({ matchMedia: displayMode(mode), screen: PHONE }), mode).toBe(
        false,
      );
    expect(isLandscapeLockedShell({ navigator: { standalone: true }, screen: PHONE })).toBe(false);
    expect(isLandscapeLockedShell({})).toBe(false);
    const web = { nativePromise: () => Promise.resolve(), isNativePlatform: () => false };
    expect(isLandscapeLockedShell({ Capacitor: web, screen: IPAD })).toBe(false);
  });

  it('shows the Settings toggle on every touch device that can turn upright', () => {
    const fresh = () => ({ localStorage: memoryStorage(), screen: PHONE });
    expect(showPortraitBattleSetting({ mobile: true, env: fresh() })).toBe(true);
    expect(showPortraitBattleSetting({ mobile: false, env: fresh() })).toBe(false); // desktop
    expect(
      showPortraitBattleSetting({
        mobile: true,
        env: { ...fresh(), matchMedia: displayMode('standalone') },
      }),
    ).toBe(true);
    expect(
      showPortraitBattleSetting({ mobile: true, env: { ...fresh(), Capacitor: nativeApp() } }),
    ).toBe(true); // the iPhone app
    expect(
      showPortraitBattleSetting({
        mobile: true,
        env: { localStorage: memoryStorage(), screen: IPAD, Capacitor: nativeApp() },
      }),
    ).toBe(false); // the iPad app
    expect(
      showPortraitBattleSetting({
        mobile: true,
        env: { localStorage: memoryStorage(), screen: IPAD },
      }),
    ).toBe(true); // an iPad browser tab
  });

  it('ignores a stored opt-in in the iPad app and keeps it', () => {
    const localStorage = memoryStorage();
    localStorage.setItem(PORTRAIT_BATTLE_STORAGE_KEY, 'on');
    const app = { localStorage, Capacitor: nativeApp(), screen: IPAD };
    expect(portraitBattlesAvailable(app)).toBe(false);
    expect(portraitBattlesEnabled(app)).toBe(false);
    expect(getPortraitBattlePreference(app)).toBe(true);
    expect(localStorage.getItem(PORTRAIT_BATTLE_STORAGE_KEY)).toBe('on');
    const phoneApp = { localStorage, Capacitor: nativeApp(), screen: PHONE };
    expect(portraitBattlesEnabled(phoneApp)).toBe(true);
  });
});

// A page environment for portrait mode: storage, media queries, viewport and events.
function portraitPage({
  optedIn = true,
  coarse = true,
  width = 390,
  height = 844,
  mode = 'browser',
  app = false,
} = {}) {
  const env = new EventTarget();
  const localStorage = memoryStorage();
  // true / false: the player's choice; null: never chosen (the device default).
  if (optedIn !== null) localStorage.setItem(PORTRAIT_BATTLE_STORAGE_KEY, optedIn ? 'on' : 'off');
  const classes = new Set();
  Object.assign(env, {
    localStorage,
    innerWidth: width,
    innerHeight: height,
    matchMedia: (query) => ({
      matches: query === '(pointer: coarse)' ? coarse : query === `(display-mode: ${mode})`,
    }),
    document: {
      documentElement: {
        classList: {
          contains: (c) => classes.has(c),
          toggle: (c, on) => (on ? classes.add(c) : classes.delete(c), on),
        },
      },
    },
    classes,
  });
  if (app) env.Capacitor = nativeApp();
  return env;
}

describe('portrait mode page class', () => {
  it('is on for a touch phone held upright, unless the player turned it off', () => {
    expect(portraitUiActive(portraitPage())).toBe(true);
    expect(portraitUiActive(portraitPage({ optedIn: null }))).toBe(true); // the default
    expect(portraitUiActive(portraitPage({ optedIn: false }))).toBe(false);
    expect(portraitUiActive(portraitPage({ coarse: false }))).toBe(false); // desktop
    expect(portraitUiActive(portraitPage({ coarse: false, optedIn: true }))).toBe(false);
    expect(portraitUiActive(portraitPage({ width: 844, height: 390 }))).toBe(false);
    expect(portraitUiActive(portraitPage({ mode: 'standalone' }))).toBe(true); // installed
    expect(portraitUiActive(portraitPage({ app: true }))).toBe(true); // the iPhone app
    // The iPad app is locked sideways; an iPad tab starts off and can opt in.
    expect(portraitUiActive(portraitPage({ app: true, width: 820, height: 1180 }))).toBe(false);
    expect(portraitUiActive(portraitPage({ optedIn: null, width: 820, height: 1180 }))).toBe(false);
    expect(portraitUiActive(portraitPage({ width: 820, height: 1180 }))).toBe(true);
  });

  it('follows the phone as it turns and the preference as it changes, and stops on uninstall', () => {
    const env = portraitPage({ width: 844, height: 390 });
    const changes = [];
    env.addEventListener(PORTRAIT_UI_CHANGE_EVENT, (e) => changes.push(e.detail.active));
    const uninstall = installPortraitUi(env);
    expect(env.classes.has('portrait-ui')).toBe(false);
    Object.assign(env, { innerWidth: 390, innerHeight: 844 });
    env.dispatchEvent(new Event('resize'));
    expect(env.classes.has('portrait-ui')).toBe(true);
    env.dispatchEvent(new Event('orientationchange')); // no change: no second event
    setPortraitBattlePreference(false, env); // dispatches the preference event
    expect(env.classes.has('portrait-ui')).toBe(false);
    expect(changes).toEqual([true, false]);
    uninstall();
    setPortraitBattlePreference(true, env);
    expect(env.classes.has('portrait-ui')).toBe(false);
  });
});

describe('phone battle canvas', () => {
  it('keeps the landscape canvas 480 tall (unchanged behavior)', () => {
    expect(battleCanvasSize(622, 390)).toEqual({ portrait: false, width: 766, height: 480 });
  });

  it('keeps a portrait canvas 640 wide with square tiles', () => {
    const size = battleCanvasSize(390, 582);
    expect(size.portrait).toBe(true);
    expect(size.width).toBe(640);
    expect(size.height / size.width).toBeCloseTo(582 / 390, 2);
  });

  it('centers the 640x480 pinned layout on a tall canvas', () => {
    expect(uiBand(640, 928)).toEqual({ y: 224, height: 480 });
    expect(uiBand(640, 480)).toEqual({ y: 0, height: 480 });
    expect(uiBand(1280, 1856, 2)).toEqual({ y: 448, height: 960 });
  });
});

describe('PortraitBattleController', () => {
  let saved;
  beforeEach(() => {
    saved = {
      localStorage: globalThis.localStorage,
      innerWidth: globalThis.innerWidth,
      innerHeight: globalThis.innerHeight,
    };
    globalThis.localStorage = memoryStorage();
    globalThis.localStorage.setItem(PORTRAIT_BATTLE_STORAGE_KEY, 'on');
    _resetInputFocus();
  });
  afterEach(() => {
    globalThis.localStorage = saved.localStorage;
    globalThis.innerWidth = saved.innerWidth;
    globalThis.innerHeight = saved.innerHeight;
    _resetInputFocus();
  });

  function viewport(width, height) {
    globalThis.innerWidth = width;
    globalThis.innerHeight = height;
  }

  function fakeScene({ checkpoint = true, slot = 1 } = {}) {
    const rm = {
      battleInProgress: checkpoint
        ? {
            nodeId: 'n1',
            battleParams: { act: 'act1' },
            checkpoint: { checkpointIndex: 3 },
          }
        : null,
      getRoster: () => ['roster'],
    };
    const scene = {
      _battleSession: 1,
      mobileCameraEnabled: true,
      battleState: 'PLAYER_IDLE',
      battleParams: { act: 'act1' },
      turnManager: { currentPhase: 'player' },
      playerUnits: [],
      runManager: rm,
      gameData: { id: 'data' },
      input: { enabled: true },
      sys: { settings: { key: 'Battle' } },
      registry: { get: (key) => (key === 'activeSlot' ? slot : undefined) },
      scene: { restart: vi.fn() },
      isStoryInputLocked: () => false,
      _battleRewindPolicy: 'fixed-v1',
      _battleSuspendController: {
        captureCheckpoint: vi.fn(() => {
          rm.battleInProgress.checkpoint = { checkpointIndex: 4 };
          return true;
        }),
      },
    };
    pushInputScope(scene, () => {});
    return scene;
  }

  function controller(scene, battleConfig = { cols: 16, playerSpawns: [{ col: 0 }, { col: 1 }] }) {
    const c = new PortraitBattleController(scene);
    c.phoneLayout = () => true;
    c.presentation = c.resolvePresentation(battleConfig);
    return c;
  }

  it('draws an upright board only when the phone is upright', () => {
    viewport(390, 844);
    expect(controller(fakeScene()).presentation).toEqual({ rotation: 'ccw' });
    viewport(844, 390);
    expect(controller(fakeScene()).presentation).toBeNull();
  });

  it('never turns the board with portrait mode off', () => {
    globalThis.localStorage.setItem(PORTRAIT_BATTLE_STORAGE_KEY, 'off');
    viewport(390, 844);
    const c = controller(fakeScene());
    expect(c.presentation).toBeNull();
    expect(c.capable).toBe(false);
  });

  it('never turns the board or hides the rotate prompt in the iPad app, even opted in', () => {
    globalThis.Capacitor = nativeApp();
    globalThis.screen = IPAD;
    try {
      viewport(820, 1180);
      const scene = fakeScene();
      const c = controller(scene);
      expect(c.presentation).toBeNull();
      expect(c.enabled).toBe(false);
      // Not capable: the page class that hides the rotate prompt is never set.
      expect(c.capable).toBe(false);
      expect(c.mismatch()).toBe(false);
      expect(c.check()).toBe(false);
      expect(c.pending).toBe(false);
      expect(c.locked).toBe(false);
      expect(scene._battleSuspendController.captureCheckpoint).not.toHaveBeenCalled();
      expect(scene.scene.restart).not.toHaveBeenCalled();
    } finally {
      delete globalThis.Capacitor;
      delete globalThis.screen;
    }
  });

  for (const [shell, install, remove] of [
    [
      'the iPhone app',
      () => Object.assign(globalThis, { Capacitor: nativeApp(), screen: PHONE }),
      () => (delete globalThis.Capacitor, delete globalThis.screen),
    ],
    [
      'the installed web app',
      () => (globalThis.matchMedia = displayMode('standalone')),
      () => delete globalThis.matchMedia,
    ],
  ]) {
    it(`turns the board upright in ${shell}`, () => {
      install();
      try {
        viewport(390, 844);
        const c = controller(fakeScene());
        expect(c.presentation).toEqual({ rotation: 'ccw' });
        expect(c.enabled).toBe(true);
        expect(c.capable).toBe(true);
      } finally {
        remove();
      }
    });
  }

  it('waits for a finger on the board to lift before it re-opens', () => {
    viewport(390, 844);
    const scene = fakeScene();
    const c = controller(scene);
    viewport(844, 390);
    scene._touchTapDown = { x: 10, y: 10 };
    expect(c.check()).toBe(false);
    expect(c.pending).toBe(true);
    expect(scene._battleSuspendController.captureCheckpoint).not.toHaveBeenCalled();
    scene._touchTapDown = null;
    scene._battleCamera = { hasActiveTouches: () => true }; // a pinch under way
    c.update();
    expect(scene._battleSuspendController.captureCheckpoint).not.toHaveBeenCalled();
    scene._battleCamera = { hasActiveTouches: () => false };
    c.update();
    expect(scene._battleSuspendController.captureCheckpoint).toHaveBeenCalledTimes(1);
  });

  it('re-opens the saved battle in the new orientation at a safe moment', () => {
    viewport(390, 844);
    const scene = fakeScene();
    const c = controller(scene);
    expect(c.check()).toBe(false); // no mismatch yet
    viewport(844, 390);
    expect(c.check()).toBe(true);
    expect(scene._battleSuspendController.captureCheckpoint).toHaveBeenCalledWith({
      preserveRng: true,
    });
    expect(scene.scene.restart).toHaveBeenCalledTimes(1);
    const data = scene.scene.restart.mock.calls[0][0];
    expect(data.resumeCheckpoint).toEqual({ checkpointIndex: 4 });
    expect(data.presentationSwitch).toBe(true);
    expect(data.nodeId).toBe('n1');
    expect(data.roster).toEqual(['roster']);
    expect(scene.input.enabled).toBe(false);
    // A second event during the restart does nothing.
    expect(c.check()).toBe(false);
    expect(scene.scene.restart).toHaveBeenCalledTimes(1);
  });

  it('waits while a unit is mid-action and switches once it is idle', () => {
    viewport(390, 844);
    const scene = fakeScene();
    const c = controller(scene);
    scene.battleState = 'UNIT_ACTION_MENU';
    scene.selectedUnit = { name: 'Edric' };
    viewport(844, 390);
    expect(c.check()).toBe(false);
    expect(c.pending).toBe(true);
    c.update();
    expect(scene.scene.restart).not.toHaveBeenCalled();
    scene.battleState = 'PLAYER_IDLE';
    scene.selectedUnit = null;
    c.update();
    expect(scene.scene.restart).toHaveBeenCalledTimes(1);
  });

  it('waits while an overlay owns input', () => {
    viewport(390, 844);
    const scene = fakeScene();
    const c = controller(scene);
    const overlay = {};
    pushInputScope(overlay, () => {});
    viewport(844, 390);
    expect(c.check()).toBe(false);
    expect(scene.scene.restart).not.toHaveBeenCalled();
  });

  it('keeps the board of a battle without a run save (tutorial)', () => {
    viewport(390, 844);
    const scene = fakeScene({ checkpoint: false });
    const c = controller(scene);
    viewport(844, 390);
    expect(c.check()).toBe(false);
    expect(c.locked).toBe(true);
    c.update();
    expect(scene.scene.restart).not.toHaveBeenCalled();
  });

  it('keeps playing when the save point cannot be refreshed', () => {
    viewport(390, 844);
    const scene = fakeScene();
    scene._battleSuspendController.captureCheckpoint = vi.fn(() => false);
    const c = controller(scene);
    viewport(844, 390);
    expect(c.check()).toBe(false);
    expect(c.rotated).toBe(true);
    expect(c.switching).toBe(false);
    expect(scene.input.enabled).toBe(true);
    expect(scene.scene.restart).not.toHaveBeenCalled();
  });

  // A failed write (storage full, private mode, a transient error) keeps the board and
  // the battle playable, never retries on its own every frame, and never needs a
  // refresh: the player's next request (turning the phone, the Settings toggle) retries.
  function failingWrites(scene) {
    const rm = scene.runManager;
    const io = { writable: false };
    // captureCheckpoint sets the in-memory checkpoint before persisting, then
    // reports the failed write by returning false.
    scene._battleSuspendController.captureCheckpoint = vi.fn(() => {
      const index = rm.battleInProgress.checkpoint.checkpointIndex + 1;
      rm.battleInProgress.checkpoint = { checkpointIndex: index };
      return io.writable;
    });
    return io;
  }

  it('keeps playing when the save advances in memory but cannot be written', () => {
    viewport(390, 844);
    const scene = fakeScene();
    failingWrites(scene);
    const capture = scene._battleSuspendController.captureCheckpoint;
    const c = controller(scene);
    viewport(844, 390);
    expect(c.check()).toBe(false);
    expect(c.switching).toBe(false);
    expect(c.pending).toBe(false);
    expect(scene.input.enabled).toBe(true);
    expect(scene.scene.restart).not.toHaveBeenCalled();
    // Later frames and resize events of the same request do not retry the write.
    c.update();
    c.check();
    c.update();
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('retries a failed switch when the phone turns again, without a refresh', () => {
    viewport(390, 844);
    const scene = fakeScene();
    const io = failingWrites(scene);
    const capture = scene._battleSuspendController.captureCheckpoint;
    const c = controller(scene);
    viewport(844, 390);
    expect(c.check()).toBe(false);
    expect(capture).toHaveBeenCalledTimes(1);
    // Upright again: the board already matches, nothing to save.
    viewport(390, 844);
    expect(c.check()).toBe(false);
    expect(capture).toHaveBeenCalledTimes(1);
    // Storage recovered; turning the phone again re-opens the battle sideways.
    io.writable = true;
    viewport(844, 390);
    expect(c.check()).toBe(true);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(scene.scene.restart).toHaveBeenCalledTimes(1);
    expect(scene.scene.restart.mock.calls[0][0].resumeCheckpoint).toEqual({ checkpointIndex: 5 });
  });

  it('retries a failed switch when the preference changes', () => {
    viewport(390, 844);
    const scene = fakeScene();
    const io = failingWrites(scene);
    const capture = scene._battleSuspendController.captureCheckpoint;
    const c = controller(scene);
    viewport(844, 390);
    expect(c.check()).toBe(false);
    c.update();
    expect(capture).toHaveBeenCalledTimes(1);
    // Still sideways, portrait mode switched off in Settings: a new request, so one
    // more try (the board still has to turn back), which now succeeds.
    io.writable = true;
    globalThis.localStorage.setItem(PORTRAIT_BATTLE_STORAGE_KEY, 'off');
    c._refreshEnabled();
    expect(c.check()).toBe(true);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(scene.scene.restart).toHaveBeenCalledTimes(1);
  });

  it('keeps the board of a battle without a save slot, without trying to save', () => {
    viewport(390, 844);
    const scene = fakeScene({ slot: null });
    const c = controller(scene);
    viewport(844, 390);
    expect(c.check()).toBe(false);
    expect(c.locked).toBe(true);
    // Locked for good: turning back and again changes nothing.
    viewport(390, 844);
    c.check();
    viewport(844, 390);
    c.check();
    c.update();
    expect(scene._battleSuspendController.captureCheckpoint).not.toHaveBeenCalled();
    expect(scene.scene.restart).not.toHaveBeenCalled();
  });

  it('keeps the board of a battle begun under the legacy reseed-per-save policy', () => {
    viewport(390, 844);
    const scene = fakeScene();
    scene._battleRewindPolicy = 'legacy-v1';
    const c = controller(scene);
    viewport(844, 390);
    expect(c.check()).toBe(false);
    expect(c.locked).toBe(true);
    expect(scene._battleSuspendController.captureCheckpoint).not.toHaveBeenCalled();
  });

  it('turns an upright board back when portrait battles are switched off', () => {
    viewport(390, 844);
    const scene = fakeScene();
    const c = controller(scene);
    globalThis.localStorage.removeItem(PORTRAIT_BATTLE_STORAGE_KEY);
    c._refreshEnabled();
    expect(c.capable).toBe(true); // the upright layout stays until the board turns back
    expect(c.check()).toBe(true);
    expect(scene.scene.restart).toHaveBeenCalledTimes(1);
  });

  it('stops following the phone once the battle ends', () => {
    viewport(390, 844);
    const scene = fakeScene();
    const c = controller(scene);
    scene.battleState = 'BATTLE_END';
    c.update();
    expect(c.ended).toBe(true);
    viewport(844, 390);
    expect(c.check()).toBe(false);
    expect(scene.scene.restart).not.toHaveBeenCalled();
  });
});

// Portrait mode ships on by default on phones. The stored preference is 'on', 'off' or
// nothing (the device default), and only the player's explicit choices are ever stored.
describe('portrait mode preference: links, defaults and the Settings toggle', () => {
  // A storage that records every write and removal.
  function recordingStorage() {
    const store = memoryStorage();
    const log = [];
    return {
      log,
      getItem: store.getItem,
      setItem: (k, v) => (log.push(['set', k, v]), store.setItem(k, v)),
      removeItem: (k) => (log.push(['remove', k]), store.removeItem(k)),
    };
  }
  const device = ({ screen = { width: 390, height: 844 }, coarse: touch = true, search = '' }) => ({
    localStorage: recordingStorage(),
    location: { search },
    screen,
    matchMedia: coarse(touch),
  });

  for (const [search, stored, on] of [
    ['?portrait=0', 'off', false],
    ['?portrait=off', 'off', false],
    ['?portrait=FALSE', 'off', false],
    ['?portrait=no', 'off', false],
    ['?portrait=1', 'on', true],
    ['?portrait=%20On%20', 'on', true],
    ['?portrait=true', 'on', true],
    ['?portrait=yes', 'on', true],
  ]) {
    it(`${search} stores '${stored}' on a phone and a desktop, and it outlives the link`, () => {
      for (const env of [device({ search }), device({ search, coarse: false })]) {
        expect(applyPortraitQuery(env)).toBe(on);
        expect(env.localStorage.getItem(PORTRAIT_BATTLE_STORAGE_KEY)).toBe(stored);
        env.location.search = '';
        expect(applyPortraitQuery(env)).toBe(on);
        expect(getPortraitBattlePreference(env)).toBe(on);
        expect(env.localStorage.log.filter(([op]) => op === 'remove')).toEqual([]);
      }
    });
  }

  it('an explicit ?portrait=1 is stored even where it matches the default', () => {
    // A phone is on by default; the link still records the choice, so a later
    // change of default (or a new screen) cannot undo what the player asked for.
    const env = device({ search: '?portrait=1' });
    expect(getPortraitBattlePreference(env)).toBe(true);
    applyPortraitQuery(env);
    expect(storedPortraitChoice(env)).toBe(true);
  });

  it('an unknown ?portrait= value changes nothing, stored or not', () => {
    const fresh = device({ search: '?portrait=sideways' });
    expect(applyPortraitQuery(fresh)).toBe(true); // the phone default
    expect(fresh.localStorage.log).toEqual([]);
    const off = device({ search: '?portrait=' });
    off.localStorage.setItem(PORTRAIT_BATTLE_STORAGE_KEY, 'off');
    expect(applyPortraitQuery(off)).toBe(false);
    expect(off.localStorage.getItem(PORTRAIT_BATTLE_STORAGE_KEY)).toBe('off');
  });

  it('unset follows the device: a touch screen whose short side is under 600 px', () => {
    const cases = [
      [{ width: 375, height: 667 }, true, true], // iPhone SE
      [{ width: 430, height: 932 }, true, true], // iPhone Pro Max
      [{ width: 932, height: 430 }, true, true], // the same phone, screen read sideways
      [{ width: 599, height: 900 }, true, true], // just under the line
      [{ width: 600, height: 960 }, true, false], // the line itself: a tablet
      [{ width: 744, height: 1133 }, true, false], // iPad mini
      [{ width: 1024, height: 1366 }, true, false], // iPad Pro
      [{ width: 390, height: 844 }, false, false], // a small window with a mouse
      [{ width: 1280, height: 800 }, false, false], // desktop
    ];
    for (const [screen, touch, on] of cases) {
      const env = device({ screen, coarse: touch });
      expect(storedPortraitChoice(env), JSON.stringify(screen)).toBeNull();
      expect(portraitDefault(env), `${JSON.stringify(screen)} touch=${touch}`).toBe(on);
      expect(getPortraitBattlePreference(env)).toBe(on);
      expect(env.localStorage.log).toEqual([]); // reading the default stores nothing
    }
  });

  it('the Settings toggle stores off and on, and never deletes the choice', () => {
    // SettingsMenu's toggle: write(!read()) with the preference's getter and setter.
    const env = device({});
    const tap = () => setPortraitBattlePreference(!getPortraitBattlePreference(env), env);
    expect(getPortraitBattlePreference(env)).toBe(true); // default on a phone
    tap();
    expect(env.localStorage.getItem(PORTRAIT_BATTLE_STORAGE_KEY)).toBe('off');
    expect(getPortraitBattlePreference(env)).toBe(false); // off holds against the default
    tap();
    expect(env.localStorage.getItem(PORTRAIT_BATTLE_STORAGE_KEY)).toBe('on');
    tap();
    expect(env.localStorage.log).toEqual([
      ['set', PORTRAIT_BATTLE_STORAGE_KEY, 'off'],
      ['set', PORTRAIT_BATTLE_STORAGE_KEY, 'on'],
      ['set', PORTRAIT_BATTLE_STORAGE_KEY, 'off'],
    ]);
    // A tablet (default off) stores its opt-in the same way.
    const tablet = device({ screen: { width: 820, height: 1180 } });
    setPortraitBattlePreference(!getPortraitBattlePreference(tablet), tablet);
    expect(tablet.localStorage.getItem(PORTRAIT_BATTLE_STORAGE_KEY)).toBe('on');
  });
});

// The rotate prompt (index.html) shows on a touch screen held upright unless
// portrait-ui (or an upright-capable battle) hides it (portraitBattle.css), so it
// shows exactly where portrait mode is not active on an upright touch screen.
describe('where portrait mode is active, and so where the rotate prompt shows', () => {
  const cases = [
    // [label, page options, portrait mode active upright]
    ['a phone tab, never chosen (the default)', { optedIn: null }, true],
    ['a phone tab, turned off', { optedIn: false }, false],
    ['a phone tab, turned on', { optedIn: true }, true],
    ['the iPhone app, never chosen', { optedIn: null, app: true }, true],
    ['the iPhone app, turned off', { optedIn: false, app: true }, false],
    ['the installed web app on a phone', { optedIn: null, mode: 'standalone' }, true],
    ['an iPad tab, never chosen', { optedIn: null, width: 820, height: 1180 }, false],
    ['an iPad tab, turned on', { optedIn: true, width: 820, height: 1180 }, true],
    ['the iPad app, turned on', { optedIn: true, app: true, width: 820, height: 1180 }, false],
    ['the iPad app, never chosen', { optedIn: null, app: true, width: 820, height: 1180 }, false],
    ['a desktop, turned on', { optedIn: true, coarse: false }, false],
  ];
  // portraitPage has no `screen`: the viewport stands in for it, as on a page whose
  // screen object is missing. Upright is width < height.
  for (const [label, options, active] of cases) {
    it(`${label}: ${active ? 'upright, no prompt' : 'the prompt asks for landscape'}`, () => {
      const env = portraitPage(options);
      expect(portraitUiActive(env)).toBe(active);
      // The same page held sideways is never in portrait mode (and needs no prompt).
      const sideways = portraitPage({
        ...options,
        width: options.height ?? 844,
        height: options.width ?? 390,
      });
      expect(portraitUiActive(sideways)).toBe(false);
    });
  }

  it('the iPad app is the only landscape-locked shell', () => {
    const shells = [
      ['browser tab (phone)', { screen: PHONE }, false],
      ['browser tab (iPad)', { screen: IPAD }, false],
      [
        'installed web app (phone)',
        { screen: PHONE, matchMedia: displayMode('standalone') },
        false,
      ],
      ['installed web app (iPad)', { screen: IPAD, matchMedia: displayMode('standalone') }, false],
      ['iPhone app upright', { screen: PHONE, Capacitor: nativeApp() }, false],
      [
        'iPhone app sideways',
        { screen: { width: 844, height: 390 }, Capacitor: nativeApp() },
        false,
      ],
      ['iPad app', { screen: IPAD, Capacitor: nativeApp() }, true],
      ['iPad app sideways', { screen: { width: 1180, height: 820 }, Capacitor: nativeApp() }, true],
    ];
    for (const [label, env, locked] of shells) {
      expect(isLandscapeLockedShell(env), label).toBe(locked);
      expect(portraitBattlesAvailable(env), label).toBe(!locked);
      expect(showPortraitBattleSetting({ mobile: true, env }), label).toBe(!locked);
    }
  });
});
