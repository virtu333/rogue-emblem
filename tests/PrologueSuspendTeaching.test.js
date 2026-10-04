// Unfinished teaching survives a suspend as data (review, 2026-10-04; docs/specs/
// prologue-chapter.md §9 "What survives suspend"). A checkpoint used to record a beat as
// fired and its hints as taught the moment it matched, while its line was still open or
// its note still waiting for a playable turn: a reload then resumed a chapter whose
// lesson was never seen, and the taught hint ids suppressed the in-run explanation for
// good. Now the controller keeps every unread note and line set as a pending record
// (scheduled or displayed), the snapshot carries them, a resume shows them again in
// order, and a hint is marked read only when its note is acknowledged. Cancelled deferred
// tasks settle (false) instead of hanging, and never run against a replacement session.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { hintCalls } = vi.hoisted(() => ({ hintCalls: [] }));
vi.mock('../src/ui/HintDisplay.js', () => ({
  showImportantHint: vi.fn(
    (_scene, text) => new Promise((resolve) => hintCalls.push({ text, resolve })),
  ),
  showMinorHint: vi.fn(),
}));
vi.mock('../src/utils/SceneRouter.js', async () => {
  const actual = await vi.importActual('../src/utils/SceneRouter.js');
  return { ...actual, transitionToScene: vi.fn(async () => true), restartScene: vi.fn(() => true) };
});

import { showImportantHint } from '../src/ui/HintDisplay.js';
import { loadGameData } from './testData.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { buildPrologueBattleConfig, buildPrologueRoster } from '../src/engine/Prologue.js';
import { RunManager } from '../src/engine/RunManager.js';
import { PrologueController } from '../src/ui/PrologueController.js';
import { prologueBattleParams } from '../src/engine/ScriptedBattle.js';
import { readFileSync } from 'fs';

const data = {
  ...loadGameData(),
  dialogue: JSON.parse(readFileSync(new URL('../data/dialogue.json', import.meta.url), 'utf8')),
};
const chapterOf = (id) => data.prologue.chapters.find((c) => c.id === id);

const tick = async (n = 8) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};
async function settled(promise) {
  const token = Symbol('pending');
  return (await Promise.race([promise, Promise.resolve(token)])) !== token;
}

