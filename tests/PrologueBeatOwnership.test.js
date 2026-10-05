// A blocking tutorial sequence owns its interval of the simulation (review, 2026-10-04;
// docs/specs/prologue-chapter.md §9 "Who owns the screen"). Varro's fall launches a
// manual-advance line and then the seize note: the controller's hook returns a task
// that settles once both are read, BattleScene.removeUnit awaits it before the death's
// side effects and before combat or the enemy phase go on, and the player turn-start
// pipeline waits for the chapter's presentation instead of mistaking a note's
// TUTORIAL_HINT state for a superseded turn (the soft-lock: the pipeline returned, the
// note then restored TURN_START_RESOLVING, and nothing ever handed the turn over).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';

const { hintCalls } = vi.hoisted(() => ({ hintCalls: [] }));
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/HintDisplay.js', () => ({
  // Every note waits for the test to dismiss it.
  showImportantHint: vi.fn(
    (_scene, text) => new Promise((resolve) => hintCalls.push({ text, resolve })),
  ),
  showMinorHint: vi.fn(),
  showContextualHint: vi.fn(),
}));
vi.mock('../src/utils/errorReporter.js', () => ({ reportAsyncError: vi.fn() }));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { PrologueController } from '../src/ui/PrologueController.js';
import { prologueBattleParams } from '../src/engine/ScriptedBattle.js';
import { loadGameData } from './testData.js';

const data = {
  ...loadGameData(),
  dialogue: JSON.parse(readFileSync(new URL('../data/dialogue.json', import.meta.url), 'utf8')),
};
const p4 = data.prologue.chapters.find((c) => c.id === 'p4_quarry_gate');

/** A promise the test settles. */
function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

/** Settled or not, without waiting. */
async function settled(promise) {
  const token = Symbol('pending');
  const result = await Promise.race([promise, Promise.resolve(token)]);
  return result !== token;
}

const tick = async (n = 6) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

/** A BattleScene around P4 (standalone) with the pieces the hooks and the pipeline read. */
function makeScene() {
  const scene = new BattleScene();
  const lines = [];
  Object.assign(scene, {
    scene: { isActive: () => true },
    sys: { isActive: () => true },
    gameData: data,
    battleParams: prologueBattleParams(p4, { seed: 77 }),
    runManager: null,
    battleConfig: { objective: 'seize', thronePos: { col: 9, row: 0 } },
    battleState: 'PLAYER_IDLE',
    playerUnits: [
      { name: 'Edric', isCommander: true, isLord: true, faction: 'player', currentHP: 20, stats: { HP: 20, MOV: 5 }, col: 0, row: 6, moveType: 'Infantry', _movementSpent: 0 }, // prettier-ignore
    ],
    enemyUnits: [],
    npcUnits: [],
    escapedUnits: [],
    _zombieTombstones: [],
    turnPar: 10,
    turnCounterText: null,
    _latePressureWarningShown: false,
    grid: { fogEnabled: false, updateFogOfWar: vi.fn(), clearTemporaryTerrainsBySource: vi.fn() },
    showPhaseBanner: vi.fn(),
    dangerZone: { hide: vi.fn() },
    _clearCombatRollSession: vi.fn(),
    undimUnit: vi.fn(),
    dimUnit: vi.fn(),
    captureVisionSnapshot: vi.fn(),
    updateVisionHud: vi.fn(),
    refreshEndTurnControl: vi.fn(),
    updateObjectiveText: vi.fn(),
    _showBossDefeatedBanner: vi.fn(),
    removeUnitGraphic: vi.fn(),
    getTurnPressureState: vi.fn(() => ({ active: false })),
    getTurnPressureSummary: vi.fn(() => ''),
    _expireTimedWeaponArtBuffs: vi.fn(),
    processTurnStartEffects: vi.fn(async () => {}),
    processBallistaFire: vi.fn(async () => {}),
    registry: { get: vi.fn(() => null) },
    events: { on: vi.fn(), off: vi.fn(), once: vi.fn() },
    isStoryInputLocked: () => Boolean(scene.dialogueOverlay?.visible),
    _getPortraitKey: () => null,
    _combatFx: { deathFade: vi.fn(async () => {}) },
    dialogueOverlay: {
      visible: false,
      showSequence: vi.fn((entries, options) => {
        const line = deferred();
        scene.dialogueOverlay.visible = true;
        lines.push({
          key: options?.key,
          entries,
          resolve: () => {
            scene.dialogueOverlay.visible = false;
            line.resolve(true);
          },
        });
        return line.promise;
      }),
    },
  });
  const delayedCallbacks = [];
  scene.time = {
    delayedCall: vi.fn((ms, cb) => {
      delayedCallbacks.push({ ms, cb });
      return { remove: vi.fn() };
    }),
  };
  return { scene, lines, delayedCallbacks };
}

