// HeadlessBattle.test.js — Core integration tests for the headless battle harness.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HeadlessBattle, HEADLESS_STATES, CANTO_DISABLED } from './HeadlessBattle.js';
import { GameDriver } from './GameDriver.js';
import { ScenarioRunner } from '../agents/ScenarioRunner.js';
import { loadFixture } from '../fixtures/battles/index.js';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { gridDistance } from '../../src/engine/Combat.js';
import { hasStaff } from '../../src/engine/UnitManager.js';

function captureVisibleTiles(grid) {
  const visible = new Set();
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (grid.isVisible(c, r)) visible.add(`${c},${r}`);
    }
  }
  return visible;
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const k of a) {
    if (!b.has(k)) return false;
  }
  return true;
}

function getDueTurnSearchUpperBound(battle) {
  const waves = battle?.battleConfig?.reinforcements?.waves || [];
  if (!waves.length) return 1;

  let maxWaveTurn = 1;
  for (const wave of waves) {
    if (Number.isInteger(wave?.turn)) maxWaveTurn = Math.max(maxWaveTurn, wave.turn);
  }

  const reinforcementTurnOffset = Number.isInteger(battle?.difficultyModel?.reinforcementTurnOffset)
    ? battle.difficultyModel.reinforcementTurnOffset
    : 0;
  const turnJitter = battle?.battleConfig?.reinforcements?.turnJitter;
  const maxJitter = (Array.isArray(turnJitter) && turnJitter.length === 2 && Number.isInteger(turnJitter[1]))
    ? turnJitter[1]
    : 0;

  return Math.max(1, maxWaveTurn + reinforcementTurnOffset + maxJitter + 5);
}

function findFirstDueTurn(battle) {
  const upperBound = getDueTurnSearchUpperBound(battle);
  for (let turn = 1; turn <= upperBound; turn++) {
    if ((battle._resolveReinforcementsForTurn(turn)?.dueWaves?.length || 0) > 0) return turn;
  }
  return null;
}