/** A fake BattleScene around the headless board of a chapter, in the prologue run. */
function makeScene(chapterId, { run = true, deploy = null } = {}) {
  installSeed(5);
  const chapter = chapterOf(chapterId);
  const config = buildPrologueBattleConfig(chapter, data.terrain);
  let rm = null;
  let battleParams = prologueBattleParams(chapter, { seed: 1209 });
  let roster = buildPrologueRoster(data.prologue, data, chapter);
  if (run) {
    rm = new RunManager(data, null);
    rm.startPrologue(data, data.prologue);
    rm.completeBattle(rm.roster, 'prologue_0', 0);
    rm.completeBattle(rm.roster, 'prologue_1', 0);
    rm.currentNodeId = 'prologue_2b';
    rm.arriveAtPrologueNode('prologue_2b');
    rm.markNodeComplete('prologue_2b');
    let nodeId = 'prologue_3';
    if (chapterId === 'p4_quarry_gate') {
      const sera = buildPrologueRoster(data.prologue, data, chapter).find((u) => u.name === 'Sera');
      rm.completeBattle([...rm.getRoster(), sera], 'prologue_3', 0);
      rm.currentNodeId = 'prologue_4';
      rm.markNodeComplete('prologue_4');
      nodeId = 'prologue_5';
    }
    const node = rm.nodeMap.nodes.find((n) => n.id === nodeId);
    rm.beginBattleInProgress(node.id, { battleParams: rm.getBattleParams(node) });
    battleParams = rm.getBattleParams(node);
    roster = rm.getRoster();
  }
  const fielded = deploy ? deploy.map((n) => roster.find((u) => u.name === n)) : roster;
  const battle = new HeadlessBattle(data, { act: 'act1', objective: chapter.objective }, fielded);
  battle.init({ battleConfig: config });
  const hints = { markSeen: vi.fn(), hasSeen: () => false, shouldShow: () => false };
  const meta = { recordPrologueChapter: vi.fn(), recordProloguePractised: vi.fn() };
  const lines = [];
  const scene = {
    gameData: data,
    battleParams,
    runManager: rm,
    nodeId: rm?.battleInProgress?.nodeId || null,
    turnPar: battle.turnPar,
    getVisionChargesRemaining: () => rm?.visionChargesRemaining || 0,
    _persistBattleRunState: vi.fn(),
    playerUnits: battle.playerUnits,
    enemyUnits: battle.enemyUnits,
    npcUnits: battle.npcUnits,
    grid: Object.assign(battle.grid, { gridToPixel: (c, r) => ({ x: c * 32, y: r * 32 }) }),
    threatContext: () => battle._playerThreatContext(),
    findAttackTargets: (u) => battle._findAttackTargets(u),
    turnManager: { turnNumber: 1, currentPhase: 'player' },
    battleState: 'PLAYER_IDLE',
    isMobileInput: false,
    events: { on: vi.fn(), off: vi.fn(), once: vi.fn() },
    sys: { isActive: () => true },
    registry: { get: (key) => (key === 'hints' ? hints : key === 'meta' ? meta : null) },
    add: { rectangle: vi.fn(() => ({ setStrokeStyle() { return this; }, setDepth() { return this; }, destroy: vi.fn() })) }, // prettier-ignore
    tweens: { add: vi.fn() },
    _reduceMotion: () => true,
    refreshEndTurnControl: vi.fn(),
    updateVisionHud: vi.fn(),
    showBriefBanner: vi.fn(async () => {}),
    isStoryInputLocked: () => Boolean(scene.dialogueOverlay.visible),
    _getPortraitKey: () => null,
    dialogueOverlay: {
      visible: false,
      showSequence: vi.fn((entries, options) => {
        scene.dialogueOverlay.visible = true;
        return new Promise((resolve) => {
          lines.push({
            key: options?.key,
            entries,
            finish: (completed = true) => {
              scene.dialogueOverlay.visible = false;
              resolve(completed);
            },
          });
        });
      }),
    },
    onDefeat: vi.fn(),
    showLordDeathVisionPrompt: vi.fn(() => false),
    clearInspectionVisuals: vi.fn(),
    hideActionMenu: vi.fn(),
    dangerZone: { hide: vi.fn() },
    _battleSession: 1,
  };
  return { scene, battle, rm, hints, lines };
}

const flush = async (prologue, n = 12) => {
  for (let i = 0; i < n; i++) {
    prologue.flushDeferred();
    await tick(3);
  }
};

beforeEach(() => {
  hintCalls.length = 0;
  vi.clearAllMocks();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
});
afterEach(() => {
  restoreMathRandom();
  vi.unstubAllGlobals();
});

