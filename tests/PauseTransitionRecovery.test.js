import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PauseOverlay } from '../src/ui/PauseOverlay.js';
import { showTransitionRecoveryPrompt } from '../src/ui/TransitionRecoveryPrompt.js';
import { transitionToScene, TRANSITION_REASONS } from '../src/utils/SceneRouter.js';
import { resetTransitionLocks } from '../src/utils/sceneLoader.js';
import { markStartup } from '../src/utils/startupTelemetry.js';

// ---- Mock deps used by TransitionRecoveryPrompt ----
vi.mock('../src/utils/SceneRouter.js', () => ({
  TRANSITION_REASONS: {
    SAVE_EXIT: 'SAVE_EXIT',
    ABANDON_RUN: 'ABANDON_RUN',
    BACK: 'BACK',
    VICTORY: 'VICTORY',
    DEFEAT: 'DEFEAT',
    RETRY: 'RETRY',
  },
  transitionToScene: vi.fn().mockResolvedValue(true),
}));
vi.mock('../src/utils/sceneLoader.js', () => ({
  TRANSITION_REASONS: {
    SAVE_EXIT: 'SAVE_EXIT',
    ABANDON_RUN: 'ABANDON_RUN',
    BACK: 'BACK',
    VICTORY: 'VICTORY',
    DEFEAT: 'DEFEAT',
    RETRY: 'RETRY',
  },
  normalizeTransitionReason: vi.fn((r) => r),
  resetTransitionLocks: vi.fn(),
  startSceneLazy: vi.fn(),
}));
vi.mock('../src/utils/startupTelemetry.js', () => ({
  markStartup: vi.fn(),
}));

// ---- Helpers ----

/** Minimal Phaser scene mock */
function mockScene(overrides = {}) {
  const objects = [];
  const scene = {
    cameras: { main: { centerX: 320, centerY: 240, width: 640, height: 480 } },
    add: {
      rectangle: (_x, _y, _w, _h, _c, _a) => {
        const obj = {
          setDepth: function () { return this; },
          setInteractive: function () { return this; },
          setStrokeStyle: function () { return this; },
          destroy: vi.fn(),
          type: 'rectangle',
        };
        objects.push(obj);
        return obj;
      },
      text: (_x, _y, label, _style) => {
        const obj = {
          text: label,
          setOrigin: function () { return this; },
          setDepth: function () { return this; },
          setInteractive: function () { return this; },
          disableInteractive: function () { return this; },
          setColor: function () { return this; },
          setText: function (t) { this.text = t; return this; },
          on: vi.fn().mockReturnThis(),
          destroy: vi.fn(),
          type: 'text',
        };
        objects.push(obj);
        return obj;
      },
    },
    scene: { isActive: () => true, start: vi.fn() },
    gameData: {},
    pauseOverlay: { visible: false },
    pauseTransitionRecovery: null,
    nodeMapTransitionRecovery: null,
    registry: { get: () => null },
    _createdObjects: objects,
    ...overrides,
  };
  return scene;
}

/** Extract pointerdown handler for a text button by label */
function findBtnHandler(objects, label) {
  const btn = objects.find(o => o.type === 'text' && o.text === label);
  return btn?.on.mock.calls.find(c => c[0] === 'pointerdown')?.[1] || null;
}

// ---- Tests: BattleScene showTransitionRecoveryPrompt (pauseTransitionRecovery guard) ----

