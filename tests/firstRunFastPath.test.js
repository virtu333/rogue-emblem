import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the scene router + cloud so the helper can run without Phaser. The
// helper still constructs a REAL RunManager so we can assert its committed
// state matches the Blessing-skip path.
const { transitionToSceneMock, deleteRunSaveMock } = vi.hoisted(() => ({
  transitionToSceneMock: vi.fn(),
  deleteRunSaveMock: vi.fn(),
}));

vi.mock('../src/utils/SceneRouter.js', () => ({
  TRANSITION_REASONS: { BEGIN_RUN: 'begin_run' },
  transitionToScene: transitionToSceneMock,
}));

vi.mock('../src/cloud/CloudSync.js', () => ({
  deleteRunSave: deleteRunSaveMock,
}));

import { isFirstRunSlot, startFirstRunFastPath } from '../src/utils/firstRunFastPath.js';
import { RunManager } from '../src/engine/RunManager.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { loadGameData } from './testData.js';

// Minimal localStorage so RunManager.clearSavedRun / MetaProgressionManager work.
const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => store[key] ?? null),
  setItem: vi.fn((key, val) => {
    store[key] = val;
  }),
  removeItem: vi.fn((key) => {
    delete store[key];
  }),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

function makeScene({ meta, cloud } = {}) {
  const reg = new Map();
  if (meta !== undefined) reg.set('meta', meta);
  if (cloud !== undefined) reg.set('cloud', cloud);
  return { registry: { get: (k) => reg.get(k) } };
}

describe('isFirstRunSlot detection matrix', () => {
  it('treats an empty slot (null summary) as fresh', () => {
    expect(isFirstRunSlot(null)).toBe(true);
    expect(isFirstRunSlot(undefined)).toBe(true);
  });

  it('treats a used slot with zero started/completed runs as fresh', () => {
    expect(
      isFirstRunSlot({ hasActiveRun: false, runCorrupt: false, runsStarted: 0, runsCompleted: 0 }),
    ).toBe(true);
  });

  it('is NOT fresh once a run has been started', () => {
    expect(
      isFirstRunSlot({ hasActiveRun: false, runCorrupt: false, runsStarted: 1, runsCompleted: 0 }),
    ).toBe(false);
  });

  it('is NOT fresh once a run has been completed', () => {
    expect(
      isFirstRunSlot({ hasActiveRun: false, runCorrupt: false, runsStarted: 0, runsCompleted: 1 }),
    ).toBe(false);
  });

  it('is NOT fresh when a run is active', () => {
    expect(isFirstRunSlot({ hasActiveRun: true, runsStarted: 0, runsCompleted: 0 })).toBe(false);
  });

  it('is NOT fresh when the run save is corrupt', () => {
    expect(isFirstRunSlot({ hasActiveRun: false, runCorrupt: true, runsStarted: 0 })).toBe(false);
  });
});

describe('startFirstRunFastPath', () => {
  let gameData;
  let meta;

  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    vi.clearAllMocks();
    transitionToSceneMock.mockResolvedValue(true);
    gameData = loadGameData();
    meta = new MetaProgressionManager(gameData.metaUpgrades, 'test_slot_meta');
  });

  it('transitions to NodeMap with a committed normal/no-blessing run', async () => {
    const scene = makeScene({ meta });

    const ok = await startFirstRunFastPath(scene, { gameData, slot: 1 });

    expect(ok).toBe(true);
    expect(transitionToSceneMock).toHaveBeenCalledTimes(1);
    const [callScene, key, data, opts] = transitionToSceneMock.mock.calls[0];
    expect(callScene).toBe(scene);
    expect(key).toBe('NodeMap');
    expect(data.firstRun).toBe(true);
    expect(data.gameData).toBe(gameData);
    expect(opts).toEqual({ reason: 'begin_run' });

    // Committed RunManager state matches the Blessing-skip path exactly.
    const rm = data.runManager;
    expect(rm).toBeInstanceOf(RunManager);
    expect(rm.difficultyId).toBe('normal');
    expect(rm.activeBlessings).toEqual([]);
    expect(rm._blessingChosen).toBe(true);
    expect(rm.roster.length).toBe(2); // Edric + partner lord
    expect(rm.nodeMap?.nodes?.length).toBeGreaterThan(0);
  });

  it('mirrors a directly-built Blessing-skip RunManager', async () => {
    const scene = makeScene({ meta });
    await startFirstRunFastPath(scene, { gameData, slot: 1 });
    const fastRm = transitionToSceneMock.mock.calls[0][2].runManager;

    // Reference: the exact recipe BlessingSelectScene uses when the player skips.
    const refRm = new RunManager(gameData, meta.getActiveEffects({ weaponArtCatalog: [] }));
    refRm.startRun({ difficultyId: 'normal', applyBlessingsAtStart: false });
    refRm.chooseBlessing(null);

    expect(fastRm.difficultyId).toBe(refRm.difficultyId);
    expect(fastRm.activeBlessings).toEqual(refRm.activeBlessings);
    expect(fastRm._blessingChosen).toBe(refRm._blessingChosen);
    expect(fastRm.roster.length).toBe(refRm.roster.length);
  });

  it('increments runsStarted exactly once on success', async () => {
    const scene = makeScene({ meta });
    expect(meta.runsStarted).toBe(0);

    await startFirstRunFastPath(scene, { gameData, slot: 1 });

    expect(meta.runsStarted).toBe(1);
  });

  it('does not increment runsStarted or clear the save when the transition is rejected', async () => {
    transitionToSceneMock.mockResolvedValue(false);
    const scene = makeScene({ meta });

    const ok = await startFirstRunFastPath(scene, { gameData, slot: 1 });

    expect(ok).toBe(false);
    expect(meta.runsStarted).toBe(0);
    expect(deleteRunSaveMock).not.toHaveBeenCalled();
  });

  it('works without meta (dev/standalone route) and still transitions', async () => {
    const scene = makeScene({ meta: undefined });

    const ok = await startFirstRunFastPath(scene, { gameData, slot: 1 });

    expect(ok).toBe(true);
    const rm = transitionToSceneMock.mock.calls[0][2].runManager;
    expect(rm.difficultyId).toBe('normal');
  });

  it('routes the cloud delete callback only when a cloud session exists', async () => {
    const cloud = { userId: 'user-123' };
    const scene = makeScene({ meta, cloud });

    await startFirstRunFastPath(scene, { gameData, slot: 2 });

    expect(deleteRunSaveMock).toHaveBeenCalledWith('user-123', 2);
  });
});
