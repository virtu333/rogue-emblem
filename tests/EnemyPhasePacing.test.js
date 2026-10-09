// Enemy-phase dead air (docs/specs/large-maps/02-encounters-and-pacing.md §2.5).
// Realistic ways this can fail, one test each (or a family):
//   - the beat still follows an enemy the player saw nothing of (a holder, a fogged
//     walk), or skips one the player did see (a seen walk, a strike on a player unit);
//   - the beat ignores the battle speed or hold-to-fast-forward;
//   - a hidden walk still tweens, or draws the sprite on a fogged tile (prefix, suffix,
//     a gap in the middle), or ends somewhere else than an unhidden one;
//   - an idle enemy still writes a checkpoint and a timeline row, or an acting one
//     stops writing them;
//   - a phase with skipped checkpoints resumes to a different board or RNG cursor than
//     the live phase reached (both rewind policies, from every durable write);
//   - an idle turn draws randomness;
//   - the heal or status-staff banner names a unit the fog hides;
//   - pacing changes game state (the same phase at every speed and visibility).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { AIController } from '../src/engine/AIController.js';
import { isIdleEnemyDecision } from '../src/engine/EnemyTurnOutcome.js';
import {
  ENEMY_BEAT_LABEL,
  enemyBeatDuration,
  enemyHealBanner,
  enemyStepDuration,
  planEnemyMoveSteps,
  seenUnitName,
  skipsIdleCheckpoint,
} from '../src/ui/EnemyPhasePacing.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { serializeBattleUnit } from '../src/engine/BattleUnitState.js';
import { setUnitHP } from '../src/engine/UnitHealth.js';
import { loadRun } from '../src/engine/RunManager.js';
import { RunDriver, JourneyStorage } from './harness/RunDriver.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { loadGameData } from './testData.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';

const data = loadGameData();
const RUN_KEY = 'emblem_rogue_slot_1_run';

