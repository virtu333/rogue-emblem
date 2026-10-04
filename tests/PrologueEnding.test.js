// The prologue's ending (docs/specs/prologue-chapter.md §5 beats 7-8, §9): its scenes
// (music, cues, the shake, the veils, the lines) and title card play, then one meta write (state complete, the grant paid once), the
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
const ceremonyCalls = [];
vi.mock('../src/ui/CeremonyController.js', () => ({
  CeremonyController: class {
    static available() {
      return true;
    }
    showVeil(kind) {
      ceremonyCalls.push(['veil', kind]);
      return { close: vi.fn() };
    }
    showRunEnd(args, opts) {
      ceremonyCalls.push(['runEnd', opts]);
      return { close: vi.fn() };
    }
    destroy() {
      ceremonyCalls.push(['destroy']);
    }
  },
}));

import { showImportantHint, showMinorHint } from '../src/ui/HintDisplay.js';
import { transitionToScene } from '../src/utils/SceneRouter.js';
import { deleteRunSave } from '../src/cloud/CloudSync.js';
import { RunManager, saveRun, loadRun } from '../src/engine/RunManager.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import {
  commitPrologueEnd,
  finishPrologue,
  prologueChaptersWon,
  endingLinesFor,
  prologueEndingScenes,
} from '../src/ui/PrologueEnding.js';
import { PROLOGUE_THREAD_CARD } from '../src/data/prologueContent.js';
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

function makeScene({ cloud = null, won = true, reduceMotion = false } = {}) {
  const rm = new RunManager(data, null);
  rm.startPrologue(data, data.prologue);
  if (won) {
    rm.completeBattle(rm.roster, 'prologue_0', 0);
    rm.completeBattle(rm.roster, 'prologue_1', 0);
    rm.currentNodeId = 'prologue_2b';
    rm.markNodeComplete('prologue_2b');
    rm.completeBattle(rm.roster, 'prologue_3', 0);
    rm.currentNodeId = 'prologue_4';
    rm.markNodeComplete('prologue_4');
    rm.completeBattle(rm.roster, 'prologue_5', 0);
  }
  expect(saveRun(rm, null, 1).ok).toBe(true);
  const meta = new MetaProgressionManager(data.metaUpgrades, META_KEY);
  const registry = new Map([
    ['meta', meta],
    ['activeSlot', 1],
    [
      'audio',
      {
        stopMusic: vi.fn(),
        playMusic: vi.fn(async () => {}),
        playStinger: vi.fn(async () => null),
      },
    ],
    ['settings', { getReduceMotion: () => reduceMotion }],
  ]);
  if (cloud) registry.set('cloud', cloud);
  const scene = {
    runManager: rm,
    gameData: data,
    registry: { get: (k) => registry.get(k) },
    dialogueOverlay: { showSequence: vi.fn(async () => true) },
    sys: { isActive: () => true },
    cameras: { main: { shake: vi.fn() } },
  };
  return { scene, rm, meta, registry };
}

beforeEach(() => {
  vi.clearAllMocks();
  ceremonyCalls.length = 0;
  for (const key of Object.keys(store)) delete store[key];
});

