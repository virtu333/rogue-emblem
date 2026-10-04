// PrologueController in P4, "The Quarry Gate" (docs/specs/prologue-chapter.md §6 P4), on a
// fake scene around the headless P4 battle: the opening names only the objective (the
// coach) and explains seize and par with the battle's own par; the first forecast on
// Varro while he holds the throne explains the throne (one forecast on him off it, or on
// anyone else, says nothing); Varro's fall turns the coach to the gate; a Seize records
// the lesson practised. Every fielded named unit is protected, and a fall in the run
// restarts the chapter from its entry with the whole army, so the deploy screen opens
// again. Plus the pure pieces: the deploy rule, the formation tiles, the boss line, the
// boss card's epithet for a boss in no act pool, and the music fallback for Varro.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/HintDisplay.js', () => ({
  showImportantHint: vi.fn(async () => true),
  showMinorHint: vi.fn(),
}));
vi.mock('../src/utils/SceneRouter.js', async () => {
  const actual = await vi.importActual('../src/utils/SceneRouter.js');
  return { ...actual, transitionToScene: vi.fn(async () => true), restartScene: vi.fn(() => true) };
});

import { showImportantHint } from '../src/ui/HintDisplay.js';
import { restartScene } from '../src/utils/SceneRouter.js';
import { loadGameData } from './testData.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import {
  buildPrologueBattleConfig,
  buildPrologueRoster,
  prologueBossDefinitions,
  prologueBossLine,
  prologueDeployRule,
  prologueOpensFormation,
} from '../src/engine/Prologue.js';
import { RunManager } from '../src/engine/RunManager.js';
import { PrologueController } from '../src/ui/PrologueController.js';
import { prologueBattleParams } from '../src/engine/ScriptedBattle.js';
import { bossCardContent } from '../src/ui/ceremonyContent.js';
import { getBossEnrageLayer, getBossMusicKey } from '../src/utils/musicConfig.js';
import { readFileSync } from 'fs';

const data = {
  ...loadGameData(),
  dialogue: JSON.parse(readFileSync(new URL('../data/dialogue.json', import.meta.url), 'utf8')),
};
const p4 = data.prologue.chapters.find((c) => c.id === 'p4_quarry_gate');
const config = buildPrologueBattleConfig(p4, data.terrain);

/** The prologue run standing on P4's node (through the fork and the watchtower). */
function p4Run() {
  const rm = new RunManager(data, null);
  rm.startPrologue(data, data.prologue);
  rm.completeBattle(rm.roster, 'prologue_0', 0);
  rm.completeBattle(rm.roster, 'prologue_1', 0);
  rm.currentNodeId = 'prologue_2a';
  rm.arriveAtPrologueNode('prologue_2a');
  rm.markNodeComplete('prologue_2a');
  // P3 won with Sera talked into the army (she leaves the battle among its survivors).
  const sera = buildPrologueRoster(data.prologue, data, p4).find((u) => u.name === 'Sera');
  rm.completeBattle([...rm.getRoster(), sera], 'prologue_3', 0);
  expect(rm.roster.map((u) => u.name)).toContain('Sera');
  rm.currentNodeId = 'prologue_4';
  rm.markNodeComplete('prologue_4');
  const node = rm.nodeMap.nodes.find((n) => n.id === 'prologue_5');
  rm.beginBattleInProgress(node.id, { battleParams: rm.getBattleParams(node) });
  return { rm, node };
}

function makeP4({ run = false, deploy = ['Edric', 'Gaspar', 'Sera'], confirmed = true } = {}) {
  installSeed(5);
  let rm = null;
  let battleParams = prologueBattleParams(p4, { seed: 77 });
  let roster = buildPrologueRoster(data.prologue, data, p4);
  if (run) {
    const made = p4Run();
    rm = made.rm;
    battleParams = rm.getBattleParams(made.node);
    roster = rm.getRoster();
  }
  const fielded = deploy.map((n) => roster.find((u) => u.name === n)).filter(Boolean);
  const battle = new HeadlessBattle(data, { act: 'act1', objective: 'seize' }, fielded);
  battle.init({ battleConfig: config });
  const hints = { markSeen: vi.fn(), hasSeen: () => false, shouldShow: () => false };
  const meta = { recordPrologueChapter: vi.fn(), recordProloguePractised: vi.fn() };
  const events = { handlers: new Map(), on: vi.fn(), off: vi.fn(), once: vi.fn() };
  const scene = {
    gameData: data,
    battleParams,
    runManager: rm,
    nodeId: rm?.battleInProgress?.nodeId || null,
    turnPar: battle.turnPar,
    getVisionChargesRemaining: () => 0,
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
    // The deploy screen's confirmation (BattleScene.create): the chapter's deploy
    // lesson is practised by that choice. An auto-deploy or a resume confirms nothing.
    _deployConfirmation: confirmed ? { count: fielded.length } : null,
  };
  const varro = battle.enemyUnits.find((u) => u.isBoss);
  return { scene, battle, rm, hints, meta, varro };
}