afterEach(() => {
  restoreMathRandom();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('isIdleEnemyDecision: only a decision that commits nothing is idle', () => {
  it.each([
    'hold',
    'asleep',
    'guard_hold',
    'healer_hold',
    'artillery_hold',
    'boss_hold_throne',
    'no_viable_target',
    'no_reachable_move',
    'no_in_range',
  ])('%s with no path, target, heal, staff or break is idle', (reason) => {
    expect(isIdleEnemyDecision({ path: null, target: null, reason })).toBe(true);
    expect(isIdleEnemyDecision({ path: [{ col: 1, row: 1 }], target: null, reason })).toBe(true);
  });
  it.each([
    [
      'a move',
      {
        path: [
          { col: 0, row: 0 },
          { col: 1, row: 0 },
        ],
      },
    ],
    ['an attack', { target: { name: 'Edric' } }],
    ['a heal', { healTarget: { name: 'Fighter' } }],
    ['a status staff', { statusStaffTarget: { name: 'Edric' } }],
    ['a wall break', { breakTile: { col: 2, row: 2 } }],
  ])('%s is not idle', (_label, fields) => {
    expect(isIdleEnemyDecision({ path: null, target: null, reason: 'x', ...fields })).toBe(false);
  });
  it('an unknown decision is never idle (the checkpoint is kept)', () => {
    expect(isIdleEnemyDecision(null)).toBe(false);
    expect(isIdleEnemyDecision(undefined)).toBe(false);
  });
  it('queued EXP keeps the boundary even for an idle turn', () => {
    const idle = { path: null, target: null, reason: 'hold' };
    expect(skipsIdleCheckpoint({}, idle)).toBe(true);
    expect(skipsIdleCheckpoint({ _pendingXpGauges: [{}] }, idle)).toBe(false);
    expect(skipsIdleCheckpoint({ _pendingLevelUpPopups: [{}] }, idle)).toBe(false);
  });
});

describe('planEnemyMoveSteps: no tween in the dark', () => {
  const path = (n) => Array.from({ length: n }, (_, i) => ({ col: i, row: 0 }));
  const seenCols = (cols) => (col) => cols.includes(col);
  it('fog off: every step is drawn', () => {
    const plan = planEnemyMoveSteps(path(4), () => true);
    expect(plan.steps.map((s) => s.tween)).toEqual([true, true, true]);
    expect(plan.seen).toBe(true);
  });
  it('a walk the player sees none of: no tween at all, not seen', () => {
    const plan = planEnemyMoveSteps(path(5), () => false);
    expect(plan.steps.map((s) => s.tween)).toEqual([false, false, false, false]);
    expect(plan.steps.map((s) => s.shown)).toEqual([false, false, false, false]);
    expect(plan.seen).toBe(false);
  });
  it('a hidden prefix and suffix are skipped; the seen stretch is drawn', () => {
    // Tiles 0,1 hidden; 2,3,4 seen; 5,6 hidden.
    const plan = planEnemyMoveSteps(path(7), seenCols([2, 3, 4]));
    // Steps 1..6: 0→1 hidden, 1→2 enters (snap, shown), 2→3, 3→4 drawn, 4→5 leaves, 5→6 hidden.
    expect(plan.steps.map((s) => s.tween)).toEqual([false, false, true, true, false, false]);
    expect(plan.steps.map((s) => s.shown)).toEqual([false, true, true, true, false, false]);
    expect(plan.seen).toBe(true);
  });
  it('a hidden gap in the middle is not drawn either', () => {
    const plan = planEnemyMoveSteps(path(5), seenCols([0, 1, 3, 4]));
    expect(plan.steps.map((s) => s.tween)).toEqual([true, false, false, true]);
    expect(plan.steps.map((s) => s.shown)).toEqual([true, false, true, true]);
  });
  it('only the start tile seen: no tween, but the player saw the unit leave', () => {
    const plan = planEnemyMoveSteps(path(3), seenCols([0]));
    expect(plan.steps.map((s) => s.tween)).toEqual([false, false]);
    expect(plan.steps.map((s) => s.hold)).toEqual([false, false]);
    expect(plan.seen).toBe(true);
  });
  // The review's table: a walk that clips the party's vision by one tile is seen, yet no
  // step around that tile is tweened, so the tile must be held or it is never drawn.
  it.each([
    ['hidden, seen, hidden', [1], 3, [false, false], [true, false]],
    ['hidden, seen, seen, hidden', [1, 2], 4, [false, true, false], [false, false, false]],
    ['all hidden', [], 3, [false, false], [false, false]],
    [
      'a lone seen tile mid-walk',
      [2],
      5,
      [false, false, false, false],
      [false, true, false, false],
    ],
    ['a lone seen tile at the end (left visible)', [2], 3, [false, false], [false, false]],
    ['two lone seen tiles', [1, 3], 5, [false, false, false, false], [true, false, true, false]],
  ])('%s', (_label, cols, length, tweens, holds) => {
    const plan = planEnemyMoveSteps(path(length), seenCols(cols));
    expect(plan.steps.map((s) => s.tween)).toEqual(tweens);
    expect(plan.steps.map((s) => s.hold)).toEqual(holds);
    expect(plan.seen).toBe(cols.length > 0);
    // Every seen tile past the start is drawn for a step: tweened into or out of, or held.
    for (const col of cols.filter((c) => c > 0)) {
      const into = plan.steps.find((s) => s.index === col);
      const outOf = plan.steps.find((s) => s.index === col + 1);
      const isLast = col === length - 1;
      expect(into.tween || into.hold || outOf?.tween || isLast, `tile ${col}`).toBe(true);
    }
  });
});

describe('the beat between enemies', () => {
  const sceneAt = (speed, extra = {}) => ({
    registry: { get: () => ({ getBattleSpeed: () => speed }) },
    turnManager: { currentPhase: 'enemy' },
    ...extra,
  });
  it.each([
    ['normal', 300],
    ['fast', 150],
    ['instant', 1],
  ])('a seen turn waits the beat at %s', (speed, ms) => {
    expect(enemyBeatDuration(sceneAt(speed), true)).toBe(ms);
  });
  it.each(['normal', 'fast', 'instant'])('an unseen turn never waits at %s', (speed) => {
    expect(enemyBeatDuration(sceneAt(speed), false)).toBe(0);
  });
  it('hold-to-fast-forward in the enemy phase counts as Fast (never slower than Instant)', () => {
    expect(enemyBeatDuration(sceneAt('normal', { _holdBattleFast: true }), true)).toBe(150);
    expect(enemyBeatDuration(sceneAt('instant', { _holdBattleFast: true }), true)).toBe(1);
    const playerPhase = sceneAt('normal', {
      _holdBattleFast: true,
      turnManager: { currentPhase: 'player' },
    });
    expect(enemyBeatDuration(playerPhase, true)).toBe(300);
  });
});

describe('banners never name a unit the player cannot see', () => {
  const grid = { fogEnabled: true, isVisible: (col) => col === 1 };
  const healer = { name: 'Cleric', faction: 'enemy', col: 1, row: 0 };
  const hiddenHealer = { name: 'Cleric', faction: 'enemy', col: 5, row: 0 };
  const seenAlly = { name: 'Brigand', faction: 'enemy', col: 1, row: 1 };
  const hiddenAlly = { name: 'Hidden Knight', faction: 'enemy', col: 6, row: 0 };
  it('heal: the target only when seen; the healer when only it is seen; else none', () => {
    expect(enemyHealBanner(grid, healer, seenAlly, 7)).toBe('Brigand healed 7 HP');
    expect(enemyHealBanner(grid, healer, hiddenAlly, 7)).toBe('Cleric healed an unseen ally');
    expect(enemyHealBanner(grid, hiddenHealer, hiddenAlly, 7)).toBeNull();
    expect(enemyHealBanner({ fogEnabled: false }, hiddenHealer, hiddenAlly, 7)).toBe(
      'Hidden Knight healed 7 HP',
    );
  });
  it('a status staff names a hidden caster as an unseen enemy', () => {
    expect(seenUnitName(grid, hiddenHealer, 'An unseen enemy')).toBe('An unseen enemy');
    expect(seenUnitName(grid, healer, 'An unseen enemy')).toBe('Cleric');
    expect(seenUnitName(grid, { name: 'Edric', faction: 'player', col: 9 }, '?')).toBe('Edric');
  });
});

// --- animateEnemyMove on a real scene method, rendering faked ---------------------

const PX = 32;
function moveScene({ fog, seen, speed = 'normal', hold = false }) {
  const scene = new BattleScene();
  scene.registry = { get: (key) => (key === 'settings' ? { getBattleSpeed: () => speed } : null) };
  scene.turnManager = { currentPhase: 'enemy' };
  scene._holdBattleFast = hold;
  const terrain = data.terrain;
  scene.grid = {
    cols: 8,
    rows: 1,
    mapLayout: [Array(8).fill(0)],
    terrainData: terrain,
    fogEnabled: fog,
    isVisible: (col, row) => !fog || seen.has(`${col},${row}`),
    gridToPixel: (col, row) => ({ x: col * PX, y: row * PX }),
  };
  scene.runManager = { battleInProgress: {} };
  scene.buildOccupiedSet = () => new Set();
  scene._getCostModifier = () => null;
  const tweens = [];
  const sprite = (name) => {
    const part = {
      name,
      x: 0,
      y: 0,
      visible: !fog || seen.has('0,0'),
      shownOnHidden: [],
      setPosition(x, y) {
        this.x = x;
        this.y = y;
        this.check();
      },
      setVisible(v) {
        this.visible = v;
        this.check();
      },
      check() {
        const key = `${Math.round(this.x / PX)},${Math.round(this.y / PX)}`;
        if (this.visible && fog && !seen.has(key)) this.shownOnHidden.push(key);
      },
    };
    return part;
  };
  // What a frame drawn while the walk waits would show: the sprite at each await's start
  // (and, for a tween, along it to its end). A sync-only show/hide is never sampled.
  const frames = [];
  const sample = (part) => ({
    tile: `${Math.round(part.x / PX)},${Math.round(part.y / PX)}`,
    visible: part.visible,
  });
  const holds = [];
  scene._awaitSceneTween = vi.fn(async (config, options) => {
    const from = config.targets.map((t) => ({ x: t.x, y: t.y, visible: t.visible }));
    frames.push(sample(config.targets[0]));
    tweens.push({
      from,
      to: { x: config.x, y: config.y },
      label: 'step',
      duration: config.duration,
      scaled: options?.scaled === true,
    });
    for (const t of config.targets) t.setPosition(config.x, config.y);
    frames.push(sample(config.targets[0]));
  });
  scene._awaitSceneDelay = vi.fn(async (ms, options) => {
    holds.push({ ms, ...options });
    frames.push(sample(unitRef.graphic));
  });
  scene.updateUnitPosition = (unit) => {
    unit.graphic.setPosition(unit.col * PX, unit.row * PX);
    unit.label.setPosition(unit.col * PX, unit.row * PX);
  };
  scene.updateEnemyVisibility = function () {
    for (const enemy of [unitRef]) {
      const vis = this.grid.isVisible(enemy.col, enemy.row);
      enemy.graphic.setVisible(vis);
      enemy.label.setVisible(vis);
    }
  };
  scene._battleSession = 1;
  const unitRef = {
    name: 'Raider',
    faction: 'enemy',
    battleEntityId: 'e1',
    col: 0,
    row: 0,
    moveType: 'Infantry',
    graphic: sprite('graphic'),
    label: sprite('label'),
  };
  return { scene, unit: unitRef, tweens, frames, holds };
}

describe('animateEnemyMove: hidden steps are never drawn and the walk ends the same', () => {
  const path = Array.from({ length: 6 }, (_, i) => ({ col: i, row: 0 }));
  const seenOf = (cols) => new Set(cols.map((c) => `${c},0`));
  const cases = [
    ['fog off', false, []],
    ['all seen', true, [0, 1, 2, 3, 4, 5]],
    ['hidden mover', true, []],
    ['emerges from the fog', true, [3, 4, 5]],
    ['walks into the fog', true, [0, 1, 2]],
    ['crosses a fogged gap', true, [0, 1, 4, 5]],
    ['clips one seen tile', true, [2]],
    ['clips two seen tiles', true, [2, 3]],
    ['clips two lone seen tiles', true, [1, 3]],
  ];
  const outcomes = [];
  it.each(cases)('%s', async (_label, fog, cols) => {
    const seen = seenOf(cols);
    const { scene, unit, tweens, frames } = moveScene({ fog, seen });
    const result = await scene.animateEnemyMove(unit, path);
    // Same final state whatever was drawn (presentation invariance).
    outcomes.push({
      col: unit.col,
      row: unit.row,
      beats: (scene._historyBeats || []).length,
    });
    expect({ col: unit.col, row: unit.row }).toEqual({ col: 5, row: 0 });
    // Never drawn on a fogged tile, at any moment.
    expect(unit.graphic.shownOnHidden).toEqual([]);
    expect(unit.label.shownOnHidden).toEqual([]);
    // Each tween runs between two seen tiles with the sprite shown.
    const fullySeenSteps = path
      .slice(1)
      .filter((t, i) => !fog || (seen.has(`${path[i].col},0`) && seen.has(`${t.col},0`))).length;
    expect(tweens).toHaveLength(fullySeenSteps);
    for (const tween of tweens) {
      const toKey = `${tween.to.x / PX},0`;
      expect(!fog || seen.has(toKey)).toBe(true);
      for (const part of tween.from) {
        expect(part.visible).toBe(true);
        expect(!fog || seen.has(`${part.x / PX},0`)).toBe(true);
      }
    }
    expect(result).toEqual({ seen: !fog || cols.length > 0 });
    // Every seen tile the walk crosses is drawn: a frame shows the sprite on it.
    for (const tile of path.slice(1)) {
      const key = `${tile.col},0`;
      if (fog && !seen.has(key)) continue;
      expect(
        frames.some((f) => f.visible && f.tile === key),
        `drawn on ${key}`,
      ).toBe(true);
    }
    // No frame ever shows the sprite on a hidden tile; a walk seen nowhere waits nowhere.
    expect(frames.filter((f) => f.visible && fog && !seen.has(f.tile))).toEqual([]);
    if (fog && cols.length === 0) expect(frames).toEqual([]);
    // The sprite's visibility at rest matches the destination's.
    expect(unit.graphic.visible).toBe(!fog || seen.has('5,0'));
  });
  it.each([
    ['normal', false, 80, 60],
    ['fast', false, 40, 30],
    ['instant', false, 1, 1],
    // Hold-to-fast-forward speeds the visible walk as it speeds the beat.
    ['normal', true, 40, 30],
    ['instant', true, 1, 1],
  ])(
    'a seen step and a clipped tile at %s (hold %s) take %i ms',
    async (speed, hold, step, slide) => {
      const all = moveScene({ fog: false, seen: new Set(), speed, hold });
      expect(enemyStepDuration(all.scene, { slide: true })).toBe(slide);
      await all.scene.animateEnemyMove(all.unit, path);
      expect(all.tweens.map((t) => [t.duration, t.scaled])).toEqual(Array(5).fill([step, true]));
      const clipped = moveScene({ fog: true, seen: seenOf([2]), speed, hold });
      await clipped.scene.animateEnemyMove(clipped.unit, path);
      expect(clipped.tweens).toEqual([]);
      expect(clipped.holds).toEqual([{ ms: step, label: 'animate_enemy_move_step', scaled: true }]);
    },
  );
  it('the hold never speeds a walk outside the enemy phase', async () => {
    const m = moveScene({ fog: false, seen: new Set(), hold: true });
    m.scene.turnManager.currentPhase = 'player';
    await m.scene.animateEnemyMove(m.unit, path);
    expect(m.tweens.map((t) => t.duration)).toEqual(Array(5).fill(80));
  });
  it('every case ends on the same tile', () => {
    expect(outcomes).toHaveLength(cases.length);
    for (const o of outcomes)
      expect({ col: o.col, row: o.row }).toEqual(outcomes[0] && { col: 5, row: 0 });
  });
});

// --- The enemy phase on the real scene loop, AIController and suspend controller ---

let storage;
beforeEach(() => {
  storage = new JourneyStorage();
  vi.stubGlobal('localStorage', storage);
});

const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));

