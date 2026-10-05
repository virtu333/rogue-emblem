// The harness battle's Item and Equip actions (BattleScene.useConsumable /
// showEquipMenu, which headless play drives) and its movement rule (BattleScene's
// selectUnit: a rooted unit stays put; pathfinding skills lower terrain costs).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HeadlessBattle, HEADLESS_STATES } from './HeadlessBattle.js';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { applyCondition } from '../../src/engine/StatusConditionSystem.js';

let gameData;

function battle() {
  const b = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout', row: 2 });
  b.init();
  return b;
}

const edricOf = (b) => b.playerUnits.find((u) => u.name === 'Edric');

/** Put a unit on an open plain tile with plain all around (no terrain or neighbours). */
function placeOnOpenGround(b, unit) {
  const plain = b.gameData.terrain.findIndex((t) => t.name === 'Plain');
  const occupied = new Set([...b.playerUnits, ...b.enemyUnits].map((u) => `${u.col},${u.row}`));
  for (let r = 2; r < b.grid.rows - 2; r++)
    for (let c = 2; c < b.grid.cols - 2; c++) {
      const near = [];
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) near.push([c + dc, r + dr]);
      if (near.some(([x, y]) => occupied.has(`${x},${y}`))) continue;
      for (const [x, y] of near) b.grid.mapLayout[y][x] = plain;
      unit.col = c;
      unit.row = r;
      return;
    }
  throw new Error('no open ground');
}

describe('HeadlessBattle Item and Equip', () => {
  beforeEach(() => {
    gameData = loadGameData();
    installSeed(4242);
  });
  afterEach(() => restoreMathRandom());

  it('a Vulnerary heals its user by its value, spends a use and ends the action', () => {
    const b = battle();
    const edric = edricOf(b);
    const vulnerary = edric.consumables.find((i) => i.name === 'Vulnerary');
    const uses = vulnerary.uses;
    edric.currentHP = edric.stats.HP - 15;
    b.selectUnit(edric);
    b.moveTo(edric.col, edric.row);
    b.useItem(vulnerary);
    expect(edric.currentHP).toBe(edric.stats.HP - 15 + vulnerary.value);
    expect(vulnerary.uses).toBe(uses - 1);
    expect(edric.hasActed).toBe(true);
    expect(b.battleState).toBe(HEADLESS_STATES.PLAYER_IDLE);
  });

  it('refuses a heal at full HP and leaves the unit choosing', () => {
    const b = battle();
    const edric = edricOf(b);
    const vulnerary = edric.consumables.find((i) => i.name === 'Vulnerary');
    b.selectUnit(edric);
    b.moveTo(edric.col, edric.row);
    expect(() => b.useItem(vulnerary)).toThrow(/cannot use/);
    expect(vulnerary.uses).toBe(3);
    expect(edric.hasActed).toBe(false);
    expect(b.battleState).toBe(HEADLESS_STATES.UNIT_ACTION_MENU);
  });

  it('refuses a seal: promotion and reclass are not modelled', () => {
    const b = battle();
    const edric = edricOf(b);
    const seal = { name: 'Master Seal', type: 'Consumable', effect: 'promote', uses: 1 };
    edric.consumables.push(seal);
    b.selectUnit(edric);
    b.moveTo(edric.col, edric.row);
    expect(() => b.useItem(seal)).toThrow(/not modelled/);
    expect(seal.uses).toBe(1);
  });

  it('equips from the menu without ending the action', () => {
    const b = battle();
    const edric = edricOf(b);
    const steel = edric.inventory.find((w) => w.name === 'Steel Sword');
    expect(edric.weapon).not.toBe(steel);
    b.selectUnit(edric);
    b.moveTo(edric.col, edric.row);
    b.equipFromMenu(steel);
    expect(edric.weapon).toBe(steel);
    expect(edric.hasActed).toBe(false);
    expect(b.battleState).toBe(HEADLESS_STATES.UNIT_ACTION_MENU);
  });

  it('selects the very unit it is given when two share a name', () => {
    const b = battle();
    const [first, second] = b.playerUnits;
    second.name = first.name;
    b.selectUnit(second);
    expect(b.selectedUnit).toBe(second);
  });
});

describe('HeadlessBattle movement rule', () => {
  beforeEach(() => {
    gameData = loadGameData();
    installSeed(99);
  });
  afterEach(() => restoreMathRandom());

  it('a rooted unit can only stay where it stands', () => {
    const b = battle();
    const edric = edricOf(b);
    expect(applyCondition(edric, 'root', 2)).toBe(true);
    b.selectUnit(edric);
    const stops = [...b.movementRange.entries()].filter(([, e]) => e?.stoppable !== false);
    expect(stops.map(([k]) => k)).toEqual([`${edric.col},${edric.row}`]);
  });

  it('Pathfinder lowers a forest step from 2 to 1', () => {
    const b = battle();
    const edric = edricOf(b);
    placeOnOpenGround(b, edric);
    const forest = b.gameData.terrain.findIndex((t) => t.name === 'Forest');
    // Forest across the unit's row: 4 MOV crosses two forest tiles with Pathfinder (1 each),
    // one without (2 each), counting outward from the unit along the row.
    for (let dc = 1; dc <= 2; dc++) b.grid.mapLayout[edric.row][edric.col + dc] = forest;
    const reach = () => {
      b.selectUnit(edric);
      const can = b.movementRange.has(`${edric.col + 3},${edric.row}`);
      b.cancel();
      return can;
    };
    edric.stats.MOV = 4;
    edric.mov = 4;
    // Forest 2 + forest 2 = 4: the third tile (plain) is one step too far.
    expect(reach()).toBe(false);
    edric.skills = [...(edric.skills || []), 'pathfinder'];
    // Forest 1 + forest 1 + plain 1 = 3.
    expect(reach()).toBe(true);
  });
});