const notes = () => showImportantHint.mock.calls.map((call) => call[1]);
const flushNotes = async (prologue) => {
  for (let i = 0; i < 10; i++) {
    prologue.flushDeferred();
    await Promise.resolve();
    await Promise.resolve();
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
});
afterEach(() => {
  restoreMathRandom();
  vi.unstubAllGlobals();
});

describe('P4: the quarry gate, beat by beat', () => {
  it('the opening: the coach names only the objective; the note explains seize and this par', async () => {
    const { scene, hints } = makeP4({ run: true });
    expect(scene.turnPar).toBe(10);
    const prologue = new PrologueController(scene).create();
    prologue.onPhaseStart('player', 1);
    await flushNotes(prologue);
    expect(prologue.scripted()).toMatchObject({
      goal: 'Defeat Captain Varro, then Seize the gate',
    });
    expect(notes()).toEqual([
      'Seize: defeat Captain Varro, then a lord steps onto the gate and chooses Seize.\n' +
        'Par: win in 10 turns or fewer for bonus gold. Safety first; speed pays.',
    ]);
    expect([...prologue.lessons.shown]).toEqual(expect.arrayContaining(['seize', 'par']));
    expect([...prologue.lessons.practised]).toContain('deploy');
    // In the run, the in-run seize and par notes it stands in for are read on this slot.
    expect(hints.markSeen).toHaveBeenCalledWith('battle_seize');
    expect(hints.markSeen).toHaveBeenCalledWith('battle_par');
  });

  it('the throne lesson: the first forecast on Varro while he holds the throne, never another', async () => {
    const { scene, battle, varro } = makeP4();
    const prologue = new PrologueController(scene).create();
    prologue.onPhaseStart('player', 1);
    await flushNotes(prologue);
    showImportantHint.mockClear();
    const edric = battle.playerUnits.find((u) => u.name === 'Edric');
    const soldier = battle.enemyUnits.find((u) => u.authoredId === 'k');
    // Another target: nothing about the throne.
    await prologue.onForecastOpened(edric, soldier, { attacker: {}, defender: {} });
    expect(notes()).toEqual([]);
    // Varro on the throne: the note, once.
    expect(battle.grid.getTerrainAt(varro.col, varro.row).name).toBe('Throne');
    await prologue.onForecastOpened(edric, varro, { attacker: {}, defender: {} });
    expect(notes()).toEqual([
      'The throne guards Captain Varro: harder to hurt, and he heals each turn.\n' +
        'His axe reaches 1 tile. Strike from 2 where you can.',
    ]);
    expect([...prologue.lessons.shown]).toContain('boss_throne');
    await prologue.onForecastOpened(edric, varro, { attacker: {}, defender: {} });
    expect(notes()).toHaveLength(1);
  });

  it('Varro off the throne draws no throne note', async () => {
    const { scene, battle, varro } = makeP4();
    const prologue = new PrologueController(scene).create();
    prologue.onPhaseStart('player', 1);
    await flushNotes(prologue);
    showImportantHint.mockClear();
    Object.assign(varro, { col: 9, row: 2 });
    const edric = battle.playerUnits.find((u) => u.name === 'Edric');
    await prologue.onForecastOpened(edric, varro, { attacker: {}, defender: {} });
    expect(notes()).toEqual([]);
  });

  it("Varro's fall turns the coach to the gate; a Seize records the lesson practised", async () => {
    const { scene, varro, hints } = makeP4({ run: true });
    const prologue = new PrologueController(scene).create();
    prologue.onPhaseStart('player', 1);
    await flushNotes(prologue);
    showImportantHint.mockClear();
    varro.currentHP = 0;
    scene.enemyUnits.splice(scene.enemyUnits.indexOf(varro), 1);
    prologue.onUnitDefeated(varro);
    await flushNotes(prologue);
    expect(prologue.scripted()).toMatchObject({ goal: 'A lord: step onto the gate and Seize' });
    // Edric says so first (he is always on the field), then the note.
    expect(scene.dialogueOverlay.showSequence).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          speaker: 'Edric',
          line: expect.stringContaining('Varro is down'),
        }),
      ],
      { category: 'prologue', key: 'p4_gate_open' },
    );
    expect(notes()).toEqual(['Captain Varro has fallen. Now a lord: step onto the gate and Seize.']); // prettier-ignore
    // It stands in for the real run's objective-change note on this slot.
    expect(hints.markSeen).toHaveBeenCalledWith('guide_objective_changed');
    expect([...prologue.lessons.practised]).not.toContain('seize');
    const edric = scene.playerUnits.find((u) => u.name === 'Edric');
    await prologue.onSeize(edric);
    expect([...prologue.lessons.practised]).toContain('seize');
  });

  it('every fielded unit is protected; a fall restarts the chapter with the whole army (the deploy screen again)', async () => {
    const { scene, rm } = makeP4({ run: true });
    const prologue = new PrologueController(scene).create();
    for (const u of scene.playerUnits) expect(prologue.isProtected(u), u.name).toBe(true);
    const gaspar = scene.playerUnits.find((u) => u.name === 'Gaspar');
    gaspar.currentHP = 0;
    scene.playerUnits.splice(scene.playerUnits.indexOf(gaspar), 1);
    prologue.onUnitDefeated(gaspar);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(restartScene).toHaveBeenCalledTimes(1);
    const [, launch] = restartScene.mock.calls[0];
    expect(launch.nodeId).toBe('prologue_5');
    expect(launch.battleParams.prologueChapter).toBe('p4_quarry_gate');
    // Four in the army, three spawns: BattleScene opens the deploy screen, never a checkpoint.
    expect(launch.roster.map((u) => u.name).sort()).toEqual(['Edric', 'Gaspar', 'Sera', 'Tamsin']); // prettier-ignore
    expect(launch.roster.length).toBeGreaterThan(p4.playerSpawns.length);
    expect(rm.battleInProgress?.checkpoint ?? null).toBeNull();
  });
});

