// A slot whose prologue run save could not be read (meta.prologue left 'in_progress',
// the slot opened on Home Base as a damaged run): Begin Run offers the prologue again
// (docs/specs/prologue-chapter.md §9) instead of taking the ordinary road with the grant
// unpaid and the state stuck. Restart begins the prologue run from P1 in this slot;
// Skip records the skip and takes the first-run fast path; Back leaves Home Base as it
// was, quietly. A completed prologue still takes the fast path; anything else the
// ordinary road.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (v, min, max) => Math.min(max, Math.max(min, v)) },
  },
}));
vi.mock('../src/utils/domUI.js', async (importOriginal) => ({
  ...(await importOriginal()),
  hasDOMHost: () => true,
}));
vi.mock('../src/ui/HintDisplay.js', () => ({
  showImportantHint: vi.fn(async () => 'back'),
  showMinorHint: vi.fn(),
}));
vi.mock('../src/utils/firstRunFastPath.js', () => ({
  startFirstRunFastPath: vi.fn(async () => true),
  startPrologueRun: vi.fn(async () => true),
  skipPrologueToFirstRun: vi.fn(async () => true),
}));
vi.mock('../src/utils/SceneRouter.js', async (importOriginal) => ({
  ...(await importOriginal()),
  transitionToScene: vi.fn(async () => true),
}));

import { HomeBaseScene } from '../src/scenes/HomeBaseScene.js';
import { showImportantHint } from '../src/ui/HintDisplay.js';
import {
  skipPrologueToFirstRun,
  startFirstRunFastPath,
  startPrologueRun,
} from '../src/utils/firstRunFastPath.js';
import { transitionToScene } from '../src/utils/SceneRouter.js';
import { BEGIN_RUN_CANCELLED, PROLOGUE_ROUTES, routeForBeginRun, routeForSlot } from '../src/engine/PrologueRouting.js'; // prettier-ignore
import { getSlotSummary } from '../src/engine/SlotManager.js';
import { PROLOGUE_LOST } from '../src/data/prologueContent.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

function scene(prologueState, { runsStarted = 0, runsCompleted = 0 } = {}) {
  const meta = {
    getPrologueState: () => prologueState,
    getRunsStarted: () => runsStarted,
    getRunsCompleted: () => runsCompleted,
  };
  const registry = new Map([
    ['meta', meta],
    ['activeSlot', 2],
  ]);
  const s = new HomeBaseScene();
  return Object.assign(s, {
    gameData: data,
    registry: { get: (k) => registry.get(k) },
    sys: { isActive: () => true },
    input: { enabled: true },
    sound: { locked: false },
    _sceneLifecycleGeneration: 1,
    showTransientMessage: vi.fn(),
  });
}

beforeEach(() => vi.clearAllMocks());

describe('Begin Run with the prologue run save lost', () => {
  it('offers Back, Restart and Skip; Restart begins the prologue run in this slot', async () => {
    vi.mocked(showImportantHint).mockResolvedValueOnce('restart');
    const s = scene('in_progress');
    expect(await s.startRunFromHomeBase()).toBe(true);
    expect(showImportantHint).toHaveBeenCalledWith(s, PROLOGUE_LOST.body, {
      actions: [
        { label: 'Back', value: 'back' },
        { label: 'Restart the Prologue', value: 'restart', primary: true },
        { label: 'Skip to the first run', value: 'skip' },
      ],
    });
    expect(startPrologueRun).toHaveBeenCalledWith(s, { gameData: data, slot: 2 });
    expect(skipPrologueToFirstRun).not.toHaveBeenCalled();
    expect(transitionToScene).not.toHaveBeenCalled();
  });

  it('Skip records the skip and takes the fast path', async () => {
    vi.mocked(showImportantHint).mockResolvedValueOnce('skip');
    const s = scene('in_progress');
    expect(await s.startRunFromHomeBase()).toBe(true);
    expect(skipPrologueToFirstRun).toHaveBeenCalledWith(s, { gameData: data, slot: 2 });
    expect(startPrologueRun).not.toHaveBeenCalled();
  });

  it('Back (the Escape default) starts nothing and Home Base stays usable, with no error', async () => {
    const s = scene('in_progress');
    const result = await s.runTransition(() => s.startRunFromHomeBase());
    expect(result).toBe(BEGIN_RUN_CANCELLED);
    expect(s.isTransitioning).toBe(false);
    expect(s.input.enabled).toBe(true);
    expect(s.showTransientMessage).not.toHaveBeenCalled();
    expect(startPrologueRun).not.toHaveBeenCalled();
    expect(skipPrologueToFirstRun).not.toHaveBeenCalled();
    expect(transitionToScene).not.toHaveBeenCalled();
  });

  it('a completed prologue takes the fast path; a later run the ordinary road', async () => {
    const done = scene('complete');
    await done.startRunFromHomeBase();
    expect(startFirstRunFastPath).toHaveBeenCalledTimes(1);
    const later = scene('in_progress', { runsStarted: 1 });
    await later.startRunFromHomeBase();
    expect(showImportantHint).not.toHaveBeenCalled();
    expect(transitionToScene).toHaveBeenCalledWith(
      later,
      'DifficultySelect',
      { gameData: data },
      expect.anything(),
    );
  });
});

describe('the whole path from an unreadable prologue run save', () => {
  it('the slot opens on Home Base (damaged run), and Begin Run offers the prologue', () => {
    const store = new Map([
      ['emblem_rogue_slot_2_meta', JSON.stringify({ savedAt: 5, prologue: { state: 'in_progress' } })], // prettier-ignore
      ['emblem_rogue_slot_2_run', '{"mode":"prologue", truncated'],
    ]);
    const storage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      get length() {
        return store.size;
      },
      key: (i) => [...store.keys()][i] ?? null,
    };
    const summary = getSlotSummary(2, storage);
    expect(summary).toMatchObject({ runCorrupt: true, prologue: 'in_progress' });
    expect(routeForSlot(summary)).toBe(PROLOGUE_ROUTES.HOME_BASE);
    expect(routeForBeginRun({ prologue: { state: summary.prologue }, runsStarted: 0 })).toBe(
      PROLOGUE_ROUTES.OFFER,
    );
  });
});
