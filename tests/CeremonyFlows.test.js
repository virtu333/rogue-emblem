// Story-card sequencing in the real scene flows: the Act I card at run start,
// the act card on act advance, and THE THREAD IS CUT at the end of a run.
// Cards frame the existing dialogue (never replace it), show once, and leave
// the scene's own flow (menus, transitions, saves) untouched.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)) },
  },
}));
const { transitionToSceneMock, resultMenuMock } = vi.hoisted(() => ({
  transitionToSceneMock: vi.fn(async () => true),
  resultMenuMock: vi.fn(() => ({ destroy: vi.fn() })),
}));
vi.mock('../src/utils/SceneRouter.js', async () => {
  const actual = await vi.importActual('../src/utils/SceneRouter.js');
  return { ...actual, transitionToScene: transitionToSceneMock };
});
vi.mock('../src/ui/RunFlowMenus.js', () => ({ runResultMenu: resultMenuMock }));
vi.mock('../src/engine/RunManager.js', async () => {
  const actual = await vi.importActual('../src/engine/RunManager.js');
  return { ...actual, clearSavedRun: vi.fn() };
});
vi.mock('../src/utils/blessingAnalytics.js', () => ({ recordBlessingRunOutcome: vi.fn() }));
const { sequenceMock } = vi.hoisted(() => ({ sequenceMock: vi.fn(async () => true) }));
vi.mock('../src/ui/DialogueOverlay.js', () => ({
  DialogueOverlay: vi.fn(function () {
    this.showSequence = sequenceMock;
    this.destroy = vi.fn();
  }),
}));

import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';
import dialogue from '../data/dialogue.json';
import { RunCompleteScene } from '../src/scenes/RunCompleteScene.js';
import { NodeMapScene } from '../src/scenes/NodeMapScene.js';
import { PostCombatController } from '../src/ui/PostCombatController.js';
import { CeremonyController } from '../src/ui/CeremonyController.js';
import { _resetInputFocus } from '../src/utils/inputFocus.js';

const gameData = { ...loadGameData(), dialogue };
let dom;
beforeEach(() => {
  vi.useFakeTimers();
  dom = installFakeDom(vi);
  _resetInputFocus();
  sequenceMock.mockReset();
  resultMenuMock.mockClear();
  transitionToSceneMock.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  _resetInputFocus();
});

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
const storyLayer = () => dom.doc.querySelector('.ce-story-layer');

describe('run end: THE THREAD IS CUT', () => {
  function runCompleteScene({ result = 'defeat', dialogue = true } = {}) {
    const scene = Object.create(RunCompleteScene.prototype);
    scene.result = result;
    scene.gameData = dialogue
      ? {
          ...gameData,
          dialogue: { runComplete: { defeat: [{ speaker: 'Sera', line: 'Not this one.' }] } },
        }
      : { ...gameData, dialogue: {} };
    scene.runManager = {
      actIndex: 0,
      currentAct: 'act1',
      completedBattles: 3,
      getStartingLordNames: () => ['Edric', 'Sera'],
      defeatContext: { defeatedBy: 'Iron Captain', wasBoss: true },
      lastBattleReport: { entries: [{ turnNumber: 9 }] },
      getActiveBlessingIds: () => [],
      settleEndRunRewards: vi.fn(() => ({ valor: 1, supply: 1, currencyMultiplier: 1 })),
    };
    scene.registry = { get: () => null };
    scene.cameras = { main: { centerX: 320, centerY: 240, setBackgroundColor: vi.fn() } };
    scene.events = emitter();
    scene.add = { text: vi.fn() };
    return scene;
  }

  it('frames the farewell lines, then gives way to the result menu', async () => {
    let finishLines;
    sequenceMock.mockImplementation(() => new Promise((r) => (finishLines = r)));
    const scene = runCompleteScene();
    const created = RunCompleteScene.prototype.create.call(scene);
    await vi.advanceTimersByTimeAsync(0);
    const card = storyLayer();
    expect(card.classList.contains('ce-runend-layer--cut')).toBe(true);
    expect(card.classList.contains('has-lines')).toBe(true);
    expect(card.querySelector('.ce-runend-word').textContent).toBe('THE THREAD IS CUT');
    expect(card.querySelector('.ce-runend-sub').textContent).toBe('Edric fell to the Iron Captain');
    expect(card.querySelector('.ce-runend-meta').textContent).toBe(
      'Border Marches · Act I · Turn 9',
    );
    // The dialogue starts immediately (its timing contract is unchanged).
    expect(sequenceMock).toHaveBeenCalledTimes(1);
    expect(resultMenuMock).not.toHaveBeenCalled();
    finishLines(true);
    await vi.advanceTimersByTimeAsync(600);
    await created;
    expect(storyLayer()).toBeNull();
    expect(resultMenuMock).toHaveBeenCalledTimes(1);
  });

  it('with no lines the card holds (skippable), then the menu', async () => {
    const scene = runCompleteScene({ dialogue: false });
    const created = RunCompleteScene.prototype.create.call(scene);
    await vi.advanceTimersByTimeAsync(300);
    expect(storyLayer()).not.toBeNull();
    expect(resultMenuMock).not.toHaveBeenCalled();
    dom.key('Enter');
    await vi.advanceTimersByTimeAsync(600);
    await created;
    expect(storyLayer()).toBeNull();
    expect(resultMenuMock).toHaveBeenCalledTimes(1);
  });

  it('an abandoned run has no turn and says so; victory is the gold counterpart', () => {
    const scene = runCompleteScene();
    scene.runManager.defeatContext = null;
    expect(scene._runEndContext()).toMatchObject({ turn: null, defeatContext: null });
    scene.result = 'victory';
    scene.runManager.defeatContext = { defeatedBy: 'x' };
    expect(scene._runEndContext().turn).toBeNull();
  });

  it('shutdown during the card tears it down without opening the menu', async () => {
    sequenceMock.mockImplementation(() => new Promise(() => {}));
    const scene = runCompleteScene();
    void RunCompleteScene.prototype.create.call(scene);
    await vi.advanceTimersByTimeAsync(0);
    expect(storyLayer()).not.toBeNull();
    scene.events.emit('shutdown');
    expect(storyLayer()).toBeNull();
    expect(resultMenuMock).not.toHaveBeenCalled();
  });
});