/**
 * A journey scene (rendering faked; checkpoint, timeline, restore and the enemy-phase
 * loop real) with a real AIController. Enemies, in array order: a holder, an attacker,
 * a second holder, a sleeper, a second attacker and a guard at its post. Attacks are a
 * fake combat that draws the battle RNG (as Combat does) and deals the drawn damage.
 */
function phaseScene(run, { beats = [] } = {}) {
  const scene = journeyBattleScene(run, data);
  scene._battleSession = 1;
  Object.assign(scene.grid, {
    cols: 10,
    rows: 10,
    mapLayout: Array.from({ length: 10 }, () => Array(10).fill(0)),
    fogEnabled: false,
  });
  scene.isDevToolsEnabled = () => false;
  scene.createEnemyPhaseAiStats = () => ({ byReason: {}, noPathUnits: [] });
  scene.finalizeEnemyPhaseAiStats = () => {};
  scene.processTerrainDamage = async () => {};
  scene.applyReinforcementsForTurn = () => {};
  scene.turnManager.endEnemyPhase = vi.fn();
  scene.showBriefBanner = () => {};
  scene._awaitSceneDelay = vi.fn(async (ms, options) => {
    beats.push({ ms, ...options });
  });
  scene.executeEnemyCombat = async (enemy, target) => {
    const roll = scene._battleRng();
    setUnitHP(target, target.currentHP - (1 + Math.floor(roll * 3)));
    enemy._fakeRolls = [...(enemy._fakeRolls || []), roll];
  };
  const ai = new AIController(scene.grid, data, { objective: 'rout' });
  const decide = ai._decideAction.bind(ai);
  ai._decideAction = (enemy, ...rest) => {
    if (!enemy.name.startsWith('Raider')) return decide(enemy, ...rest);
    const target = scene.playerUnits.find((p) => p.currentHP > 0);
    return ai._finalizeDecision(enemy, { path: null, target, reason: 'attack_in_range' });
  };
  scene.aiController = ai;
  return scene;
}

