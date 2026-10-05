// PrologueController on a fake scene wrapped around the headless P1 battle: the beats
// fire in order and once, the gates block the wrong input, the notes read what the beat
// says, the lessons recorded are only those shown, a fall restarts the chapter without
// ever reaching onDefeat, victory hands off, and (standalone) nothing touches a slot or
// its meta. In the prologue run (a real RunManager in mode 'prologue') the notes mark
// the slot's hints, a won chapter is recorded on the meta, and a fall restarts the
// chapter from the run's entry snapshot, a Vision charge offered first.
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

vi.mock('../src/ui/PrologueTip.js', async () => {
  const actual = await vi.importActual('../src/ui/PrologueTip.js');
  const { fakeTipHandle } = await import('./helpers/prologueTipMock.js');
  return { ...actual, showPrologueTip: vi.fn((_scene, opts) => fakeTipHandle(opts)) };
});

import { showImportantHint } from '../src/ui/HintDisplay.js';
import { showPrologueTip } from '../src/ui/PrologueTip.js';
import { restartScene, transitionToScene } from '../src/utils/SceneRouter.js';
import { loadGameData } from './testData.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import {
  buildPrologueBattleConfig,
  buildPrologueUnits,
  buildPrologueRoster,
} from '../src/engine/Prologue.js';
import { RunManager } from '../src/engine/RunManager.js';
import { computeDangerTiles } from '../src/engine/ThreatForecast.js';
import { PrologueController } from '../src/ui/PrologueController.js';
import { prologueBattleParams } from '../src/engine/ScriptedBattle.js';
import { TUTORIAL_COMPLETED_KEY, TUTORIAL_LESSONS_KEY } from '../src/ui/prologueLessons.js';
import { readFileSync } from 'fs';

const data = {
  ...loadGameData(),
  dialogue: JSON.parse(readFileSync(new URL('../data/dialogue.json', import.meta.url), 'utf8')),
};
const chapter = data.prologue.chapters.find((c) => c.id === 'p1_banner_at_dawn');
const config = buildPrologueBattleConfig(chapter, data.terrain);
const FORT = { col: 3, row: 2 };

let store;
let slotWrites;

/**
 * A fake BattleScene around the real P1 board (units, grid, threat context).
 * `chapterId` plays another chapter standalone; `run: true` wraps the chapter in a
 * real prologue run (RunManager.startPrologue, the battle flag at its entry).
 */
function makeScene({
  battleParams = prologueBattleParams(chapter, { seed: 1209 }),
  chapterId = chapter.id,
  run = false,
} = {}) {
  installSeed(7);
  const played = data.prologue.chapters.find((c) => c.id === chapterId);
  let rm = null;
  let roster;
  if (run) {
    rm = new RunManager(data, null);
    rm.startPrologue(data, data.prologue);
    const node = rm.getAvailableNodes()[0];
    battleParams = rm.getBattleParams(node);
    rm.beginBattleInProgress(node.id, { battleParams, isBoss: false, isElite: false });
    roster = rm.getRoster();
  } else {
    roster =
      played === chapter
        ? buildPrologueUnits(data.prologue, data, chapter.roster)
        : buildPrologueRoster(data.prologue, data, played);
    if (played !== chapter) battleParams = prologueBattleParams(played, { seed: 1209 });
  }
  const [edric] = roster;
  const battle = new HeadlessBattle(data, { act: 'act1', objective: 'rout' }, roster);
  battle.init({
    battleConfig: played === chapter ? config : buildPrologueBattleConfig(played, data.terrain),
  });
  const hints = { markSeen: vi.fn(), hasSeen: () => false, shouldShow: () => false };
  const meta = {
    _save: vi.fn(),
    hintState: null,
    markDialogueSeen: vi.fn(),
    recordPrologueChapter: vi.fn(),
    recordProloguePractised: vi.fn(),
  };
  const events = { handlers: new Map() };
  events.on = vi.fn((name, fn) => events.handlers.set(name, fn));
  events.off = vi.fn((name) => events.handlers.delete(name));
  events.once = vi.fn();
  const markers = [];
  const scene = {
    gameData: data,
    battleParams,
    runManager: rm,
    nodeId: rm?.battleInProgress?.nodeId || null,
    getVisionChargesRemaining: () => rm?.visionChargesRemaining ?? 0,
    _persistBattleRunState: vi.fn(),
    playerUnits: battle.playerUnits,
    enemyUnits: battle.enemyUnits,
    npcUnits: [],
    grid: Object.assign(battle.grid, {
      gridToPixel: (col, row) => ({ x: col * 32 + 16, y: row * 32 + 16 }),
    }),
    threatContext: () => battle._playerThreatContext(),
    turnManager: { turnNumber: 1, currentPhase: 'player' },
    battleState: 'PLAYER_IDLE',
    isMobileInput: false,
    events,
    sys: { isActive: () => true },
    registry: {
      get: (key) => (key === 'hints' ? hints : key === 'meta' ? meta : null),
    },
    add: {
      rectangle: vi.fn(() => {
        const marker = {
          setStrokeStyle() {
            return this;
          },
          setDepth() {
            return this;
          },
          destroy: vi.fn(),
        };
        markers.push(marker);
        return marker;
      }),
    },
    tweens: { add: vi.fn() },
    _reduceMotion: () => true,
    refreshEndTurnControl: vi.fn(),
    showBriefBanner: vi.fn(async () => {}),
    isStoryInputLocked: () => false,
    _getPortraitKey: (unit) => `portrait:${unit.specialCharId || unit.name}`,
    dialogueOverlay: { showSequence: vi.fn(async () => true), visible: false },
    onDefeat: vi.fn(),
    showLordDeathVisionPrompt: vi.fn(() => false),
    clearInspectionVisuals: vi.fn(),
    hideActionMenu: vi.fn(),
    dangerZone: { hide: vi.fn() },
    _battleSession: 1,
  };
  return { scene, battle, edric, hints, meta, markers, events, rm, roster };
}

