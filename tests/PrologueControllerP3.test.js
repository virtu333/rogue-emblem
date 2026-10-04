// PrologueController in P3, "The Seer on the Road" (docs/specs/prologue-chapter.md §6 P3),
// on a fake scene around the headless P3 battle: Talk wired (Sera's authored line, her
// lesson starts, she acts at once), Sera protected green or blue, one note per move,
// the heal note naming the hurt ally, the rewind exercise (the one Vision charge granted
// once, Open Rewind, "Same turn, better plan" after the replayed move). Then what the
// review found in Phases 1B/2A: a resumed chapter keeps its teaching state (no second
// opening, the gate where it was), a successful rewind lets a later fall offer a charge
// again, and a failed Skip leaves the chapter playable with a real retry.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/HintDisplay.js', () => ({
  showImportantHint: vi.fn(async () => true),
  showMinorHint: vi.fn(),
}));
vi.mock('../src/utils/SceneRouter.js', async () => {
  const actual = await vi.importActual('../src/utils/SceneRouter.js');
  return {
    ...actual,
    transitionToScene: vi.fn(async () => true),
    restartScene: vi.fn(() => true),
  };
});
vi.mock('../src/ui/PrologueEnding.js', async () => {
  const actual = await vi.importActual('../src/ui/PrologueEnding.js');
  return { ...actual, finishPrologue: vi.fn(async () => true) };
});

import { showImportantHint } from '../src/ui/HintDisplay.js';
import { restartScene } from '../src/utils/SceneRouter.js';
import { finishPrologue } from '../src/ui/PrologueEnding.js';
import { loadGameData } from './testData.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import {
  buildPrologueBattleConfig,
  buildPrologueRoster,
  buildPrologueNpcUnit,
} from '../src/engine/Prologue.js';
import { RunManager } from '../src/engine/RunManager.js';
import { PrologueController } from '../src/ui/PrologueController.js';
import { prologueBattleParams } from '../src/engine/ScriptedBattle.js';
import { readFileSync } from 'fs';
import { installFakeDom } from './helpers/fakeDom.js';

const data = {
  ...loadGameData(),
  dialogue: JSON.parse(readFileSync(new URL('../data/dialogue.json', import.meta.url), 'utf8')),
};
const p1 = data.prologue.chapters.find((c) => c.id === 'p1_banner_at_dawn');
const p3 = data.prologue.chapters.find((c) => c.id === 'p3_seer_on_the_road');
const config = buildPrologueBattleConfig(p3, data.terrain);

/** The prologue run standing on P3's node, the battle flag at its entry. */
function p3Run() {
  const rm = new RunManager(data, null);
  rm.startPrologue(data, data.prologue);
  rm.completeBattle(rm.roster, 'prologue_0', 0);
  rm.completeBattle(rm.roster, 'prologue_1', 0);
  rm.currentNodeId = 'prologue_2b';
  rm.arriveAtPrologueNode('prologue_2b');
  rm.markNodeComplete('prologue_2b');
  const node = rm.nodeMap.nodes.find((n) => n.id === 'prologue_3');
  rm.beginBattleInProgress(node.id, { battleParams: rm.getBattleParams(node) });
  return { rm, node };
}