function setupLive({ policy }) {
  // The run's own creation draws Math.random: seed it so every setup is the same board.
  installSeed(1234);
  const driver = new RunDriver(storage, { seed: 7 });
  const run = driver.run;
  run.beginBattleInProgress('pacing-battle', { act: 'act1', objective: 'rout' });
  run.battleInProgress.rewindPolicy = policy;
  const beats = [];
  const scene = phaseScene(run, { beats });
  const lord = structuredClone(run.roster[0]);
  Object.assign(lord, {
    col: 1,
    row: 1,
    faction: 'player',
    isCommander: true,
    currentHP: 60,
    hasActed: true,
  });
  lord.stats = { ...lord.stats, HP: 60 };
  scene.playerUnits = [lord];
  scene.addUnitGraphic(lord);
  const foe = (name, extra = {}) => ({
    name,
    className: 'Fighter',
    faction: 'enemy',
    level: 3,
    col: 2,
    row: 1,
    currentHP: 20,
    stats: { HP: 20, STR: 5, MAG: 0, SKL: 3, SPD: 3, DEF: 2, RES: 0, LCK: 0, MOV: 5 },
    weapon: weapon('Iron Axe'),
    proficiencies: [{ type: 'Axe', rank: 'Prof' }],
    moveType: 'Infantry',
    inventory: [],
    consumables: [],
    skills: [],
    hasActed: false,
    ...extra,
  });
  const enemies = [
    foe('Holder A', { col: 9, row: 9, aiMode: 'hold', holdPack: 0, holdPackSize: 1 }),
    foe('Raider One', { col: 2, row: 1 }),
    foe('Holder B', { col: 9, row: 8, aiMode: 'hold', holdPack: 1, holdPackSize: 1 }),
    foe('Sleeper', { col: 8, row: 9, _conditions: [{ id: 'sleep', turnsRemaining: 2 }] }),
    foe('Raider Two', { col: 1, row: 2 }),
    foe('Sentry', { col: 9, row: 0, aiMode: 'guard', guardPost: { col: 9, row: 0 } }),
  ];
  for (const enemy of enemies) {
    enemy.inventory = [enemy.weapon];
    if (enemy.aiMode === 'hold') enemy.holdPost = { col: enemy.col, row: enemy.row };
    scene.addUnitGraphic(enemy);
  }
  scene.enemyUnits = enemies;
  scene.turnManager.turnNumber = 3;
  scene._battleSuspendController = new BattleSuspendController(scene);
  // End Turn's checkpoint: the board the whole enemy phase replays from.
  scene._timelineBoundary = 'player_action';
  expect(scene._captureSuspendCheckpoint({ session: 1 })).toBe(true);
  return { driver, run, scene, beats };
}