const unitOf = (scene, id) => scene.enemyUnits.find((u) => u.authoredId === id);
const notes = () => showImportantHint.mock.calls.map((call) => call[1]);
/** The non-blocking tips shown beside the map (text as authored), and their handles. */
const tips = () => showPrologueTip.mock.calls.map((call) => call[1].text);
const tipHandle = (i = -1) => showPrologueTip.mock.results.at(i)?.value;

beforeEach(() => {
  vi.clearAllMocks();
  store = new Map();
  slotWrites = [];
  vi.stubGlobal('localStorage', {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      if (!/^emblem_rogue_tutorial_/.test(k)) slotWrites.push(k);
      store.set(k, String(v));
    },
    removeItem: (k) => store.delete(k),
  });
});
afterEach(() => {
  restoreMathRandom();
  vi.unstubAllGlobals();
});

describe('PrologueController: the guided steps', () => {
  it('battle start gates the first select to Edric, rings him, and corrects a wrong tap', async () => {
    const { scene, edric } = makeScene();
    const prologue = new PrologueController(scene).create();
    const schedule = vi.fn();
    prologue.onPhaseStart('player', 1, { schedule });
    expect(prologue.gate).toEqual({ kind: 'select', unit: 'Edric' });
    expect(prologue.isGateActive()).toBe(true);
    expect(prologue.scripted()).toMatchObject({ id: 'p1_select_edric', goal: 'Select Edric' });
    expect(scene.add.rectangle).toHaveBeenCalledTimes(1); // the ring on Edric's tile
    expect(schedule).toHaveBeenCalledWith(1500, 'prologue_coach_reveal', expect.any(Function));
    // A wrong tap is refused with the step's correction (a blocking note without a coach).
    expect(prologue.allowsSelect(unitOf(scene, 'a'))).toBe(false);
    prologue.rejectSelect();
    await Promise.resolve();
    expect(notes()).toEqual(['Select Edric first.']);
    expect(prologue.allowsSelect(edric)).toBe(true);
  });

  it('selecting Edric moves the gate to the Fort; only that tile is allowed; arrival shows the terrain tip once, never holding the move', async () => {
    const { scene, edric } = makeScene();
    const prologue = new PrologueController(scene).create();
    prologue.onPhaseStart('player', 1);
    prologue.onUnitSelected(edric);
    expect(prologue.gate).toEqual({ kind: 'move', ...FORT });
    expect(prologue.scripted()).toMatchObject({
      id: 'p1_move_to_fort',
      anchor: { kind: 'tile', ...FORT },
    });
    expect(prologue.allowsMoveTo(2, 2)).toBe(false);
    expect(prologue.allowsMoveTo(FORT.col, FORT.row)).toBe(true);
    // The Fort's ring replaced Edric's.
    expect(scene.add.rectangle).toHaveBeenCalledTimes(2);

    edric.col = FORT.col;
    edric.row = FORT.row;
    // Reinforcement: the terrain tip docks beside the map; the move is never held.
    const held = await prologue.onAfterMove(edric);
    expect(held).toBe(false);
    expect(showImportantHint).not.toHaveBeenCalled();
    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(tips()).toHaveLength(1);
    expect(tips()[0]).toContain('Fort tile reached — Defense +2, Avoid +20.');
    expect(prologue.gate).toBeNull();
    expect(prologue.isGateActive()).toBe(false);
    expect(prologue.scripted()).toBeNull();
    expect([...prologue.lessons.shown]).toEqual(['terrain']);
    // Shown is not read: its hint is marked only once the player read it.
    expect(prologue.taught.has('battle_terrain')).toBe(false);
    tipHandle().read();
    expect(prologue.taught.has('battle_terrain')).toBe(true);
    // Once only: a second arrival says nothing.
    expect(await prologue.onAfterMove(edric)).toBe(false);
    expect(showPrologueTip).toHaveBeenCalledTimes(1);
  });

  it('a tip about a unit steps aside unread when that unit moves on or acts', async () => {
    const { scene, edric } = makeScene();
    const prologue = new PrologueController(scene).create();
    prologue.skipStep();
    edric.col = FORT.col;
    edric.row = FORT.row;
    await prologue.onAfterMove(edric);
    const handle = tipHandle();
    expect(handle.opts.unit).toBe(edric); // docked away from the unit it is about
    prologue.beforeUnitActionCompletes(edric);
    expect(handle.closed).toBe(false);
    expect(prologue.taught.has('battle_terrain')).toBe(false);
  });

  it("a scoped tip holds through the unit's own planning, and steps aside when it ends", async () => {
    const { scene, edric } = makeScene();
    const prologue = new PrologueController(scene).create();
    prologue.skipStep();
    edric.col = FORT.col;
    edric.row = FORT.row;
    scene.selectedUnit = edric;
    scene.battleState = 'UNIT_MOVING';
    await prologue.onAfterMove(edric);
    const handle = tipHandle();
    // The action menu on the tile it is about: it holds (each frame checks).
    scene.battleState = 'UNIT_ACTION_MENU';
    prologue.syncTip();
    expect(handle.closed).toBeNull();
    // A forecast opens over the move: the moment is over, unread.
    scene.battleState = 'SHOWING_FORECAST';
    prologue.syncTip();
    expect(handle.closed).toBe(false);
    expect(prologue.taught.has('battle_terrain')).toBe(false);
  });

  it('a tip already read stays read when it steps aside; a modal note closes an open tip', async () => {
    const { scene, edric } = makeScene();
    const prologue = new PrologueController(scene).create();
    prologue.skipStep();
    edric.col = 5;
    edric.row = 4; // the holding Fighter's reach: its tip (unscoped to the Fort)
    scene.selectedUnit = edric;
    scene.battleState = 'UNIT_ACTION_MENU';
    await prologue.onAfterMove(edric);
    const holding = tipHandle();
    holding.read(); // on screen long enough
    edric.col = 4; // Back, to another tile
    prologue.syncTip();
    expect(holding.closed).toBe(false);
    // An unscoped tip (the Vulnerary at 55%), then the turn's modal note: the tip goes.
    edric.currentHP = 11;
    await prologue.onCombatResolved(unitOf(scene, 'a'), edric, { initiator: 'enemy' });
    const vulnerary = tipHandle();
    expect(vulnerary.opts.text).toContain('Vulnerary');
    scene.battleState = 'PLAYER_IDLE';
    await prologue.beforeUnitActionCompletes(edric);
    expect(notes().at(-1)).toContain('Wait ends Edric');
    expect(vulnerary.closed).toBe(false);
    expect(prologue.taught.has('battle_consumable_supply')).toBe(false);
  });

  it('Skip step releases the gates for good', () => {
    const { scene, edric } = makeScene();
    const prologue = new PrologueController(scene).create();
    prologue.onPhaseStart('player', 1);
    expect(prologue.skipStep()).toBe(true);
    expect(prologue.isGateActive()).toBe(false);
    prologue.onUnitSelected(edric); // the move beat still fires, its gate is ignored
    expect(prologue.gate).toBeNull();
    expect(prologue.allowsMoveTo(2, 2)).toBe(true);
  });
});

