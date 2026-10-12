// A unit that joins the battle mid-phase (a reinforcement, a Necromancer's Skeleton, a risen
// Zombie) is game state first and a sprite second: drawing it never decides whether it is on
// the board (CLAUDE.md: rendering never changes game state). The real BattleScene.addUnitGraphic
// draws here; only the renderer under it (scene.add, banners, effects, the objective line, the
// arrival band) is faked and made to throw. Realistic ways this breaks:
//   - one arrival's sprite throws out of the wave: the arrivals after it are never made (nor
//     their stat rolls drawn from the battle stream), par is not raised, and the enemy phase
//     is cut short by its error recovery (its enemies never act)
//   - a Skeleton that fails to draw stops the next Necromancer's raise and the enemy phase
//   - a risen Zombie that fails to draw (or whose banner throws) drops the remains still due
//     to rise that phase (already ticked out of the records) and skips the rise's end check
//   - a throwing objective line, fog refresh, marker or arrival band after the state change
//     skips state that came after it (par, the history beat, the battle-end check)
//   - an arrival keeps a different battle entity id, history beat or RNG cursor depending on
//     whether it drew, or differs from what the headless harness makes of the same arrival
import { afterEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { AIController } from '../src/engine/AIController.js';
import { TurnManager } from '../src/engine/TurnManager.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { TERRAIN } from '../src/utils/constants.js';
import { HeadlessGrid } from './harness/HeadlessGrid.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { RunDriver, JourneyStorage } from './harness/RunDriver.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { serializeBattleUnit } from '../src/engine/BattleUnitState.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { registerBattleEntity, resetBattleIdentities } from '../src/engine/BattleEntityIdentity.js';
import { createEnemyUnit, createPromotedEnemyUnit, createUnit } from '../src/engine/UnitManager.js';
import { createRemains } from '../src/engine/ZombieRemains.js';
import { skeletonsOf } from '../src/engine/Necromancy.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { presentationFailureProxy as rendering } from './harness/PresentationFailureProxy.js';
import { liveRenderer } from './harness/LiveRenderer.js';
import { guardUndrawnUnits } from '../src/ui/arrivalGraphic.js';
import { damageUnit } from '../src/engine/UnitHealth.js';
import { loadGameData } from './testData.js';
import { _resetUidCounter } from '../src/utils/itemUid.js';

const data = loadGameData();
const classOf = (name) => data.classes.find((c) => c.name === name);
const originalRandom = Math.random;
const SEED = 4242;
const TURN = 4;

afterEach(() => {
  Math.random = originalRandom;
  restoreMathRandom();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const edric = (col, row) =>
  Object.assign(createUnit(classOf('Fighter'), 12, data.weapons, { name: 'Edric' }), {
    faction: 'player',
    isLord: true,
    isCommander: true,
    col,
    row,
  });

const fighter = (col, row) =>
  Object.assign(createEnemyUnit(classOf('Fighter'), 10, data.weapons, 1, data.skills, 'act4'), {
    col,
    row,
  });

const necromancer = (col, row) =>
  Object.assign(
    createPromotedEnemyUnit(
      classOf('Necromancer'),
      15,
      data.weapons,
      1,
      data.skills,
      'act4',
      data.classes,
    ),
    { col, row, aiMode: 'guard' },
  );

/** Remains due to rise this enemy phase (one tick left), seen where they fell. */
const dueRemains = (col, row) => ({
  ...createRemains(fighter(col, row), { col, row }, { seen: true }),
  turnsRemaining: 1,
});

// The units every fixture starts from, made once on a fixed stream (createUnit rolls).
const ROSTER = (() => {
  Math.random = createBattleRng(11);
  try {
    return {
      edric: edric(0, 0),
      foe: fighter(9, 9),
      necroA: necromancer(2, 5),
      necroB: necromancer(7, 2),
      // Two piles due this phase, one in sight and one in the fog; a third ticks down.
      remains: [dueRemains(3, 3), dueRemains(8, 3), { ...dueRemains(4, 6), turnsRemaining: 2 }],
    };
  } finally {
    Math.random = originalRandom;
  }
})();

/**
 * A 10x10 rout on plain ground, fog hiding every column from 6 on, the history recording (a
 * battle in progress), the battle stream bound to Math.random. Drawing is the real
 * addUnitGraphic over the failing renderer (`failure`: 0 none, 'all', or the nth call).
 */
function fixture({ failure = 0, enemies = [], remains = [] } = {}) {
  _resetUidCounter(); // arrivals' weapon uids come from the global counter
  const scene = new BattleScene();
  const plain = { moveCost: { Infantry: '1', Armored: '1', Cavalry: '1', Flying: '1' } };
  Object.assign(scene, {
    _battleSession: 1,
    runManager: { runSeed: 77, battleInProgress: { rewindPolicy: 'fixed-v1' } },
    nodeId: 'arrivals',
    playerUnits: [structuredClone(ROSTER.edric)],
    enemyUnits: enemies.map((unit) => structuredClone(unit)),
    npcUnits: [],
    escapedUnits: [],
    nonDeployedUnits: [],
    _zombieTombstones: structuredClone(remains),
    battleState: 'ENEMY_PHASE',
    turnManager: { currentPhase: 'enemy', turnNumber: TURN },
    battleConfig: { objective: 'rout', cols: 10, rows: 10 },
    battleParams: { act: 'act4', difficultyId: 'hard', battleSeed: SEED },
    gameData: data,
    registry: { get: () => null },
    textures: { exists: () => false },
    turnPar: 8,
    dangerZoneStale: false,
    grid: {
      cols: 10,
      rows: 10,
      fogEnabled: true,
      isVisible: (c) => c < 6,
      getTerrainAt: () => plain,
      gridToPixel: (c, r) => ({ x: c * 32 + 16, y: r * 32 + 16 }),
      clearAttackHighlights() {},
    },
    getTurnPressureState: () => ({ goldMultiplier: 1, xpMultiplier: 1 }),
  });
  scene.checkBattleEnd = vi.fn(() => false);
  resetBattleIdentities(scene);
  for (const unit of [...scene.playerUnits, ...scene.enemyUnits]) registerBattleEntity(scene, unit);
  scene.getUnitAt = (c, r) =>
    [...scene.playerUnits, ...scene.enemyUnits].find(
      (u) => u.currentHP > 0 && !u._removing && u.col === c && u.row === r,
    ) || null;
  scene._battleRng = createBattleRng(SEED);
  Math.random = scene._battleRng;
  const calls = rendering(scene, failure);
  // The canvas arrival banner (the arrival band's fallback off the DOM).
  scene.showReinforcementBanner = calls.call(() => {}, 'showReinforcementBanner');
  if (!vi.isMockFunction(console.warn)) vi.spyOn(console, 'warn').mockImplementation(() => {});
  return { scene, calls };
}

/** Everything the battle keeps of an arrival; presentation fields are nulled by the serializer. */
function snapshot(scene) {
  return structuredClone({
    players: scene.playerUnits.map(serializeBattleUnit),
    enemies: scene.enemyUnits.map(serializeBattleUnit),
    remains: scene._zombieTombstones,
    turnPar: scene.turnPar,
    nextEntityId: scene._nextBattleEntityId,
    history: scene._historyBeats || [],
    dangerZoneStale: scene.dangerZoneStale,
    endChecks: scene.checkBattleEnd.mock.calls.length,
    rng: scene._battleRng.getState(),
  });
}

/** The same flow with no failure, every call failing, and each single call failing in turn. */
async function expectSameStateAtEveryFailure(play) {
  const clean = await play(0);
  expect(clean.calls).toBeGreaterThan(0);
  expect((await play('all')).state, 'every presentation call failing').toEqual(clean.state);
  for (let nth = 1; nth <= clean.calls; nth++)
    expect((await play(nth)).state, `presentation call ${nth} failing`).toEqual(clean.state);
  return clean;
}

// ── Reinforcements ─────────────────────────────────────────────────────────────

/** A wave of four on turn 4: two seen (columns 1-2), two in the fog (columns 7-8). */
const WAVE = [
  { col: 1, row: 8, className: 'Fighter', level: 6 },
  { col: 2, row: 8, className: 'Soldier', level: 7 },
  { col: 7, row: 8, className: 'Mercenary', level: 6 },
  { col: 8, row: 8, className: 'Archer', level: 5 },
].map((spawn) => ({ ...spawn, waveIndex: 0, scheduledTurn: TURN, xpMultiplier: 0.5 }));
const schedule = () => ({
  turn: TURN,
  spawns: structuredClone(WAVE),
  dueWaves: [{ spawnedCount: 4, requestedCount: 4 }],
  blockedSpawns: 0,
});

async function playWave(failure) {
  const { scene, calls } = fixture({ failure, enemies: [ROSTER.foe] });
  scene.resolveReinforcementsForTurn = () => schedule();
  const result = scene.applyReinforcementsForTurn(TURN);
  return { scene, result, state: { ...snapshot(scene), spawned: result.spawned }, calls: calls() };
}

/** What the game keeps of each enemy in both the scene and the harness. */
const gameFields = (units) =>
  units.map((u) => ({
    name: u.name,
    className: u.className,
    level: u.level,
    col: u.col,
    row: u.row,
    stats: u.stats,
    currentHP: u.currentHP,
    weapon: u.weapon?.name ?? null,
    inventory: (u.inventory || []).map((w) => w.name),
    skills: u.skills,
    aiMode: u.aiMode ?? null,
    reinforcement: u._isReinforcement === true,
    waveIndex: u._reinforcementWaveIndex ?? null,
    spawnTurn: u._reinforcementSpawnTurn ?? null,
    rewardMultiplier: u._reinforcementRewardMultiplier ?? null,
  }));

describe('a wave whose sprites fail to draw', () => {
  it('lands every arrival, raises par and keeps the stream, whichever drawing call throws', async () => {
    const clean = await expectSameStateAtEveryFailure(playWave);
    const arrivals = clean.scene.enemyUnits.filter((u) => u._isReinforcement);
    expect(arrivals.map((u) => [u.className, u.col, u.row])).toEqual(
      WAVE.map((s) => [s.className, s.col, s.row]),
    );
    expect(clean.state.spawned).toBe(4);
    expect(clean.state.turnPar).toBe(9); // one procedural wave arrived: +1 par
    expect(clean.state.dangerZoneStale).toBe(true);
    // Each arrival is a battle entity of its own (saves, rewinds and history name it).
    const ids = arrivals.map((u) => u.battleEntityId);
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(id).toMatch(/^u[1-9]\d*$/);
    // The two the player sees are in the history; the fogged two are not.
    expect(clean.state.history.map((b) => b.actorId)).toEqual(ids.slice(0, 2));
  });

  it('the second of four failing to draw still makes all four, as the harness makes them', async () => {
    // The failure the review found: the sprite of the wave's second arrival throws.
    const { scene: probe } = fixture({ enemies: [ROSTER.foe] });
    let drawn = 0;
    const realDraw = probe.addUnitGraphic;
    const throwOnSecond = function (unit) {
      if (++drawn === 2) throw new Error('Renderer unavailable: sprite');
      return realDraw.call(this, unit);
    };
    const { scene } = fixture({ enemies: [ROSTER.foe] });
    scene.addUnitGraphic = throwOnSecond;
    scene.resolveReinforcementsForTurn = () => schedule();
    let result;
    expect(() => (result = scene.applyReinforcementsForTurn(TURN))).not.toThrow();
    expect(result.spawned).toBe(4);
    const arrivals = scene.enemyUnits.filter((u) => u._isReinforcement);
    expect(arrivals).toHaveLength(4);
    expect(new Set(arrivals.map((u) => u.battleEntityId)).size).toBe(4);
    expect(arrivals[1].battleEntityId).toMatch(/^u[1-9]\d*$/);
    expect(scene.turnPar).toBe(9);

    // The harness's wave from the same schedule, seed and stream position.
    const battle = Object.assign(Object.create(HeadlessBattle.prototype), {
      gameData: data,
      battleParams: { ...scene.battleParams },
      battleConfig: { ...scene.battleConfig },
      playerUnits: [structuredClone(ROSTER.edric)],
      enemyUnits: [structuredClone(ROSTER.foe)],
      npcUnits: [],
      _zombieTombstones: [],
      turnPar: 8,
      _villageState: null,
    });
    battle._resolveReinforcementsForTurn = () => schedule();
    Math.random = createBattleRng(SEED);
    const harness = battle._applyReinforcementsForTurn(TURN);
    expect(harness.spawned).toBe(4);
    expect(battle.turnPar).toBe(scene.turnPar);
    expect(gameFields(scene.enemyUnits)).toEqual(gameFields(battle.enemyUnits));
  });
});

// ── The Necromancer's raise ────────────────────────────────────────────────────

async function playRaise(failure) {
  // Two Necromancers, one in sight (its Skeleton rises seen) and one in the fog.
  const { scene, calls } = fixture({ failure, enemies: [ROSTER.necroA, ROSTER.necroB] });
  await scene.processNecromancy();
  return { scene, state: snapshot(scene), calls: calls() };
}

describe("a raise whose Skeleton's drawing fails", () => {
  it('raises for every Necromancer and counts each raise, whichever drawing call throws', async () => {
    const clean = await expectSameStateAtEveryFailure(playRaise);
    const [a, b] = clean.scene.enemyUnits;
    for (const necro of [a, b]) {
      expect(necro._raisedCount).toBe(1);
      const [skeleton] = skeletonsOf(necro, clean.scene.enemyUnits);
      expect(skeleton).toMatchObject({ className: 'Skeleton', hasActed: false });
      expect(skeleton.battleEntityId).toMatch(/^u[1-9]\d*$/);
    }
    expect(clean.state.dangerZoneStale).toBe(true);
    // The seen raise is in the history; the fogged one is not.
    expect(clean.state.history.map((beat) => beat.label)).toEqual(['Necromancer raised Skeleton.']);
  });

  it('the first Skeleton failing to draw still lets the second Necromancer raise, as the harness does', async () => {
    const { scene } = fixture({ enemies: [ROSTER.necroA, ROSTER.necroB] });
    const realDraw = scene.addUnitGraphic;
    let drawn = 0;
    scene.addUnitGraphic = function (unit) {
      if (++drawn === 1) throw new Error('Renderer unavailable: sprite');
      return realDraw.call(this, unit);
    };
    await expect(scene.processNecromancy()).resolves.toBeUndefined();
    const [a, b] = scene.enemyUnits;
    expect([a._raisedCount, b._raisedCount]).toEqual([1, 1]);
    expect(scene.enemyUnits.map((u) => u.className)).toEqual([
      'Necromancer',
      'Necromancer',
      'Skeleton',
      'Skeleton',
    ]);

    // The harness's raises for the same Necromancers, turn and seed.
    const battle = Object.assign(Object.create(HeadlessBattle.prototype), {
      gameData: data,
      battleParams: { ...scene.battleParams },
      battleConfig: { ...scene.battleConfig },
      playerUnits: [structuredClone(ROSTER.edric)],
      enemyUnits: [structuredClone(ROSTER.necroA), structuredClone(ROSTER.necroB)],
      npcUnits: [],
      turnManager: { turnNumber: TURN },
      grid: scene.grid,
    });
    battle.getUnitAt = (c, r) =>
      [...battle.playerUnits, ...battle.enemyUnits].find((u) => u.col === c && u.row === r) || null;
    resetBattleIdentities(battle);
    // The same ids as the scene's (the scene registered Edric, then the Necromancers).
    registerBattleEntity(battle, battle.playerUnits[0]);
    battle._processNecromancy();
    expect(gameFields(scene.enemyUnits)).toEqual(gameFields(battle.enemyUnits));
    expect(scene.enemyUnits.map((u) => [u.battleEntityId, u._raisedBy ?? null])).toEqual(
      battle.enemyUnits.map((u) => [u.battleEntityId, u._raisedBy ?? null]),
    );
  });
});

// ── Zombie remains rising ──────────────────────────────────────────────────────

async function playRise(failure) {
  const { scene, calls } = fixture({ failure, enemies: [ROSTER.foe], remains: ROSTER.remains });
  await scene.processZombieRevival();
  return { scene, state: snapshot(scene), calls: calls() };
}

describe('remains whose risen unit fails to draw', () => {
  it('raise every pile due, keep the rest ticking and check the end, whichever call throws', async () => {
    const clean = await expectSameStateAtEveryFailure(playRise);
    const risen = clean.scene.enemyUnits.slice(1);
    expect(risen.map((u) => [u.className, u.col, u.row])).toEqual([
      ['Fighter', 3, 3],
      ['Fighter', 8, 3],
    ]);
    for (const unit of risen) expect(unit.battleEntityId).toMatch(/^u[1-9]\d*$/);
    expect(clean.state.remains).toEqual([
      expect.objectContaining({ col: 4, row: 6, turnsRemaining: 1 }),
    ]);
    expect(clean.state.endChecks).toBe(1);
    expect(clean.state.history.map((beat) => beat.label)).toEqual(['Fighter revived.']);
  });

  it('the first risen unit failing to draw still raises the second, as the harness does', async () => {
    const remains = ROSTER.remains.slice(0, 2);
    const { scene } = fixture({ enemies: [ROSTER.foe], remains });
    const realDraw = scene.addUnitGraphic;
    let drawn = 0;
    scene.addUnitGraphic = function (unit) {
      if (++drawn === 1) throw new Error('Renderer unavailable: sprite');
      return realDraw.call(this, unit);
    };
    await expect(scene.processZombieRevival()).resolves.toBeUndefined();
    expect(scene._zombieTombstones).toEqual([]);
    expect(scene.checkBattleEnd).toHaveBeenCalledTimes(1);

    const battle = Object.assign(Object.create(HeadlessBattle.prototype), {
      battleConfig: { ...scene.battleConfig },
      playerUnits: [structuredClone(ROSTER.edric)],
      enemyUnits: [structuredClone(ROSTER.foe)],
      _zombieTombstones: structuredClone(remains),
      grid: scene.grid,
    });
    battle.getUnitAt = (c, r) =>
      [...battle.playerUnits, ...battle.enemyUnits].find((u) => u.col === c && u.row === r) || null;
    battle._checkBattleEnd = vi.fn(() => false);
    battle._processZombieRevival();
    expect(gameFields(scene.enemyUnits)).toEqual(gameFields(battle.enemyUnits));
    expect(battle._checkBattleEnd).toHaveBeenCalledTimes(1);
  });
});

// ── The enemy phase goes on ────────────────────────────────────────────────────
// The real enemy-phase lifecycle, as tests/EnemyPhaseLifecycle.test.js runs it (the run and its
// slot, the suspend checkpoints, TurnManager, onPhaseChange, the turn-start pipeline, the AI on
// the harness grid, the tail's wave), from End Turn to the next player turn's checkpoint. The
// pipeline raises two Zombies and a Skeleton; the tail lands a wave of four. Only drawing is
// faked, and the arrivals' sprites throw.

const PHASE_TURN = 3;
const PHASE_WAVE = [
  { col: 9, row: 3, className: 'Fighter', level: 3 },
  { col: 9, row: 4, className: 'Soldier', level: 3 },
  { col: 9, row: 5, className: 'Fighter', level: 3 },
  { col: 9, row: 6, className: 'Soldier', level: 3 },
];

let storage;

function lifecycleScene(run, drawFails) {
  const scene = journeyBattleScene(run, data);
  scene._battleSession = 1;
  scene.scene = { isActive: () => true };
  const layout = Array.from({ length: 10 }, () => Array(10).fill(TERRAIN.Plain));
  const fixtureGrid = scene.grid;
  scene.grid = Object.assign(new HeadlessGrid(10, 10, data.terrain, layout, false), {
    temporaryTerrains: [],
    fogOverlays: [],
    gridToPixel: fixtureGrid.gridToPixel,
    clearAttackHighlights: fixtureGrid.clearAttackHighlights,
    clearHighlights: fixtureGrid.clearHighlights,
    clearPath: fixtureGrid.clearPath,
  });
  scene.battleConfig = {
    objective: 'rout',
    cols: 10,
    rows: 10,
    mapLayout: layout,
    reinforcements: { scriptedWaves: [{ turn: PHASE_TURN, spawns: structuredClone(PHASE_WAVE) }] },
  };
  scene.battleParams = { act: 'act1', objective: 'rout', difficultyId: 'normal' };
  scene.turnPar = 8;
  scene.isDevToolsEnabled = () => false;
  scene.aiPhaseStatsHistory = [];
  delete scene.checkBattleEnd; // the scene's own rout check
  // Drawing only.
  scene.showBriefBanner = async () => {};
  scene.showPhaseBanner = () => {};
  scene.renderTurnCounter = () => {};
  scene.undimUnit = () => {};
  scene.dangerZone = { hide() {}, show() {} };
  scene._awaitSceneTween = async () => {};
  scene.animateStrike = async () => {};
  scene.animateSkillActivation = async () => {};
  scene.animateHeal = async () => {};
  scene.showTerrainDamage = async () => {};
  scene.showMarkProc = () => {};
  scene._addConditionIcon = () => {};
  scene._removeConditionIcon = () => {};
  scene._reinforcements = { present() {} };
  scene.refreshVisibleDangerZone = () => {};
  scene._combatFx = { raise: async () => {}, deathFade: async () => {} };
  scene.time = { delayedCall: () => null };
  // The sprite: the fixture's stand-in registers the unit; an arrival chosen to fail throws
  // before anything else (the renderer is gone).
  const draw = scene.addUnitGraphic;
  scene.addUnitGraphic = (unit) => {
    if (drawFails(unit)) throw new Error('Renderer unavailable: sprite');
    return draw(unit);
  };
  // The scene clock: every scheduled callback waits in a queue.
  const queue = [];
  scene._scheduleSafeDelayedAsync = (_ms, label, callback, options = {}) => {
    queue.push({ label, callback, onError: options.onError });
    return { label };
  };
  scene.drain = async () => {
    while (queue.length) {
      const { callback, onError } = queue.shift();
      // As scheduleSafeDelayedAsync: a throw goes to the callback's recovery.
      try {
        await callback();
      } catch (error) {
        if (!onError) throw error;
        onError(error);
      }
    }
  };
  const tm = new TurnManager({
    onPhaseChange: (phase, turn) => scene.onPhaseChange(phase, turn),
    onVictory: () => {},
    onDefeat: () => {},
    checkBattleEnd: () => scene.checkBattleEnd(),
  });
  tm.init(scene.playerUnits, scene.enemyUnits, scene.npcUnits, 'rout');
  scene.turnManager = tm;
  scene.aiController = new AIController(scene.grid, data, { objective: 'rout' });
  return scene;
}

function foe(name, className, col, row, extra = {}) {
  const unit = {
    name,
    className,
    faction: 'enemy',
    level: 3,
    currentHP: 24,
    stats: { HP: 24, STR: 6, MAG: 0, SKL: 4, SPD: 4, DEF: 3, RES: 0, LCK: 1, MOV: 5 },
    weapon: structuredClone(data.weapons.find((w) => w.name === 'Iron Axe')),
    proficiencies: [{ type: 'Axe', rank: 'Prof' }],
    moveType: 'Infantry',
    consumables: [],
    skills: [],
    hasActed: false,
    col,
    row,
    ...extra,
  };
  unit.inventory = [unit.weapon];
  return unit;
}

/** End Turn on turn 3 to the next player turn's checkpoint; the end state as saved. */
async function playEnemyPhase(drawFails, { rendererDown = false } = {}) {
  storage = new JourneyStorage();
  vi.stubGlobal('localStorage', storage);
  installSeed(1234);
  _resetUidCounter();
  const driver = new RunDriver(storage, { seed: 7 });
  const run = driver.run;
  run.beginBattleInProgress('arrivals-battle', { act: 'act1', objective: 'rout' });
  run.battleInProgress.rewindPolicy = 'fixed-v1';
  const starting = new Set();
  const scene = lifecycleScene(run, (unit) => !starting.has(unit) && drawFails(unit));
  scene._battleRewindPolicy = 'fixed-v1';
  const lord = Object.assign(structuredClone(run.roster[0]), {
    col: 1,
    row: 1,
    faction: 'player',
    isCommander: true,
    currentHP: 60,
    hasActed: true,
  });
  lord.stats = { ...lord.stats, HP: 60 };
  const necro = Object.assign(structuredClone(ROSTER.necroA), { col: 8, row: 8 });
  const sentry = foe('Sentry', 'Fighter', 9, 0, { aiMode: 'guard', guardPost: { col: 9, row: 0 } });
  for (const unit of [lord, sentry, necro]) starting.add(unit);
  scene.playerUnits.push(lord);
  scene.addUnitGraphic(lord);
  for (const enemy of [sentry, necro]) {
    scene.enemyUnits.push(enemy);
    scene.addUnitGraphic(enemy);
  }
  // Every draw from here on, each arrival's sprite and stand-in alike, fails while the renderer
  // is down; the attempts are counted per unit.
  const attempts = new Map();
  const drawWithCount = scene.addUnitGraphic;
  scene.addUnitGraphic = (unit) => {
    attempts.set(unit, (attempts.get(unit) || 0) + 1);
    return drawWithCount(unit);
  };
  if (rendererDown) {
    const add = scene.add;
    scene.add = new Proxy(add, {
      get: (target, key) =>
        typeof target[key] === 'function'
          ? () => {
              throw new Error(`Renderer unavailable: add.${String(key)}`);
            }
          : target[key],
    });
  }
  // Two piles due to rise as the enemy phase starts.
  scene._zombieTombstones = structuredClone([
    { ...ROSTER.remains[0], col: 5, row: 8 },
    { ...ROSTER.remains[1], col: 6, row: 9 },
  ]);
  scene.turnManager.turnNumber = PHASE_TURN;
  scene.turnManager.currentPhase = 'player';
  scene.initializeAntiTurtleState();
  scene._battleSuspendController = new BattleSuspendController(scene);
  scene._timelineBoundary = 'player_action';
  expect(scene._captureSuspendCheckpoint({ session: 1 })).toBe(true);
  Math.random = () => scene._battleRng();
  const recovered = vi.spyOn(scene, '_recoverEnemyPhaseError');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  scene.turnManager.endPlayerPhase();
  await scene.drain();
  const units = (list) => list.map((u) => serializeBattleUnit(u));
  const checkpoint = run.battleInProgress.checkpoint;
  const strip = (key, value) =>
    key === 'checkpointIndex' || key === 'savedAt' || key === 'timestamp' ? undefined : value;
  return {
    scene,
    attempts,
    recovered: recovered.mock.calls.length,
    state: JSON.parse(
      JSON.stringify(
        {
          turn: scene.turnManager.turnNumber,
          phase: scene.turnManager.currentPhase,
          battleState: scene.battleState,
          turnPar: scene.turnPar,
          players: units(scene.playerUnits),
          enemies: units(scene.enemyUnits),
          remains: scene._zombieTombstones,
          rng: scene._battleRng.getState(),
          checkpoint: {
            phase: checkpoint.phase,
            turnNumber: checkpoint.turnNumber,
            rngState: checkpoint.rngState,
            playerUnits: checkpoint.playerUnits,
            enemyUnits: checkpoint.enemyUnits,
          },
        },
        strip,
      ),
    ),
  };
}

describe('the enemy phase whose arrivals fail to draw', () => {
  it('runs to the next player turn exactly as when every arrival draws', async () => {
    const clean = await playEnemyPhase(() => false);
    // The phase did what this test is about.
    expect(clean.recovered).toBe(0);
    expect(clean.state).toMatchObject({ turn: PHASE_TURN + 1, phase: 'player' });
    expect(clean.state.checkpoint).toMatchObject({ phase: 'player', turnNumber: PHASE_TURN + 1 });
    const enemies = clean.scene.enemyUnits;
    expect(enemies.filter((u) => u._isReinforcement).map((u) => [u.col, u.row])).toEqual(
      PHASE_WAVE.map((s) => [s.col, s.row]),
    );
    expect(enemies.filter((u) => u.className === 'Skeleton')).toHaveLength(1);
    expect(enemies.find((u) => u.className === 'Necromancer')._raisedCount).toBe(1);
    expect(clean.state.remains).toEqual([]);
    // The risen and the raised acted in the phase they arrived in.
    for (const unit of enemies.filter((u) => u.className === 'Skeleton' || u.name === 'Fighter'))
      if (!unit._isReinforcement) expect(unit._lastAiDecision, unit.name).toBeTruthy();

    let arrival = 0;
    const variants = {
      'every arrival': () => true,
      'the second of the wave': (unit) => unit._isReinforcement && ++arrival === 2,
      'the first risen Zombie': (unit) => unit.className === 'Fighter' && !unit._isReinforcement,
      'the raised Skeleton': (unit) => unit.className === 'Skeleton',
    };
    for (const [name, fails] of Object.entries(variants)) {
      arrival = 0;
      const broken = await playEnemyPhase(fails);
      expect(broken.recovered, `${name}: the enemy phase was not cut short`).toBe(0);
      expect(broken.state, name).toEqual(clean.state);
    }
  });

  it('nothing can draw the arrivals: the next player turn tries each again at its checkpoint', async () => {
    const clean = await playEnemyPhase(() => false);
    const down = await playEnemyPhase(() => true, { rendererDown: true });
    expect(down.recovered).toBe(0);
    expect(down.state).toEqual(clean.state);
    const arrivals = down.scene.enemyUnits.filter(
      (u) => u._isReinforcement || u.className === 'Skeleton' || u.name === 'Fighter',
    );
    expect(arrivals.length).toBeGreaterThanOrEqual(PHASE_WAVE.length + 3);
    // Once as it arrived, once more at the turn's checkpoint (still nothing: a reload is asked).
    for (const unit of arrivals) {
      expect(down.attempts.get(unit), unit.name).toBe(2);
      expect(unit.graphic ?? null, unit.name).toBeNull();
    }
    // When every arrival draws, nothing is tried twice.
    for (const unit of clean.scene.enemyUnits) expect(clean.attempts.get(unit) ?? 1).toBe(1);
  });
});

// ── A sprite that fails leaves a marker ────────────────────────────────────────
// The arrival is on the board whether or not it draws (above); here the player must still SEE
// it. The real addUnitGraphic, updateHPBar, updateUnitPosition, updateEnemyVisibility,
// animateEnemyMove, removeUnit and the resume's applyUnits draw over a renderer that keeps
// what it makes (tests/harness/LiveRenderer.js). Realistic ways this breaks:
//   - the sprite's first call throws: the unit has no graphic, an invisible foe that moves and
//     strikes, and its walk's tween has no target
//   - a later call throws: a half-built sprite (no HP bar, or a label left over) stays, and the
//     objects made before the throw are leaked on the board
//   - the stand-in ignores the fog (a hidden foe's marker shows, or a seen one stays hidden),
//     never follows its walk or its HP, or outlives its unit's death
//   - nothing at all can be drawn and the next player turn plays on regardless

/** The parts of a unit the player sees, as addUnitGraphic and removeUnitGraphic know them. */
const partsOf = (unit) =>
  [unit.graphic, unit.label, unit.factionIndicator, unit.hpBar?.bg, unit.hpBar?.fill]
    .concat(unit.affixPips || [])
    .filter(Boolean);
const pixel = (col, row) => ({ x: col * 32 + 16, y: row * 32 + 16 });

function drawnFixture(options) {
  const { scene } = fixture(options);
  // Back to the scene's own drawing (fixture() fakes these for the call counts above).
  for (const name of [
    '_removeAllConditionIcons',
    '_addConditionIcon',
    'updateHPBar',
    'removeUnitGraphic',
    'updateUnitPosition',
    'updateEnemyVisibility',
    'dimUnit',
    'undimUnit',
  ])
    delete scene[name];
  const renderer = liveRenderer(scene);
  scene.refreshVisibleDangerZone = () => {};
  scene.updateObjectiveText = () => {};
  scene._isSceneActiveForAsync = () => true;
  scene.grid.mapLayout = Array.from({ length: 10 }, () => Array(10).fill(TERRAIN.Plain));
  scene.grid.terrainData = data.terrain;
  // A tween lands its targets where it goes; Phaser's has no answer for a missing target.
  scene._awaitSceneTween = async ({ targets, x, y }) => {
    for (const target of targets) {
      if (!target) throw new TypeError('tween target missing');
      target.setPosition(x, y);
    }
    return { status: 'finished' };
  };
  for (const unit of [...scene.playerUnits, ...scene.enemyUnits]) scene.addUnitGraphic(unit);
  // What each call to addUnitGraphic made, thrown or not.
  const drawnBy = new Map();
  const draw = scene.addUnitGraphic;
  scene.addUnitGraphic = function (unit) {
    const start = renderer.made.length;
    try {
      return draw.call(this, unit);
    } finally {
      drawnBy.set(unit, [...(drawnBy.get(unit) || []), ...renderer.made.slice(start)]);
    }
  };
  return { scene, renderer, drawnBy };
}

const ARRIVAL_KINDS = {
  'a reinforcement': {
    setup: { enemies: [ROSTER.foe] },
    arrive: (scene) => {
      scene.resolveReinforcementsForTurn = () => ({
        turn: TURN,
        spawns: [{ ...WAVE[0], col: 2, row: 8 }],
        dueWaves: [{ spawnedCount: 1, requestedCount: 1 }],
        blockedSpawns: 0,
      });
      scene.applyReinforcementsForTurn(TURN);
      return scene.enemyUnits.find((u) => u._isReinforcement);
    },
  },
  'a raised Skeleton': {
    setup: { enemies: [{ ...ROSTER.necroA, col: 0, row: 5 }] },
    arrive: async (scene) => {
      await scene.processNecromancy();
      return scene.enemyUnits.find((u) => u.className === 'Skeleton');
    },
  },
  'a risen Zombie': {
    setup: { enemies: [ROSTER.foe], remains: [ROSTER.remains[0]] },
    arrive: async (scene) => {
      await scene.processZombieRevival();
      return scene.enemyUnits[1];
    },
  },
};

/** A straight walk along the unit's row to `col`. */
const walk = (unit, col) => {
  const step = col > unit.col ? 1 : -1;
  const path = [{ col: unit.col, row: unit.row }];
  for (let c = unit.col + step; c !== col + step; c += step) path.push({ col: c, row: unit.row });
  return path;
};

/** Everything the player must see of one arrival, from its arrival to its death. */
async function playArrival(kind, failCall) {
  const { scene, renderer, drawnBy } = drawnFixture(kind.setup);
  const start = renderer.made.length;
  renderer.failNext(failCall);
  const unit = await kind.arrive(scene);
  const made = renderer.made.length - start;
  const seen = (what) => {
    const parts = partsOf(unit);
    expect(unit.graphic, `${what}: a graphic`).toBeTruthy();
    expect(unit.hpBar?.fill, `${what}: an HP bar`).toBeTruthy();
    for (const part of parts) expect(part.destroyed, `${what}: ${part.kind} live`).toBe(false);
    return parts;
  };

  // Drawn on its tile, shown (it rose in sight), and nothing of a failed sprite left behind.
  let parts = seen('arrived');
  expect(unit.graphic).toMatchObject(pixel(unit.col, unit.row));
  for (const part of parts) expect(part.visible, `arrived: ${part.kind} shown`).toBe(true);
  const owned = new Set(parts);
  for (const object of drawnBy.get(unit) || [])
    if (!owned.has(object)) expect(object.destroyed, `leaked ${object.kind}`).toBe(true);

  // It walks in sight, into the fog (hidden), and out again (shown), its marker with it.
  const row = unit.row;
  await scene.animateEnemyMove(unit, walk(unit, 4));
  expect(unit.graphic).toMatchObject(pixel(4, row));
  await scene.animateEnemyMove(unit, walk(unit, 7));
  for (const part of seen('in the fog')) expect(part.visible, `fog: ${part.kind}`).toBe(false);
  await scene.animateEnemyMove(unit, walk(unit, 5));
  parts = seen('back in sight');
  expect(unit.graphic).toMatchObject(pixel(5, row));
  for (const part of parts) expect(part.visible, `back: ${part.kind} shown`).toBe(true);

  // Targeted where it is drawn, and hurt: the bar shows what is left.
  expect(scene.getUnitAt(5, row)).toBe(unit);
  damageUnit(unit, Math.floor(unit.stats.HP / 2));
  scene.updateHPBar(unit);
  const { bg, fill } = unit.hpBar;
  expect(fill.width).toBeCloseTo((bg.width * unit.currentHP) / unit.stats.HP, 5);
  expect(fill.width).toBeLessThan(bg.width);

  // The checkpoint keeps the unit, never its drawing.
  const saved = structuredClone(serializeBattleUnit(unit));

  // Killed: every part goes with it.
  parts = partsOf(unit);
  await scene.removeUnit(unit, { killer: scene.playerUnits[0] });
  expect(scene.enemyUnits).not.toContain(unit);
  for (const part of parts) expect(part.destroyed, `dead: ${part.kind} gone`).toBe(true);

  return { made, saved, nextEntityId: scene._nextBattleEntityId, players: scene.playerUnits };
}

describe('an arrival whose sprite fails is still drawn', () => {
  for (const [name, kind] of Object.entries(ARRIVAL_KINDS)) {
    it(`${name}: seen, moved, hidden, hurt and killed, whichever drawing call fails`, async () => {
      const clean = await playArrival(kind, 0);
      expect(clean.made).toBeGreaterThan(2);
      for (let nth = 1; nth <= clean.made; nth++) {
        const broken = await playArrival(kind, nth);
        // The battle keeps the same unit whatever was drawn.
        expect(broken.saved, `drawing call ${nth} failing`).toEqual(clean.saved);
      }

      // Resumed from the checkpoint: drawn whole, by the sprite.
      const { scene, renderer } = drawnFixture({ enemies: [] });
      new BattleSuspendController(scene).applyUnits({
        playerUnits: [],
        enemyUnits: [clean.saved],
        npcUnits: [],
        nextEntityId: clean.nextEntityId,
      });
      const [resumed] = scene.enemyUnits;
      expect(resumed.battleEntityId).toBe(clean.saved.battleEntityId);
      expect(resumed.graphic.destroyed).toBe(false);
      expect(resumed.hpBar.fill.width).toBeCloseTo(
        (resumed.hpBar.bg.width * resumed.currentHP) / resumed.stats.HP,
        5,
      );
      expect(renderer.live()).toEqual(expect.arrayContaining(partsOf(resumed)));
    });
  }
});

describe('an arrival nothing can draw', () => {
  it('is drawn again at the next player turn, and is still owed while the renderer fails', async () => {
    const { scene, renderer } = drawnFixture(ARRIVAL_KINDS['a reinforcement'].setup);
    renderer.failAll();
    const unit = await ARRIVAL_KINDS['a reinforcement'].arrive(scene);
    expect(scene.enemyUnits).toContain(unit); // on the board all the same
    expect(partsOf(unit)).toEqual([]);
    // The renderer still failing: the unit is still owed (the battle asks for a reload).
    expect(guardUndrawnUnits(scene)).toEqual([unit]);
    expect(partsOf(unit)).toEqual([]);
    // Back: drawn whole, and owed no longer.
    renderer.failAll(false);
    expect(guardUndrawnUnits(scene)).toEqual([]);
    expect(unit.graphic?.destroyed).toBe(false);
    expect(unit.hpBar?.fill?.destroyed).toBe(false);
    expect(guardUndrawnUnits(scene)).toEqual([]);
  });

  it('is forgotten once it has left the board', async () => {
    const { scene, renderer } = drawnFixture(ARRIVAL_KINDS['a reinforcement'].setup);
    renderer.failAll();
    const unit = await ARRIVAL_KINDS['a reinforcement'].arrive(scene);
    scene.enemyUnits = scene.enemyUnits.filter((u) => u !== unit);
    expect(guardUndrawnUnits(scene)).toEqual([]);
    renderer.failAll(false);
    const before = renderer.made.length;
    guardUndrawnUnits(scene);
    expect(renderer.made.length).toBe(before); // never drawn for a unit that is gone
  });
});