const durableRuns = [];
function recordWrites() {
  const setItem = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    setItem(key, value);
    if (key === RUN_KEY) durableRuns.push(String(value));
  };
}

async function runEnemyPhase(scene) {
  scene.turnManager.currentPhase = 'enemy';
  scene.battleState = 'ENEMY_PHASE';
  await scene.startEnemyPhase();
}

/** Everything a resume must reproduce: the board and the RNG cursor. */
function endState(scene, { ignoreUids = false } = {}) {
  const units = (list) =>
    list.map((u) => {
      const data = serializeBattleUnit(u);
      delete data.graphic;
      return data;
    });
  // Separate runs in one process number their item uids from one counter.
  const replacer = ignoreUids ? (key, value) => (key === 'uid' ? undefined : value) : undefined;
  return JSON.parse(
    JSON.stringify(
      {
        players: units(scene.playerUnits),
        enemies: units(scene.enemyUnits),
        rng: scene._battleRng.getState(),
      },
      replacer,
    ),
  );
}

async function resumeFrom(driver, raw) {
  storage.values.set(RUN_KEY, raw);
  const restored = loadRun(driver.data, 1);
  const scene = phaseScene(restored);
  scene._battleTimeline = restored.battleInProgress.timeline;
  scene._timelineCurrentEntryId = restored.battleInProgress.timelineCurrentEntryId;
  const checkpoint = restored.battleInProgress.checkpoint;
  const resume = new BattleSuspendController(scene);
  scene._battleSuspendController = resume;
  let replay = null;
  scene._scheduleSafeDelayedAsync = (_ms, _label, callback) => {
    replay = callback;
  };
  resume.applyUnits(checkpoint);
  resume.finalizeResume(checkpoint);
  if (checkpoint.phase === 'enemy') await replay();
  else {
    // End Turn's checkpoint: the exhausted player phase hands off to the same enemy phase.
    expect(scene.turnManager.endPlayerPhaseCalls).toBe(1);
    await runEnemyPhase(scene);
  }
  return { scene, checkpoint };
}

