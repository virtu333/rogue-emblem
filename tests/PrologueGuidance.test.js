// The Guidance setting in the prologue (engine/Guidance.js prologueGuidanceAllows): Full
// shows everything, Light drops the tips, Off drops the field notes (the deploy screen's
// included) and the guided steps too. The controller's side is in
// PrologueController.test.js ("the Guidance setting").
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/HintDisplay.js', () => ({
  showImportantHint: vi.fn(async () => true),
  showMinorHint: vi.fn(),
}));

import { showImportantHint } from '../src/ui/HintDisplay.js';
import { prologueGuidanceAllows } from '../src/engine/Guidance.js';
import { showPrologueDeployNote } from '../src/ui/PrologueDeployNote.js';
import { prologueBattleParams } from '../src/engine/ScriptedBattle.js';
import { prologueBeatsFor } from '../src/engine/Prologue.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const p4 = data.prologue.chapters.find((c) => c.id === 'p4_quarry_gate');

describe('prologueGuidanceAllows', () => {
  it('Full shows tips, notes and guided steps; Light only notes and guided steps; Off none', () => {
    const table = {};
    for (const level of ['full', 'light', 'off'])
      table[level] = ['tip', 'note', 'guided'].filter((k) => prologueGuidanceAllows(level, k));
    expect(table).toEqual({
      full: ['tip', 'note', 'guided'],
      light: ['note', 'guided'],
      off: [],
    });
  });
});

describe("the deploy screen's note follows the setting", () => {
  beforeEach(() => vi.clearAllMocks());

  const sceneWith = (guidance, meta = null) => ({
    battleParams: prologueBattleParams(p4, { seed: 1209 }),
    gameData: data,
    runManager: null,
    isMobileInput: false,
    registry: {
      get: (key) =>
        key === 'settings'
          ? { getGuidance: () => guidance }
          : key === 'meta'
            ? meta
            : key === 'hints'
              ? { hasSeen: () => false, markSeen: vi.fn() }
              : null,
    },
  });

  it('shows under Full and Light, never under Off (and records nothing taught then)', async () => {
    expect(p4.deploy?.note).toBeTruthy();
    for (const level of ['full', 'light']) {
      vi.clearAllMocks();
      const scene = sceneWith(level);
      await showPrologueDeployNote(scene, { max: 3 });
      expect(showImportantHint).toHaveBeenCalledTimes(1);
      expect(scene._prologueDeployTaught.length).toBeGreaterThan(0);
    }
    vi.clearAllMocks();
    const off = sceneWith('off');
    expect(showPrologueDeployNote(off, { max: 3 })).toBeNull();
    expect(showImportantHint).not.toHaveBeenCalled();
    expect(off._prologueDeployTaught).toBeUndefined();
  });

  it('Auto follows the slot: Full before a finished run (the note shows), Light after (it still shows)', async () => {
    await showPrologueDeployNote(sceneWith('auto', { runsCompleted: 0 }), { max: 3 });
    await showPrologueDeployNote(sceneWith('auto', { runsCompleted: 2 }), { max: 3 });
    expect(showImportantHint).toHaveBeenCalledTimes(2);
  });
});

describe("prologueBeatsFor's one-note slot and what will be heard", () => {
  const chapter = {
    beats: [
      { id: 't', on: 'afterMove', once: true, do: [{ tip: 'x' }, { markLesson: { id: 'a' } }] },
      { id: 'n', on: 'afterMove', once: true, do: [{ note: 'y' }] },
    ],
  };
  const event = { type: 'afterMove' };

  it('by default the first beat that speaks takes the slot; the next waits unspent', () => {
    const { fired } = prologueBeatsFor(chapter, event, {}, { oneNote: true });
    expect(fired).toEqual(['t']);
  });

  it('a beat nobody will hear still fires (its other actions run) but leaves the slot', () => {
    const heard = (a) => !('tip' in a);
    const { fired, actions } = prologueBeatsFor(chapter, event, {}, { oneNote: true, heard });
    expect(fired).toEqual(['t', 'n']);
    expect(actions.map((a) => Object.keys(a)[0])).toEqual(['tip', 'markLesson', 'note']);
  });
});
