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

  function fakeScene({ checkpoint = true } = {}) {
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
      mobileCameraEnabled: true,
      battleState: 'PLAYER_IDLE',
      battleParams: { act: 'act1' },
      turnManager: { currentPhase: 'player' },
      playerUnits: [],
      runManager: rm,
      gameData: { id: 'data' },
      input: { enabled: true },
      sys: { settings: { key: 'Battle' } },
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
    expect(c.locked).toBe(true);
    expect(scene.scene.restart).not.toHaveBeenCalled();
  });

  it('keeps playing when the save advances in memory but cannot be written', () => {
    viewport(390, 844);
    const scene = fakeScene();
    const rm = scene.runManager;
    // captureCheckpoint sets the in-memory checkpoint before persisting, then
    // reports the failed write (quota, private mode) by returning false.
    scene._battleSuspendController.captureCheckpoint = vi.fn(() => {
      rm.battleInProgress.checkpoint = { checkpointIndex: 4 };
      return false;
    });
    const c = controller(scene);
    viewport(844, 390);
    expect(c.check()).toBe(false);
    expect(c.locked).toBe(true);
    expect(c.switching).toBe(false);
    expect(scene.scene.restart).not.toHaveBeenCalled();
    // Locked: later frames do not retry the write.
    c.update();
    expect(scene._battleSuspendController.captureCheckpoint).toHaveBeenCalledTimes(1);
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