const varro = () => ({
  name: 'Captain Varro',
  authoredId: 'v',
  faction: 'enemy',
  isBoss: true,
  currentHP: 0,
  col: 9,
  row: 0,
  battleEntityId: 'e1',
});

beforeEach(() => {
  hintCalls.length = 0;
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("the controller's fall hook is a task", () => {
  it("Varro's fall settles only once his line and the seize note are read, and idle() with it", async () => {
    const { scene, lines } = makeScene();
    const prologue = new PrologueController(scene).create();
    const task = prologue.onUnitDefeated(varro());
    await tick();
    expect(lines.map((l) => l.key)).toEqual(['p4_gate_open']);
    expect(prologue.isPresenting()).toBe(true);
    const idle = prologue.idle();
    expect(await settled(task)).toBe(false);
    expect(await settled(idle)).toBe(false);
    // The coach and the gate's ring were set at once (sync actions), the note not yet.
    expect(prologue.scripted()).toMatchObject({ goal: 'A lord: step onto the gate and Seize' });
    expect(hintCalls).toHaveLength(0);
    lines[0].resolve();
    await tick();
    expect(hintCalls.map((h) => h.text)).toEqual(['Captain Varro has fallen. Now a lord: step onto the gate and Seize.']); // prettier-ignore
    expect(scene.battleState).toBe('TUTORIAL_HINT');
    expect(await settled(task)).toBe(false);
    expect(await settled(idle)).toBe(false);
    hintCalls[0].resolve(true);
    await tick();
    expect(await task).toBe(true);
    expect(await settled(idle)).toBe(true);
    expect(prologue.isPresenting()).toBe(false);
    expect(scene.battleState).toBe('PLAYER_IDLE');
    // Nothing to say: the task settles at once, false.
    expect(await prologue.onUnitDefeated({ name: 'Fighter', authoredId: 'k', faction: 'enemy' })).toBe(false); // prettier-ignore
    expect(await settled(prologue.idle())).toBe(true);
  });

  it('a destroyed controller releases whoever waits on idle()', async () => {
    const { scene } = makeScene();
    const prologue = new PrologueController(scene).create();
    void prologue.onUnitDefeated(varro());
    await tick();
    const idle = prologue.idle();
    expect(await settled(idle)).toBe(false);
    prologue.destroy();
    expect(await settled(idle)).toBe(true);
  });
});

describe('BattleScene.removeUnit awaits the fall beats', () => {
  it("the death's side effects, and so the combat that caused it, wait for the sequence", async () => {
    const { scene, lines } = makeScene();
    const prologue = new PrologueController(scene).create();
    scene._prologue = prologue;
    const boss = varro();
    scene.enemyUnits = [boss];
    scene.turnManager = { currentPhase: 'enemy', turnNumber: 1 };
    scene.battleState = 'ENEMY_PHASE';
    let after = false;
    const removal = scene.removeUnit(boss, { killer: scene.playerUnits[0] }).then(() => {
      after = true;
    });
    await tick(20);
    // The board is settled (he has left the field) while the line holds the screen.
    expect(scene.enemyUnits).toEqual([]);
    expect(lines.map((l) => l.key)).toEqual(['p4_gate_open']);
    expect(after).toBe(false);
    lines[0].resolve();
    await tick(20);
    expect(hintCalls).toHaveLength(1);
    expect(after).toBe(false);
    hintCalls[0].resolve(true);
    await removal;
    expect(after).toBe(true);
    expect(scene.battleState).toBe('ENEMY_PHASE');
  });
});

describe("Varro falls to the player's own attack (the turn's final action)", () => {
  it('the combat waits for his line and the note, and the combat state comes back for the action to complete', async () => {
    const { scene, lines } = makeScene();
    const prologue = new PrologueController(scene).create();
    scene._prologue = prologue;
    const boss = varro();
    scene.enemyUnits = [boss];
    scene.turnManager = { currentPhase: 'player', turnNumber: 3 };
    // executeCombat's state while the casualties leave, before finishUnitAction.
    scene.battleState = 'COMBAT_RESOLVING';
    let after = false;
    const removal = scene.removeUnit(boss, { killer: scene.playerUnits[0] }).then(() => {
      after = true;
    });
    await tick(20);
    expect(scene.enemyUnits).toEqual([]);
    expect(lines.map((l) => l.key)).toEqual(['p4_gate_open']);
    expect(after).toBe(false);
    lines[0].resolve();
    await tick(20);
    expect(hintCalls.map((h) => h.text)).toEqual(['Captain Varro has fallen. Now a lord: step onto the gate and Seize.']); // prettier-ignore
    // The note holds the rail; the combat is not over underneath it.
    expect(scene.battleState).toBe('TUTORIAL_HINT');
    expect(after).toBe(false);
    hintCalls[0].resolve(true);
    await removal;
    expect(after).toBe(true);
    // The action's own completion (finishUnitAction, then the phase's end) runs next,
    // from the state it left: nothing of the sequence turned it into a playable turn.
    expect(scene.battleState).toBe('COMBAT_RESOLVING');
    expect(prologue.isPresenting()).toBe(false);
    expect(prologue.scripted()).toMatchObject({ goal: 'A lord: step onto the gate and Seize' });
  });
});

describe('the player turn-start pipeline and a sequence that spans the turn start', () => {
  /**
   * Varro falls on the enemy phase; his line is still open when the player phase
   * begins. The pipeline must reach PLAYER_IDLE whether the player dismisses the
   * line and the note before the pipeline fires, with the line open, or with the
   * note open (the soft-lock case), and run the turn's effects exactly once.
   */
  async function play(dismissAt) {
    const { scene, lines, delayedCallbacks } = makeScene();
    const prologue = new PrologueController(scene).create();
    scene._prologue = prologue;
    scene.turnManager = { currentPhase: 'enemy', turnNumber: 1, endPlayerPhase: vi.fn() };
    scene.battleState = 'ENEMY_PHASE';
    const fall = prologue.onUnitDefeated(varro());
    await tick();
    expect(lines).toHaveLength(1);
    const readLine = async () => {
      lines[0].resolve();
      await tick(10);
      expect(hintCalls).toHaveLength(1);
    };
    const readNote = async () => {
      hintCalls[0].resolve(true);
      await tick(10);
    };
    if (dismissAt === 'before') {
      await readLine();
      await readNote();
    }
    // The enemy phase ends under the open sequence; the player phase begins.
    scene.turnManager = { currentPhase: 'player', turnNumber: 2, endPlayerPhase: vi.fn() };
    scene.onPhaseChange('player', 2);
    expect(scene.battleState).toBe(dismissAt === 'before' ? 'TURN_START_RESOLVING' : 'TURN_START_RESOLVING'); // prettier-ignore
    if (dismissAt === 'line') await readLine();
    expect(scene.battleState).toBe(dismissAt === 'line' ? 'TUTORIAL_HINT' : 'TURN_START_RESOLVING'); // prettier-ignore
    const pipeline = delayedCallbacks.find((entry) => entry.ms === 1200);
    const run = pipeline.cb();
    await tick(10);
    if (dismissAt === 'line') {
      expect(scene.processTurnStartEffects).not.toHaveBeenCalled();
      await readNote();
    } else if (dismissAt === 'open') {
      expect(scene.processTurnStartEffects).not.toHaveBeenCalled();
      await readLine();
      expect(scene.processTurnStartEffects).not.toHaveBeenCalled();
      await readNote();
    }
    await run;
    await fall;
    expect(scene.processTurnStartEffects).toHaveBeenCalledTimes(1);
    expect(scene.processBallistaFire).toHaveBeenCalledTimes(1);
    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(scene.turnManager.endPlayerPhase).not.toHaveBeenCalled();
    expect(prologue.scripted()).toMatchObject({ goal: 'A lord: step onto the gate and Seize' });
  }

  it('the line and the note read before the pipeline fires', () => play('before'));
  it('the line still open when the pipeline fires', () => play('open'));
  it('the note open when the pipeline fires (the soft-lock)', () => play('line'));
});

describe('Seize', () => {
  it("the seize beats are awaited before the victory flow (the chapter's seize lesson)", () => {
    const source = readFileSync(new URL('../src/scenes/BattleScene.js', import.meta.url), 'utf8');
    const start = source.indexOf("command('seize', 'Seize'");
    const body = source.slice(start, source.indexOf('this.onVictory();', start));
    expect(body).toMatch(
      /await safeBattlePresentation\([^)]*\(\) => this\._prologue\.onSeize\(unit\)/,
    );
    expect(body).toMatch(/isCurrentBattleSession\(this, session\)/);
  });
});