/** A fake BattleScene around the real P3 board (standalone, or `run`). */
function makeP3({ run = false } = {}) {
  installSeed(5);
  let rm = null;
  let battleParams = prologueBattleParams(p3, { seed: 1209 });
  let roster = buildPrologueRoster(data.prologue, data, p3);
  if (run) {
    const made = p3Run();
    rm = made.rm;
    battleParams = rm.getBattleParams(made.node);
    roster = rm.getRoster();
  }
  const battle = new HeadlessBattle(data, { act: 'act1', objective: 'rout' }, roster);
  battle.init({ battleConfig: config });
  const hints = { markSeen: vi.fn(), hasSeen: () => false, shouldShow: () => false };
  const meta = { recordPrologueChapter: vi.fn(), recordProloguePractised: vi.fn() };
  const events = { handlers: new Map() };
  events.on = vi.fn((name, fn) => events.handlers.set(name, fn));
  events.off = vi.fn((name) => events.handlers.delete(name));
  events.once = vi.fn();
  const scene = {
    gameData: data,
    battleParams,
    runManager: rm,
    nodeId: rm?.battleInProgress?.nodeId || null,
    getVisionChargesRemaining: () =>
      rm ? rm.visionChargesRemaining : scene._standaloneVisionState?.visionChargesRemaining || 0,
    _persistBattleRunState: vi.fn(),
    playerUnits: battle.playerUnits,
    enemyUnits: battle.enemyUnits,
    npcUnits: battle.npcUnits,
    grid: Object.assign(battle.grid, {
      gridToPixel: (col, row) => ({ x: col * 32 + 16, y: row * 32 + 16 }),
    }),
    threatContext: () => battle._playerThreatContext(),
    findAttackTargets: (u) => battle._findAttackTargets(u),
    turnManager: { turnNumber: 1, currentPhase: 'player' },
    battleState: 'PLAYER_IDLE',
    isMobileInput: false,
    events,
    sys: { isActive: () => true },
    registry: { get: (key) => (key === 'hints' ? hints : key === 'meta' ? meta : null) },
    add: {
      rectangle: vi.fn(() => ({
        setStrokeStyle() {
          return this;
        },
        setDepth() {
          return this;
        },
        destroy: vi.fn(),
      })),
    },
    tweens: { add: vi.fn() },
    _reduceMotion: () => true,
    refreshEndTurnControl: vi.fn(),
    updateVisionHud: vi.fn(),
    requestVisionRewind: vi.fn(() => true),
    showBriefBanner: vi.fn(async () => {}),
    isStoryInputLocked: () => false,
    _getPortraitKey: () => null,
    dialogueOverlay: { showSequence: vi.fn(async () => true), visible: false },
    onDefeat: vi.fn(),
    showLordDeathVisionPrompt: vi.fn(() => false),
    clearInspectionVisuals: vi.fn(),
    hideActionMenu: vi.fn(),
    dangerZone: { hide: vi.fn() },
    _battleSession: 1,
  };
  const unit = (name) =>
    battle.playerUnits.find((u) => u.name === name) || battle.npcUnits.find((u) => u.name === name);
  return { scene, battle, rm, hints, meta, unit };
}

const notes = () => showImportantHint.mock.calls.map((call) => call[1]);
const flushNotes = async (prologue) => {
  for (let i = 0; i < 10; i++) {
    prologue.flushDeferred();
    await Promise.resolve();
    await Promise.resolve();
  }
};

/** Edric walks next to Sera and Talks (the harness settles the join, as the scene does). */
async function talk(battle, prologue, unit) {
  const edric = unit('Edric');
  const sera = unit('Sera');
  battle.selectUnit('Edric');
  const tile = [...battle.movementRange.keys()]
    .map((k) => k.split(',').map(Number))
    .find(([c, r]) => Math.abs(c - sera.col) + Math.abs(r - sera.row) === 1);
  battle.moveTo(tile[0], tile[1]);
  battle.chooseAction('Talk');
  return prologue.onTalk(edric, sera);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
});
afterEach(() => {
  restoreMathRandom();
  vi.unstubAllGlobals();
});