describe('showTransitionRecoveryPrompt (BattleScene guard)', () => {
  it('creates recovery UI elements (blocker + panel + msg + retryBtn + reloadBtn)', () => {
    const scene = mockScene();
    const group = showTransitionRecoveryPrompt(scene, {
      reason: TRANSITION_REASONS.SAVE_EXIT,
      sceneName: 'Battle',
      guardKey: 'pauseTransitionRecovery',
      titleData: { gameData: scene.gameData },
    });
    expect(group).not.toBeNull();
    expect(group.length).toBe(5);
    expect(scene.pauseTransitionRecovery).toBe(group);
  });

  it('does not create duplicate UI when called twice', () => {
    const scene = mockScene();
    const first = showTransitionRecoveryPrompt(scene, {
      reason: TRANSITION_REASONS.SAVE_EXIT,
      sceneName: 'Battle',
      guardKey: 'pauseTransitionRecovery',
      titleData: { gameData: scene.gameData },
    });
    const second = showTransitionRecoveryPrompt(scene, {
      reason: TRANSITION_REASONS.SAVE_EXIT,
      sceneName: 'Battle',
      guardKey: 'pauseTransitionRecovery',
      titleData: { gameData: scene.gameData },
    });
    expect(second).toBeNull();
    expect(scene.pauseTransitionRecovery).toBe(first);
  });

  it('guard reset on init allows new recovery UI', () => {
    const scene = mockScene();
    scene.pauseTransitionRecovery = [1, 2, 3]; // stale
    scene.pauseTransitionRecovery = null; // init() reset
    const group = showTransitionRecoveryPrompt(scene, {
      reason: TRANSITION_REASONS.SAVE_EXIT,
      sceneName: 'Battle',
      guardKey: 'pauseTransitionRecovery',
      titleData: { gameData: scene.gameData },
    });
    expect(group).not.toBeNull();
    expect(group.length).toBe(5);
  });

  it('contains [ Retry ] button', () => {
    const scene = mockScene();
    showTransitionRecoveryPrompt(scene, {
      reason: TRANSITION_REASONS.SAVE_EXIT,
      sceneName: 'Battle',
      guardKey: 'pauseTransitionRecovery',
      titleData: { gameData: scene.gameData },
    });
    const textObjects = scene._createdObjects.filter((o) => o.type === 'text');
    const labels = textObjects.map((o) => o.text);
    expect(labels).toContain('[ Retry ]');
  });

  it('contains [ Reload Page ] escape hatch button', () => {
    const scene = mockScene();
    showTransitionRecoveryPrompt(scene, {
      reason: TRANSITION_REASONS.SAVE_EXIT,
      sceneName: 'Battle',
      guardKey: 'pauseTransitionRecovery',
      titleData: { gameData: scene.gameData },
    });
    const textObjects = scene._createdObjects.filter((o) => o.type === 'text');
    const labels = textObjects.map((o) => o.text);
    expect(labels).toContain('[ Reload Page ]');
  });

  it('clears pauseOverlay ref on show when overlayKey provided', () => {
    const scene = mockScene({ pauseOverlay: { visible: true } });
    showTransitionRecoveryPrompt(scene, {
      reason: TRANSITION_REASONS.SAVE_EXIT,
      sceneName: 'Battle',
      guardKey: 'pauseTransitionRecovery',
      overlayKey: 'pauseOverlay',
      titleData: { gameData: scene.gameData },
    });
    expect(scene.pauseOverlay).toBeNull();
  });

  it('does not clear pauseOverlay when overlayKey omitted', () => {
    const scene = mockScene({ pauseOverlay: { visible: true } });
    showTransitionRecoveryPrompt(scene, {
      reason: TRANSITION_REASONS.SAVE_EXIT,
      sceneName: 'Battle',
      guardKey: 'pauseTransitionRecovery',
      titleData: { gameData: scene.gameData },
    });
    expect(scene.pauseOverlay).toEqual({ visible: true });
  });
});

// ---- Tests: NodeMapScene showTransitionRecoveryPrompt (nodeMapTransitionRecovery guard) ----

describe('showTransitionRecoveryPrompt (NodeMapScene guard)', () => {
  it('creates recovery UI elements', () => {
    const scene = mockScene();
    const group = showTransitionRecoveryPrompt(scene, {
      reason: TRANSITION_REASONS.SAVE_EXIT,
      sceneName: 'NodeMap',
      guardKey: 'nodeMapTransitionRecovery',
      titleData: { gameData: scene.gameData },
    });
    expect(group).not.toBeNull();
    expect(group.length).toBe(5);
    expect(scene.nodeMapTransitionRecovery).toBe(group);
  });

  it('does not create duplicate UI when called twice', () => {
    const scene = mockScene();
    const first = showTransitionRecoveryPrompt(scene, {
      reason: TRANSITION_REASONS.SAVE_EXIT,
      sceneName: 'NodeMap',
      guardKey: 'nodeMapTransitionRecovery',
      titleData: { gameData: scene.gameData },
    });
    const second = showTransitionRecoveryPrompt(scene, {
      reason: TRANSITION_REASONS.SAVE_EXIT,
      sceneName: 'NodeMap',
      guardKey: 'nodeMapTransitionRecovery',
      titleData: { gameData: scene.gameData },
    });
    expect(second).toBeNull();
    expect(scene.nodeMapTransitionRecovery).toBe(first);
  });

  it('guard reset in create allows new recovery UI', () => {
    const scene = mockScene();
    scene.nodeMapTransitionRecovery = [1, 2, 3];
    scene.nodeMapTransitionRecovery = null;
    const group = showTransitionRecoveryPrompt(scene, {
      reason: TRANSITION_REASONS.ABANDON_RUN,
      sceneName: 'NodeMap',
      guardKey: 'nodeMapTransitionRecovery',
      titleData: { gameData: scene.gameData },
    });
    expect(group).not.toBeNull();
    expect(group.length).toBe(5);
  });
});

