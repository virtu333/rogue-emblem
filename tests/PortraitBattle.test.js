import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PORTRAIT_BATTLE_STORAGE_KEY,
  applyPortraitQuery,
  canSwitchBattlePresentation,
  getPortraitBattlePreference,
  isLandscapeLockedShell,
  isPortraitSize,
  portraitBattlesAvailable,
  portraitBattlesEnabled,
  portraitQueryOverride,
  setPortraitBattlePreference,
  showPortraitBattleSetting,
  syncRotatePromptCopy,
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

describe('portrait battle preference', () => {
  it('parses ?portrait= links', () => {
    expect(portraitQueryOverride('?portrait=1')).toBe(true);
    expect(portraitQueryOverride('?a=b&portrait=on')).toBe(true);
    expect(portraitQueryOverride('?portrait=0')).toBe(false);
    expect(portraitQueryOverride('?portrait=off')).toBe(false);
    expect(portraitQueryOverride('?portrait=maybe')).toBeNull();
    expect(portraitQueryOverride('')).toBeNull();
  });

  it('is off by default, device-local, and set by a link', () => {
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

  it('survives blocked storage', () => {
    const env = {
      get localStorage() {
        throw new Error('blocked');
      },
    };
    expect(getPortraitBattlePreference(env)).toBe(false);
    expect(setPortraitBattlePreference(true, env)).toBe(false);
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
    ]) {
      expect(canSwitchBattlePresentation({ ...safe, [key]: value })).toBe(false);
    }
    expect(canSwitchBattlePresentation(null)).toBe(false);
  });
});

// The iOS app (Info.plist: landscape only) and the installed web app (manifest:
// landscape) can never show an upright battle.
const nativeApp = () => ({
  nativePromise: () => Promise.resolve(),
  isNativePlatform: () => true,
});
const displayMode = (mode) => (query) => ({ matches: query === `(display-mode: ${mode})` });

describe('landscape-locked shells', () => {
  it('recognises the iOS app, installed web apps and a fullscreen-locked tab', () => {
    expect(isLandscapeLockedShell({ Capacitor: nativeApp() })).toBe(true);
    expect(isLandscapeLockedShell({ navigator: { standalone: true } })).toBe(true);
    for (const mode of ['standalone', 'fullscreen', 'minimal-ui'])
      expect(isLandscapeLockedShell({ matchMedia: displayMode(mode) }), mode).toBe(true);
  });

  it('leaves a browser tab free, including the web build that bundles Capacitor', () => {
    expect(isLandscapeLockedShell({ matchMedia: displayMode('browser') })).toBe(false);
    expect(isLandscapeLockedShell({ navigator: { standalone: false } })).toBe(false);
    expect(isLandscapeLockedShell({})).toBe(false);
    const web = { nativePromise: () => Promise.resolve(), isNativePlatform: () => false };
    expect(isLandscapeLockedShell({ Capacitor: web })).toBe(false);
    const broken = () => {
      throw new Error('no media queries');
    };
    expect(isLandscapeLockedShell({ matchMedia: broken })).toBe(false);
  });

  it('shows the Settings toggle only on a phone browser tab', () => {
    const tab = { matchMedia: displayMode('browser') };
    expect(showPortraitBattleSetting({ mobile: true, env: tab })).toBe(true);
    expect(showPortraitBattleSetting({ mobile: false, env: tab })).toBe(false);
    expect(showPortraitBattleSetting({ mobile: true, env: { Capacitor: nativeApp() } })).toBe(
      false,
    );
    expect(
      showPortraitBattleSetting({ mobile: true, env: { matchMedia: displayMode('standalone') } }),
    ).toBe(false);
  });

  it('ignores a stored opt-in in a locked shell and keeps it for the browser tab', () => {
    const localStorage = memoryStorage();
    localStorage.setItem(PORTRAIT_BATTLE_STORAGE_KEY, 'on');
    const tab = { localStorage, matchMedia: displayMode('browser') };
    const installed = { localStorage, matchMedia: displayMode('standalone') };
    const app = { localStorage, Capacitor: nativeApp() };
    expect(portraitBattlesEnabled(tab)).toBe(true);
    expect(portraitBattlesAvailable(installed)).toBe(false);
    expect(portraitBattlesEnabled(installed)).toBe(false);
    expect(portraitBattlesEnabled(app)).toBe(false);
    // The shared storage still holds the tab's choice.
    expect(getPortraitBattlePreference(installed)).toBe(true);
    expect(localStorage.getItem(PORTRAIT_BATTLE_STORAGE_KEY)).toBe('on');
  });

  it('keeps the plain rotate prompt in a locked shell', () => {
    const text = { textContent: '' };
    const localStorage = memoryStorage();
    localStorage.setItem(PORTRAIT_BATTLE_STORAGE_KEY, 'on');
    const document = { querySelector: () => text };
    syncRotatePromptCopy({ localStorage, document, matchMedia: displayMode('browser') });
    expect(text.textContent).toMatch(/Battles can be played upright/);
    syncRotatePromptCopy({ localStorage, document, Capacitor: nativeApp() });
    expect(text.textContent).toBe('\u21bb Rotate your device to landscape');
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

  it('never turns the board without the opt-in', () => {
    globalThis.localStorage.removeItem(PORTRAIT_BATTLE_STORAGE_KEY);
    viewport(390, 844);
    const c = controller(fakeScene());
    expect(c.presentation).toBeNull();
    expect(c.capable).toBe(false);
  });

  for (const [shell, install, remove] of [
    ['the iOS app', () => (globalThis.Capacitor = nativeApp()), () => delete globalThis.Capacitor],
    [
      'the installed web app',
      () => (globalThis.matchMedia = displayMode('standalone')),
      () => delete globalThis.matchMedia,
    ],
  ]) {
    it(`never turns the board or hides the rotate prompt in ${shell}, even opted in`, () => {
      install();
      try {
        viewport(390, 844);
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
        remove();
      }
    });
  }

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
