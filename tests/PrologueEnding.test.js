// The prologue's ending (docs/specs/prologue-chapter.md §5 beats 7-8, §9): its lines
// and title card play, then one meta write (state complete, the grant paid once), the
// device's lesson record, the run save cleared, then Home Base. A refresh after the
// meta write finds the grant paid and only clears the save; a meta write that fails
// keeps the run save and never transitions.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/HintDisplay.js', () => ({
  showImportantHint: vi.fn(async () => true),
  showMinorHint: vi.fn(),
}));
vi.mock('../src/utils/domUI.js', async (importOriginal) => ({
  ...(await importOriginal()),
  hasDOMHost: () => true,
}));
vi.mock('../src/utils/SceneRouter.js', async () => {
  const actual = await vi.importActual('../src/utils/SceneRouter.js');
  return { ...actual, transitionToScene: vi.fn(async () => true) };
});
vi.mock('../src/cloud/CloudSync.js', () => ({ deleteRunSave: vi.fn() }));

import { showImportantHint, showMinorHint } from '../src/ui/HintDisplay.js';
import { transitionToScene } from '../src/utils/SceneRouter.js';
import { deleteRunSave } from '../src/cloud/CloudSync.js';
import { RunManager, saveRun, loadRun } from '../src/engine/RunManager.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import {
  commitPrologueEnd,
  finishPrologue,
  prologueChaptersWon,
} from '../src/ui/PrologueEnding.js';
import { TUTORIAL_COMPLETED_KEY, TUTORIAL_LESSONS_KEY } from '../src/ui/prologueLessons.js';
import { loadGameData } from './testData.js';
import { readFileSync } from 'fs';

const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null)),
  setItem: vi.fn((key, val) => {
    store[key] = String(val);
  }),
  removeItem: vi.fn((key) => {
    delete store[key];
  }),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

const data = {
  ...loadGameData(),
  dialogue: JSON.parse(readFileSync(new URL('../data/dialogue.json', import.meta.url), 'utf8')),
};
const META_KEY = 'emblem_rogue_slot_1_meta';

function makeScene({ cloud = null, won = true } = {}) {
  const rm = new RunManager(data, null);
  rm.startPrologue(data, data.prologue);
  if (won) {
    rm.completeBattle(rm.roster, 'prologue_0', 0);
    rm.completeBattle(rm.roster, 'prologue_1', 0);
    rm.currentNodeId = 'prologue_2b';
    rm.markNodeComplete('prologue_2b');
    rm.completeBattle(rm.roster, 'prologue_3', 0);
  }
  expect(saveRun(rm, null, 1).ok).toBe(true);
  const meta = new MetaProgressionManager(data.metaUpgrades, META_KEY);
  const registry = new Map([
    ['meta', meta],
    ['activeSlot', 1],
    ['audio', { stopMusic: vi.fn() }],
  ]);
  if (cloud) registry.set('cloud', cloud);
  const scene = {
    runManager: rm,
    gameData: data,
    registry: { get: (k) => registry.get(k) },
    dialogueOverlay: { showSequence: vi.fn(async () => true) },
    sys: { isActive: () => true },
  };
  return { scene, rm, meta, registry };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(store)) delete store[key];
});

describe('commitPrologueEnd', () => {
  it('records the slot (state, grant once, chapters, practised), the device, and clears the save', () => {
    const { scene, meta } = makeScene();
    expect(prologueChaptersWon(scene.runManager)).toEqual([
      'p1_banner_at_dawn',
      'p2_old_hands',
      'p3_seer_on_the_road',
    ]);
    const result = commitPrologueEnd(scene, {
      taught: ['battle_terrain'],
      practised: ['forecast'],
    });
    expect(result).toEqual({ ok: true, paid: true, grant: data.prologue.grant });
    expect(meta.getPrologue()).toEqual({
      state: 'complete',
      grantPaid: true,
      chaptersCompleted: ['p1_banner_at_dawn', 'p2_old_hands', 'p3_seer_on_the_road'],
      practised: ['forecast'],
    });
    expect(meta.totalValor).toBe(data.prologue.grant.valor);
    expect(meta.totalSupply).toBe(data.prologue.grant.supply);
    expect(meta.runsStarted).toBe(0);
    expect(store[TUTORIAL_COMPLETED_KEY]).toBe('1');
    expect(JSON.parse(store[TUTORIAL_LESSONS_KEY])).toEqual(['battle_terrain']);
    expect(loadRun(data, 1)).toBeNull();
  });

  it('a refresh after the meta write (the save still there) pays nothing and clears the save', () => {
    const { scene } = makeScene();
    commitPrologueEnd(scene);
    const saved = JSON.parse(store[META_KEY]);
    expect(saved.prologue.grantPaid).toBe(true);
    // The reload: a fresh meta reads the paid ledger; the run save is back on disk.
    const { scene: again, meta } = makeScene();
    expect(loadRun(data, 1)).not.toBeNull();
    const result = commitPrologueEnd(again);
    expect(result).toMatchObject({ ok: true, paid: false });
    expect(meta.totalValor).toBe(data.prologue.grant.valor);
    expect(loadRun(data, 1)).toBeNull();
  });

  it('a meta write that fails keeps the run save and reports it', () => {
    const { scene, meta } = makeScene();
    localStorageMock.setItem.mockImplementation((key, val) => {
      if (key === META_KEY) throw new Error('storage refused the write');
      store[key] = String(val);
    });
    expect(commitPrologueEnd(scene)).toEqual({ ok: false, reason: 'meta_write_failed' });
    expect(meta.getPrologueState()).toBe('none');
    expect(meta.totalValor).toBe(0);
    expect(loadRun(data, 1)).not.toBeNull();
    localStorageMock.setItem.mockImplementation((key, val) => {
      store[key] = String(val);
    });
  });

  it('routes the cloud delete only with a cloud session', () => {
    const { scene } = makeScene({ cloud: { userId: 'u-1' } });
    commitPrologueEnd(scene);
    expect(deleteRunSave).toHaveBeenCalledWith(
      'u-1',
      1,
      expect.objectContaining({ mode: 'prologue' }),
    );
    const { scene: offline } = makeScene();
    commitPrologueEnd(offline);
    expect(deleteRunSave).toHaveBeenCalledTimes(1);
  });
});

