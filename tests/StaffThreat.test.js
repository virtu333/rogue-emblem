// A staff heals or hexes but never strikes: a unit whose only weapon is a staff must
// not read as a damage threat. Every enemy Cleric (act 2 on) spawns holding Heal.
import { describe, it, expect, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { Grid } from '../src/engine/Grid.js';
import {
  computeDangerTiles,
  threatsOnTile,
  threatSummaryText,
  unitReach,
} from '../src/engine/ThreatForecast.js';
import { createEnemyUnit, createPromotedEnemyUnit } from '../src/engine/UnitManager.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const T = Object.fromEntries(data.terrain.map((t, i) => [t.name, i]));
const cls = (name) => data.classes.find((c) => c.name === name);

function mockScene() {
  const stub = new Proxy({}, { get: (t, p) => (p === 'destroy' ? () => {} : () => stub) });
  return {
    cameras: { main: { width: 640, height: 480 } },
    add: { rectangle: () => stub, image: () => stub, text: () => stub, container: () => stub },
    textures: { exists: () => false },
  };
}
const plainGrid = (size) =>
  new Grid(
    mockScene(),
    size,
    size,
    data.terrain,
    Array.from({ length: size }, () => Array(size).fill(T.Plain)),
    false,
  );
const ctxFor = (grid, enemies) => ({
  grid,
  enemyUnits: enemies,
  ballistas: [],
  positions: () => new Map(enemies.map((u) => [`${u.col},${u.row}`, { faction: u.faction }])),
});

function cleric(col, row) {
  const unit = createEnemyUnit(cls('Cleric'), 7, data.weapons, 1.0, null, 'act2');
  return Object.assign(unit, { col, row, aiMode: 'heal' });
}

describe('Staff-only units threaten no damage', () => {
  it('a generated enemy Cleric carries only Heal (the case that matters)', () => {
    const unit = cleric(0, 0);
    expect(unit.weapon.name).toBe('Heal');
    expect(unit.inventory.map((w) => w.name)).toEqual(['Heal']);
  });

  it('adds no Danger tiles and no source to a tile beside it', () => {
    const grid = plainGrid(11);
    const unit = cleric(5, 5);
    const ctx = ctxFor(grid, [unit]);
    expect(computeDangerTiles(ctx)).toEqual([]);
    const beside = threatsOnTile(ctx, 5, 4);
    expect(beside.count).toBe(0);
    expect(beside.damage).toEqual([]);
    expect(threatSummaryText(beside)).toBe('No foe can reach');
  });

  it('draws no red attack fringe when inspected (enemy or player Cleric)', () => {
    const grid = plainGrid(11);
    const unit = cleric(5, 5);
    const reach = unitReach(grid, unit, { mov: unit.stats.MOV, positions: new Map() });
    expect(reach.moveRange.size).toBeGreaterThan(1);
    expect(reach.attackTiles).toEqual([]);
    const ally = { ...unit, faction: 'player' };
    expect(unitReach(grid, ally, { mov: 0, positions: new Map() }).attackTiles).toEqual([]);
  });

  it('still counts a Sage’s tome as damage and its status staff as status reach', () => {
    const grid = plainGrid(11);
    const sage = createPromotedEnemyUnit(
      cls('Sage'),
      12,
      data.weapons,
      1.0,
      null,
      'act3',
      data.classes,
    );
    expect(sage.weapon.type).not.toBe('Staff');
    sage.statusStaff = structuredClone(data.weapons.find((w) => w.name === 'Lullaby Staff'));
    Object.assign(sage, { col: 5, row: 5, mov: 0 });
    sage.stats.MOV = 0;
    const tiles = computeDangerTiles(ctxFor(grid, [sage]));
    const at = (c, r) => tiles.find((t) => t.col === c && t.row === r);
    expect(at(5, 4)).toMatchObject({ count: 1, damageThreat: true });
    expect(at(5, 1)).toMatchObject({ count: 0, damageThreat: false, statusThreat: true });
  });
});
