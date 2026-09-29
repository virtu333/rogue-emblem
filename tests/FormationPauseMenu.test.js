import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));

// The route map transition is recorded, never started.
const transitions = [];
vi.mock('../src/utils/SceneRouter.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    transitionToSceneWithBlockedRetry: vi.fn(async (scene, key, data, opts) => {
      transitions.push({ key, data, opts, savedFlag: scene._savedFlag });
      return { status: actual.TRANSITION_RESULTS.STARTED };
    }),
  };
});

import { BattleScene } from '../src/scenes/BattleScene.js';
import { FormationController, FORMATION_STATE } from '../src/ui/FormationController.js';
import { PauseOverlay } from '../src/ui/PauseOverlay.js';
import { RunManager } from '../src/engine/RunManager.js';
import { TRANSITION_REASONS } from '../src/utils/SceneRouter.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

function displayObject(extra = {}) {
  const obj = {
    handlers: {},
    on(event, handler) {
      this.handlers[event] = handler;
      return this;
    },
    destroy: vi.fn(),
    ...extra,
  };
  for (const name of [
    'setDepth',
    'setInteractive',
    'setStrokeStyle',
    'setOrigin',
    'setColor',
    'setVisible',
  ])
    obj[name] = () => obj;
  return obj;
}

function overlayScene() {
  return {
    cameras: { main: { centerX: 320, centerY: 240 } },
    add: {
      rectangle: () => displayObject(),
      text: (_x, _y, label) => displayObject({ text: label }),
      graphics: () => {
        const g = displayObject();
        for (const name of ['lineStyle', 'beginPath', 'moveTo', 'lineTo', 'strokePath'])
          g[name] = () => g;
        return g;
      },
    },
    input: {
      keyboard: { addKey: () => ({ on: vi.fn(), off: vi.fn() }), on: vi.fn(), off: vi.fn() },
    },
    game: { events: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } },
  };
}

const press = (overlay, label) => {
  const button = [...overlay.objects, ...overlay.confirmObjects].find((o) => o.text === label);
  expect(button, label).toBeTruthy();
  button.handlers.pointerdown();
};

/** A run that has just entered its first battle, as BattleScene records it. */
function enteredRun() {
  const rm = new RunManager(gameData);
  rm.startRun();
  const nodeId = rm.nodeMap.startNodeId;
  rm.rngSeed = 1234;
  rm.beginBattleInProgress(nodeId, { battleParams: { act: 'act1' } });
  rm.rngSeed = 999; // the battle's RNG install moved it on
  return { rm, nodeId };
}

function formationScene({ rm, nodeId }) {
  const scene = {
    runManager: rm,
    nodeId,
    gameData,
    battleParams: { act: 'act1' },
    registry: { get: () => null },
    sys: { isActive: () => true },
    _persistBattleRunState: vi.fn(() => {
      scene._savedFlag = rm.battleInProgress;
    }),
    showPauseTransitionRecovery: vi.fn(),
  };
  const formation = new FormationController(scene);
  formation.ready = true;
  scene._formation = formation;
  return { scene, formation };
}

beforeEach(() => {
  transitions.length = 0;
});

describe('Formation: the rail Menu opens the pause menu', () => {
  function menuScene(extra = {}) {
    return Object.assign(Object.create(BattleScene.prototype), {
      battleState: FORMATION_STATE,
      _formation: { ready: true, menu: null, picker: null },
      turnManager: { currentPhase: 'player' },
      isStoryInputLocked: () => false,
      ...extra,
    });
  }

  it('during placement, with nothing of placement open', () => {
    expect(menuScene().canOpenPauseFromMenu()).toBe(true);
  });

  it('not while the Formation menu or a unit picker is open (Menu backs out of those)', () => {
    expect(
      menuScene({ _formation: { ready: true, menu: {}, picker: null } }).canOpenPauseFromMenu(),
    ).toBe(false);
    expect(
      menuScene({ _formation: { ready: true, menu: null, picker: {} } }).canOpenPauseFromMenu(),
    ).toBe(false);
  });

  it('not before placement hands control to the player, nor while already paused', () => {
    expect(
      menuScene({ _formation: { ready: false, menu: null, picker: null } }).canOpenPauseFromMenu(),
    ).toBe(false);
    expect(menuScene({ pauseOverlay: { visible: true } }).canOpenPauseFromMenu()).toBe(false);
  });
});