describe('HeadlessBattle', () => {
  let gameData;

  beforeEach(() => {
    gameData = loadGameData();
    installSeed(12345);
  });

  afterEach(() => {
    restoreMathRandom();
  });

  it('CANTO_DISABLED flag is true', () => {
    expect(CANTO_DISABLED).toBe(true);
  });

  it('init creates player and enemy units', () => {
    const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout', row: 2 });
    battle.init();
    expect(battle.playerUnits.length).toBeGreaterThanOrEqual(1);
    expect(battle.enemyUnits.length).toBeGreaterThanOrEqual(1);
    expect(battle.battleState).toBe(HEADLESS_STATES.PLAYER_IDLE);
  });

  it('init creates correct player count matching spawn points', () => {
    const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout', row: 2 });
    battle.init();
    // Fallback lords: should have 2 (Edric + Sera)
    expect(battle.playerUnits.length).toBe(2);
    expect(battle.playerUnits.some(u => u.name === 'Edric')).toBe(true);
    expect(battle.playerUnits.some(u => u.name === 'Sera')).toBe(true);
  });

  it('init resets reinforcement caches when reusing the same battle instance', () => {
    const battle = new HeadlessBattle(gameData, {
      act: 'act4',
      objective: 'rout',
      row: 3,
      templateId: 'frozen_pass',
    });
    battle.init();

    battle.reinforcementTemplatePool = [{ className: '__stale__', level: 1 }];
    battle.lastReinforcementSchedule = { spawns: [{ col: 0, row: 0 }] };

    battle.init();

    expect(battle.reinforcementTemplatePool).toBeNull();
    expect(battle.lastReinforcementSchedule).toBeNull();
    const rebuiltPool = battle._getReinforcementTemplatePool();
    expect(rebuiltPool.some((entry) => entry.className === '__stale__')).toBe(false);
  });

  it('uses battle-seed fallback parity for reinforcement seed derivation', () => {
    const runSeed = 777;
    const base = {
      act: 'act4',
      runSeed,
      nodeId: 'node_test_01',
    };
    const a = new HeadlessBattle(gameData, { ...base, objective: 'rout', row: 3 });
    const b = new HeadlessBattle(gameData, { ...base, objective: 'seize', row: 9 });

    let expected = 2166136261 >>> 0;
    const input = `${runSeed >>> 0}:node_test_01`;
    for (let i = 0; i < input.length; i++) {
      expected ^= input.charCodeAt(i);
      expected = Math.imul(expected, 16777619);
    }
    expected >>>= 0;

    expect(a._getReinforcementSeed()).toBe(expected);
    expect(b._getReinforcementSeed()).toBe(expected);
  });

  it('selectUnit transitions to UNIT_SELECTED', () => {
    const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout', row: 2 });
    battle.init();
    battle.selectUnit('Edric');
    expect(battle.battleState).toBe(HEADLESS_STATES.UNIT_SELECTED);
    expect(battle.selectedUnit.name).toBe('Edric');
    expect(battle.movementRange).toBeTruthy();
    expect(battle.movementRange.size).toBeGreaterThan(0);
  });

  it('selectUnit throws for already-acted unit', () => {
    const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout', row: 2 });
    battle.init();
    battle.playerUnits[0].hasActed = true;
    expect(() => battle.selectUnit('Edric')).toThrow(/already acted/);
  });

  it('moveTo updates unit position', () => {
    const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout', row: 2 });
    battle.init();
    battle.selectUnit('Edric');
    const edric = battle.selectedUnit;
    const origCol = edric.col;
    const origRow = edric.row;

    // Find a reachable tile
    const keys = [...battle.movementRange.keys()];
    const target = keys.find(k => k !== `${origCol},${origRow}`);
    if (target) {
      const [col, row] = target.split(',').map(Number);
      battle.moveTo(col, row);
      expect(edric.col).toBe(col);
      expect(edric.row).toBe(row);
      expect(battle.battleState).toBe(HEADLESS_STATES.UNIT_ACTION_MENU);
    }
  });

  it('moveTo throws for unreachable tile', () => {
    const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout', row: 2 });
    battle.init();
    battle.selectUnit('Edric');
    expect(() => battle.moveTo(999, 999)).toThrow(/not reachable/);
  });

  it('getAvailableActions returns Wait always', () => {
    const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout', row: 2 });
    battle.init();
    battle.selectUnit('Edric');
    // Move in place
    battle.moveTo(battle.selectedUnit.col, battle.selectedUnit.row);
    const actions = battle.getAvailableActions();
    expect(actions.some(a => a.label === 'Wait')).toBe(true);
  });

  it('getAvailableActions marks deferred actions as unsupported', () => {
    const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout', row: 2 });
    battle.init();
    battle.selectUnit('Edric');
    battle.moveTo(battle.selectedUnit.col, battle.selectedUnit.row);
    const actions = battle.getAvailableActions();
    const unsupported = actions.filter(a => !a.supported);
    // All unsupported actions should have known labels
    for (const a of unsupported) {
      expect(['Equip', 'Promote', 'Item', 'Shove', 'Pull', 'Trade', 'Swap', 'Dance']).toContain(a.label);
    }
  });

  it('chooseAction Wait finishes unit action', () => {
    const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout', row: 2 });
    battle.init();
    battle.selectUnit('Edric');
    battle.moveTo(battle.selectedUnit.col, battle.selectedUnit.row);
    battle.chooseAction('Wait');
    expect(battle.battleState).toBe(HEADLESS_STATES.PLAYER_IDLE);
    expect(battle.playerUnits.find(u => u.name === 'Edric').hasActed).toBe(true);
  });

  it('chooseAction throws for unsupported action', () => {
    const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout', row: 2 });
    battle.init();
    battle.selectUnit('Edric');
    battle.moveTo(battle.selectedUnit.col, battle.selectedUnit.row);
    expect(() => battle.chooseAction('Equip')).toThrow(/not supported in MVP/);
  });

  it('undoMove restores unit position', () => {
    const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout', row: 2 });
    battle.init();
    battle.selectUnit('Edric');
    const origCol = battle.selectedUnit.col;
    const origRow = battle.selectedUnit.row;

    const keys = [...battle.movementRange.keys()];
    const target = keys.find(k => k !== `${origCol},${origRow}`);
    if (target) {
      const [col, row] = target.split(',').map(Number);
      battle.moveTo(col, row);
      battle.undoMove();
      expect(battle.selectedUnit.col).toBe(origCol);
      expect(battle.selectedUnit.row).toBe(origRow);
      expect(battle.battleState).toBe(HEADLESS_STATES.UNIT_SELECTED);
    }
  });

  it('Promote action requires Master Seal in consumables', () => {
    const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout', row: 2 });
    battle.init();
    battle.selectUnit('Edric');
    const edric = battle.selectedUnit;
    edric.level = 10;
    edric.tier = 'base';

    battle.moveTo(edric.col, edric.row);
    let actions = battle.getAvailableActions();
    expect(actions.some(a => a.label === 'Promote')).toBe(false);

    const seal = gameData.consumables.find(c => c.name === 'Master Seal');
    expect(seal).toBeTruthy();
    edric.consumables.push(structuredClone(seal));

    actions = battle.getAvailableActions();
    expect(actions.some(a => a.label === 'Promote')).toBe(true);
  });

  it('undoMove on fog maps reverts revealed tiles to pre-move visibility', () => {
    const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout', row: 2, fogEnabled: true });
    battle.init();
    battle.selectUnit('Edric');

    const unit = battle.selectedUnit;
    const origCol = unit.col;
    const origRow = unit.row;
    const before = captureVisibleTiles(battle.grid);

    let moveTarget = null;
    for (const key of battle.movementRange.keys()) {
      if (key === `${origCol},${origRow}`) continue;
      const [col, row] = key.split(',').map(Number);
      unit.col = col;
      unit.row = row;
      battle.grid.updateFogOfWar(battle.playerUnits);
      const probe = captureVisibleTiles(battle.grid);
      if (!setsEqual(before, probe)) {
        moveTarget = { col, row };
        break;
      }
    }

    unit.col = origCol;
    unit.row = origRow;
    battle.grid.updateFogOfWar(battle.playerUnits);
    expect(moveTarget).toBeTruthy();

    battle.moveTo(moveTarget.col, moveTarget.row);
    battle.undoMove();

    const afterUndo = captureVisibleTiles(battle.grid);
    expect(setsEqual(afterUndo, before)).toBe(true);
  });

  it('cancel from UNIT_SELECTED returns to PLAYER_IDLE', () => {
    const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout', row: 2 });
    battle.init();
    battle.selectUnit('Edric');
    battle.cancel();
    expect(battle.battleState).toBe(HEADLESS_STATES.PLAYER_IDLE);
    expect(battle.selectedUnit).toBeNull();
  });

  it('enemy units have valid weapons', () => {
    const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout', row: 2 });
    battle.init();
    for (const e of battle.enemyUnits) {
      expect(e.weapon).toBeTruthy();
      expect(e.weapon.name).toBeTruthy();
    }
  });

  it('all units have valid grid positions', () => {
    const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout', row: 2 });
    battle.init();
    for (const u of [...battle.playerUnits, ...battle.enemyUnits]) {
      expect(u.col).toBeGreaterThanOrEqual(0);
      expect(u.row).toBeGreaterThanOrEqual(0);
      expect(u.col).toBeLessThan(battle.battleConfig.cols);
      expect(u.row).toBeLessThan(battle.battleConfig.rows);
    }
  });

  it('no two units share the same position at init', () => {
    const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout', row: 2 });
    battle.init();
    const positions = new Set();
    for (const u of [...battle.playerUnits, ...battle.enemyUnits, ...battle.npcUnits]) {
      const key = `${u.col},${u.row}`;
      expect(positions.has(key)).toBe(false);
      positions.add(key);
    }
  });

  it('enemy phase applies deterministic reinforcement spawns on due turns', async () => {
    const battle = new HeadlessBattle(gameData, {
      act: 'act4',
      objective: 'rout',
      row: 3,
      templateId: 'frozen_pass',
      difficultyId: 'normal',
      difficultyMod: 1.0,
    });
    battle.init();
    battle.aiController.processEnemyPhase = async () => {};

    const dueTurn = findFirstDueTurn(battle);
    expect(dueTurn).not.toBeNull();

    const before = battle.enemyUnits.length;
    battle.turnManager.turnNumber = dueTurn;
    battle.turnManager.currentPhase = 'enemy';
    battle.battleState = HEADLESS_STATES.ENEMY_PHASE;

    await battle._processEnemyPhase();

    expect(battle.enemyUnits.length).toBeGreaterThan(before);
    expect(battle.lastReinforcementSchedule?.spawns?.length || 0).toBeGreaterThan(0);
  });

  it('scripted reinforcement waves spawn exact configured units in headless flow', () => {
    const battle = new HeadlessBattle(gameData, {
      act: 'act1',
      objective: 'rout',
      row: 2,
      difficultyId: 'normal',
      difficultyMod: 1.0,
    });
    battle.init();

    const occupied = new Set(
      [...battle.playerUnits, ...battle.enemyUnits, ...battle.npcUnits].map((unit) => `${unit.col},${unit.row}`)
    );
    let spawnTile = null;
    for (let row = 0; row < battle.battleConfig.rows && !spawnTile; row++) {
      for (let col = 0; col < battle.battleConfig.cols && !spawnTile; col++) {
        const key = `${col},${row}`;
        if (occupied.has(key)) continue;
        const terrainIdx = battle.battleConfig.mapLayout[row][col];
        const tile = gameData.terrain[terrainIdx];
        if (tile?.moveCost?.Infantry !== '--') {
          spawnTile = { col, row };
        }
      }
    }
    expect(spawnTile).toBeTruthy();

    battle.battleConfig.reinforcements = {
      spawnEdges: ['right'],
      waves: [],
      scriptedWaves: [
        {
          turn: 1,
          xpMultiplier: 0.5,
          spawns: [{
            col: spawnTile.col,
            row: spawnTile.row,
            className: 'Fighter',
            level: 7,
            aiMode: 'guard',
            affixes: ['scripted_affix'],
          }],
        },
      ],
      difficultyScaling: true,
      turnOffsetByDifficulty: { normal: 0, hard: 0, lunatic: 0 },
      xpDecay: [1.0],
    };

    const before = battle.enemyUnits.length;
    const schedule = battle._applyReinforcementsForTurn(1);

    expect(schedule.spawned).toBe(1);
    expect(schedule.spawns[0]).toEqual(expect.objectContaining({
      waveType: 'scripted',
      className: 'Fighter',
      level: 7,
      col: spawnTile.col,
      row: spawnTile.row,
      xpMultiplier: 0.5,
    }));
    expect(battle.enemyUnits.length).toBe(before + 1);

    const spawned = battle.enemyUnits.find((unit) => unit.col === spawnTile.col && unit.row === spawnTile.row);
    expect(spawned).toBeTruthy();
    expect(spawned.className).toBe('Fighter');
    expect(spawned.level).toBe(7);
    expect(spawned.aiMode).toBe('guard');
    expect(spawned.affixes || []).toContain('scripted_affix');
    expect(spawned._isReinforcement).toBe(true);
    expect(spawned._reinforcementSpawnTurn).toBe(1);
  });

  it('reinforcementTurnOffset advances reinforcement waves in enemy phase flow', async () => {
    const withOffset = new HeadlessBattle(gameData, {
      act: 'act4',
      objective: 'rout',
      row: 3,
      templateId: 'frozen_pass',
      difficultyId: 'normal',
      difficultyMod: 1.0,
      reinforcementTurnOffset: -1,
    });
    withOffset.init();
    withOffset.aiController.processEnemyPhase = async () => {};

    const withoutOffset = new HeadlessBattle(gameData, {
      act: 'act4',
      objective: 'rout',
      row: 3,
      templateId: 'frozen_pass',
      difficultyId: 'normal',
      difficultyMod: 1.0,
      reinforcementTurnOffset: 0,
    });
    withoutOffset.init();
    withoutOffset.aiController.processEnemyPhase = async () => {};
    const withOffsetDueTurn = findFirstDueTurn(withOffset);
    const withoutOffsetDueTurn = findFirstDueTurn(withoutOffset);
    expect(withOffsetDueTurn).not.toBeNull();
    expect(withoutOffsetDueTurn).not.toBeNull();
    expect(withOffsetDueTurn).toBe(withoutOffsetDueTurn - 1);

    const withOffsetBefore = withOffset.enemyUnits.length;
    withOffset.turnManager.turnNumber = withOffsetDueTurn;
    withOffset.turnManager.currentPhase = 'enemy';
    withOffset.battleState = HEADLESS_STATES.ENEMY_PHASE;
    await withOffset._processEnemyPhase();

    const withoutOffsetBefore = withoutOffset.enemyUnits.length;
    withoutOffset.turnManager.turnNumber = withOffsetDueTurn;
    withoutOffset.turnManager.currentPhase = 'enemy';
    withoutOffset.battleState = HEADLESS_STATES.ENEMY_PHASE;
    await withoutOffset._processEnemyPhase();

    expect(withOffset.lastReinforcementSchedule?.dueWaves?.length || 0).toBeGreaterThan(0);
    expect(withOffset.enemyUnits.length).toBeGreaterThan(withOffsetBefore);
    expect(withoutOffset.lastReinforcementSchedule?.dueWaves || []).toHaveLength(0);
    expect(withoutOffset.enemyUnits.length).toBe(withoutOffsetBefore);
  });

  it('selectUnit prefers an unacted unit when duplicate names exist', () => {
    const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout', row: 2 });
    battle.init();

    const first = battle.playerUnits[0];
    const second = structuredClone(first);
    first.hasActed = true;
    second.hasActed = false;
    second.col = Math.max(0, first.col - 1);
    second.row = first.row;
    battle.playerUnits.unshift(second);

    battle.selectUnit(first.name);

    expect(battle.selectedUnit).toBe(second);
    expect(battle.selectedUnit.hasActed).toBe(false);
    expect(battle.battleState).toBe(HEADLESS_STATES.UNIT_SELECTED);
  });
});

