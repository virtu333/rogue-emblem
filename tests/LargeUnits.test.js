// Big bodies (docs/specs/large-units.md): any unit with a `footprint` larger than one tile
// stands on, blocks, is seen on, is measured from and is struck at every tile of its body, the
// way the Entity's 3x3 always was; it never walks and is never pushed.
//
// Ways this goes wrong:
//   - a 2x2 is measured from its top-left anchor (a lancer beside its far side cannot reach it,
//     or it strikes from the wrong tile), or only its anchor blocks a walk or a placement;
//   - a body tile the fog shows does not show the unit, so the player cannot target it;
//   - a push, ram or Smite moves its anchor and leaves the rest of it behind;
//   - the AI walks it like a one-tile unit (a path from the anchor through tiles it already
//     fills), or the Danger overlay draws it as a walker;
//   - a malformed footprint makes a unit fill a strange shape instead of one tile;
//   - the Entity's own 3x3 changes on the way.
// Expected values are worked out by hand from the board below.
import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { Grid } from '../src/engine/Grid.js';
import {
  bodyCenter,
  combatDistance,
  footprintSize,
  getFootprint,
  isLargeUnit,
} from '../src/engine/EntitySystem.js';
import { displacementBlockReason } from '../src/engine/ForcedMovement.js';
import { resolvePostCombatMove } from '../src/engine/WeaponArtPostCombat.js';
import { createPlayerKnowledge } from '../src/engine/PlayerKnowledge.js';
import { isUnitSeenAt } from '../src/engine/BattleInformation.js';
import { enemyThreatTiles, unitReach } from '../src/engine/ThreatForecast.js';
import { occupiedUnitTiles } from '../src/engine/ReinforcementSpawns.js';
import { AIController } from '../src/engine/AIController.js';
import { predictEnemyIntents } from '../src/engine/EnemyIntent.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const PLAIN = gameData.terrain.findIndex((t) => t.name === 'Plain');

function mockScene() {
  const stub = new Proxy({}, { get: (t, prop) => (prop === 'destroy' ? () => {} : () => stub) });
  return {
    cameras: { main: { width: 640, height: 480 } },
    add: { rectangle: () => stub, image: () => stub, text: () => stub, container: () => stub },
    textures: { exists: () => false },
  };
}
const plainGrid = (cols, rows, { fog = false } = {}) =>
  new Grid(
    mockScene(),
    cols,
    rows,
    gameData.terrain,
    Array.from({ length: rows }, () => Array(cols).fill(PLAIN)),
    fog,
  );

const ironLance = () => structuredClone(gameData.weapons.find((w) => w.name === 'Iron Lance'));
const guardianAt = (col, row, extra = {}) => ({
  name: 'Iron Guardian',
  className: 'Fighter',
  faction: 'enemy',
  footprint: { width: 2, height: 2 },
  col,
  row,
  level: 10,
  currentHP: 80,
  mov: 4, // a body never walks, whatever its MOV says
  stats: { HP: 80, STR: 14, MAG: 0, SKL: 8, SPD: 4, DEF: 12, RES: 2, LCK: 0, MOV: 4 },
  moveType: 'Infantry',
  weapon: ironLance(),
  inventory: [ironLance()],
  skills: [],
  ...extra,
});
const soldierAt = (col, row, faction = 'player', extra = {}) => ({
  name: `${faction}-${col}-${row}`,
  className: 'Soldier',
  faction,
  col,
  row,
  level: 5,
  currentHP: 20,
  mov: 5,
  stats: { HP: 20, STR: 6, MAG: 0, SKL: 5, SPD: 5, DEF: 4, RES: 1, LCK: 2, MOV: 5 },
  moveType: 'Infantry',
  weapon: ironLance(),
  inventory: [ironLance()],
  skills: [],
  ...extra,
});
const sorted = (set) => [...set].sort((a, b) => a.localeCompare(b));
const keys = (tiles) => sorted(tiles.map((t) => `${t.col},${t.row}`));

