// Escape battle objective: repeating pursuit waves (scheduler), escape map
// generation, node assignment, par, the EscapeObjectiveController flow, and
// the BattleScene victory/defeat rules for escaped units.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: { Scene: class {} },
}));

import {
  getDueRepeatingReinforcementWaves,
  scheduleReinforcementsForTurn,
} from '../src/engine/ReinforcementScheduler.js';
import { validateMapTemplatesConfig } from '../src/engine/MapTemplateEngine.js';
import { generateBattle } from '../src/engine/MapGenerator.js';
import { generateNodeMap } from '../src/engine/NodeMapGenerator.js';
import { calculatePar } from '../src/engine/TurnBonusCalculator.js';
import { EscapeObjectiveController } from '../src/ui/EscapeObjectiveController.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { VisionRewindController } from '../src/ui/VisionRewindController.js';
import { ESCAPE_EVAC_GOLD_BY_ACT, NODE_TYPES } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withSeed(seed, fn) {
  const origRandom = Math.random;
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = origRandom;
  }
}

// ── Repeating pursuit waves ──────────────────────────────────

describe('repeating reinforcement waves', () => {
  const reinforcements = {
    spawnEdges: ['left'],
    waves: [],
    repeatingWaves: [{ startTurn: 5, every: 2, count: [2, 3], edges: ['left'] }],
    difficultyScaling: true,
    turnOffsetByDifficulty: { normal: 0, hard: -1, lunatic: -2 },
    xpDecay: [0.75, 0.5, 0.25],
  };

  it('fires on the cadence startTurn, startTurn+every, ... and never before', () => {
    const dueTurns = [];
    for (let turn = 1; turn <= 12; turn++) {
      const due = getDueRepeatingReinforcementWaves({ turn, reinforcements });
      if (due.length > 0) dueTurns.push(turn);
    }
    expect(dueTurns).toEqual([5, 7, 9, 11]);
  });

  it('shifts the cadence start by difficulty turn offsets', () => {
    const due4 = getDueRepeatingReinforcementWaves({
      turn: 4,
      reinforcements,
      difficultyId: 'hard',
    });
    expect(due4).toHaveLength(1); // startTurn 5 - 1
    const due5 = getDueRepeatingReinforcementWaves({
      turn: 5,
      reinforcements,
      difficultyId: 'hard',
    });
    expect(due5).toHaveLength(0); // off-cadence after the shift
  });

  it('defaults xpMultiplier to the xpDecay tail and honors explicit overrides', () => {
    const [due] = getDueRepeatingReinforcementWaves({ turn: 5, reinforcements });
    expect(due.xpMultiplier).toBe(0.25);

    const explicit = {
      ...reinforcements,
      repeatingWaves: [{ startTurn: 5, every: 2, count: [1, 1], xpMultiplier: 0.1 }],
    };
    const [dueExplicit] = getDueRepeatingReinforcementWaves({
      turn: 5,
      reinforcements: explicit,
    });
    expect(dueExplicit.xpMultiplier).toBe(0.1);
  });

  it('skips when the active enemy count is at the cap (default and explicit)', () => {
    expect(
      getDueRepeatingReinforcementWaves({ turn: 5, reinforcements, activeEnemyCount: 20 }),
    ).toHaveLength(0);

    const capped = {
      ...reinforcements,
      repeatingWaves: [{ startTurn: 5, every: 2, count: [1, 1], maxActiveEnemies: 6 }],
    };
    expect(
      getDueRepeatingReinforcementWaves({
        turn: 5,
        reinforcements: capped,
        activeEnemyCount: 6,
      }),
    ).toHaveLength(0);
    expect(
      getDueRepeatingReinforcementWaves({
        turn: 5,
        reinforcements: capped,
        activeEnemyCount: 5,
      }),
    ).toHaveLength(1);
  });

  it('gives each occurrence a distinct waveIndex (distinct RNG identity)', () => {
    const [a] = getDueRepeatingReinforcementWaves({ turn: 5, reinforcements });
    const [b] = getDueRepeatingReinforcementWaves({ turn: 7, reinforcements });
    expect(a.waveIndex).not.toBe(b.waveIndex);
  });

  it('schedules deterministic edge spawns tagged waveType repeating', () => {
    const terrain = [{ name: 'Plain', moveCost: { Infantry: '1' } }];
    const mapLayout = Array.from({ length: 6 }, () => new Array(8).fill(0));
    const args = {
      turn: 5,
      seed: 1234,
      reinforcements,
      mapLayout,
      terrain,
      occupied: [],
    };
    const first = scheduleReinforcementsForTurn(args);
    const second = scheduleReinforcementsForTurn(args);
    expect(first.spawns.length).toBeGreaterThanOrEqual(2);
    expect(first.spawns).toEqual(second.spawns);
    for (const spawn of first.spawns) {
      expect(spawn.waveType).toBe('repeating');
      expect(spawn.col).toBe(0); // left edge
    }
    expect(first.dueWaves[0].waveType).toBe('repeating');
  });
});