describe('GameDriver', () => {
  let gameData;

  beforeEach(() => {
    gameData = loadGameData();
    installSeed(12345);
  });

  afterEach(() => {
    restoreMathRandom();
  });

  it('listLegalActions returns select_unit and end_turn at start', () => {
    const driver = new GameDriver(gameData, { act: 'act1', objective: 'rout', row: 2 });
    driver.init();
    const actions = driver.listLegalActions();
    expect(actions.some(a => a.type === 'select_unit')).toBe(true);
    expect(actions.some(a => a.type === 'end_turn')).toBe(true);
  });

  it('snapshot returns valid state', () => {
    const driver = new GameDriver(gameData, { act: 'act1', objective: 'rout', row: 2 });
    driver.init();
    const snap = driver.snapshot();
    expect(snap.battleState).toBe('PLAYER_IDLE');
    expect(snap.turn).toBe(1);
    expect(snap.playerUnits.length).toBeGreaterThanOrEqual(1);
    expect(snap.enemyUnits.length).toBeGreaterThanOrEqual(1);
  });

  it('step select_unit transitions correctly', async () => {
    const driver = new GameDriver(gameData, { act: 'act1', objective: 'rout', row: 2 });
    driver.init();
    const result = await driver.step({ type: 'select_unit', payload: { unitName: 'Edric' } });
    expect(result.state).toBe('UNIT_SELECTED');
  });

  it('isTerminal returns false at start', () => {
    const driver = new GameDriver(gameData, { act: 'act1', objective: 'rout', row: 2 });
    driver.init();
    expect(driver.isTerminal()).toBe(false);
  });

  it('replay log records actions', async () => {
    const driver = new GameDriver(gameData, { act: 'act1', objective: 'rout', row: 2 });
    driver.init();
    await driver.step({ type: 'select_unit', payload: { unitName: 'Edric' } });
    expect(driver.replayLog.length).toBe(1);
    expect(driver.replayLog[0].type).toBe('select_unit');
  });

  it('end_turn triggers enemy phase and returns to player', async () => {
    const driver = new GameDriver(gameData, { act: 'act1', objective: 'rout', row: 2 });
    driver.init();
    const turnBefore = driver.battle.turnManager.turnNumber;
    await driver.step({ type: 'end_turn', payload: {} });
    // After enemy phase, should be back to PLAYER_IDLE (or BATTLE_END if someone died)
    const state = driver.battle.battleState;
    expect([HEADLESS_STATES.PLAYER_IDLE, HEADLESS_STATES.BATTLE_END]).toContain(state);
    if (state === HEADLESS_STATES.PLAYER_IDLE) {
      expect(driver.battle.turnManager.turnNumber).toBe(turnBefore + 1);
    }
  });

  it('captures AI decision reasons for enemy phase observability', async () => {
    const driver = new GameDriver(gameData, { act: 'act1', objective: 'rout', row: 2 });
    driver.init();
    await driver.step({ type: 'end_turn', payload: {} });
    const stats = driver.battle.getLastEnemyPhaseAiStats();

    expect(stats).toBeTruthy();
    expect(stats.turn).toBeGreaterThanOrEqual(1);
    expect(stats.enemyCountAtStart).toBeGreaterThan(0);
    expect(Object.keys(stats.byReason).length).toBeGreaterThan(0);
  });

  it('last unit Wait auto-triggers enemy phase via driver', async () => {
    const driver = new GameDriver(gameData, { act: 'act1', objective: 'rout', row: 2 });
    driver.init();
    // Wait with all player units
    for (const u of driver.battle.playerUnits) {
      await driver.step({ type: 'select_unit', payload: { unitName: u.name } });
      await driver.step({ type: 'move_to', payload: { col: u.col, row: u.row } });
      await driver.step({ type: 'choose_action', payload: { label: 'Wait' } });
    }
    // Should have processed enemy phase and be back at player idle (or battle end)
    const state = driver.battle.battleState;
    expect([HEADLESS_STATES.PLAYER_IDLE, HEADLESS_STATES.BATTLE_END]).toContain(state);
  });
});