describe('a body and its tiles', () => {
  it('a 2x2 footprint fills four tiles from its top-left anchor', () => {
    const g = guardianAt(5, 3);
    expect(footprintSize(g)).toEqual({ width: 2, height: 2 });
    expect(isLargeUnit(g)).toBe(true);
    expect(keys(getFootprint(g))).toEqual(['5,3', '5,4', '6,3', '6,4']);
    expect(bodyCenter(g)).toEqual({ col: 5.5, row: 3.5 });
  });

  it('the Entity keeps its 3x3 whatever footprint it carries', () => {
    const entity = { isEntity: true, col: 2, row: 2, footprint: { width: 2, height: 2 } };
    expect(footprintSize(entity)).toEqual({ width: 3, height: 3 });
    expect(getFootprint(entity)).toHaveLength(9);
  });

  it('a malformed footprint is one tile', () => {
    for (const footprint of [
      { width: 0, height: 2 },
      { width: 4, height: 1 },
      { width: 1.5, height: 2 },
      { width: '2', height: '2' },
      null,
      [2, 2],
    ]) {
      const u = { col: 1, row: 1, footprint };
      expect(footprintSize(u)).toEqual({ width: 1, height: 1 });
      expect(isLargeUnit(u)).toBe(false);
      expect(getFootprint(u)).toEqual([{ col: 1, row: 1 }]);
    }
  });

  it('distance is measured from the nearest body tile, never the anchor', () => {
    const g = guardianAt(5, 3); // body 5-6 x 3-4
    expect(combatDistance(g, soldierAt(7, 4))).toBe(1); // beside its far side (anchor: 3)
    expect(combatDistance(soldierAt(6, 5), g)).toBe(1); // below it (anchor: 3)
    expect(combatDistance(g, soldierAt(8, 6))).toBe(4); // from (6,4): 2 + 2
    expect(combatDistance(g, soldierAt(4, 3))).toBe(1);
    // Two bodies: the nearest pair of tiles. (8,3)-(9,4) against 5-6 x 3-4: 2 apart.
    expect(combatDistance(g, guardianAt(8, 3))).toBe(2);
  });

  it('every tile of the body is a tile a unit stands on', () => {
    expect(keys(occupiedUnitTiles([guardianAt(5, 3)]))).toEqual(['5,3', '5,4', '6,3', '6,4']);
    const knowledge = createPlayerKnowledge({ grid: plainGrid(10, 8), units: [guardianAt(5, 3)] });
    expect(sorted(knowledge.positions().keys())).toEqual(['5,3', '5,4', '6,3', '6,4']);
  });

  it('a player walk goes around the whole body', () => {
    const grid = plainGrid(10, 8);
    const knowledge = createPlayerKnowledge({ grid, units: [guardianAt(5, 3)] });
    const range = grid.getMovementRange(4, 4, 5, 'Infantry', knowledge.positions(), 'player', 0);
    for (const tile of ['5,3', '5,4', '6,3', '6,4']) expect(range.has(tile)).toBe(false);
    // (7,4) is reached around the body: up and over or down and under, 5 steps either way.
    expect(range.has('7,4')).toBe(true);
  });

  it('the fog shows the unit when any tile of its body is in sight', () => {
    const grid = plainGrid(10, 8, { fog: true });
    const g = guardianAt(5, 3);
    grid.isVisible = (col, row) => col === 6 && row === 4; // only its lower-right tile
    expect(isUnitSeenAt(grid, g)).toBe(true);
    grid.isVisible = (col, row) => col === 7 && row === 4; // beside it, not on it
    expect(isUnitSeenAt(grid, g)).toBe(false);
  });
});

describe('a body is never moved by another unit', () => {
  it('Smite and Override refuse it (displacementBlockReason)', () => {
    expect(displacementBlockReason(guardianAt(5, 3), {})).toBe('large');
    expect(displacementBlockReason({ isEntity: true, col: 1, row: 1 }, {})).toBe('entity');
    expect(displacementBlockReason(soldierAt(1, 1, 'enemy'), {})).toBeNull();
  });

  it("a weapon art's push, swap or ram never moves it", () => {
    const user = soldierAt(4, 3);
    const g = guardianAt(5, 3);
    const units = [user, g];
    const getUnitAt = (col, row) =>
      units.find((u) => getFootprint(u).some((t) => t.col === col && t.row === row)) || null;
    for (const mode of ['push', 'swap']) {
      const result = resolvePostCombatMove({
        mode,
        sourceUnit: user,
        targetUnit: g,
        cols: 10,
        rows: 8,
        getMoveCost: () => 1,
        getUnitAt,
      });
      expect(result.ok, mode).toBe(false);
      expect(result.reason, mode).toBe('immovable');
    }
  });
});

