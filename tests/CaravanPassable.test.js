// The Merchant Caravan never walls the army in: a player unit walks through the
// merchant's tile as through an ally's (never stopping on it), while foes and every other
// NPC still stop at it. A playtest had a General shut in a pocket by a merchant on the
// map's edge.
//
// Ways this goes wrong, each caught below:
//   range      the tiles past the merchant are missing, or its tile is offered as a stop
//   path       findPath refuses the route the range offers
//   others     an enemy (or a non-merchant NPC) starts walking through the merchant
//   preview    the player's position map drops the merchant's mark, so the scene's range
//              still treats it as a wall
//   fog        a merchant the fog hides stops the walk it no longer blocks
//   harness    the headless battle's movement still walls the unit in
// Expected values are worked out by hand on a corridor, never by re-running the code.
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { Grid, computeMovementRange, computePath, walksThrough } from '../src/engine/Grid.js';
import { createPlayerKnowledge, unitPositionEntry } from '../src/engine/PlayerKnowledge.js';
import { passesHiddenUnit } from '../src/engine/PassMovement.js';
import { createCaravanUnit } from '../src/engine/CaravanSystem.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const T = Object.fromEntries(data.terrain.map((t, i) => [t.name, i]));

function mockScene() {
  const stub = new Proxy({}, { get: (t, p) => (p === 'destroy' ? () => {} : () => stub) });
  return {
    cameras: { main: { width: 640, height: 480 } },
    add: { rectangle: () => stub, image: () => stub, text: () => stub, container: () => stub },
    textures: { exists: () => false },
  };
}

/** A 7-tile corridor, row 0 plain. */
function corridor() {
  const map = [Array(7).fill(T.Plain)];
  return new Grid(mockScene(), 7, 1, data.terrain, map, false);
}

const unit = (faction, col, extra = {}) => ({
  name: `${faction}${col}`,
  faction,
  col,
  row: 0,
  currentHP: 20,
  mov: 4,
  stats: { MOV: 4, HP: 20 },
  moveType: 'Infantry',
  skills: [],
  ...extra,
});
const merchant = (col) => createCaravanUnit('act2', { col, row: 0 });
const positionsOf = (...units) =>
  new Map(units.map((u) => [`${u.col},${u.row}`, unitPositionEntry(u)]));
const stoppable = (range) =>
  [...range.entries()]
    .filter(([, entry]) => entry.stoppable !== false)
    .map(([key]) => key)
    .sort();

describe('a player unit walks through the merchant', () => {
  it('ranges past the merchant at full cost, never onto its tile', () => {
    const grid = corridor();
    const m = merchant(2);
    // From column 0 with MOV 4: columns 1..4, the merchant's column 2 walked over, not a stop.
    const range = computeMovementRange(grid, 0, 0, 4, 'Infantry', positionsOf(m), 'player');
    expect(stoppable(range)).toEqual(['0,0', '1,0', '3,0', '4,0']);
    expect(range.get('2,0').stoppable).toBe(false);
    expect(range.get('4,0').cost).toBe(4);
    expect(range.has('5,0')).toBe(false);
  });

  it('findPath walks the same route the range offers', () => {
    const grid = corridor();
    const path = computePath(grid, 0, 0, 4, 0, 'Infantry', positionsOf(merchant(2)), 'player');
    expect(path.map((t) => t.col)).toEqual([0, 1, 2, 3, 4]);
    // An enemy mover finds no way past it.
    expect(computePath(grid, 0, 0, 4, 0, 'Infantry', positionsOf(merchant(2)), 'enemy')).toBe(null);
  });

  it('enemies and non-merchant NPCs are still stopped by it', () => {
    const grid = corridor();
    const foeRange = computeMovementRange(
      grid,
      0,
      0,
      4,
      'Infantry',
      positionsOf(merchant(2)),
      'enemy',
    );
    expect(stoppable(foeRange)).toEqual(['0,0', '1,0']);
    const npcBlock = unit('npc', 2);
    const heroRange = computeMovementRange(
      grid,
      0,
      0,
      4,
      'Infantry',
      positionsOf(npcBlock),
      'player',
    );
    expect(stoppable(heroRange)).toEqual(['0,0', '1,0']);
    expect(walksThrough({ faction: 'npc', isCaravan: true }, 'enemy')).toBe(false);
    expect(walksThrough({ faction: 'npc', isCaravan: true }, 'player')).toBe(true);
    expect(walksThrough({ faction: 'npc' }, 'player')).toBe(false);
  });
});

describe('the player’s view and the fog', () => {
  it('the position map the scene ranges with marks the merchant', () => {
    const m = merchant(2);
    const knowledge = createPlayerKnowledge({
      grid: { fogEnabled: false, isVisible: () => true },
      units: [unit('player', 0), m, unit('enemy', 5)],
    });
    const positions = knowledge.positions();
    expect(positions.get('2,0')).toEqual({ faction: 'npc', isCaravan: true });
    expect(positions.get('5,0')).toEqual({ faction: 'enemy' });
    const range = computeMovementRange(corridor(), 0, 0, 4, 'Infantry', positions, 'player');
    expect(stoppable(range)).toEqual(['0,0', '1,0', '3,0', '4,0']);
  });

  it('a merchant hidden in fog does not stop a player’s walk; other hidden NPCs still do', () => {
    const hero = unit('player', 0);
    expect(passesHiddenUnit(hero, merchant(2))).toBe(true);
    expect(passesHiddenUnit(hero, unit('npc', 2))).toBe(false);
    expect(passesHiddenUnit(unit('enemy', 0), merchant(2))).toBe(false);
  });
});

describe('the headless harness', () => {
  it('moves a unit past a merchant that fills the corridor', () => {
    installSeed(12345);
    try {
      const battle = new HeadlessBattle(data, { act: 'act1', objective: 'rout', row: 2 });
      battle.init();
      const { grid } = battle;
      grid.mapLayout = Array.from({ length: grid.rows }, (_, row) =>
        Array(grid.cols).fill(row === 2 ? T.Plain : T.Wall),
      );
      const me = battle.playerUnits[0];
      Object.assign(me, { col: 1, row: 2, skills: [], benchedSkills: [] });
      me.stats.MOV = 4;
      me.mov = 4;
      battle.playerUnits.slice(1).forEach((u, i) => Object.assign(u, { col: 10 + i, row: 0 }));
      battle.enemyUnits.forEach((u, i) => Object.assign(u, { col: 10 + i, row: 8 }));
      const m = createCaravanUnit('act2', { col: 2, row: 2 });
      battle.npcUnits.push(m);
      battle.selectUnit(me.name);
      expect(battle.movementRange.get('2,2').stoppable).toBe(false);
      expect(() => battle.moveTo(2, 2)).toThrow(/not reachable/);
      battle.moveTo(4, 2);
      expect([me.col, me.row]).toEqual([4, 2]);
      expect([m.col, m.row]).toEqual([2, 2]);
    } finally {
      restoreMathRandom();
    }
  });
});