describe.each(['fixed-v1', 'legacy-v1'])('an enemy phase under %s', (policy) => {
  beforeEach(() => {
    durableRuns.length = 0;
  });

  it('idle enemies write no checkpoint and no timeline row; acting ones still do', async () => {
    const { scene, run, beats } = setupLive({ policy });
    recordWrites();
    const rowsBefore = scene._battleTimeline.entries.length;
    const indexBefore = run.battleInProgress.checkpoint.checkpointIndex;
    await runEnemyPhase(scene);
    // Every enemy took its turn and is marked acted.
    expect(scene.enemyUnits.map((u) => [u.name, u._lastAiDecision.reason, u.hasActed])).toEqual([
      ['Holder A', 'hold', true],
      ['Raider One', 'attack_in_range', true],
      ['Holder B', 'hold', true],
      ['Sleeper', 'asleep', true],
      ['Raider Two', 'attack_in_range', true],
      ['Sentry', 'guard_hold', true],
    ]);
    // Two acting enemies: two durable writes, two checkpoints, two rows. Nothing for the
    // four idle ones (the old loop wrote six of each).
    expect(durableRuns).toHaveLength(2);
    expect(run.battleInProgress.checkpoint.checkpointIndex).toBe(indexBefore + 2);
    expect(scene._battleTimeline.entries.length - rowsBefore).toBe(2);
    expect(scene._battleTimeline.entries.slice(-2).map((e) => e.kind)).toEqual([
      'enemy_action',
      'enemy_action',
    ]);
    // The second checkpoint already holds every idle enemy before it as acted.
    const saved = JSON.parse(durableRuns[1]).battleInProgress.checkpoint.enemyUnits;
    expect(saved.map((u) => u.hasActed)).toEqual([true, true, true, true, true, false]);
    // Fog off: the player sees the two strikes; the beat follows those two only.
    expect(beats).toEqual([
      { ms: 300, label: ENEMY_BEAT_LABEL, scaled: true },
      { ms: 300, label: ENEMY_BEAT_LABEL, scaled: true },
    ]);
  });

  it('a resume from any durable write reaches the live board and RNG cursor exactly', async () => {
    const { driver, scene } = setupLive({ policy });
    const endTurn = storage.getItem(RUN_KEY);
    recordWrites();
    await runEnemyPhase(scene);
    const live = endState(scene);
    // The fake combat drew the stream once per strike: the cursor moved.
    expect(scene.enemyUnits.filter((u) => u._fakeRolls).length).toBe(2);
    // A crash before any acting enemy's write (Holder A), after Raider One's (Holder B,
    // Sleeper), and after Raider Two's (Sentry) resumes from these three saves.
    const saves = [endTurn, ...durableRuns];
    expect(saves).toHaveLength(3);
    for (const [index, raw] of saves.entries()) {
      const { scene: resumed, checkpoint } = await resumeFrom(driver, raw);
      expect(checkpoint.phase, `save ${index}`).toBe(index === 0 ? 'player' : 'enemy');
      expect(endState(resumed), `resume from save ${index}`).toEqual(live);
    }
  });
});