describe('a body fights where it stands', () => {
  const world = () => {
    const grid = plainGrid(12, 9);
    const g = guardianAt(5, 3);
    return { grid, g };
  };

  it('its threat is its weapon reach from its body: the eight tiles around a 2x2, no walk', () => {
    const { grid, g } = world();
    const ctx = {
      grid,
      enemyUnits: [g],
      ballistas: [],
      positions: () => new Map(),
      costModifier: () => 0,
    };
    const { damage } = enemyThreatTiles(ctx, g);
    // Range 1 from 5-6 x 3-4: the edge neighbours only, never a diagonal corner or the body.
    expect(sorted(damage)).toEqual(
      sorted(['5,2', '6,2', '5,5', '6,5', '4,3', '4,4', '7,3', '7,4']),
    );
    const reach = unitReach(grid, g, { mov: 4, positions: new Map() });
    expect(keys(reach.attackTiles)).toEqual(sorted([...damage]));
  });

  it('the AI never walks it and strikes a unit beside its far side', async () => {
    const { grid, g } = world();
    const target = soldierAt(7, 4); // beside (6,4); the anchor is 3 away
    const ai = new AIController(grid, {}, { objective: 'rout' });
    ai._delay = () => Promise.resolve();
    const calls = [];
    const decision = await ai._processOneEnemy(g, [g], [target], [], {
      onMoveUnit: async () => calls.push('move'),
      onAttack: async (unit, foe) => calls.push(`attack:${foe.name}`),
      onUnitDone: async () => calls.push('done'),
    });
    expect(calls).toEqual([`attack:${target.name}`, 'done']);
    expect(decision.path).toBeNull();
    expect({ col: g.col, row: g.row }).toEqual({ col: 5, row: 3 });
  });

  it('with nobody in reach it holds and strikes no one (it never steps toward them)', async () => {
    const { grid, g } = world();
    const ai = new AIController(grid, {}, { objective: 'rout' });
    ai._delay = () => Promise.resolve();
    const calls = [];
    await ai._processOneEnemy(g, [g], [soldierAt(10, 8)], [], {
      onMoveUnit: async () => calls.push('move'),
      onAttack: async () => calls.push('attack'),
      onUnitDone: async () => calls.push('done'),
    });
    expect(calls).toEqual(['done']);
  });

  it('another enemy never stops on its body (it may pass through, as allies do)', () => {
    const { grid, g } = world();
    // A runner at (3,4) with the reach to stand anywhere around the player at (7,4): the tile
    // beside it on the left, (6,4), is the Guardian's, so it must take another side.
    const runner = soldierAt(3, 4, 'enemy', {
      mov: 6,
      stats: { ...soldierAt(0, 0).stats, MOV: 6 },
    });
    const target = soldierAt(7, 4);
    const ai = new AIController(grid, {}, { objective: 'rout', aggressiveMode: true });
    const decision = ai._decideAction(runner, [runner, g], [target], []);
    expect(decision.target).toBe(target);
    const end = decision.path[decision.path.length - 1];
    expect(['5,3', '5,4', '6,3', '6,4']).not.toContain(`${end.col},${end.row}`);
    expect(Math.abs(end.col - 7) + Math.abs(end.row - 4)).toBe(1);
  });

  it('the intent preview says it attacks the unit beside it, without a move', () => {
    const { grid, g } = world();
    const target = soldierAt(6, 5);
    const ai = new AIController(grid, {}, { objective: 'rout' });
    const intents = predictEnemyIntents({
      ai,
      ctx: {
        grid,
        enemyUnits: [g],
        positions: () => new Map(),
        costModifier: () => 0,
        ballistas: [],
      },
      playerUnits: [target],
    });
    expect(intents.get(g)).toMatchObject({ kind: 'attack', target });
  });
});