describe('P3: a reload during the opening conversation', () => {
  it('the checkpoint carries the open lines and the waiting note, and nothing is taught yet', async () => {
    const { scene, hints, lines } = makeScene('p3_seer_on_the_road');
    scene.battleState = 'TURN_START_RESOLVING';
    const first = new PrologueController(scene).create();
    first.onPhaseStart('player', 1);
    await tick();
    expect(lines.map((l) => l.key)).toEqual(['p3_intro']);
    // The pipeline sets the turn idle under the open lines and captures a checkpoint.
    scene.battleState = 'PLAYER_IDLE';
    await flush(first, 3);
    const state = structuredClone(first.snapshot());
    expect(state.version).toBe(2);
    expect(state.fired).toContain('p3_intro');
    expect(state.coachGoal).toBe('p3_reach_sera');
    expect(state.pending).toEqual([
      { beat: 'p3_intro', kind: 'dialogue', id: 'p3_intro', text: null, event: null, status: 'displayed' }, // prettier-ignore
      {
        beat: 'p3_intro',
        kind: 'note',
        id: 'p3_recruit',
        text: expect.stringContaining('Sera (Light Sage) under the gold banner can join you.'),
        event: { type: 'battleStart', phase: null, turn: null },
        status: 'scheduled',
      },
    ]);
    expect(state.taught).toEqual([]);
    expect(hints.markSeen).not.toHaveBeenCalled();
    // The reload tears the scene down mid-line: still nothing taught.
    lines[0].finish(false);
    first.destroy();
    await tick();
    expect(hints.markSeen).not.toHaveBeenCalled();

    // Resume Battle: the lines replay whole, then the note shows, and only an
    // acknowledged note marks the slot's hint read. The opening never fires twice.
    const { scene: again, hints: hints2, lines: lines2 } = makeScene('p3_seer_on_the_road');
    const resumed = new PrologueController(again).create();
    resumed.onResume(state, { turn: 1, phase: 'player' });
    expect(resumed.scripted()).toMatchObject({ id: 'p3_reach_sera' });
    await flush(resumed, 3);
    expect(lines2.map((l) => l.key)).toEqual(['p3_intro']);
    expect(lines2[0].entries.map((e) => e.speaker)).toEqual(
      data.dialogue.prologue.p3_intro.map((e) => e.speaker),
    );
    expect(hintCalls).toHaveLength(0);
    lines2[0].finish(true);
    await flush(resumed, 3);
    expect(hintCalls.map((h) => h.text)).toEqual([state.pending[1].text]);
    expect(resumed.snapshot().pending).toEqual([{ ...state.pending[1], status: 'displayed' }]);
    expect(hints2.markSeen).not.toHaveBeenCalled();
    hintCalls[0].resolve(true);
    await tick();
    expect(hints2.markSeen).toHaveBeenCalledWith('guide_recruit_on_map');
    expect([...resumed.taught]).toEqual(['guide_recruit_on_map']);
    expect(resumed.snapshot().pending).toEqual([]);
    expect(resumed.beatState.fired.filter((id) => id === 'p3_intro')).toHaveLength(1);
    expect(again.dialogueOverlay.showSequence).toHaveBeenCalledTimes(1);
  });
});