describe('finishPrologue', () => {
  it('plays the lines and the card, commits, stops the music and goes to Home Base', async () => {
    const { scene, meta, registry } = makeScene();
    expect(await finishPrologue(scene, { taught: new Set(['battle_loot']) })).toBe(true);
    const key = data.prologue.ending.dialogue;
    expect(scene.dialogueOverlay.showSequence).toHaveBeenCalledWith(
      data.dialogue.prologue[key].map((e) => ({
        speaker: e.speaker,
        line: e.line,
        portrait: null,
      })),
      { category: 'prologue', key },
    );
    expect(showImportantHint).toHaveBeenCalledWith(
      scene,
      data.prologue.ending.titleCard,
      expect.objectContaining({ actions: [{ label: 'Continue', value: true, primary: true }] }),
    );
    expect(meta.getPrologueState()).toBe('complete');
    expect(JSON.parse(store[TUTORIAL_LESSONS_KEY])).toEqual(['battle_loot']);
    expect(registry.get('audio').stopMusic).toHaveBeenCalled();
    expect(transitionToScene).toHaveBeenCalledWith(
      scene,
      'HomeBase',
      { gameData: data, prologueEnded: true },
      expect.objectContaining({ retryBlocked: true }),
    );
    // The lines and the card come before the write; the write before the transition.
    const order = [
      scene.dialogueOverlay.showSequence.mock.invocationCallOrder[0],
      showImportantHint.mock.invocationCallOrder[0],
      transitionToScene.mock.invocationCallOrder[0],
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(loadRun(data, 1)).toBeNull();
  });

  it('a failed meta write says so, keeps the save and never transitions', async () => {
    const { scene } = makeScene();
    localStorageMock.setItem.mockImplementation((key, val) => {
      if (key === META_KEY) throw new Error('storage refused the write');
      store[key] = String(val);
    });
    expect(await finishPrologue(scene)).toBe(false);
    expect(showMinorHint).toHaveBeenCalledWith(scene, expect.stringContaining('Save failed'));
    expect(transitionToScene).not.toHaveBeenCalled();
    expect(loadRun(data, 1)).not.toBeNull();
    localStorageMock.setItem.mockImplementation((key, val) => {
      store[key] = String(val);
    });
  });

  it('the ending plays once: a retry after a failed meta write or transition only commits and leaves', async () => {
    const { scene, meta } = makeScene();
    // First attempt: the meta write fails after the lines and the card.
    localStorageMock.setItem.mockImplementation((key, val) => {
      if (key === META_KEY) throw new Error('storage refused the write');
      store[key] = String(val);
    });
    expect(await finishPrologue(scene)).toBe(false);
    expect(scene.dialogueOverlay.showSequence).toHaveBeenCalledTimes(1);
    expect(showImportantHint).toHaveBeenCalledTimes(1);
    localStorageMock.setItem.mockImplementation((key, val) => {
      store[key] = String(val);
    });
    // Second attempt: the write lands but the transition doesn't start.
    vi.mocked(transitionToScene).mockResolvedValueOnce(false);
    expect(await finishPrologue(scene)).toBe(false);
    expect(meta.getPrologueState()).toBe('complete');
    // Third attempt (the force path): commits again (already paid) and leaves.
    expect(await finishPrologue(scene)).toBe(true);
    expect(transitionToScene).toHaveBeenCalledTimes(2);
    expect(meta.totalValor).toBe(data.prologue.grant.valor);
    // The lines and the card never replayed.
    expect(scene.dialogueOverlay.showSequence).toHaveBeenCalledTimes(1);
    expect(showImportantHint).toHaveBeenCalledTimes(1);
  });

  it('refuses outside the prologue run', async () => {
    const rm = new RunManager(data, null);
    rm.startRun({ difficultyId: 'normal' });
    const scene = { runManager: rm, gameData: data, registry: { get: () => null } };
    expect(await finishPrologue(scene)).toBe(false);
    expect(transitionToScene).not.toHaveBeenCalled();
  });
});