describe('P3: Sera, the green unit', () => {
  it('one builder: the harness spawns exactly the NPC buildPrologueNpcUnit builds (as BattleScene does)', () => {
    const { battle } = makeP3();
    installSeed(5);
    const built = buildPrologueNpcUnit(config.npcSpawn, data);
    expect(config.npcSpawn).toEqual({
      col: p3.npc.col,
      row: p3.npc.row,
      className: 'Light Sage',
      name: 'Sera',
      prologueUnit: 'Sera',
    });
    const [npc] = battle.npcUnits;
    // Item uids carry a process-wide counter; everything else is the same build.
    const strip = (unit) =>
      JSON.parse(
        JSON.stringify(unit, (k, v) => (k === 'uid' || k === '_phoenixBroochUsed' ? undefined : v)),
      );
    expect(strip(npc)).toEqual(strip(built));
    // The scene takes the same path for an authored spawn (never the recruit-node roll).
    const scene = readFileSync(new URL('../src/scenes/BattleScene.js', import.meta.url), 'utf8');
    expect(scene).toMatch(/npcSpawn\.prologueUnit\s*\?\s*\{\s*unit:\s*buildPrologueNpcUnit\(npcSpawn, this\.gameData\)/); // prettier-ignore
    const harness = readFileSync(new URL('./harness/HeadlessBattle.js', import.meta.url), 'utf8');
    expect(harness).toMatch(/bc\.npcSpawn\?\.prologueUnit[\s\S]{0,200}buildPrologueNpcUnit\(bc\.npcSpawn, this\.gameData\)/); // prettier-ignore
  });

  it('the opening: the lines, the goal to reach her, then the recruit note (its in-run note read in the run)', async () => {
    const { scene, hints } = makeP3({ run: true });
    const prologue = new PrologueController(scene).create();
    prologue.onPhaseStart('player', 1);
    await Promise.resolve();
    expect(scene.dialogueOverlay.showSequence).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ speaker: 'Gaspar' })]),
      { category: 'prologue', key: 'p3_intro' },
    );
    expect(prologue.scripted()).toMatchObject({ id: 'p3_reach_sera', goal: 'Reach Sera and Talk' });
    await flushNotes(prologue);
    expect(notes().at(-1)).toContain('Sera (Light Sage) under the gold banner can join you.');
    expect(hints.markSeen).toHaveBeenCalledWith('guide_recruit_on_map');
  });

  it('Talk: her own line on the card, the goal moves to her turn, and she acts at once', async () => {
    const { scene, battle, unit } = makeP3();
    const prologue = new PrologueController(scene).create();
    prologue.onPhaseStart('player', 1);
    expect(prologue.talkLine(unit('Sera'))).toBe(
      'I have seen you before, Edric. Many times. You always come for me.',
    );
    await talk(battle, prologue, unit);
    const sera = unit('Sera');
    expect(sera.faction).toBe('player');
    expect(sera.hasActed).toBe(false);
    expect(prologue.scripted()).toMatchObject({ id: 'p3_sera_acts' });
    expect([...prologue.lessons.practised]).toContain('recruit');
    // Her action clears the goal.
    prologue.beforeUnitActionCompletes(sera);
    expect(prologue.scripted()).toBeNull();
    // Only lords get the line: a generic NPC keeps the recruit pools.
    expect(prologue.talkLine({ name: 'Ren' })).toBeNull();
  });

  it('Sera is protected while green: her fall restarts the chapter', async () => {
    const { scene, unit } = makeP3();
    const prologue = new PrologueController(scene).create();
    const sera = unit('Sera');
    expect(prologue.isProtected(sera)).toBe(true);
    sera.currentHP = 0;
    scene.npcUnits.splice(scene.npcUnits.indexOf(sera), 1);
    prologue.onUnitDefeated(sera);
    expect(scene.battleState).toBe('BATTLE_END');
    await Promise.resolve();
    await Promise.resolve();
    expect(restartScene).toHaveBeenCalledTimes(1);
    expect(scene.onDefeat).not.toHaveBeenCalled();
    expect(scene._prologueFallen?.name).toBe('Sera');
    const [, payload] = restartScene.mock.calls[0];
    expect(payload.roster.map((u) => u.name)).toEqual(['Edric', 'Gaspar', 'Tamsin']);
    expect(payload.roster[2].weapon?.name).toBe('Iron Bow'); // the replay's canned kit
  });

  it('...and blue: after Talk her fall restarts it too', async () => {
    const { scene, battle, unit } = makeP3();
    const prologue = new PrologueController(scene).create();
    await talk(battle, prologue, unit);
    const sera = unit('Sera');
    sera.currentHP = 0;
    scene.playerUnits.splice(scene.playerUnits.indexOf(sera), 1);
    prologue.onUnitDefeated(sera);
    await Promise.resolve();
    await Promise.resolve();
    expect(restartScene).toHaveBeenCalledTimes(1);
  });
});