describe('Fixture roster building', () => {
  let gameData;

  beforeEach(() => {
    gameData = loadGameData();
    installSeed(42);
  });

  afterEach(() => {
    restoreMathRandom();
  });

  it('act2_seize_basic fixture produces 4 player units', () => {
    const fixture = loadFixture('act2_seize_basic');
    const roster = fixture.buildRoster(gameData);
    expect(roster).not.toBeNull();
    expect(roster.length).toBe(4);

    const driver = new GameDriver(gameData, fixture.battleParams, roster);
    driver.init();
    expect(driver.battle.playerUnits.length).toBe(4);
  });

  it('healer_heavy fixture has 2+ staff users', () => {
    const fixture = loadFixture('healer_heavy');
    const roster = fixture.buildRoster(gameData);
    expect(roster).not.toBeNull();
    const staffCount = roster.filter(u =>
      u.inventory.some(w => w.type === 'Staff')
    ).length;
    expect(staffCount).toBeGreaterThanOrEqual(2);
  });

  it('act1_rout_basic returns null roster (fallback lords)', () => {
    const fixture = loadFixture('act1_rout_basic');
    const roster = fixture.buildRoster(gameData);
    expect(roster).toBeNull();
  });
});

describe('ScenarioRunner RNG safety', () => {
  it('restores Math.random on agent error', async () => {
    const origRandom = Math.random;
    const fixture = loadFixture('act1_rout_basic');
    const brokenAgent = () => ({
      chooseAction: () => { throw new Error('broken agent'); },
    });
    const runner = new ScenarioRunner(99, fixture, brokenAgent);
    const replay = await runner.run(10);
    expect(replay.result).toBe('error');
    // Math.random should be restored to original
    expect(Math.random).toBe(origRandom);
  });
});