describe('run start: Act I card with the opening lines', () => {
  function nodeMapScene({ shown = false } = {}) {
    const order = [];
    const scene = {
      sys: { isActive: () => true },
      input: { enabled: false },
      registry: { get: () => null },
      events: emitter(),
      gameData,
      runManager: {
        currentAct: 'act1',
        hasShownDialogue: vi.fn(() => shown),
        markDialogueShown: vi.fn(() => order.push('mark')),
        getStartingLordNames: () => ['Edric', 'Sera'],
        getAvailableNodes: () => [],
        nodeMap: { nodes: [] },
      },
      dialogueOverlay: {
        showSequence: vi.fn(async () => {
          order.push(storyLayer() ? 'lines-over-card' : 'lines');
          return true;
        }),
        visible: false,
      },
      persistRunSave: vi.fn(() => order.push('persist')),
      _showPendingNodeMapHints: vi.fn(async () => {}),
      _storyDialogueActive: false,
      isSceneReady: false,
      _pendingNodeSelection: null,
      _consumePendingNodeSelection: () => false,
      _maybeOpenPendingAmbushShop: () => false,
      _maybeOpenPendingCaravanShop: () => false,
    };
    return { scene, order };
  }

  it('marks and persists run start first, shows the card under the lines, then leaves', async () => {
    const { scene, order } = nodeMapScene();
    const ready = NodeMapScene.prototype.finalizeSceneReady.call(scene);
    await vi.advanceTimersByTimeAsync(700);
    await ready;
    expect(order).toEqual(['mark', 'persist', 'lines-over-card']);
    expect(storyLayer()).toBeNull();
    expect(scene._storyDialogueActive).toBe(false);
    expect(scene.isSceneReady).toBe(true);
  });

  it('never replays once run start has been shown (resume / reload)', async () => {
    const { scene } = nodeMapScene({ shown: true });
    await NodeMapScene.prototype.finalizeSceneReady.call(scene);
    expect(scene.dialogueOverlay.showSequence).not.toHaveBeenCalled();
    expect(dom.doc.querySelector('.ce-layer')).toBeNull();
  });

  it('when the lines were skipped as already seen, the title holds on its own', async () => {
    const { scene } = nodeMapScene();
    scene.dialogueOverlay.showSequence = vi.fn(async () => {
      scene.dialogueOverlay.lastSequenceSkippedAsSeen = true;
      return true;
    });
    const ready = NodeMapScene.prototype.finalizeSceneReady.call(scene);
    await vi.advanceTimersByTimeAsync(100);
    expect(storyLayer()).not.toBeNull();
    expect(scene._storyDialogueActive).toBe(true);
    await vi.advanceTimersByTimeAsync(4500);
    await ready;
    expect(storyLayer()).toBeNull();
    expect(scene._storyDialogueActive).toBe(false);
  });
});

describe('act advance: act card with the transition lines', () => {
  function actScene({ shown = false, entries = true } = {}) {
    const order = [];
    const runManager = {
      currentAct: 'act1',
      pendingBattleReward: null,
      isActComplete: () => true,
      isRunComplete: () => false,
      advanceAct: vi.fn(() => {
        runManager.currentAct = 'act2';
      }),
      hasShownDialogue: vi.fn(() => shown),
      getStartingLordNames: () => ['Edric', 'Sera'],
    };
    const scene = {
      gameData: entries
        ? gameData
        : { ...gameData, dialogue: { ...gameData.dialogue, actTransitions: {} } },
      events: emitter(),
      registry: { get: () => null },
      runManager,
      isTransitioningOut: false,
      dialogueOverlay: { lastSequenceSkippedAsSeen: false },
      _showStoryDialogueOnce: vi.fn(async (key) => {
        order.push(`${key}:${storyLayer() ? 'over-card' : 'alone'}`);
      }),
    };
    scene._getCeremonies = () => (scene._ceremonies ||= new CeremonyController(scene));
    transitionToSceneMock.mockImplementation(async () => {
      order.push(`transition:${storyLayer() ? 'card-up' : 'card-gone'}`);
      return true;
    });
    return { scene, order };
  }

  it('shows ACT II · Old Kingdom Roads · Iron Rain under the lines, gone before NodeMap', async () => {
    const { scene, order } = actScene();
    const done = new PostCombatController(scene).transitionAfterBattle();
    await vi.advanceTimersByTimeAsync(0);
    const card = storyLayer();
    expect(card.querySelector('.ce-act-kicker').textContent).toBe('Act II');
    expect(card.querySelector('.ce-act-title').textContent).toBe('Old Kingdom Roads');
    expect(card.querySelector('.ce-act-grade').textContent).toBe('Iron Rain');
    await vi.advanceTimersByTimeAsync(600);
    await expect(done).resolves.toBe(true);
    expect(order).toEqual(['act1_to_act2:over-card', 'transition:card-gone']);
  });

  it('shares the dialogue once-gate: no card when the transition was already shown', async () => {
    const { scene, order } = actScene({ shown: true });
    await new PostCombatController(scene).transitionAfterBattle();
    expect(order).toEqual(['act1_to_act2:alone', 'transition:card-gone']);
  });
});
