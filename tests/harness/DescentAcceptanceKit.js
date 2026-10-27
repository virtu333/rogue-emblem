// Shared set-up for the Descent acceptance tests (tests/harness/DescentAcceptance*.test.js and
// tests/DescentAcceptance*.test.js): a real Descent run switched on for the test (on its own copy,
// whatever data/descent.json ships), its nodes won as the scene's victory commit wins them, and a node's battle played
// in the harness on the map the game generates and locks for it (BattleScene.beginBattle's calls,
// through the sims' battleConfigForNode). Nothing here wins a battle for a test: a battle ends
// only when its objective is met by the harness's own rules.
import { loadGameData } from '../testData.js';
import { RunManager } from '../../src/engine/RunManager.js';
import { createUnit } from '../../src/engine/UnitManager.js';
import { createRite } from '../../src/engine/Rite.js';
import { gridDistance, parseRange } from '../../src/engine/Combat.js';
import { entityDistanceTo, isEntity } from '../../src/engine/EntitySystem.js';
import { GameDriver } from './GameDriver.js';
import { battleConfigForNode } from '../sim/RunSimulationDriver.js';

export const baseData = loadGameData();

/** The game's data with the Descent switched on (a copy: the shared data is never touched). */
export const descentData = () => ({
  ...baseData,
  descent: { ...structuredClone(baseData.descent), enabled: true },
});

/** A standard run standing at the Descent's first row on `difficultyId`, the Rite at `words`. */
export function descentRun(difficultyId = 'hard', { runSeed = 9, words = null } = {}) {
  const rm = new RunManager(descentData());
  rm.startRun({ runSeed, difficultyId, applyBlessingsAtStart: false });
  rm.actIndex = rm.actSequence.indexOf('finalBoss') - 1;
  rm.advanceAct();
  if (words !== null) rm.rite = createRite({ start: words });
  return rm;
}

export const nodeOf = (rm, key) => rm.nodeMap.nodes.find((n) => n.descentKey === key);

/** Win a node as PostCombatController.onVictory commits it (under par, no Vigil words). */
export function winNode(rm, key, options = {}) {
  const node = nodeOf(rm, key);
  return rm.completeBattle(
    rm.roster.map((u) => structuredClone(u)),
    node.id,
    0,
    { turnCount: 4, turnPar: 12, ...options },
  );
}

/** Pass a node that is not a battle (an event, the Ruins) as the route map does. */
export const passNode = (rm, key) => rm.markNodeComplete(nodeOf(rm, key).id);

/**
 * An army strong enough to finish any Descent fight by force of arms but still mortal (no
 * invincibility patch): the run's lords and `extra` level-20 Mercenaries, every stat raised.
 */
export function strongArmy(rm, extra = 2) {
  const merc = rm.gameData.classes.find((c) => c.name === 'Mercenary');
  const army = rm.roster.map((u) => structuredClone(u));
  for (let i = 0; i < extra; i++) {
    army.push(
      createUnit(merc, 20, rm.gameData.weapons, {
        name: `Vanguard ${i + 1}`,
        rng: () => 0.5,
      }),
    );
  }
  for (const unit of army) {
    unit.faction = 'player';
    Object.assign(unit.stats, {
      HP: 99,
      STR: 70,
      MAG: 70,
      SKL: 60,
      SPD: 45,
      LCK: 40,
      DEF: 55,
      RES: 55,
    });
    unit.currentHP = unit.stats.HP;
  }
  return army;
}

/**
 * The battle for `node` as the game plays it: the run's params, the map BattleScene generates
 * and locks at entry (the sims' battleConfigForNode is those calls), the army deployed on it.
 */
export function playNode(rm, node, army) {
  const params = rm.getBattleParams(node);
  const battleConfig = battleConfigForNode(rm, node, params, {
    deployCount: army.length,
    gameData: rm.gameData,
  });
  const driver = new GameDriver(rm.gameData, params, army, { runManager: rm });
  driver.init({ battleConfig });
  return { driver, b: driver.battle, params, battleConfig };
}

/**
 * A free tile `unit` could stand on and strike `foe` from with its equipped weapon (the nearest
 * first; an Entity's distance is from its footprint, as combat measures it).
 */
export function freeTileBeside(b, unit, foe) {
  const { min, max } = parseRange(unit.weapon?.range || '1');
  const taken = (c, r) => b.getUnitAt(c, r);
  const cols = b.battleConfig.cols;
  const rows = b.battleConfig.rows;
  const options = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const d = isEntity(foe) ? entityDistanceTo(foe, c, r) : gridDistance(c, r, foe.col, foe.row);
      if (d < Math.max(1, min) || d > max) continue;
      const cost = b.grid.getTerrainAt(c, r)?.moveCost?.[unit.moveType];
      if (!(Number(cost) > 0) || Number(cost) >= 99) continue;
      if (taken(c, r) && taken(c, r) !== unit) continue;
      options.push({ col: c, row: r, d });
    }
  }
  options.sort((a, b2) => a.d - b2.d || a.row - b2.row || a.col - b2.col);
  return options[0] || null;
}

/**
 * `unit` attacks `foe` through the harness's real action path (select, stay, Attack, target),
 * standing first on a free tile beside it (a test's placement, as a move the unit could have
 * made). Returns the harness's state after the exchange.
 */
export async function strike(driver, unit, foe, { tile = null } = {}) {
  const b = driver.battle;
  const at = tile || freeTileBeside(b, unit, foe);
  if (!at) throw new Error(`no tile beside ${foe.name}`);
  unit.col = at.col;
  unit.row = at.row;
  await driver.step({ type: 'select_unit', payload: { unitName: unit.name } });
  await driver.step({ type: 'move_to', payload: { col: at.col, row: at.row } });
  await driver.step({ type: 'choose_action', payload: { label: 'Attack' } });
  return driver.step({ type: 'choose_target', payload: { targetName: foe.name } });
}

/** `unit` walks onto `tile` (placed beside it first, as `strike` does) and waits there. */
export async function standOn(driver, unit, tile) {
  unit.col = tile.col;
  unit.row = tile.row;
  await driver.step({ type: 'select_unit', payload: { unitName: unit.name } });
  await driver.step({ type: 'move_to', payload: { col: tile.col, row: tile.row } });
  return driver.step({ type: 'choose_action', payload: { label: 'Wait' } });
}

/** `unit` walks onto a Vigil circle (placed there first, as `standOn`) and Unweaves it. */
export async function unweaveOn(driver, unit, circle) {
  unit.col = circle.col;
  unit.row = circle.row;
  await driver.step({ type: 'select_unit', payload: { unitName: unit.name } });
  await driver.step({ type: 'move_to', payload: { col: circle.col, row: circle.row } });
  return driver.step({ type: 'choose_action', payload: { label: 'Unweave' } });
}

/** End the player phase (the enemy phase runs through the harness's pipeline). */
export const endTurn = (driver) => driver.step({ type: 'end_turn', payload: {} });

/** Every unit the run's victory commit is handed, as PostCombatController builds the list. */
export function survivorsOf(b, bench = []) {
  return [...b.playerUnits, ...(b.escapedUnits || []), ...bench].map((u) => structuredClone(u));
}