describe('Formation: the pause menu offers Back to Map', () => {
  function pausedFrom(state, canReturn = true) {
    const base = overlayScene();
    const scene = Object.assign(Object.create(BattleScene.prototype), base, {
      battleState: state,
      runManager: { previewEndRunRewards: () => ({ valor: 1, supply: 2 }), nodeMap: null },
      registry: { get: () => null },
      battleParams: { act: 'act1' },
      gameData,
      _formation: { canReturnToMap: () => canReturn, returnToMap: vi.fn(async () => true) },
      refreshEndTurnControl: () => {},
    });
    scene.showPauseMenu();
    return scene;
  }

  it('while placing: Back to Map asks first, then leaves without resuming', async () => {
    const scene = pausedFrom(FORMATION_STATE);
    const pause = scene.pauseOverlay;
    expect(pause.objects.map((o) => o.text)).toContain('Back to Map');
    expect(pause.onSaveAndExitWarning).toMatch(/has not started/);
    press(pause, 'Back to Map');
    expect(scene._formation.returnToMap).not.toHaveBeenCalled();
    press(pause, 'Back to map'); // the confirm
    await Promise.resolve();
    await Promise.resolve();
    expect(scene._formation.returnToMap).toHaveBeenCalledTimes(1);
    expect(pause.visible).toBe(false);
    // hideForTransition: placement is not resumed underneath the transition.
    expect(scene.battleState).toBe('PAUSED');
  });

  it('Cancel on the confirm keeps the pause menu and placement', () => {
    const scene = pausedFrom(FORMATION_STATE);
    press(scene.pauseOverlay, 'Back to Map');
    press(scene.pauseOverlay, 'Cancel');
    expect(scene._formation.returnToMap).not.toHaveBeenCalled();
    scene.pauseOverlay.hide(); // Resume
    expect(scene.battleState).toBe(FORMATION_STATE);
  });

  it('not once the battle has begun, nor when the run cannot go back', () => {
    for (const scene of [pausedFrom('PLAYER_IDLE'), pausedFrom(FORMATION_STATE, false)]) {
      expect(scene.pauseOverlay.objects.map((o) => o.text)).not.toContain('Back to Map');
      expect(scene.pauseOverlay.onSaveAndExitWarning).toMatch(/Battle suspended/);
    }
  });

  it('a pause menu built without it has no Back to Map', () => {
    const pause = new PauseOverlay(overlayScene(), { onResume: vi.fn() });
    pause.show();
    expect(pause.objects.map((o) => o.text)).not.toContain('Back to Map');
    expect(pause.requestBackToMap()).toBe(false);
  });
});

describe('Formation: returning to the map', () => {
  it('reverts the run to its entry, saves that, then opens the route map', async () => {
    const entered = enteredRun();
    const { scene, formation } = formationScene(entered);
    const { rm, nodeId } = entered;
    expect(formation.canReturnToMap()).toBe(true);

    expect(await formation.returnToMap()).toBe(true);
    expect(rm.battleInProgress).toBeNull();
    expect(rm.rngSeed).toBe(1234); // entry RNG refunded
    // Saved after the revert: the save says "on the map", not "in battle".
    expect(scene._persistBattleRunState).toHaveBeenCalledTimes(1);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      key: 'NodeMap',
      data: { gameData, runManager: rm },
      opts: { reason: TRANSITION_REASONS.BACK },
      savedFlag: null,
    });
    // The node is still open for the same fight.
    expect(rm.nodeMap.nodes.find((n) => n.id === nodeId).completed).toBeFalsy();
  });

  it('is refused once a suspend checkpoint exists (turn 1 began)', async () => {
    const entered = enteredRun();
    entered.rm.battleInProgress.checkpoint = { version: 2 };
    const { scene, formation } = formationScene(entered);
    expect(formation.canReturnToMap()).toBe(false);
    expect(await formation.returnToMap()).toBe(false);
    expect(entered.rm.battleInProgress).not.toBeNull();
    expect(scene._persistBattleRunState).not.toHaveBeenCalled();
    expect(transitions).toHaveLength(0);
  });

  it('is refused in the tutorial, without a run, before placement and for another node', () => {
    const tutorial = formationScene(enteredRun());
    tutorial.scene.battleParams.tutorialMode = true;
    expect(tutorial.formation.canReturnToMap()).toBe(false);

    const noRun = formationScene({ rm: null, nodeId: 'x' });
    expect(noRun.formation.canReturnToMap()).toBe(false);

    const early = formationScene(enteredRun());
    early.formation.ready = false;
    expect(early.formation.canReturnToMap()).toBe(false);

    const other = formationScene(enteredRun());
    other.scene.nodeId = 'some-other-node';
    expect(other.formation.canReturnToMap()).toBe(false);
  });
});
