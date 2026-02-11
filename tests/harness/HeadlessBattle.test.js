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
      expect(['Equip', 'Promote', 'Item', 'Accessory', 'Shove', 'Pull', 'Trade', 'Swap', 'Dance']).toContain(a.label);
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