describe('PrologueController: forecasts, actions and the enemy phase', () => {
  it('the first forecast teaches reading it and allows only Confirm or Cancel; the triangle waits for b', async () => {
    const { scene, edric } = makeScene();
    const prologue = new PrologueController(scene).create();
    const a = unitOf(scene, 'a');
    const b = unitOf(scene, 'b');
    const triangle = { display: { triangle: { damage: 1, hit: 10 } }, attacker: {}, defender: {} };
    expect(prologue.allowsForecastCycling()).toBe(true);
    await prologue.onForecastOpened(edric, a, triangle, edric.weapon);
    expect(notes().at(-1)).toContain('Reading a forecast');
    expect(prologue.gate).toEqual({ kind: 'confirm' });
    expect(prologue.allowsForecastCycling()).toBe(false);
    expect(prologue.isGateActive()).toBe(false); // a confirm gate never blocks free play
    prologue.onForecastClosed();
    expect(prologue.allowsForecastCycling()).toBe(true);
    // Against a: no triangle tip (the beat names b). Against b: the triangle, once, as a
    // line in the forecast's own notes (drawn in before it renders), never a modal.
    expect(prologue.prepareForecast(edric, a, triangle, edric.weapon)).toBeNull();
    await prologue.onForecastOpened(edric, a, triangle, edric.weapon);
    prologue.onForecastClosed({ acknowledge: true });
    expect(prologue.prepareForecast(edric, b, triangle, edric.weapon)).toBe(
      'Swords beat axes, axes beat lances, lances beat swords. These numbers include it.',
    );
    expect(await prologue.onForecastOpened(edric, b, triangle, edric.weapon)).toBe(false);
    expect(prologue.forecastTipText()).toContain('Swords beat axes');
    expect(showImportantHint).toHaveBeenCalledTimes(1);
    // Read when the player confirms or cancels; a forecast closed by anything else
    // (End Turn, a rewind) leaves it unread.
    prologue.onForecastClosed({ acknowledge: true });
    expect(prologue.forecastTipText()).toBeNull();
    await prologue.onForecastOpened(edric, b, triangle, edric.weapon);
    expect(prologue.forecastTipText()).toBeNull(); // once
    expect(prologue.taught).toEqual(new Set(['battle_forecast', 'battle_triangle']));
  });

  it('a forecast tip closed without Confirm or Cancel is not read', async () => {
    const { scene, edric } = makeScene();
    const prologue = new PrologueController(scene).create();
    const b = unitOf(scene, 'b');
    const triangle = { display: { triangle: { damage: 1, hit: 10 } }, attacker: {}, defender: {} };
    await prologue.onForecastOpened(edric, unitOf(scene, 'a'), triangle, edric.weapon);
    prologue.onForecastClosed({ acknowledge: true });
    await prologue.onForecastOpened(edric, b, triangle, edric.weapon);
    expect(prologue.forecastTipText()).toContain('Swords beat axes');
    prologue.onForecastClosed(); // End Turn, a rewind, a shutdown
    expect(prologue.taught.has('battle_triangle')).toBe(false);
  });

  it("Edric's first action holds its completion for the turn note and shows a's reach under it", async () => {
    const { scene, edric } = makeScene();
    const prologue = new PrologueController(scene).create();
    let reachDuringNote = null;
    showImportantHint.mockImplementationOnce(async () => {
      reachDuringNote = prologue.reach?.tiles.map((t) => `${t.col},${t.row}`) || [];
      return true;
    });
    const hold = prologue.beforeUnitActionCompletes(edric);
    expect(hold).toBeInstanceOf(Promise);
    await hold;
    expect(notes().at(-1)).toContain('Wait ends Edric');
    expect(notes().at(-1)).toContain('Danger [D]');
    expect(prologue.taught.has('battle_danger_zone')).toBe(true);
    // Exactly a's Danger tiles (the beat's `reachOf: a`), which hold the Fort.
    const aReach = computeDangerTiles(scene.threatContext(), { onlyEnemy: unitOf(scene, 'a') }).map(
      (t) => `${t.col},${t.row}`,
    );
    expect(reachDuringNote.sort()).toEqual(aReach.sort());
    expect(reachDuringNote).toContain(`${FORT.col},${FORT.row}`);
    // Turn 2 has no such beat: nothing holds the action.
    scene.turnManager.turnNumber = 2;
    expect(prologue.beforeUnitActionCompletes(edric)).toBeNull();
  });

  it('the enemy phase note is a nudge (a banner without a coach), never a modal, and clears the reach', async () => {
    const { scene, edric } = makeScene();
    const prologue = new PrologueController(scene).create();
    await prologue.beforeUnitActionCompletes(edric);
    expect(prologue.reach.visible).toBe(true);
    scene.turnManager.currentPhase = 'enemy';
    prologue.onPhaseStart('enemy', 1);
    await Promise.resolve();
    expect(prologue.reach.visible).toBe(false);
    expect(showImportantHint).toHaveBeenCalledTimes(1);
    expect(scene.showBriefBanner).toHaveBeenCalledWith(
      'Red units move now. Edric strikes back when attacked, too.',
    );
  });

  it('a hit that leaves Edric at 60% or less tips the Vulnerary, once, with its real numbers', async () => {
    const { scene, edric } = makeScene();
    const prologue = new PrologueController(scene).create();
    const a = unitOf(scene, 'a');
    edric.currentHP = 13; // 65%
    expect(await prologue.onCombatResolved(a, edric, { initiator: 'enemy' })).toBe(false);
    edric.currentHP = 11; // 55%
    // A tip: the enemy phase is never held for it.
    expect(await prologue.onCombatResolved(a, edric, { initiator: 'enemy' })).toBe(false);
    expect(tips().at(-1)).toContain('Item → Vulnerary heals 10 HP');
    expect(showImportantHint).not.toHaveBeenCalled();
    tipHandle().read();
    expect(prologue.taught.has('battle_consumable_supply')).toBe(true);
    edric.currentHP = 4;
    expect(await prologue.onCombatResolved(a, edric, { initiator: 'enemy' })).toBe(false);
    expect(showPrologueTip).toHaveBeenCalledTimes(1);
  });

  it("a player-started exchange practises the forecast lesson; a level-up's card gets its line", async () => {
    const { scene, edric } = makeScene();
    const prologue = new PrologueController(scene).create();
    await prologue.onCombatResolved(edric, unitOf(scene, 'a'), { initiator: 'player' });
    expect([...prologue.lessons.practised]).toEqual(['forecast']);
    expect(await prologue.onLevelUp(edric)).toBe(false); // a tip: the card flow goes on
    expect(tips().at(-1)).toBe('Levels raise stats at random. Growth rates decide the odds.');
    await prologue.onLevelUp(edric);
    expect(showPrologueTip).toHaveBeenCalledTimes(1);
  });

  it("walking into b's reach names the holding enemy and shows its reach", async () => {
    const { scene, edric } = makeScene();
    const prologue = new PrologueController(scene).create();
    edric.col = 5;
    edric.row = 4; // the second Fort, inside b's reach
    const sources = prologue.dangerSources(5, 4);
    expect(sources).toContain('b');
    await prologue.onAfterMove(edric);
    expect(tips().at(-1)).toContain('Some enemies hold their post');
    expect(prologue.reach.tiles.some((t) => t.col === 5 && t.row === 4)).toBe(true);
    expect([...prologue.lessons.shown]).toContain('hold_reach');
  });

  it('a note raised at a phase start waits for a playable turn', async () => {
    const { scene } = makeScene();
    const prologue = new PrologueController(scene).create();
    prologue.chapter = {
      ...chapter,
      beats: [{ id: 'x', on: 'turnStart', turn: 2, do: [{ note: 'p1_level_up' }] }],
    };
    scene.battleState = 'TURN_START_RESOLVING';
    prologue.onPhaseStart('player', 2);
    prologue.flushDeferred();
    await Promise.resolve();
    expect(showImportantHint).not.toHaveBeenCalled();
    scene.battleState = 'PLAYER_IDLE';
    prologue.flushDeferred();
    await Promise.resolve();
    expect(showImportantHint).toHaveBeenCalledTimes(1);
  });
});

