// The route map's line for what a blessing paid as an act began (Advance Pay, Quartermaster
// Cache; RunManager._payActStartGrants → ActStartNotice). Two callers advance the act and
// must both end with the line shown exactly once:
//   - NodeMapScene.checkActComplete uses advanceAct's return, and takes the notice so the
//     next map entry does not say it again;
//   - PostCombatController.transitionAfterBattle (after a boss victory) ignores the return,
//     so the line waits for the route map's next entry (_showPendingNodeMapHints).
// Rendering adapters only: the real RunManager, the real PostCombatController transition and
// the real scene methods, no canvas (the scene-to-scene hop is the one stub).
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (v, min, max) => Math.max(min, Math.min(max, v)) },
  },
}));
vi.mock('../src/utils/SceneRouter.js', async (importOriginal) => ({
  ...(await importOriginal()),
  transitionToScene: vi.fn(async () => true),
}));
vi.mock('../src/ui/HintDisplay.js', () => ({
  showImportantHint: vi.fn(async () => true),
  showMinorHint: vi.fn(async () => true),
}));

import { showMinorHint } from '../src/ui/HintDisplay.js';
import { NodeMapScene } from '../src/scenes/NodeMapScene.js';
import { PostCombatController } from '../src/ui/PostCombatController.js';
import { RunManager } from '../src/engine/RunManager.js';
import { earnedPickOwed, skipEarnedBlessing } from '../src/engine/EarnedBlessings.js';
import { loadGameData } from './testData.js';

const store = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key) => store[key] ?? null,
    setItem: (key, val) => {
      store[key] = String(val);
    },
    removeItem: (key) => {
      delete store[key];
    },
  },
  configurable: true,
  writable: true,
});

const data = loadGameData();

function runWithAdvancePay() {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: 7001, applyBlessingsAtStart: false });
  rm.activeBlessings = [{ id: 'coin_of_fate', rolledCost: null }];
  rm._runStartBlessingsApplied = false;
  rm.applyRunStartBlessingEffects();
  return rm;
}

function runWithSecondDawn() {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: 7002, applyBlessingsAtStart: false });
  expect(rm.addBlessingMidRun('second_dawn', { earned: true })).toBe(true);
  return rm;
}

/** Play the act through to its boss, as the route map would (every reward claimed). */
function winAct(rm) {
  for (let guard = 0; guard < 60 && !rm.isActComplete(); guard++) {
    const node = rm.getAvailableNodes()[0];
    if (['battle', 'boss', 'recruit'].includes(node.type))
      rm.completeBattle(rm.getRoster(), node.id, 0, { turnCount: 5, turnPar: 7 });
    else rm.markNodeComplete(node.id);
  }
  // The boss's earned-blessing pick is made (left) before the act advances, as the pick
  // screen would (tests/EarnedBlessingPickFlow.test.js covers the pick itself).
  const owed = earnedPickOwed(rm);
  if (owed) skipEarnedBlessing(rm, owed.actId);
}

/** The battle scene's end: the real controller runs the act advance, a stub hops scenes. */
async function bossVictoryTransition(rm) {
  const scene = {
    _battleSession: 1,
    runManager: rm,
    gameData: data,
    isElite: false,
    battleState: 'BATTLE_END',
    nodeId: rm.nodeMap.bossNodeId,
    registry: { get: () => null },
    reportLootError: vi.fn(),
    forceTransitionAfterBattle: vi.fn(),
    _persistBattleRunState: vi.fn(() => ({ ok: true })),
    _showStoryDialogueOnce: vi.fn(async () => {}),
  };
  expect(await new PostCombatController(scene).transitionAfterBattle()).toBe(true);
  expect(scene.reportLootError).not.toHaveBeenCalled();
}

/** The route map's entry: the scene method that shows what waits for the player. */
async function enterRouteMap(rm) {
  const scene = {
    runManager: rm,
    sys: { isActive: () => true },
    _sceneLifecycleGeneration: 1,
    _pendingNodeMapHints: null,
  };
  await NodeMapScene.prototype._showPendingNodeMapHints.call(scene, 1);
}

const noticeCalls = () =>
  vi.mocked(showMinorHint).mock.calls.filter(([, text]) => /Advance Pay/.test(String(text)));
const dawnCalls = () =>
  vi.mocked(showMinorHint).mock.calls.filter(([, text]) => /Second Dawn/.test(String(text)));

beforeEach(() => {
  vi.mocked(showMinorHint).mockClear();
});