describe("P4's pure pieces", () => {
  it('the deploy rule, the formation, the route line', () => {
    expect(prologueDeployRule(p4)).toEqual({ min: 2, note: 'p4_deploy' });
    expect(p4.roster).toHaveLength(4);
    expect(p4.playerSpawns).toHaveLength(3);
    expect(prologueOpensFormation(p4)).toBe(true);
    // The formation's spares are its own authored tiles, never the throne.
    expect(config.formationSpares).toEqual(p4.formation.tiles);
    const p3 = data.prologue.chapters.find((c) => c.id === 'p3_seer_on_the_road');
    expect(prologueDeployRule(p3)).toBeNull();
    expect(prologueOpensFormation(p3)).toBe(false);
    expect(prologueBossLine(p4, data.weapons)).toBe('Captain Varro · Fighter · Iron Axe (reach 1)');
    expect(prologueBossLine(p3, data.weapons)).toBeNull();
  });

  it("Varro's card: the prologue's epithet (he is in no act pool), the Prologue kicker", () => {
    const defs = prologueBossDefinitions(data.prologue);
    expect(defs.map((d) => d.name)).toEqual(['Captain Varro']);
    const unit = { name: 'Captain Varro', className: 'Fighter', isBoss: true, faction: 'enemy' };
    const card = bossCardContent({ unit, enemiesData: data.enemies, actId: 'prologue', extraBosses: defs }); // prettier-ignore
    expect(card).toMatchObject({ name: 'Captain Varro', epithet: 'Keeper of the Quarry Gate' });
    // Without the prologue's definitions there is no epithet to read (the fallback).
    const bare = bossCardContent({ unit, enemiesData: data.enemies, actId: 'prologue' });
    expect(bare?.epithet || null).not.toBe('Keeper of the Quarry Gate');
  });

  it("Varro's music: the act's boss theme, no enrage layer (turn pressure leaves it as is)", () => {
    const theme = getBossMusicKey('Captain Varro', 'act1');
    expect(theme).toBe(getBossMusicKey(null, 'act1'));
    expect(getBossEnrageLayer(theme, 'Captain Varro')).toBeNull();
  });
});