describe('P3: her lessons', () => {
  it('the heal note names the hurt ally, and waits for someone to be hurt', async () => {
    const { scene, battle, unit } = makeP3();
    const prologue = new PrologueController(scene).create();
    await talk(battle, prologue, unit);
    const sera = unit('Sera');
    prologue.onUnitSelected(sera);
    await Promise.resolve();
    expect(notes().some((n) => n.includes('heals with her staff'))).toBe(false);
    unit('Gaspar').currentHP = 9;
    prologue.onUnitSelected(sera);
    await Promise.resolve();
    expect(notes().at(-1)).toContain(
      'Sera heals with her staff: move next to Gaspar, choose Heal.',
    );
    await prologue.onHealed(sera, unit('Gaspar'));
    expect([...prologue.lessons.practised]).toContain('heal');
  });

  it('one note per move: in two reaches the threat count shows, the rest wait their turn', async () => {
    const { scene, battle, unit } = makeP3();
    const prologue = new PrologueController(scene).create();
    await talk(battle, prologue, unit);
    const sera = unit('Sera');
    showImportantHint.mockClear();
    // The forest at the front: the Soldier beside her start and the two far ones reach it.
    Object.assign(sera, { col: 6, row: 1 });
    await prologue.onAfterMove(sera);
    expect(notes()).toHaveLength(1);
    expect(notes()[0]).toMatch(/^Cover isn't safety\. 3 enemies can reach Sera here/);
    // Two tiles from the Soldier, out of the far ones' reach: the range note, now.
    Object.assign(sera, { col: 4, row: 3 });
    await prologue.onAfterMove(sera);
    expect(notes()).toHaveLength(2);
    expect(notes()[1]).toContain('Glimmer reaches 2 tiles.');
    expect(prologue.scripted()).toMatchObject({ id: 'p3_look_is_free' });
  });

  it('a Glimmer forecast is the magic lesson', async () => {
    const { scene, battle, unit } = makeP3();
    const prologue = new PrologueController(scene).create();
    await talk(battle, prologue, unit);
    const sera = unit('Sera');
    const soldier = scene.enemyUnits.find((e) => e.authoredId === 's');
    await prologue.onForecastOpened(sera, soldier, { attacker: { hit: 100 }, defender: { canCounter: false } }, sera.weapon); // prettier-ignore
    expect(notes().some((n) => n.startsWith('Glimmer is magic: it hits RES, not DEF.'))).toBe(true);
  });
});

describe('P3: the rewind exercise', () => {
  it('grants the one Vision charge once (a replayed turn start never grants again), saved with the run', async () => {
    const { scene, rm, unit } = makeP3({ run: true });
    const prologue = new PrologueController(scene).create();
    unit('Edric').currentHP -= 8;
    prologue.onPhaseStart('player', 2);
    await flushNotes(prologue);
    expect(rm.visionChargesRemaining).toBe(1);
    expect(rm.prologueVisionGranted).toBe(true);
    expect(scene.updateVisionHud).toHaveBeenCalled();
    expect(notes().at(-1)).toContain('Edric is hurt. Sera grants one Vision.');
    // A new controller (a resume) replaying the beat grants nothing.
    const again = new PrologueController(scene).create();
    again.grantVision();
    expect(rm.visionChargesRemaining).toBe(1);
    expect(RunManager.fromJSON(rm.toJSON(), data).visionChargesRemaining).toBe(1);
  });

  it('nobody hurt at turn 2: no charge, no note (the exercise is optional)', async () => {
    const { scene, rm } = makeP3({ run: true });
    const prologue = new PrologueController(scene).create();
    prologue.onPhaseStart('player', 2);
    await flushNotes(prologue);
    expect(rm.visionChargesRemaining).toBe(0);
  });

  it('standalone, the charge goes to the scene, once', async () => {
    const { scene, unit } = makeP3();
    const prologue = new PrologueController(scene).create();
    unit('Gaspar').currentHP = 5;
    prologue.onPhaseStart('player', 2);
    await flushNotes(prologue);
    expect(scene._standaloneVisionState.visionChargesRemaining).toBe(1);
    expect(prologue.grantVision()).toBe(false);
    expect(scene._standaloneVisionState.visionChargesRemaining).toBe(1);
  });

  it('the note opens Rewind; after it, a move out of reach is "Same turn, better plan"', async () => {
    vi.useFakeTimers();
    installFakeDom(vi); // the note's buttons are a browser's
    try {
      const { scene, unit } = makeP3({ run: true });
      const prologue = new PrologueController(scene).create();
      unit('Edric').currentHP -= 8;
      showImportantHint.mockImplementation(async (_scene, text) =>
        text.includes('Sera grants one Vision') ? 'rewind' : true,
      );
      prologue.onPhaseStart('player', 2);
      await flushNotes(prologue);
      const [, , options] = showImportantHint.mock.calls.find((c) => c[1].includes('one Vision'));
      expect(options.actions.map((a) => a.label)).toEqual(['Open Rewind', 'Continue', 'Skip prologue']); // prettier-ignore
      await vi.runAllTimersAsync();
      expect(scene.requestVisionRewind).toHaveBeenCalledTimes(1);
      showImportantHint.mockImplementation(async () => true);
      // The rewind lands: the replayed move to a tile no enemy reaches.
      await prologue.onRewound();
      const gaspar = unit('Gaspar');
      Object.assign(gaspar, { col: 0, row: 0 });
      await prologue.onAfterMove(gaspar);
      expect(notes().at(-1)).toMatch(/^Same turn, better plan\./);
      expect([...prologue.lessons.practised]).toContain('rewind');
    } finally {
      vi.useRealTimers();
    }
  });

  it('after a successful rewind a later fall offers a remaining charge again; the commander is never renamed', async () => {
    const { scene, rm, unit } = makeP3({ run: true });
    rm.visionChargesRemaining = 2;
    scene.showLordDeathVisionPrompt = vi.fn(() => true);
    const prologue = new PrologueController(scene).create();
    const gaspar = unit('Gaspar');
    gaspar.currentHP = 0;
    expect(prologue.onDefeatIntercept({ fallen: gaspar })).toBe(true);
    expect(scene.showLordDeathVisionPrompt).toHaveBeenCalledTimes(1);
    expect(scene._prologueFallen).toEqual({ name: 'Gaspar', className: 'Paladin', epithet: null });
    expect(scene._battleCommanderName ?? null).toBeNull();
    expect(scene._fallenCommander ?? null).toBeNull();
    // The player rewinds (one charge spent); the fall is undone.
    rm.visionChargesRemaining = 1;
    await prologue.onRewound();
    expect(scene._prologueFallen).toBeNull();
    // A second fall in the same battle: the remaining charge is offered again.
    const tamsin = unit('Tamsin');
    tamsin.currentHP = 0;
    expect(prologue.onDefeatIntercept({ fallen: tamsin })).toBe(true);
    expect(scene.showLordDeathVisionPrompt).toHaveBeenCalledTimes(2);
    expect(scene._prologueFallen.name).toBe('Tamsin');
    expect(restartScene).not.toHaveBeenCalled();
  });
});

describe('resume keeps the teaching state (review: Resume Battle and rotation re-open)', () => {
  /** P1, standalone: the opening gate on Edric, then he is selected (the Fort gate). */
  function p1Scene() {
    const { scene, battle } = makeP3();
    const roster = buildPrologueRoster(data.prologue, data, p1);
    const p1battle = new HeadlessBattle(data, { act: 'act1', objective: 'rout' }, roster);
    p1battle.init({ battleConfig: buildPrologueBattleConfig(p1, data.terrain) });
    Object.assign(scene, {
      battleParams: prologueBattleParams(p1, { seed: 1209 }),
      playerUnits: p1battle.playerUnits,
      enemyUnits: p1battle.enemyUnits,
      npcUnits: [],
      grid: Object.assign(p1battle.grid, { gridToPixel: (c, r) => ({ x: c * 32, y: r * 32 }) }),
      threatContext: () => p1battle._playerThreatContext(),
    });
    void battle;
    return scene;
  }

  it('a checkpoint carries the guided step; the resumed chapter is gated where it was, and turn 2 never replays the opening', async () => {
    const scene = p1Scene();
    const first = new PrologueController(scene).create();
    first.onPhaseStart('player', 1);
    const edric = scene.playerUnits[0];
    first.onUnitSelected(edric);
    expect(first.gate).toEqual({ kind: 'move', col: 3, row: 2 });
    const state = structuredClone(first.snapshot());
    expect(state).toMatchObject({ version: 1, started: true, gate: { kind: 'move', col: 3, row: 2 } }); // prettier-ignore
    expect(state.fired).toEqual(expect.arrayContaining(['p1_select_edric', 'p1_move_to_fort']));
    first.destroy();
    // Resume Battle: a fresh controller, the checkpoint's state.
    const resumed = new PrologueController(scene).create();
    resumed.onResume(state, { turn: 1, phase: 'player' });
    expect(resumed.gate).toEqual({ kind: 'move', col: 3, row: 2 });
    expect(resumed.isGateActive()).toBe(true);
    expect(resumed.allowsMoveTo(2, 2)).toBe(false);
    expect(resumed.scripted()).toMatchObject({ id: 'p1_move_to_fort' });
    // Turn 2's player phase: no second battleStart, no Edric gate.
    resumed.releaseGate();
    resumed.onPhaseStart('player', 2);
    expect(resumed.gate).toBeNull();
    expect(resumed.scripted()).toBeNull();
  });

  it('a checkpoint from before this state existed resumes as a started chapter: nothing replays', () => {
    const scene = p1Scene();
    const resumed = new PrologueController(scene).create();
    resumed.onResume(null, { turn: 2, phase: 'player' });
    resumed.onPhaseStart('player', 3);
    expect(resumed.gate).toBeNull();
    expect(resumed.beatState.fired).not.toContain('p1_select_edric');
  });

  it('a fresh battle on turn 1 still opens; one first seen on turn 2 never does', () => {
    const scene = p1Scene();
    const fresh = new PrologueController(scene).create();
    fresh.onPhaseStart('player', 1);
    expect(fresh.gate).toEqual({ kind: 'select', unit: 'Edric' });
    const late = new PrologueController(scene).create();
    late.onPhaseStart('player', 2);
    expect(late.gate).toBeNull();
    expect(late.beatState.fired).not.toContain('p1_select_edric');
  });

  it('a resume from before the opening ran (turn 1, nothing fired) opens it now', () => {
    const scene = p1Scene();
    const resumed = new PrologueController(scene).create();
    resumed.onResume({ version: 1, started: false, fired: [] }, { turn: 1, phase: 'player' });
    expect(resumed.gate).toEqual({ kind: 'select', unit: 'Edric' });
  });
});

describe('a failed Skip (review)', () => {
  beforeEach(() => installFakeDom(vi)); // the retry is a browser dialog
  it('leaves the chapter playable and offers a real retry', async () => {
    const { scene } = makeP3({ run: true });
    const prologue = new PrologueController(scene).create();
    finishPrologue.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    showImportantHint.mockResolvedValueOnce('retry');
    const started = await prologue.skipRest();
    expect(finishPrologue).toHaveBeenCalledTimes(2);
    expect(started).toBe(true);
    expect(showImportantHint.mock.calls[0][1]).toContain('could not be saved as finished');
  });

  it('Keep playing returns the battle as it was', async () => {
    const { scene } = makeP3({ run: true });
    const prologue = new PrologueController(scene).create();
    finishPrologue.mockResolvedValueOnce(false);
    showImportantHint.mockResolvedValueOnce(false);
    expect(await prologue.skipRest()).toBe(false);
    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(prologue.leaving).toBeNull();
    // The pause's Skip works again.
    finishPrologue.mockResolvedValueOnce(true);
    expect(await prologue.skipRest()).toBe(true);
  });
});
