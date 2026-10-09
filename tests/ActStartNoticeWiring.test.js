// The route map's line for what a blessing paid as an act began (Advance Pay, Quartermaster
// Cache; RunManager._payActStartGrants → ActStartNotice). Two callers advance the act and
// must both end with the line shown exactly once:
//   - NodeMapScene.checkActComplete uses advanceAct's return, and takes the notice so the
//     next map entry does not say it again;
//   - PostCombatController (after a boss victory) ignores the return, so the line waits for
//     the route map's next entry (_showPendingNodeMapHints).
// Rendering adapters only: the real RunManager and the real scene methods, no canvas.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (v, min, max) => Math.max(min, Math.min(max, v)) },
  },
}));
vi.mock('../src/ui/HintDisplay.js', () => ({
  showImportantHint: vi.fn(async () => true),
  showMinorHint: vi.fn(async () => true),
}));

import { showMinorHint } from '../src/ui/HintDisplay.js';
import { NodeMapScene } from '../src/scenes/NodeMapScene.js';
import { RunManager } from '../src/engine/RunManager.js';
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

beforeEach(() => {
  vi.mocked(showMinorHint).mockClear();
});

describe('act-start notice: the PostCombatController path (advanceAct, return ignored)', () => {
  it('waits on the run and shows on the next route-map entry, once', async () => {
    const rm = runWithAdvancePay();
    rm.advanceAct(); // PostCombatController calls it bare
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
    rm.advanceAct();
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