// ---- Tests: PauseOverlay rejection safety (via real button handlers) ----

describe('PauseOverlay async callback rejection safety', () => {
  function mockPauseScene() {
    const objects = [];
    return {
      cameras: { main: { centerX: 320, centerY: 240 } },
      add: {
        rectangle: () => {
          const obj = {
            setDepth: function () { return this; },
            setInteractive: function () { return this; },
            setStrokeStyle: function () { return this; },
            destroy: vi.fn(),
            type: 'rectangle',
          };
          objects.push(obj);
          return obj;
        },
        text: (_x, _y, label, _style) => {
          const obj = {
            text: label,
            setOrigin: function () { return this; },
            setDepth: function () { return this; },
            setInteractive: function () { return this; },
            disableInteractive: function () { return this; },
            setColor: function () { return this; },
            setText: function (t) { this.text = t; return this; },
            on: vi.fn().mockReturnThis(),
            destroy: vi.fn(),
            type: 'text',
          };
          objects.push(obj);
          return obj;
        },
      },
      _createdObjects: objects,
    };
  }

  it('Save & Return to Title sync throw caught by production wrapper', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('transition kaboom');
    const scene = mockPauseScene();
    const overlay = new PauseOverlay(scene, {
      onResume: vi.fn(),
      onSaveAndExit: () => { throw error; }, // sync throw — no onSaveAndExitWarning → direct path
    });
    overlay.show();

    const handler = findBtnHandler(scene._createdObjects, 'Save & Return to Title');
    expect(handler).not.toBeNull();
    handler(); // triggers production Promise.resolve().then(() => cb()).catch()
    await new Promise(r => setTimeout(r, 0)); // flush microtasks

    expect(consoleError).toHaveBeenCalledWith('[PauseOverlay] onSaveAndExit rejected:', error);
    consoleError.mockRestore();
  });

  it('Save & Return to Title async rejection caught by production wrapper', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('async kaboom');
    const scene = mockPauseScene();
    const overlay = new PauseOverlay(scene, {
      onResume: vi.fn(),
      onSaveAndExit: async () => { throw error; },
    });
    overlay.show();

    const handler = findBtnHandler(scene._createdObjects, 'Save & Return to Title');
    handler();
    await new Promise(r => setTimeout(r, 0));

    expect(consoleError).toHaveBeenCalledWith('[PauseOverlay] onSaveAndExit rejected:', error);
    consoleError.mockRestore();
  });

  it('Abandon Run rejection caught through confirm dialog', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('abandon kaboom');
    const scene = mockPauseScene();
    const overlay = new PauseOverlay(scene, {
      onResume: vi.fn(),
      onAbandon: async () => { throw error; },
    });
    overlay.show();

    // Click "Abandon Run" → triggers _showConfirm which adds "Yes" button
    const abandonHandler = findBtnHandler(scene._createdObjects, 'Abandon Run');
    expect(abandonHandler).not.toBeNull();
    abandonHandler();

    // Find the "Yes" confirm button (created by _showConfirm)
    const yesHandler = findBtnHandler(scene._createdObjects, 'Yes');
    expect(yesHandler).not.toBeNull();
    yesHandler(); // triggers production Promise.resolve().then(() => onAbandon()).catch()
    await new Promise(r => setTimeout(r, 0));

    expect(consoleError).toHaveBeenCalledWith('[PauseOverlay] onAbandon rejected:', error);
    consoleError.mockRestore();
  });

  it('Save & Return to Title warning-confirm rejection caught', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('warning confirm kaboom');
    const scene = mockPauseScene();
    const overlay = new PauseOverlay(scene, {
      onResume: vi.fn(),
      onSaveAndExit: async () => { throw error; },
      onSaveAndExitWarning: 'Battle Progress Will Be Lost',
    });
    overlay.show();

    // Click "Save & Return to Title" → triggers _showConfirm (not direct call)
    const saveHandler = findBtnHandler(scene._createdObjects, 'Save & Return to Title');
    expect(saveHandler).not.toBeNull();
    saveHandler();

    // Find "Yes" confirm button (created by _showConfirm)
    const yesHandler = findBtnHandler(scene._createdObjects, 'Yes');
    expect(yesHandler).not.toBeNull();
    yesHandler();
    await new Promise(r => setTimeout(r, 0));

    expect(consoleError).toHaveBeenCalledWith('[PauseOverlay] onSaveAndExit rejected:', error);
    consoleError.mockRestore();
  });
});