describe('idle turns draw no randomness', () => {
  it('a phase of holders, a sleeper and a guard never calls Math.random or the battle RNG', async () => {
    const { scene } = setupLive({ policy: 'fixed-v1' });
    scene.enemyUnits = scene.enemyUnits.filter((u) => !u.name.startsWith('Raider'));
    const cursor = scene._battleRng.getState();
    const random = vi.spyOn(Math, 'random');
    await runEnemyPhase(scene);
    expect(random).not.toHaveBeenCalled();
    expect(scene._battleRng.getState()).toEqual(cursor);
    expect(scene.enemyUnits.every((u) => u.hasActed)).toBe(true);
  });
});

describe('pacing never changes game state', () => {
  it('the same phase at every speed, with and without fog, ends on the same board', async () => {
    const ends = [];
    for (const speed of ['normal', 'fast', 'instant'])
      for (const fog of [false, true]) {
        storage = new JourneyStorage();
        vi.stubGlobal('localStorage', storage);
        const { scene, beats } = setupLive({ policy: 'fixed-v1' });
        scene.registry = {
          get: (key) =>
            key === 'activeSlot' ? 1 : key === 'settings' ? { getBattleSpeed: () => speed } : null,
        };
        scene.grid.fogEnabled = fog;
        await runEnemyPhase(scene);
        ends.push(endState(scene, { ignoreUids: true }));
        const expected = { normal: 300, fast: 150, instant: 1 }[speed];
        // The strikes hit a player unit: seen with or without fog.
        expect(beats.map((b) => b.ms)).toEqual([expected, expected]);
      }
    for (const end of ends) expect(end).toEqual(ends[0]);
  });
});