describe('PrologueController: records, exits and cleanup', () => {
  it('records completion and only the lessons actually shown, and never writes a slot or its meta', async () => {
    const { scene, edric, hints, meta } = makeScene();
    const prologue = new PrologueController(scene).create();
    edric.col = FORT.col;
    edric.row = FORT.row;
    await prologue.onAfterMove(edric);
    await prologue.onForecastOpened(edric, unitOf(scene, 'a'), {}, edric.weapon);
    await prologue.onVictory();
    expect(scene.dialogueOverlay.showSequence).toHaveBeenCalledWith(
      [
        {
          speaker: 'Edric',
          line: 'Gaspar? You swore you were done with saddles.',
          portrait: 'portrait:Edric',
        },
        {
          speaker: 'Gaspar',
          line: 'The saddle was not consulted.',
          portrait: 'portrait:old_knight',
        },
      ],
      { category: 'prologue', key: 'p1_gaspar_arrives' },
    );
    expect(notes().at(-1)).toContain('Banner at Dawn is yours.');
    expect(store.get(TUTORIAL_COMPLETED_KEY)).toBe('1');
    // The terrain tip showed but was never read: its lesson stays for Act 1.
    expect(tips()).toHaveLength(1);
    expect(JSON.parse(store.get(TUTORIAL_LESSONS_KEY)).sort()).toEqual([
      'battle_first_turn',
      'battle_forecast',
    ]);
    expect(slotWrites).toEqual([]);
    expect(hints.markSeen).not.toHaveBeenCalled();
    expect(meta._save).not.toHaveBeenCalled();
    expect(transitionToScene).toHaveBeenCalledWith(
      scene,
      'Title',
      { gameData: data },
      expect.objectContaining({ reason: expect.any(String) }),
    );
  });

  it('standalone: the victory handoff offers only the way back to the title', async () => {
    const { scene } = makeScene();
    const prologue = new PrologueController(scene).create();
    showImportantHint.mockImplementationOnce(async (_s, _m, { actions }) => {
      expect(actions.map((a) => a.label)).toEqual(['Back to title']);
      return 'title';
    });
    await prologue.onVictory();
    expect(store.get(TUTORIAL_COMPLETED_KEY)).toBe('1');
    expect(transitionToScene).toHaveBeenCalledWith(
      scene,
      'Title',
      { gameData: data },
      expect.anything(),
    );
  });

  it("the commander's fall never reaches onDefeat: the unnamed line plays, then the chapter restarts fresh", async () => {
    const { scene, edric } = makeScene();
    const prologue = new PrologueController(scene).create();
    edric.currentHP = 0;
    edric.col = 6;
    scene.playerUnits.splice(0, 1);
    expect(prologue.onDefeatIntercept()).toBe(true);
    expect(scene.battleState).toBe('BATTLE_END');
    expect(prologue.onDefeatIntercept()).toBe(true); // idempotent while the line plays
    await Promise.resolve();
    await Promise.resolve();
    expect(scene.dialogueOverlay.showSequence).toHaveBeenCalledWith(
      [
        { speaker: '???', line: 'Not this thread.', portrait: null },
        { speaker: '???', line: 'Stand again where the morning found you.', portrait: null },
      ],
      { category: 'prologue', key: 'not_this_thread' },
    );
    expect(scene.dialogueOverlay.showSequence).toHaveBeenCalledTimes(1);
    expect(scene.onDefeat).not.toHaveBeenCalled();
    expect(scene.showLordDeathVisionPrompt).not.toHaveBeenCalled();
    expect(restartScene).toHaveBeenCalledTimes(1);
    const [target, payload, options] = restartScene.mock.calls[0];
    expect(target).toBe(scene);
    expect(options).toEqual({ reason: 'retry' });
    expect(payload.battleParams).toEqual(scene.battleParams);
    expect(payload.roster).toHaveLength(1);
    const fresh = payload.roster[0];
    expect(fresh).not.toBe(edric);
    expect(fresh.name).toBe('Edric');
    expect(fresh.currentHP).toBe(fresh.stats.HP);
    expect(fresh.col).not.toBe(6);
    expect(store.size).toBe(0);
    expect(transitionToScene).not.toHaveBeenCalled();
  });

  it('pause options: standalone leaves for the title; the run skips the rest of the prologue', () => {
    const standalone = new PrologueController(makeScene().scene).create().pauseOptions();
    expect(standalone.title).toBe('Banner at Dawn');
    expect(typeof standalone.onLeave).toBe('function');
    expect(standalone.onSkipRest).toBeUndefined();
    const run = new PrologueController(makeScene({ run: true }).scene).create().pauseOptions();
    expect(run.title).toBe('Banner at Dawn');
    expect(typeof run.onSkipRest).toBe('function');
    expect(run.onLeave).toBeUndefined();
  });

  it('standalone P2: Gaspar is protected too; his fall restarts the chapter with the authored pair', async () => {
    const { scene, roster } = makeScene({ chapterId: 'p2_old_hands' });
    const prologue = new PrologueController(scene).create();
    const gaspar = roster.find((u) => u.specialCharId);
    expect(gaspar?.name).toBe('Gaspar');
    expect(prologue.isProtected(gaspar)).toBe(true);
    gaspar.currentHP = 0;
    scene.playerUnits.splice(scene.playerUnits.indexOf(gaspar), 1);
    prologue.onUnitDefeated(gaspar);
    expect(scene.battleState).toBe('BATTLE_END');
    // The prompt names Gaspar; the commander's identity is never overwritten.
    expect(scene._prologueFallen).toEqual({ name: 'Gaspar', className: 'Paladin', epithet: null });
    expect(scene._fallenCommander ?? null).toBeNull();
    expect(scene._battleCommanderName ?? null).toBeNull();
    await Promise.resolve();
    await Promise.resolve();
    expect(scene.onDefeat).not.toHaveBeenCalled();
    expect(restartScene).toHaveBeenCalledTimes(1);
    const [, payload] = restartScene.mock.calls[0];
    expect(payload.roster.map((u) => u.name)).toEqual(['Edric', 'Gaspar']);
    expect(payload.roster[1].level).toBe(gaspar.level);
    expect(payload.roster[0].level).toBe(2); // rosterLevels: Edric arrives at P1's reward
    expect(payload.roster[1].currentHP).toBe(payload.roster[1].stats.HP);
    expect(slotWrites).toEqual([]);
  });
});