// ---- Tests: TransitionRecoveryPrompt button behavior ----

describe('showTransitionRecoveryPrompt button behavior', () => {
  const titleData = { gameData: {} };
  const opts = {
    reason: TRANSITION_REASONS.SAVE_EXIT,
    sceneName: 'Battle',
    guardKey: 'pauseTransitionRecovery',
    titleData,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    transitionToScene.mockResolvedValue(true);
  });

  it('Retry calls resetTransitionLocks + transitionToScene with correct args', () => {
    const scene = mockScene();
    showTransitionRecoveryPrompt(scene, opts);

    const handler = findBtnHandler(scene._createdObjects, '[ Retry ]');
    expect(handler).not.toBeNull();
    handler();

    expect(resetTransitionLocks).toHaveBeenCalledWith(scene);
    expect(transitionToScene).toHaveBeenCalledWith(
      scene, 'Title', titleData, { reason: TRANSITION_REASONS.SAVE_EXIT },
    );
    // Button text changes to retrying
    const retryBtn = scene._createdObjects.find(o => o.type === 'text' && o.text === '[ Retrying... ]');
    expect(retryBtn).toBeTruthy();
  });

  it('Retry fallback calls scene.start when transitionToScene resolves false', async () => {
    transitionToScene.mockResolvedValueOnce(false);
    const scene = mockScene();
    showTransitionRecoveryPrompt(scene, opts);

    const handler = findBtnHandler(scene._createdObjects, '[ Retry ]');
    handler();
    await new Promise(r => setTimeout(r, 0));

    expect(scene.scene.start).toHaveBeenCalledWith('Title', titleData);
  });

  it('Retry re-enables on transitionToScene rejection', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    transitionToScene.mockRejectedValueOnce(new Error('boom'));
    const scene = mockScene();
    showTransitionRecoveryPrompt(scene, opts);

    const retryBtn = scene._createdObjects.find(o => o.type === 'text' && o.text === '[ Retry ]');
    const handler = retryBtn.on.mock.calls.find(c => c[0] === 'pointerdown')[1];
    handler();
    await new Promise(r => setTimeout(r, 0));

    // Button text reset to [ Retry ]
    expect(retryBtn.text).toBe('[ Retry ]');
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('Reload calls markStartup + globalThis.location.reload', () => {
    const savedLocation = globalThis.location;
    globalThis.location = { reload: vi.fn() };
    try {
      const scene = mockScene();
      showTransitionRecoveryPrompt(scene, opts);

      const handler = findBtnHandler(scene._createdObjects, '[ Reload Page ]');
      expect(handler).not.toBeNull();
      handler();

      expect(markStartup).toHaveBeenCalledWith('pause_transition_reload', {
        scene: 'Battle', reason: 'SAVE_EXIT',
      });
      expect(globalThis.location.reload).toHaveBeenCalled();
    } finally {
      globalThis.location = savedLocation;
    }
  });
});

// ---- Tests: Scene wrapper arg wiring (runtime extraction from source) ----

describe('Scene recovery wrapper arg wiring', () => {
  function extractMethodBody(source, methodName) {
    const rx = new RegExp(`\\b${methodName}\\s*\\([^)]*\\)\\s*\\{`);
    const match = rx.exec(source);
    if (!match) return null;
    let i = match.index + match[0].length;
    let depth = 1;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    }
    return source.slice(match.index, i);
  }

  it('BattleScene.showPauseTransitionRecovery passes correct args', () => {
    const src = readFileSync(path.resolve('src/scenes/BattleScene.js'), 'utf8');
    const body = extractMethodBody(src, 'showPauseTransitionRecovery');
    expect(body).not.toBeNull();
    expect(body).toContain("guardKey: 'pauseTransitionRecovery'");
    expect(body).toContain("overlayKey: 'pauseOverlay'");
    expect(body).toContain("sceneName: 'Battle'");
    expect(body).toContain('showTransitionRecoveryPrompt(this');
    expect(body).toContain('titleData:');
  });

  it('NodeMapScene.showNodeMapTransitionRecovery passes correct args', () => {
    const src = readFileSync(path.resolve('src/scenes/NodeMapScene.js'), 'utf8');
    const body = extractMethodBody(src, 'showNodeMapTransitionRecovery');
    expect(body).not.toBeNull();
    expect(body).toContain("guardKey: 'nodeMapTransitionRecovery'");
    expect(body).toContain("overlayKey: 'pauseOverlay'");
    expect(body).toContain("sceneName: 'NodeMap'");
    expect(body).toContain('showTransitionRecoveryPrompt(this');
    expect(body).toContain('titleData:');
  });
});