// ── Template validation ──────────────────────────────────────

describe('escape template validation', () => {
  it('accepts the shipped mapTemplates.json (escape pool included)', () => {
    const result = validateMapTemplatesConfig(data.mapTemplates);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  function makeConfig(mutate) {
    const config = structuredClone(data.mapTemplates);
    mutate(config);
    return validateMapTemplatesConfig(config);
  }

  it('requires escapeZone on escape templates', () => {
    const result = makeConfig((c) => delete c.escape[0].escapeZone);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toMatch(/escapeZone is required/);
  });

  it('rejects escapeZone on non-escape templates', () => {
    const result = makeConfig((c) => {
      c.rout[0].escapeZone = { rect: [0.9, 0.3, 1, 0.7] };
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toMatch(/only valid on escape templates/);
  });

  it('rejects malformed repeatingWaves', () => {
    const result = makeConfig((c) => {
      c.escape[0].reinforcements.repeatingWaves = [{ startTurn: 0, every: -1, count: [3, 1] }];
    });
    expect(result.valid).toBe(false);
    const text = result.errors.join('\n');
    expect(text).toMatch(/startTurn must be a positive integer/);
    expect(text).toMatch(/every must be a positive integer/);
    expect(text).toMatch(/count must have 0 < min <= max/);
  });

  it('rejects repeatingWave edges outside spawnEdges', () => {
    const result = makeConfig((c) => {
      c.escape[0].reinforcements.repeatingWaves[0].edges = ['bottom'];
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toMatch(/subset of reinforcements.spawnEdges/);
  });
});

// ── Map generation ───────────────────────────────────────────

describe('escape map generation', () => {
  it('produces escape squares on passable tiles with no throne or boss', () => {
    for (const act of ['act1', 'act2', 'act3', 'act4']) {
      for (let i = 0; i < 10; i++) {
        const config = withSeed(act.length * 1000 + i, () =>
          generateBattle({ act, objective: 'escape' }, data),
        );
        expect(config.objective).toBe('escape');
        expect(config.thronePos).toBeNull();
        expect(config.enemySpawns.some((e) => e.isBoss)).toBe(false);
        expect(config.escapeTiles.length).toBeGreaterThanOrEqual(2);
        for (const tile of config.escapeTiles) {
          expect(tile.col).toBeGreaterThanOrEqual(0);
          expect(tile.col).toBeLessThan(config.cols);
          expect(tile.row).toBeGreaterThanOrEqual(0);
          expect(tile.row).toBeLessThan(config.rows);
          const terrainEntry = data.terrain[config.mapLayout[tile.row][tile.col]];
          expect(parseInt(terrainEntry.moveCost.Infantry, 10)).toBeGreaterThan(0);
        }
        // Pursuit pressure survives into the battle config
        expect(config.reinforcements.repeatingWaves.length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps escape squares clear of player spawns', () => {
    for (let i = 0; i < 10; i++) {
      const config = withSeed(9000 + i, () =>
        generateBattle({ act: 'act2', objective: 'escape' }, data),
      );
      for (const tile of config.escapeTiles) {
        expect(config.playerSpawns.some((s) => s.col === tile.col && s.row === tile.row)).toBe(
          false,
        );
      }
    }
  });

  it('does not emit escapeTiles for rout or seize', () => {
    expect(generateBattle({ act: 'act1', objective: 'rout' }, data).escapeTiles).toBeUndefined();
    expect(generateBattle({ act: 'act1', objective: 'seize' }, data).escapeTiles).toBeUndefined();
  });
});

// ── Node assignment ──────────────────────────────────────────

describe('escape node assignment', () => {
  it('assigns escape only at special-objective rows, always elite, with escape templates', () => {
    let escapeNodes = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const map = withSeed(seed, () =>
        generateNodeMap('act2', { name: 'Act 2', rows: 7 }, data.mapTemplates),
      );
      for (const node of map.nodes) {
        if (node.battleParams?.objective !== 'escape') continue;
        escapeNodes++;
        expect(node.type).toBe(NODE_TYPES.BATTLE);
        expect(node.battleParams.isElite).toBe(true);
        expect(node.row).toBeGreaterThanOrEqual(3); // act2 special-objective gating
        const templateIds = data.mapTemplates.escape.map((t) => t.id);
        expect(templateIds).toContain(node.battleParams.templateId);
      }
    }
    expect(escapeNodes).toBeGreaterThan(0);
  });

  it('never assigns escape to recruit or boss nodes', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const map = withSeed(seed, () =>
        generateNodeMap('act3', { name: 'Act 3', rows: 7 }, data.mapTemplates),
      );
      for (const node of map.nodes) {
        if (node.type === NODE_TYPES.RECRUIT || node.type === NODE_TYPES.BOSS) {
          expect(node.battleParams?.objective).not.toBe('escape');
        }
      }
    }
  });
});

// ── Turn par ─────────────────────────────────────────────────

describe('escape turn par', () => {
  it('calculatePar returns a positive par for escape maps', () => {
    const config = generateBattle({ act: 'act1', objective: 'escape' }, data);
    const par = calculatePar(
      {
        cols: config.cols,
        rows: config.rows,
        enemyCount: config.enemySpawns.length,
        objective: 'escape',
        mapLayout: config.mapLayout,
        terrainData: data.terrain,
      },
      data.turnBonus,
    );
    expect(par).toBeGreaterThan(0);
  });
});

// ── EscapeObjectiveController ────────────────────────────────

function makeUnit(overrides = {}) {
  return {
    name: 'Galvin',
    className: 'Mercenary',
    faction: 'player',
    isLord: false,
    col: 5,
    row: 2,
    stats: { HP: 20, MOV: 5 },
    currentHP: 20,
    weapon: null,
    inventory: [],
    consumables: [],
    skills: [],
    hasActed: false,
    hasMoved: true,
    ...overrides,
  };
}

function makeEscapeScene(overrides = {}) {
  const scene = {
    battleConfig: {
      objective: 'escape',
      escapeTiles: [
        { col: 5, row: 2 },
        { col: 5, row: 4 },
      ],
    },
    battleParams: { act: 'act2' },
    playerUnits: [],
    escapedUnits: [],
    goldEarned: 0,
    selectedUnit: null,
    preMoveLoc: null,
    battleState: 'UNIT_ACTION_MENU',
    dangerZoneStale: false,
    grid: {
      gridToPixel: vi.fn(() => ({ x: 0, y: 0 })),
      clearAttackHighlights: vi.fn(),
    },
    add: {
      text: vi.fn(() => ({
        setOrigin() {
          return this;
        },
        setDepth() {
          return this;
        },
        destroy: vi.fn(),
      })),
      rectangle: vi.fn(() => ({
        setDepth() {
          return this;
        },
        destroy: vi.fn(),
      })),
    },
    tweens: { add: vi.fn(), killTweensOf: vi.fn() },
    time: { delayedCall: vi.fn() },
    _isReducedEffects: vi.fn(() => true),
    commitVisionSnapshotIfPending: vi.fn(),
    _clearCombatRollSession: vi.fn(),
    _clearSelectedWeaponArt: vi.fn(),
    removeUnitGraphic: vi.fn(),
    updateObjectiveText: vi.fn(),
    checkBattleEnd: vi.fn(() => false),
    _captureSuspendCheckpoint: vi.fn(),
    turnManager: { unitActed: vi.fn() },
  };
  return Object.assign(scene, overrides);
}

describe('EscapeObjectiveController', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pays the evac bonus and moves a non-lord off the field', () => {
    const unit = makeUnit();
    const scene = makeEscapeScene({ playerUnits: [unit] });
    const ctrl = new EscapeObjectiveController(scene);

    ctrl.executeEscape(unit);

    expect(scene.playerUnits).toHaveLength(0);
    expect(scene.escapedUnits).toEqual([unit]);
    expect(unit.hasActed).toBe(true);
    expect(scene.goldEarned).toBe(ESCAPE_EVAC_GOLD_BY_ACT.act2);
    expect(scene.removeUnitGraphic).toHaveBeenCalledWith(unit);
    expect(scene.commitVisionSnapshotIfPending).toHaveBeenCalled();
    expect(scene.turnManager.unitActed).toHaveBeenCalledWith(unit);
  });

  it('pays no evac bonus for lords', () => {
    const lord = makeUnit({ name: 'Edric', isLord: true });
    const other = makeUnit({ name: 'Kira', isLord: true, col: 1, row: 1 });
    const scene = makeEscapeScene({ playerUnits: [lord, other] });

    new EscapeObjectiveController(scene).executeEscape(lord);

    expect(scene.goldEarned).toBe(0);
    expect(scene.escapedUnits).toEqual([lord]);
  });

  it('checkpoints the resolved escape before handing the turn over', () => {
    const unit = makeUnit();
    const callOrder = [];
    const scene = makeEscapeScene({
      playerUnits: [unit],
      _captureSuspendCheckpoint: vi.fn(() => callOrder.push('checkpoint')),
      turnManager: { unitActed: vi.fn(() => callOrder.push('unitActed')) },
    });

    new EscapeObjectiveController(scene).executeEscape(unit);

    expect(callOrder).toEqual(['checkpoint', 'unitActed']);
  });

  it('stops at victory when checkBattleEnd ends the battle', () => {
    const lord = makeUnit({ name: 'Edric', isLord: true });
    const scene = makeEscapeScene({
      playerUnits: [lord],
      checkBattleEnd: vi.fn(() => true),
    });

    new EscapeObjectiveController(scene).executeEscape(lord);

    expect(scene.checkBattleEnd).toHaveBeenCalled();
    expect(scene._captureSuspendCheckpoint).not.toHaveBeenCalled();
    expect(scene.turnManager.unitActed).not.toHaveBeenCalled();
  });

  it('reports lord progress and tile occupancy', () => {
    const lordOut = makeUnit({ name: 'Edric', isLord: true });
    const lordIn = makeUnit({ name: 'Kira', isLord: true, col: 0, row: 0 });
    const scene = makeEscapeScene({
      playerUnits: [lordIn, makeUnit({ name: 'Rec', col: 5, row: 4 })],
      escapedUnits: [lordOut],
    });
    const ctrl = new EscapeObjectiveController(scene);

    expect(ctrl.getLordProgress()).toEqual({ fieldLords: 1, escapedLords: 1, totalLords: 2 });
    expect(ctrl.getObjectiveLabel()).toContain('(1/2)');
    expect(ctrl.getObjectiveLabel()).toContain('exit early');
    expect(ctrl.isOnEscapeTile(lordIn)).toBe(false);
    expect(ctrl.isOnEscapeTile(makeUnit({ col: 5, row: 4 }))).toBe(true);
  });

  it('creates and destroys markers without leaking', () => {
    const scene = makeEscapeScene();
    const ctrl = new EscapeObjectiveController(scene);
    ctrl.create();
    expect(ctrl.markers.length).toBe(4); // 2 tiles × (highlight + label)
    const markers = [...ctrl.markers];
    ctrl.destroy();
    expect(ctrl.markers).toEqual([]);
    for (const m of markers) expect(m.destroy).toHaveBeenCalled();
  });
});

// ── BattleScene victory/defeat rules ─────────────────────────

function makeBattleEndCtx(overrides = {}) {
  const ctx = Object.create(BattleScene.prototype);
  return Object.assign(ctx, {
    battleState: 'PLAYER_IDLE',
    visionDialog: null,
    playerUnits: [],
    escapedUnits: [],
    enemyUnits: [],
    _zombieTombstones: [],
    _reinforcementsPendingThisTurn: false,
    battleConfig: { objective: 'escape' },
    turnManager: { currentPhase: 'player' },
    onVictory: vi.fn(),
    onDefeat: vi.fn(),
    showLordDeathVisionPrompt: vi.fn(() => false),
    ...overrides,
  });
}

describe('BattleScene.checkBattleEnd escape rules', () => {
  it('an escaped Edric is alive, not a defeat', () => {
    const ctx = makeBattleEndCtx({
      playerUnits: [makeUnit({ name: 'Kira', isLord: true })],
      escapedUnits: [makeUnit({ name: 'Edric', isLord: true, isCommander: true })],
    });
    expect(BattleScene.prototype.checkBattleEnd.call(ctx)).toBe(false);
    expect(ctx.onDefeat).not.toHaveBeenCalled();
    expect(ctx.onVictory).not.toHaveBeenCalled();
  });

  it('victory once every living lord is out (even when the last field lord falls)', () => {
    const ctx = makeBattleEndCtx({
      playerUnits: [makeUnit({ name: 'Rec' })], // non-lord rearguard remains
      escapedUnits: [makeUnit({ name: 'Edric', isLord: true, isCommander: true })],
    });
    expect(BattleScene.prototype.checkBattleEnd.call(ctx)).toBe(true);
    expect(ctx.onVictory).toHaveBeenCalledTimes(1);
  });

  it('no victory while a living lord is still on the field', () => {
    const ctx = makeBattleEndCtx({
      playerUnits: [makeUnit({ name: 'Kira', isLord: true })],
      escapedUnits: [
        makeUnit({ name: 'Edric', isLord: true, isCommander: true }),
        makeUnit({ name: 'Rec' }),
      ],
    });
    expect(BattleScene.prototype.checkBattleEnd.call(ctx)).toBe(false);
  });

  it('Edric dying on the field is still defeat even with escapees banked', () => {
    const ctx = makeBattleEndCtx({
      playerUnits: [makeUnit({ name: 'Kira', isLord: true })],
      escapedUnits: [makeUnit({ name: 'Rec' })],
    });
    expect(BattleScene.prototype.checkBattleEnd.call(ctx)).toBe(true);
    expect(ctx.onDefeat).toHaveBeenCalledTimes(1);
  });

  it('an empty field with no escapees remains a defeat', () => {
    const ctx = makeBattleEndCtx({ playerUnits: [], escapedUnits: [] });
    expect(BattleScene.prototype.checkBattleEnd.call(ctx)).toBe(true);
    expect(ctx.onDefeat).toHaveBeenCalledTimes(1);
  });
});

describe('BattleScene.updateObjectiveText escape label', () => {
  it('routes the label through the escape controller', () => {
    const ctx = Object.create(BattleScene.prototype);
    ctx.objectiveText = { setText: vi.fn(), setColor: vi.fn() };
    ctx.battleConfig = { objective: 'escape' };
    ctx.npcUnits = [];
    ctx._escapeController = { getObjectiveLabel: vi.fn(() => 'Escape: label') };

    BattleScene.prototype.updateObjectiveText.call(ctx);

    expect(ctx.objectiveText.setText).toHaveBeenCalledWith('Escape: label');
    expect(ctx.objectiveText.setColor).toHaveBeenCalledWith('#a6ffb0');
  });
});

// ── Suspend checkpoint + Vision snapshot round trips ─────────

describe('escapedUnits persistence', () => {
  it('suspend checkpoint carries escaped units and applyUnits restores them', () => {
    const escaped = makeUnit({ name: 'Rec1' });
    const scene = {
      battleState: 'PLAYER_IDLE',
      runManager: {
        battleInProgress: { nodeId: 'n1', checkpoint: null },
        setBattleCheckpoint: vi.fn(function (cp) {
          this.battleInProgress.checkpoint = cp;
        }),
      },
      turnManager: { currentPhase: 'player', turnNumber: 3 },
      visionBaseSeed: 99,
      turnPar: 6,
      playerUnits: [],
      enemyUnits: [],
      npcUnits: [],
      escapedUnits: [escaped],
      nonDeployedUnits: [],
      visionSnapshot: null,
      pendingVisionSnapshot: null,
      antiTurtleState: {},
      grid: { fogEnabled: false },
      ballistas: [],
      _zombieTombstones: [],
      goldEarned: 60,
      _playerDeathsThisBattle: 0,
      appliedHybridOverrideTurns: new Set(),
      _latePressureWarningShown: false,
      _bossName: null,
      reseedBattleRng: vi.fn(),
      _persistBattleRunState: vi.fn(),
      addUnitGraphic: vi.fn(),
      dimUnit: vi.fn(),
      _addConditionIcon: vi.fn(),
    };
    const ctrl = new BattleSuspendController(scene);
    expect(ctrl.captureCheckpoint()).toBe(true);
    const cp = scene.runManager.battleInProgress.checkpoint;
    expect(cp.escapedUnits).toHaveLength(1);
    expect(cp.escapedUnits[0].name).toBe('Rec1');

    // Restore into a fresh scene (JSON round trip like localStorage)
    const restored = JSON.parse(JSON.stringify(cp));
    const fresh = {
      playerUnits: [],
      enemyUnits: [],
      npcUnits: [],
      escapedUnits: [],
      addUnitGraphic: vi.fn(),
      dimUnit: vi.fn(),
      _addConditionIcon: vi.fn(),
    };
    new BattleSuspendController(fresh).applyUnits(restored);
    expect(fresh.escapedUnits).toHaveLength(1);
    expect(fresh.escapedUnits[0].name).toBe('Rec1');
    // Off-field: no graphics created for escapees
    expect(fresh.addUnitGraphic).not.toHaveBeenCalled();
  });

  it('vision snapshot rewinds escaped units and the gold earned this turn', () => {
    const scene = {
      playerUnits: [],
      enemyUnits: [],
      npcUnits: [],
      escapedUnits: [makeUnit({ name: 'Rec1' })],
      goldEarned: 75,
      turnManager: { currentPhase: 'player', turnNumber: 2 },
      turnPar: null,
      objectiveText: null,
      antiTurtleState: {},
      grid: { fogEnabled: false },
      ballistas: [],
      _zombieTombstones: [],
      visionSnapshot: null,
      pendingVisionSnapshot: null,
    };
    const ctrl = new VisionRewindController(scene, { rngSeed: 7, visionCount: 0 });
    ctrl.captureSnapshot();
    expect(scene.visionSnapshot.escapedUnits).toHaveLength(1);
    expect(scene.visionSnapshot.goldEarned).toBe(75);

    // Mid-turn: another unit escapes and earns gold, then the turn is rewound
    scene.escapedUnits.push(makeUnit({ name: 'Rec2' }));
    scene.goldEarned = 135;
    Object.assign(scene, {
      selectedUnit: null,
      attackTargets: [],
      healTargets: [],
      hideActionMenu: vi.fn(),
      hideForecast: vi.fn(),
      cleanupTradeUI: vi.fn(),
      removeUnitGraphic: vi.fn(),
      addUnitGraphic: vi.fn(),
      reseedBattleRng: vi.fn(),
      updateObjectiveText: vi.fn(),
      refreshEndTurnControl: vi.fn(),
      getTurnPressureSummary: vi.fn(() => ''),
      getBestLordThroneDistance: vi.fn(() => Infinity),
      updateTopLeftHudLayout: vi.fn(),
      registry: { get: vi.fn(() => null) },
      visionBaseSeed: 7,
      turnCounterText: null,
      inspectionPanel: null,
      unitDetailOverlay: null,
      aiController: null,
      visionHudText: null,
      add: { rectangle: vi.fn(() => ({ setDepth: () => ({}) })) },
      tweens: { add: vi.fn() },
      cameras: { main: { centerX: 0, centerY: 0, width: 0, height: 0 } },
      _pinToScreen: vi.fn(),
      grid: {
        fogEnabled: false,
        clearHighlights: vi.fn(),
        clearAttackHighlights: vi.fn(),
        clearPath: vi.fn(),
      },
    });
    const applied = ctrl._applySnapshot();
    expect(applied).toBe(true);
    expect(scene.escapedUnits.map((u) => u.name)).toEqual(['Rec1']);
    expect(scene.goldEarned).toBe(75);
  });
});