describe('act-start notice: the PostCombatController path (advanceAct, return ignored)', () => {
  it('waits on the run and shows on the next route-map entry, once', async () => {
    const rm = runWithAdvancePay();
    winAct(rm);
    expect(rm.currentAct).toBe('act1');
    await bossVictoryTransition(rm); // transitionAfterBattle calls advanceAct bare
    expect(rm.currentAct).toBe('act2');
    expect(rm.gold).toBeGreaterThanOrEqual(250);
    expect(noticeCalls()).toHaveLength(0); // nothing is drawn until the map is entered
    await enterRouteMap(rm);
    expect(noticeCalls()).toHaveLength(1);
    expect(noticeCalls()[0][1]).toBe('Advance Pay: +250 gold');
    // Leaving and coming back to the map does not repeat it.
    await enterRouteMap(rm);
    expect(noticeCalls()).toHaveLength(1);
  });

  it('a map entry with nothing paid says nothing', async () => {
    const rm = new RunManager(data);
    rm.startRun({ runSeed: 7001, applyBlessingsAtStart: false });
    winAct(rm);
    await bossVictoryTransition(rm);
    expect(rm.currentAct).toBe('act2');
    await enterRouteMap(rm);
    expect(showMinorHint).not.toHaveBeenCalled();
  });
});

describe('act-start notice: the NodeMapScene.checkActComplete path (advanceAct, return used)', () => {
  function actCompleteScene(rm) {
    rm.isActComplete = () => true;
    rm.isRunComplete = () => false;
    return {
      runManager: rm,
      drawMap: vi.fn(),
      persistRunSave: vi.fn(),
      showActCompleteBanner: (onComplete) => onComplete(),
      showWeaponArtsUnlockedBanner: vi.fn(),
      _showSkillDisplacementWarning: vi.fn(async () => {}),
      registry: { get: () => null },
      sys: { isActive: () => true },
      _sceneLifecycleGeneration: 1,
      _pendingNodeMapHints: null,
    };
  }

  it('shows the line on the new act’s map and the next map entry does not repeat it', async () => {
    const rm = runWithAdvancePay();
    const scene = actCompleteScene(rm);
    NodeMapScene.prototype.checkActComplete.call(scene);
    expect(rm.currentAct).toBe('act2');
    expect(noticeCalls()).toHaveLength(1);
    expect(noticeCalls()[0][1]).toBe('Advance Pay: +250 gold');
    await enterRouteMap(rm);
    expect(noticeCalls()).toHaveLength(1);
  });
});

describe('act-start notice: Second Dawn rides the same system (a vision grant)', () => {
  it('the battle-end path shows "Second Dawn: +1 Vision" on the next map entry, once', async () => {
    const rm = runWithSecondDawn();
    const before = rm.visionChargesRemaining;
    winAct(rm);
    const afterBoss = rm.visionChargesRemaining; // the boss's own Vision grant is not Second Dawn's
    await bossVictoryTransition(rm);
    expect(rm.currentAct).toBe('act2');
    expect(rm.visionChargesRemaining).toBe(afterBoss + 1);
    expect(afterBoss).toBeGreaterThanOrEqual(before);
    expect(dawnCalls()).toHaveLength(0);
    await enterRouteMap(rm);
    expect(dawnCalls()).toHaveLength(1);
    expect(dawnCalls()[0][1]).toBe('Second Dawn: +1 Vision');
    await enterRouteMap(rm);
    expect(dawnCalls()).toHaveLength(1);
  });

  it('the route map path shows it once and the next entry does not repeat it', async () => {
    const rm = runWithSecondDawn();
    const before = rm.visionChargesRemaining;
    const scene = {
      runManager: rm,
      drawMap: vi.fn(),
      persistRunSave: vi.fn(),
      showActCompleteBanner: (onComplete) => onComplete(),
      showWeaponArtsUnlockedBanner: vi.fn(),
      _showSkillDisplacementWarning: vi.fn(async () => {}),
      registry: { get: () => null },
      sys: { isActive: () => true },
      _sceneLifecycleGeneration: 1,
      _pendingNodeMapHints: null,
    };
    rm.isActComplete = () => true;
    rm.isRunComplete = () => false;
    NodeMapScene.prototype.checkActComplete.call(scene);
    expect(rm.visionChargesRemaining).toBe(before + 1);
    expect(dawnCalls()).toHaveLength(1);
    await enterRouteMap(rm);
    expect(dawnCalls()).toHaveLength(1);
  });
});