describe('PrologueController in the prologue run', () => {
  it('a note marks the slot hints it stands in for (never standalone); a tip only once read', async () => {
    const standalone = makeScene();
    const p1 = new PrologueController(standalone.scene).create();
    await p1.onForecastOpened(standalone.edric, unitOf(standalone.scene, 'a'), {}, standalone.edric.weapon); // prettier-ignore
    standalone.edric.col = FORT.col;
    standalone.edric.row = FORT.row;
    await p1.onAfterMove(standalone.edric);
    tipHandle().read();
    expect(standalone.hints.markSeen).not.toHaveBeenCalled();

    const { scene, edric, hints } = makeScene({ run: true });
    const prologue = new PrologueController(scene).create();
    expect(prologue.run).toBe(scene.runManager);
    await prologue.onForecastOpened(edric, unitOf(scene, 'a'), {}, edric.weapon);
    expect(hints.markSeen).toHaveBeenCalledWith('battle_forecast');
    edric.col = FORT.col;
    edric.row = FORT.row;
    await prologue.onAfterMove(edric);
    expect(hints.markSeen).not.toHaveBeenCalledWith('battle_terrain');
    tipHandle().read();
    expect(hints.markSeen).toHaveBeenCalledWith('battle_terrain');
    expect(prologue.taught.has('battle_terrain')).toBe(true);
  });

  it("victory records the chapter and its practised lessons on the slot's meta and goes on with the run", async () => {
    const { scene, edric, meta } = makeScene({ run: true });
    const prologue = new PrologueController(scene).create();
    await prologue.onForecastOpened(edric, unitOf(scene, 'a'), {}, edric.weapon);
    await prologue.onCombatResolved(edric, unitOf(scene, 'a'));
    await prologue.onVictory();
    expect(meta.recordPrologueChapter).toHaveBeenCalledWith('p1_banner_at_dawn');
    expect(meta.recordProloguePractised).toHaveBeenCalledWith(['forecast']);
    expect(store.get(TUTORIAL_COMPLETED_KEY)).toBe('1');
    expect(JSON.parse(store.get(TUTORIAL_LESSONS_KEY)).sort()).toEqual([
      'battle_first_turn',
      'battle_forecast',
    ]);
    // No handoff, no title: the run's own victory flow (loot, the route map) follows.
    expect(notes().some((n) => n.includes('is yours.'))).toBe(false);
    expect(transitionToScene).not.toHaveBeenCalled();
  });

  it("the commander's fall with no Vision charge restarts the chapter from the run's entry, even past a fatal checkpoint", async () => {
    const { scene, edric, rm } = makeScene({ run: true });
    const prologue = new PrologueController(scene).create();
    const entryGold = rm.gold;
    rm.gold = entryGold + 500; // battle gold the restart must give back
    rm.setBattleCheckpoint({ recoveryKind: 'fatal_pending' });
    expect(rm.revertBattleInProgressToEntry()).toBe(false); // the standard guard holds
    scene._fatalDecision = { kind: 'x' };
    scene._fatalCapturePending = true;
    scene._defeatDecision = { durable: true };
    scene._pendingCommittedAction = { stale: true };
    edric.currentHP = 0;
    scene.playerUnits.splice(0, 1);
    expect(prologue.onDefeatIntercept({ fallen: edric })).toBe(true);
    expect(scene.showLordDeathVisionPrompt).not.toHaveBeenCalled();
    await Promise.resolve();
    await Promise.resolve();
    expect(scene.dialogueOverlay.showSequence).toHaveBeenCalledTimes(1);
    expect(scene.onDefeat).not.toHaveBeenCalled();
    expect(rm.battleInProgress).toBeNull();
    expect(rm.gold).toBe(entryGold);
    expect(rm.mode).toBe('prologue');
    expect(scene._fatalDecision).toBeNull();
    expect(scene._fatalCapturePending).toBe(false);
    expect(scene._defeatDecision).toBeNull();
    expect(scene._pendingCommittedAction).toBeNull();
    expect(scene._persistBattleRunState).toHaveBeenCalledTimes(1);
    expect(restartScene).toHaveBeenCalledTimes(1);
    const [target, payload, options] = restartScene.mock.calls[0];
    expect(target).toBe(scene);
    expect(options).toEqual({ reason: 'retry' });
    expect(payload.runManager).toBe(rm);
    expect(payload.nodeId).toBe('prologue_0');
    expect(payload.battleParams).toEqual(rm.getBattleParams(rm.nodeMap.nodes[0]));
    expect(payload.roster.map((u) => u.name)).toEqual(['Edric']);
    expect(payload.roster[0].currentHP).toBe(payload.roster[0].stats.HP);
    expect(transitionToScene).not.toHaveBeenCalled();
  });

  it('an unspent Vision charge is offered first; Accept Fate (onDefeat) then restarts', async () => {
    const { scene, edric, rm } = makeScene({ run: true });
    rm.visionChargesRemaining = 1;
    scene.showLordDeathVisionPrompt = vi.fn(() => true);
    const prologue = new PrologueController(scene).create();
    edric.currentHP = 0;
    scene.playerUnits.splice(0, 1);
    expect(prologue.onDefeatIntercept({ fallen: edric })).toBe(true);
    expect(scene.showLordDeathVisionPrompt).toHaveBeenCalledTimes(1);
    expect(scene.battleState).not.toBe('BATTLE_END');
    await Promise.resolve();
    expect(scene.dialogueOverlay.showSequence).not.toHaveBeenCalled();
    expect(restartScene).not.toHaveBeenCalled();
    // Accept Fate: PostCombatController.onDefeat hands the decline back here.
    expect(prologue.onDefeatIntercept({ accepted: true })).toBe(true);
    expect(scene.showLordDeathVisionPrompt).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(scene.dialogueOverlay.showSequence).toHaveBeenCalledTimes(1);
    expect(restartScene).toHaveBeenCalledTimes(1);
    expect(rm.battleInProgress).toBeNull();
  });

  it('destroy clears the rings and the reach and unhooks the scene', async () => {
    const { scene, edric, markers, events } = makeScene();
    const prologue = new PrologueController(scene).create();
    prologue.onPhaseStart('player', 1);
    await prologue.beforeUnitActionCompletes(edric);
    expect(markers.length).toBeGreaterThan(0);
    expect(events.handlers.has('update')).toBe(true);
    prologue.destroy();
    for (const marker of markers) expect(marker.destroy).toHaveBeenCalled();
    expect(prologue.reach).toBeNull();
    expect(events.handlers.has('update')).toBe(false);
    expect(prologue.isGateActive()).toBe(false);
    expect(await prologue.onAfterMove(edric)).toBe(false);
  });

  /** The scene's forecast and target-choice surface, as AttackFlowController drives it. */
  function withForecast(scene, prologue, attacker, target) {
    Object.assign(scene, {
      battleState: 'SHOWING_FORECAST',
      selectedUnit: attacker,
      forecastTarget: target,
      attackTargets: [target],
      hideForecast: vi.fn(({ acknowledge = false } = {}) => {
        prologue.onForecastClosed({ acknowledge });
        scene.forecastTarget = null;
      }),
      _clearCombatRollSession: vi.fn(),
      confirmForecastCombat: vi.fn(),
      executeCombat: vi.fn(),
    });
    const flow = {
      cancelTargetSelection: vi.fn(() => {
        scene.attackTargets = [];
        scene.battleState = 'UNIT_ACTION_MENU';
      }),
    };
    scene._attackFlow = () => flow;
    scene.showPauseMenu = vi.fn(() => {
      scene.pauseOverlay = { visible: true, requestLeavePrologue: vi.fn(() => true) };
    });
    return flow;
  }
  const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

  for (const run of [false, true])
    it(`${run ? 'the run' : 'a replay'}: Skip on the first forecast's note backs out of the uncommitted forecast and opens the exit confirmation`, async () => {
      const { scene, edric } = makeScene({ run });
      const prologue = new PrologueController(scene).create();
      const a = unitOf(scene, 'a');
      const hpBefore = [edric.currentHP, a.currentHP];
      const flow = withForecast(scene, prologue, edric, a);
      showImportantHint.mockImplementationOnce(async () => 'leave');
      const forecast = { display: { triangle: { damage: 0, hit: 0 } }, attacker: {}, defender: {} };
      await prologue.onForecastOpened(edric, a, forecast, edric.weapon);
      expect(notes().at(-1)).toContain('Reading a forecast');
      // The note handed the forecast back; the exit runs once the note is gone.
      expect(scene.battleState).toBe('SHOWING_FORECAST');
      await nextTask();
      expect(scene.showPauseMenu).toHaveBeenCalledTimes(1);
      expect(scene.pauseOverlay.requestLeavePrologue).toHaveBeenCalledTimes(1);
      // Nothing was committed: the forecast closed unread, the target choice backed out
      // to the action menu, no attack, no HP changed, Edric has not acted.
      expect(scene.hideForecast).toHaveBeenCalledWith({ acknowledge: false });
      expect(flow.cancelTargetSelection).toHaveBeenCalledTimes(1);
      expect(scene.battleState).toBe('UNIT_ACTION_MENU');
      expect(scene.confirmForecastCombat).not.toHaveBeenCalled();
      expect(scene.executeCombat).not.toHaveBeenCalled();
      expect([edric.currentHP, a.currentHP]).toEqual(hpBefore);
      expect(edric.hasActed).toBeFalsy();
      // Never the "once your turn is back" correction: it is the player's turn.
      expect(notes()).not.toContain('You can leave once your turn is back.');
      expect(prologue.gate).toBeNull(); // the confirm gate went with the forecast
    });

  it('Skip on the note before the automatic enemy-phase handoff is queued, then honoured once the turn is back; nothing is advanced for it', async () => {
    const { scene, edric, events } = makeScene();
    const prologue = new PrologueController(scene).create();
    scene.showPauseMenu = vi.fn(() => {
      scene.pauseOverlay = { visible: true, requestLeavePrologue: vi.fn(() => true) };
    });
    scene.forceEndTurn = vi.fn();
    showImportantHint.mockImplementationOnce(async () => 'leave');
    const hold = prologue.beforeUnitActionCompletes(edric);
    expect(hold).toBeInstanceOf(Promise);
    // The scene completes the action when the note is read: Edric was the last unit,
    // so the turn passes to the enemy at once (TurnManager.endPlayerPhase).
    const completed = hold.then(() => {
      edric.hasActed = true;
      scene.battleState = 'ENEMY_PHASE';
      scene.turnManager.currentPhase = 'enemy';
    });
    await completed;
    await nextTask();
    expect(notes()[0]).toContain('Wait ends Edric');
    // Not now: the enemy phase is under way. Nothing is forced to make room for it.
    expect(scene.showPauseMenu).not.toHaveBeenCalled();
    expect(scene.forceEndTurn).not.toHaveBeenCalled();
    const tick = events.handlers.get('update');
    tick();
    expect(scene.showPauseMenu).not.toHaveBeenCalled();
    // The player's turn is back: the exit confirmation opens, once.
    scene.turnManager.currentPhase = 'player';
    scene.turnManager.turnNumber = 2;
    scene.battleState = 'PLAYER_IDLE';
    tick();
    expect(scene.showPauseMenu).toHaveBeenCalledTimes(1);
    expect(scene.pauseOverlay.requestLeavePrologue).toHaveBeenCalledTimes(1);
    scene.pauseOverlay.visible = false;
    tick();
    expect(scene.showPauseMenu).toHaveBeenCalledTimes(1);
  });

  it('a queued exit waits under a note shown at the turn start, and opens once it is read', async () => {
    const { scene, events } = makeScene();
    const prologue = new PrologueController(scene).create();
    scene.showPauseMenu = vi.fn(() => {
      scene.pauseOverlay = { visible: true, requestLeavePrologue: vi.fn(() => true) };
    });
    scene.turnManager.currentPhase = 'enemy';
    scene.battleState = 'ENEMY_PHASE';
    expect(prologue.requestLeave()).toBe(false);
    scene.turnManager.currentPhase = 'player';
    scene.battleState = 'PLAYER_IDLE';
    prologue.beginPresentation(); // a note is on screen
    events.handlers.get('update')();
    expect(scene.showPauseMenu).not.toHaveBeenCalled();
    prologue.endPresentation();
    events.handlers.get('update')();
    expect(scene.showPauseMenu).toHaveBeenCalledTimes(1);
  });

  it('a leave from a note opens the pause confirmation, or nudges when the turn is not back', async () => {
    const { scene } = makeScene();
    const prologue = new PrologueController(scene).create();
    scene.showPauseMenu = vi.fn(() => {
      scene.pauseOverlay = { visible: true, requestLeavePrologue: vi.fn(() => true) };
    });
    expect(prologue.requestLeave()).toBe(true);
    expect(scene.showPauseMenu).toHaveBeenCalledTimes(1);
    expect(scene.pauseOverlay.requestLeavePrologue).toHaveBeenCalledTimes(1);
    scene.pauseOverlay = null;
    scene.turnManager.currentPhase = 'enemy';
    expect(prologue.requestLeave()).toBe(false);
    expect(scene.showPauseMenu).toHaveBeenCalledTimes(1);
  });
});