describe('P4: the seize note scheduled before the first checkpoint', () => {
  it('a checkpoint before the note shows carries it scheduled; the resume shows it once and marks it then', async () => {
    const { scene, hints } = makeScene('p4_quarry_gate', { deploy: ['Edric', 'Gaspar', 'Sera'] });
    scene.battleState = 'TURN_START_RESOLVING';
    const first = new PrologueController(scene).create();
    first.onPhaseStart('player', 1);
    await tick();
    // The note waits for a playable turn; the checkpoint lands first.
    const state = structuredClone(first.snapshot());
    expect(state.fired).toEqual(expect.arrayContaining(['p4_start']));
    expect(state.pending).toEqual([
      expect.objectContaining({ beat: 'p4_start', kind: 'note', id: 'p4_seize_par', status: 'scheduled' }), // prettier-ignore
    ]);
    expect(state.pending[0].text).toContain('Par: win in 10 turns or fewer');
    expect(state.taught).toEqual([]);
    expect(state.shown).toEqual(expect.arrayContaining(['seize', 'par']));
    expect(hints.markSeen).not.toHaveBeenCalled();
    expect(hintCalls).toHaveLength(0);
    first.destroy();

    const { scene: again, hints: hints2 } = makeScene('p4_quarry_gate', { deploy: ['Edric', 'Gaspar', 'Sera'] }); // prettier-ignore
    const resumed = new PrologueController(again).create();
    resumed.onResume(state, { turn: 1, phase: 'player' });
    expect(resumed.scripted()).toMatchObject({ goal: 'Defeat Captain Varro, then Seize the gate' });
    await flush(resumed, 3);
    expect(hintCalls.map((h) => h.text)).toEqual([state.pending[0].text]);
    hintCalls[0].resolve(true);
    await tick();
    expect(hints2.markSeen).toHaveBeenCalledWith('battle_seize');
    expect(hints2.markSeen).toHaveBeenCalledWith('battle_par');
    expect(resumed.snapshot().pending).toEqual([]);
    // Shown once: the beat is spent, and the resume added no second note.
    await flush(resumed, 3);
    expect(showImportantHint).toHaveBeenCalledTimes(1);
  });

  it('a note torn down unread stays pending as displayed; acknowledged, it leaves', async () => {
    const { scene, hints } = makeScene('p4_quarry_gate', { deploy: ['Edric', 'Gaspar', 'Sera'] });
    const prologue = new PrologueController(scene).create();
    prologue.onPhaseStart('player', 1);
    await flush(prologue, 2);
    expect(hintCalls).toHaveLength(1);
    expect(prologue.snapshot().pending[0]).toMatchObject({ id: 'p4_seize_par', status: 'displayed' }); // prettier-ignore
    // The scene shuts down under the note (showImportantHint resolves false).
    hintCalls[0].resolve(false);
    await tick();
    expect(prologue.snapshot().pending[0]).toMatchObject({ id: 'p4_seize_par', status: 'displayed' }); // prettier-ignore
    expect(hints.markSeen).not.toHaveBeenCalled();
    expect([...prologue.taught]).toEqual([]);
  });

  it('a version-1 checkpoint (no pending list) still resumes as before', () => {
    const { scene } = makeScene('p4_quarry_gate', { deploy: ['Edric', 'Gaspar', 'Sera'] });
    const prologue = new PrologueController(scene).create();
    prologue.onResume({ version: 1, started: true, fired: ['p4_start'], taught: ['battle_seize'], coachGoal: 'p4_objective' }, { turn: 1, phase: 'player' }); // prettier-ignore
    expect(prologue.scripted()).toMatchObject({ id: 'p4_objective' });
    expect([...prologue.taught]).toEqual(['battle_seize']);
    expect(prologue.snapshot().pending).toEqual([]);
  });
});

describe('cancelled teaching settles', () => {
  it('destroy settles every deferred task as cancelled, and the task never runs', async () => {
    const { scene, hints } = makeScene('p4_quarry_gate', { deploy: ['Edric', 'Gaspar', 'Sera'] });
    scene.battleState = 'TURN_START_RESOLVING';
    const prologue = new PrologueController(scene).create();
    const opening = prologue.emit({ type: 'battleStart' });
    await tick();
    expect(await settled(opening)).toBe(false);
    prologue.destroy();
    expect(await opening).toBe(false);
    // A replacement session's frames never run the cancelled note.
    scene.battleState = 'PLAYER_IDLE';
    prologue.flushDeferred();
    await tick();
    expect(showImportantHint).not.toHaveBeenCalled();
    expect(hints.markSeen).not.toHaveBeenCalled();
    expect(prologue.snapshot().pending).toEqual([]);
  });

  it('a rewind and a restart drop the waiting notes the same way, settled', async () => {
    const { scene } = makeScene('p3_seer_on_the_road');
    scene.battleState = 'TURN_START_RESOLVING';
    const prologue = new PrologueController(scene).create();
    scene.playerUnits[0].currentHP -= 8;
    const turnStart = prologue.emit({ type: 'turnStart', turn: 2, phase: 'player', hurt: true });
    await tick();
    expect(prologue.snapshot().pending).toEqual([expect.objectContaining({ id: 'p3_rewind', status: 'scheduled' })]); // prettier-ignore
    expect(await settled(turnStart)).toBe(false);
    await prologue.onRewound();
    expect(await turnStart).toBe(false);
    expect(prologue.snapshot().pending).toEqual([]);
    scene.battleState = 'PLAYER_IDLE';
    await flush(prologue, 2);
    expect(showImportantHint).not.toHaveBeenCalled();
  });
});