describe('the scene wires the beat and the heal banner to what the player sees', () => {
  function wiredScene({ fog, visible }) {
    const scene = new BattleScene();
    scene.scene = { isActive: () => true };
    scene._battleSession = 1;
    scene.battleState = 'ENEMY_PHASE';
    scene.battleConfig = { objective: 'rout' };
    scene.grid = {
      fogEnabled: fog,
      isVisible: (col, row) => visible.has(`${col},${row}`),
    };
    scene.playerUnits = [{ name: 'Edric', faction: 'player', col: 0, row: 0, currentHP: 10 }];
    scene.npcUnits = [];
    scene.visionDialog = null;
    scene.isDevToolsEnabled = () => false;
    scene.createEnemyPhaseAiStats = () => ({ byReason: {}, noPathUnits: [] });
    scene.finalizeEnemyPhaseAiStats = () => {};
    scene.dimUnit = () => {};
    scene.updateHPBar = () => {};
    scene.processTerrainDamage = async () => {};
    scene.applyReinforcementsForTurn = () => {};
    scene.checkBattleEnd = () => false;
    scene.turnManager = { currentPhase: 'enemy', turnNumber: 2, endEnemyPhase: vi.fn() };
    scene.showBriefBanner = vi.fn();
    scene._captureSuspendCheckpoint = vi.fn();
    scene.registry = { get: () => ({ getBattleSpeed: () => 'normal' }) };
    scene.beats = [];
    scene._awaitSceneDelay = vi.fn(async (ms) => scene.beats.push(ms));
    return scene;
  }

  it('a fogged cleric healing a fogged ally: no name, no banner, no beat, no checkpoint skip', async () => {
    const scene = wiredScene({ fog: true, visible: new Set(['0,0']) });
    const cleric = { name: 'Cleric', faction: 'enemy', col: 6, row: 6, currentHP: 10 };
    const ally = { name: 'Hidden Knight', faction: 'enemy', col: 7, row: 6, currentHP: 3 };
    scene.enemyUnits = [cleric, ally];
    const ai = new AIController(null, data, { objective: 'rout' });
    ai._decideAction = (enemy) =>
      enemy === cleric
        ? { path: null, target: null, healTarget: ally, healStaff: null, reason: 'heal_ally' }
        : { path: null, target: null, reason: 'hold' };
    ai.applyHealDecision = () => ({ healAmount: 10 });
    scene.aiController = ai;
    await scene.startEnemyPhase();
    expect(scene.showBriefBanner).not.toHaveBeenCalled();
    expect(scene.beats).toEqual([]);
    // The heal resolved something (HP moved): its checkpoint is kept; the hold has none.
    expect(scene._captureSuspendCheckpoint).toHaveBeenCalledTimes(1);
  });

  it('a seen cleric healing a fogged ally names only the cleric, and the beat plays', async () => {
    const scene = wiredScene({ fog: true, visible: new Set(['0,0', '6,6']) });
    const cleric = { name: 'Cleric', faction: 'enemy', col: 6, row: 6, currentHP: 10 };
    const ally = { name: 'Hidden Knight', faction: 'enemy', col: 7, row: 6, currentHP: 3 };
    scene.enemyUnits = [cleric];
    const ai = new AIController(null, data, { objective: 'rout' });
    ai._decideAction = () => ({
      path: null,
      target: null,
      healTarget: ally,
      healStaff: null,
      reason: 'heal_ally',
    });
    ai.applyHealDecision = () => ({ healAmount: 10 });
    scene.aiController = ai;
    await scene.startEnemyPhase();
    const texts = scene.showBriefBanner.mock.calls.map((call) => call[0]);
    expect(texts).toEqual(['Cleric healed an unseen ally']);
    expect(texts.join(' ')).not.toContain('Hidden Knight');
    expect(scene.beats).toEqual([300]);
  });

  it('a seen heal target is named', async () => {
    const scene = wiredScene({ fog: true, visible: new Set(['0,0', '7,6']) });
    const cleric = { name: 'Cleric', faction: 'enemy', col: 6, row: 6, currentHP: 10 };
    const ally = { name: 'Brigand', faction: 'enemy', col: 7, row: 6, currentHP: 3 };
    scene.enemyUnits = [cleric];
    const ai = new AIController(null, data, { objective: 'rout' });
    ai._decideAction = () => ({
      path: null,
      target: null,
      healTarget: ally,
      healStaff: null,
      reason: 'heal_ally',
    });
    ai.applyHealDecision = () => ({ healAmount: 4 });
    scene.aiController = ai;
    await scene.startEnemyPhase();
    expect(scene.showBriefBanner.mock.calls.map((call) => call[0])).toEqual([
      'Brigand healed 4 HP',
    ]);
  });

  it('a fogged walk adds no beat; a walk through a seen tile does', async () => {
    for (const [visible, expected] of [
      [new Set(['0,0']), []],
      [new Set(['0,0', '5,5']), [300]],
    ]) {
      const scene = wiredScene({ fog: true, visible });
      const walker = { name: 'Raider', faction: 'enemy', col: 4, row: 5, currentHP: 10 };
      scene.enemyUnits = [walker];
      scene.animateEnemyMove = async (_enemy, path) => ({
        seen: path.some((t) => visible.has(`${t.col},${t.row}`)),
      });
      const ai = new AIController(null, data, { objective: 'rout' });
      ai._decideAction = () => ({
        path: [
          { col: 4, row: 5 },
          { col: 5, row: 5 },
          { col: 6, row: 5 },
        ],
        target: null,
        reason: 'chase_path_aware',
      });
      scene.aiController = ai;
      await scene.startEnemyPhase();
      expect(scene.beats).toEqual(expected);
      // A move is not idle: its checkpoint stays.
      expect(scene._captureSuspendCheckpoint).toHaveBeenCalledTimes(1);
    }
  });
});