describe('commitPrologueEnd', () => {
  it('records the slot (state, grant once, chapters, practised), the device, and clears the save', () => {
    const { scene, meta } = makeScene();
    expect(prologueChaptersWon(scene.runManager)).toEqual([
      'p1_banner_at_dawn',
      'p2_old_hands',
      'p3_seer_on_the_road',
      'p4_quarry_gate',
    ]);
    const result = commitPrologueEnd(scene, {
      taught: ['battle_terrain'],
      practised: ['forecast'],
    });
    expect(result).toEqual({ ok: true, paid: true, grant: data.prologue.grant });
    expect(meta.getPrologue()).toEqual({
      state: 'complete',
      grantPaid: true,
      chaptersCompleted: [
        'p1_banner_at_dawn',
        'p2_old_hands',
        'p3_seer_on_the_road',
        'p4_quarry_gate',
      ],
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
  it('plays the scenes and the card, commits, stops the music and goes to Home Base', async () => {
    const { scene, meta, registry } = makeScene();
    // The whole army of a finished prologue (Tamsin and Sera joined on the road).
    scene.runManager.roster.push(
      { name: 'Tamsin', className: 'Archer', faction: 'player' },
      { name: 'Sera', className: 'Light Sage', isLord: true, faction: 'player' },
    );
    expect(await finishPrologue(scene, { taught: new Set(['battle_loot']) })).toBe(true);
    // The three scenes' lines, in order, each speaker with a lord's portrait.
    const keys = ['ending_east', 'ending_ridge', 'ending_thread'];
    expect(scene.dialogueOverlay.showSequence.mock.calls.map(([, opts]) => opts)).toEqual(
      keys.map((key) => ({ category: 'prologue', key })),
    );
    // Lords speak with their own faces, Gaspar with his (Tamsin's class face needs the
    // atlas, which a test has none of).
    const face = { Edric: 'portrait_lord_edric', Sera: 'portrait_lord_sera' };
    face.Gaspar = 'portrait_special_old_knight';
    for (const [i, key] of keys.entries()) {
      const shown = scene.dialogueOverlay.showSequence.mock.calls[i][0];
      expect(shown.map(({ speaker, line }) => ({ speaker, line }))).toEqual(
        data.dialogue.prologue[key].map((e) => ({ speaker: e.speaker, line: e.line })),
      );
      for (const entry of shown)
        if (face[entry.speaker]) expect(entry.portrait).toBe(face[entry.speaker]);
    }
    // Sera's last line is the spec's, word for word.
    expect(data.dialogue.prologue.ending_thread.at(-1)).toMatchObject({
      speaker: 'Sera',
      line: 'Not like this. I know this road now. Again, from the morning I reached you.',
    });
    const audio = registry.get('audio');
    expect(audio.playMusic).toHaveBeenCalledWith('music_explore_deep', scene, expect.any(Number));
    expect(audio.playStinger.mock.calls.map(([name]) => name)).toEqual(['eclipse', 'rewind']);
    expect(scene.cameras.main.shake).toHaveBeenCalledTimes(1);
    // The hollow sun, then the thread cut (the run-end card with the prologue's words).
    expect(ceremonyCalls).toEqual([
      ['veil', 'hollow_sun'],
      ['runEnd', { withLines: true, content: PROLOGUE_THREAD_CARD }],
      ['destroy'],
    ]);
    expect(showImportantHint).toHaveBeenCalledWith(
      scene,
      data.prologue.ending.titleCard,
      expect.objectContaining({ actions: [{ label: 'Continue', value: true, primary: true }] }),
    );
    expect(meta.getPrologueState()).toBe('complete');
    expect(JSON.parse(store[TUTORIAL_LESSONS_KEY])).toEqual(['battle_loot']);
    expect(audio.stopMusic).toHaveBeenCalled();
    expect(transitionToScene).toHaveBeenCalledWith(
      scene,
      'HomeBase',
      { gameData: data, prologueEnded: true },
      expect.objectContaining({ retryBlocked: true }),
    );
    // The lines and the card come before the write; the write before the transition.
    const order = [
      scene.dialogueOverlay.showSequence.mock.invocationCallOrder[2],
      showImportantHint.mock.invocationCallOrder[0],
      transitionToScene.mock.invocationCallOrder[0],
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(loadRun(data, 1)).toBeNull();
  });

  it('Reduce motion keeps the ground still; everything else plays', async () => {
    const { scene } = makeScene({ reduceMotion: true });
    expect(await finishPrologue(scene)).toBe(true);
    expect(scene.cameras.main.shake).not.toHaveBeenCalled();
    expect(scene.dialogueOverlay.showSequence).toHaveBeenCalledTimes(3);
  });

  it('a scene leaving mid-ending stops the ending and writes nothing', async () => {
    const { scene, meta } = makeScene();
    let active = true;
    scene.sys.isActive = () => active;
    scene.dialogueOverlay.showSequence = vi.fn(async () => {
      active = false;
    });
    expect(await finishPrologue(scene)).toBe(false);
    expect(scene.dialogueOverlay.showSequence).toHaveBeenCalledTimes(1);
    expect(showImportantHint).not.toHaveBeenCalled();
    expect(meta.getPrologueState()).toBe('none');
    expect(loadRun(data, 1)).not.toBeNull();
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
    expect(scene.dialogueOverlay.showSequence).toHaveBeenCalledTimes(3);
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
    expect(scene.dialogueOverlay.showSequence).toHaveBeenCalledTimes(3);
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

describe('the grant under faults (one grant, a recoverable continuation, Home Base in the end)', () => {
  const grant = () => data.prologue.grant.valor;

  it('a device that refuses the lesson record (before the meta write) never blocks the ending', async () => {
    const { scene, meta } = makeScene();
    localStorageMock.setItem.mockImplementation((key, val) => {
      if (key === TUTORIAL_COMPLETED_KEY || key === TUTORIAL_LESSONS_KEY)
        throw new Error('storage refused the write');
      store[key] = String(val);
    });
    expect(await finishPrologue(scene, { taught: new Set(['battle_loot']) })).toBe(true);
    expect(meta.getPrologueState()).toBe('complete');
    expect(meta.totalValor).toBe(grant());
    expect(transitionToScene).toHaveBeenCalledTimes(1);
    expect(loadRun(data, 1)).toBeNull();
    localStorageMock.setItem.mockImplementation((key, val) => {
      store[key] = String(val);
    });
  });

  it('a meta write that throws (not merely refuses) pays nothing; the retry pays once', async () => {
    const { scene, meta } = makeScene();
    const real = meta.completePrologue.bind(meta);
    meta.completePrologue = vi.fn(() => {
      throw new Error('quota');
    });
    expect(await finishPrologue(scene)).toBe(false);
    expect(meta.getPrologueState()).toBe('none');
    expect(meta.totalValor).toBe(0);
    expect(transitionToScene).not.toHaveBeenCalled();
    expect(loadRun(data, 1)).not.toBeNull();
    meta.completePrologue = real;
    expect(await finishPrologue(scene)).toBe(true);
    expect(meta.totalValor).toBe(grant());
    expect(loadRun(data, 1)).toBeNull();
  });

  it('the transition throws after the payment: nothing is thrown, no second grant, the retry leaves', async () => {
    const { scene, meta } = makeScene();
    vi.mocked(transitionToScene).mockRejectedValueOnce(new Error('scene manager down'));
    expect(await finishPrologue(scene)).toBe(false);
    expect(meta.getPrologueState()).toBe('complete');
    expect(meta.totalValor).toBe(grant());
    expect(loadRun(data, 1)).toBeNull();
    expect(await finishPrologue(scene)).toBe(true);
    expect(meta.totalValor).toBe(grant());
    expect(transitionToScene).toHaveBeenCalledTimes(2);
    // The ending's lines never replayed on the retry.
    expect(scene.dialogueOverlay.showSequence).toHaveBeenCalledTimes(3);
  });

  it('a crash after the payment, before the save cleared: the route map reaches the ending again, pays nothing, leaves', async () => {
    const { scene, meta, rm } = makeScene();
    expect(commitPrologueEnd(scene).paid).toBe(true);
    // The clear never landed (the tab died): the run save is still there on reload.
    expect(saveRun(rm, null, 1).ok).toBe(true);
    expect(loadRun(data, 1)).not.toBeNull();
    const again = makeScene({ won: true });
    again.scene.registry = scene.registry; // the same slot's meta
    expect(await finishPrologue(again.scene)).toBe(true);
    expect(meta.totalValor).toBe(grant());
    expect(meta.getPrologueState()).toBe('complete');
    expect(loadRun(data, 1)).toBeNull();
    expect(transitionToScene).toHaveBeenCalledTimes(1);
  });

  it('two completion attempts in flight at once pay once', async () => {
    const { scene, meta } = makeScene();
    const [a, b] = await Promise.all([finishPrologue(scene), finishPrologue(scene)]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(meta.totalValor).toBe(grant());
    expect(meta.totalSupply).toBe(data.prologue.grant.supply);
    expect(loadRun(data, 1)).toBeNull();
  });
});

describe('prologueEndingScenes', () => {
  it("reads the data's scenes; a lone dialogue key (the Phase 2 shape) is one scene", () => {
    expect(prologueEndingScenes(data.prologue)).toEqual([
      { dialogue: 'ending_east', cue: 'eclipse', shake: true, veil: 'hollow_sun' },
      { dialogue: 'ending_ridge', cue: null, shake: false, veil: null },
      { dialogue: 'ending_thread', cue: 'rewind', shake: false, veil: 'thread' },
    ]);
    expect(prologueEndingScenes({ ending: { dialogue: 'ending' } })).toEqual([
      { dialogue: 'ending', cue: null, shake: false, veil: null },
    ]);
    expect(prologueEndingScenes({ ending: { scenes: [null, {}, { shake: 'yes' }] } })).toEqual([]);
    expect(prologueEndingScenes(null)).toEqual([]);
  });
});

describe('endingLinesFor (a skip plays the ending before the army met everyone)', () => {
  const lines = data.dialogue.prologue;
  const cast = ['ending_east', 'ending_ridge', 'ending_thread'].flatMap((k) =>
    lines[k].map((e) => e.speaker),
  );
  const play = (army) =>
    ['ending_east', 'ending_ridge', 'ending_thread'].flatMap((k) =>
      endingLinesFor(lines[k], army, cast).map((e) => `${e.speaker}: ${e.line}`),
    );

  it('the whole army hears every line, as written', () => {
    const all = play(['Edric', 'Gaspar', 'Tamsin', 'Sera']);
    expect(all).toHaveLength(9);
    expect(all.at(-1)).toBe(
      'Sera: Not like this. I know this road now. Again, from the morning I reached you.',
    );
  });

  it('skipped in P1 (Edric alone): Sera is a voice not yet met, nobody unmet speaks or is named', () => {
    expect(play(['Edric'])).toEqual([
      '???: The ring has closed. They are finishing it. Today, not in a year.',
      'Edric: The sun. Something is eating the sun.',
      '???: The Hollow Sun. Under the stones, what they fed is turning over.',
      '???: Not like this. I know this road now. Again, from the morning I reached you.',
    ]);
  });

  it('skipped before P3 (no Sera yet): Gaspar and Tamsin speak; Edric never names Sera', () => {
    const heard = play(['Edric', 'Gaspar', 'Tamsin']);
    expect(heard.some((l) => l.startsWith('Sera:'))).toBe(false);
    expect(heard.some((l) => l.includes('Sera,'))).toBe(false);
    expect(heard).toContain('Gaspar: On the far ridge. A pale man, watching us. He does not run.');
    expect(heard.at(-1)).toMatch(/^\?\?\?: Not like this/);
  });
});
