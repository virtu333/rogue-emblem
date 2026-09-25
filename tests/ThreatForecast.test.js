import { describe, it, expect, vi, afterEach } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { BattleScene } from '../src/scenes/BattleScene.js';
import { Grid } from '../src/engine/Grid.js';
import {
  computeDangerTiles,
  threatsOnTile,
  threatWorldSignature,
  threatSummaryText,
  positionsWithMoverAt,
  isThreatSourceVisible,
} from '../src/engine/ThreatForecast.js';
import { applyCondition } from '../src/engine/StatusConditionSystem.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const T = Object.fromEntries(gameData.terrain.map((t, i) => [t.name, i]));

function mockScene() {
  const stub = new Proxy(
    {},
    { get: (target, prop) => (prop === 'destroy' ? () => {} : () => stub) },
  );
  return {
    cameras: { main: { width: 640, height: 480 } },
    add: { rectangle: () => stub, image: () => stub, text: () => stub, container: () => stub },
    textures: { exists: () => false },
  };
}

// '.' plain, '#' wall, 'f' forest
function grid(rows, { fog = false } = {}) {
  const map = rows.map((line) =>
    [...line].map((ch) => (ch === '#' ? T.Wall : ch === 'f' ? T.Forest : T.Plain)),
  );
  return new Grid(mockScene(), map[0].length, map.length, gameData.terrain, map, fog);
}

const foe = (col, row, extra = {}) => ({
  name: 'Fighter',
  faction: 'enemy',
  col,
  row,
  currentHP: 20,
  mov: 4,
  stats: { MOV: 4, HP: 20 },
  moveType: 'Infantry',
  weapon: { name: 'Iron Axe', type: 'Axe', range: '1' },
  ...extra,
});
const ally = (col, row, extra = {}) => ({
  name: 'Sera',
  faction: 'player',
  col,
  row,
  currentHP: 18,
  mov: 4,
  stats: { MOV: 4, HP: 18 },
  moveType: 'Infantry',
  ...extra,
});

function ctxFor(g, units, { ballistas = [] } = {}) {
  return {
    grid: g,
    enemyUnits: units.filter((u) => u.faction === 'enemy'),
    ballistas,
    positions: () => {
      const map = new Map();
      for (const u of units) {
        if (u.currentHP > 0) map.set(`${u.col},${u.row}`, { faction: u.faction });
      }
      return map;
    },
    costModifier: () => 0,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('ThreatForecast — one computation for Danger and threat sight', () => {
  it('BattleScene.calculateDangerZone is the engine computation', () => {
    const g = grid(['..........', '..........', '..........', '..........']);
    const units = [foe(7, 1), foe(8, 2, { weapon: { range: '1-2' } }), ally(1, 1)];
    const scene = new BattleScene();
    scene.grid = g;
    scene.enemyUnits = units.filter((u) => u.faction === 'enemy');
    scene.playerUnits = units.filter((u) => u.faction === 'player');
    scene.npcUnits = [];
    scene.ballistas = [];
    scene.gameData = { skills: [] };
    const fromScene = scene.calculateDangerZone();
    const fromEngine = computeDangerTiles(ctxFor(g, units));
    const norm = (tiles) =>
      tiles.map((t) => `${t.col},${t.row}:${t.count}`).sort((a, b) => a.localeCompare(b));
    expect(norm(fromScene)).toEqual(norm(fromEngine));
    expect(fromScene.length).toBeGreaterThan(10);
  });

  it('agrees with the Danger overlay tile by tile when nothing moves', () => {
    const g = grid(['..........', '...f......', '..........', '....#.....', '..........']);
    const units = [foe(8, 0), foe(9, 4, { weapon: { range: '2' } }), foe(6, 2), ally(2, 2)];
    const ctx = ctxFor(g, units);
    const danger = new Map(computeDangerTiles(ctx).map((t) => [`${t.col},${t.row}`, t.count]));
    for (let row = 0; row < g.rows; row++) {
      for (let col = 0; col < g.cols; col++) {
        // Asking about a tile nobody moves to must match the global overlay count.
        const result = threatsOnTile(ctx, col, row);
        expect(result.count).toBe(danger.get(`${col},${row}`) || 0);
      }
    }
  });

  it('lists exactly the enemies that can reach the tile', () => {
    const g = grid(['............', '............', '............']);
    const near = foe(6, 1);
    const far = foe(11, 1, { mov: 1, stats: { MOV: 1 } });
    const ctx = ctxFor(g, [near, far, ally(0, 1)]);
    const result = threatsOnTile(ctx, 3, 1, { mover: null });
    expect(result.damage).toEqual([near]);
    expect(result.count).toBe(1);
    expect(threatsOnTile(ctx, 0, 0).count).toBe(0);
  });

  it('evaluates the move: leaving a chokepoint opens the path behind it', () => {
    // Wall with a single gap at (3,1). Sera plugs the gap; the enemy waits east.
    const g = grid(['...#......', '..........', '...#......']);
    const sera = ally(3, 1);
    const enemy = foe(6, 1, { mov: 5, stats: { MOV: 5 } });
    const ctx = ctxFor(g, [sera, enemy]);
    // While Sera plugs the gap, the tiles west of it are safe...
    expect(threatsOnTile(ctx, 1, 0).count).toBe(0);
    expect(computeDangerTiles(ctx).some((t) => t.col === 1 && t.row === 0)).toBe(false);
    // ...but if Sera herself moves to (1,0), the gap opens and (1,0) is reachable.
    const moved = threatsOnTile(ctx, 1, 0, { mover: sera });
    expect(moved.damage).toEqual([enemy]);
  });

  it('a destination occupied by the mover can still be struck, but blocks paths through it', () => {
    const g = grid(['#########', '.........', '#########']);
    const sera = ally(0, 1);
    const enemy = foe(6, 1, { mov: 5, stats: { MOV: 5 } });
    const ctx = ctxFor(g, [sera, enemy]);
    // Sera moves into the corridor at (3,1): the enemy stops at (4,1) and strikes her.
    expect(threatsOnTile(ctx, 3, 1, { mover: sera }).damage).toEqual([enemy]);
    // With Sera at (3,1) blocking the corridor, the enemy cannot get past her.
    const positions = positionsWithMoverAt(ctx.positions(), sera, 3, 1);
    expect(positions.has('0,1')).toBe(false);
    expect(positions.get('3,1')).toEqual({ faction: 'player' });
  });

  it('never counts fog-hidden enemies, and says fog may hide more', () => {
    const g = grid(['..........', '..........'], { fog: true });
    const seen = foe(4, 0);
    const hidden = foe(4, 1);
    g.isVisible = (col, row) => row === 0;
    const ctx = ctxFor(g, [seen, hidden, ally(1, 0)]);
    expect(isThreatSourceVisible(g, hidden)).toBe(false);
    const result = threatsOnTile(ctx, 2, 1);
    expect(result.damage).toEqual([seen]);
    expect(result.fogged).toBe(true);
    expect(threatSummaryText(result)).toBe('1 can reach · fog may hide more');
  });

  it('respects roots that last through the enemy phase', () => {
    const g = grid(['..........']);
    const rooted = foe(6, 0);
    applyCondition(rooted, 'root', 2);
    const ctx = ctxFor(g, [rooted]);
    expect(threatsOnTile(ctx, 5, 0).count).toBe(1);
    expect(threatsOnTile(ctx, 4, 0).count).toBe(0);
  });

  it('separates status-staff reach from damage and counts ballistas', () => {
    const g = grid(['..........', '..........', '..........']);
    const staffer = foe(8, 1, {
      weapon: null,
      statusStaff: { name: 'Sleep', type: 'Staff', range: '1-3', uses: 3, statusEffect: 'sleep' },
    });
    const ballista = { col: 0, row: 0, owner: 'enemy' };
    const ctx = ctxFor(g, [staffer], { ballistas: [ballista] });
    const result = threatsOnTile(ctx, 2, 1);
    expect(result.status).toEqual([staffer]);
    expect(result.damage).toEqual([]);
    expect(result.ballistas).toEqual([ballista]);
    expect(result.count).toBe(1);
    expect(threatSummaryText(result)).toBe('1 can reach · 1 staff');
  });

  it('entities strike from their footprint without moving', () => {
    const g = grid(['..........', '..........', '..........', '..........']);
    const entity = foe(5, 1, { isEntity: true });
    const ctx = ctxFor(g, [entity]);
    const spy = vi.spyOn(g, 'getMovementRange');
    expect(threatsOnTile(ctx, 3, 1).damage).toEqual([entity]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('never draws from Math.random', () => {
    const g = grid(['..........', '..........', '..........']);
    const ctx = ctxFor(g, [foe(7, 1), foe(8, 2), ally(1, 1)]);
    const random = vi.spyOn(Math, 'random');
    computeDangerTiles(ctx);
    threatsOnTile(ctx, 4, 1, { mover: ctx.enemyUnits[0] });
    threatWorldSignature(ctx, ctx.enemyUnits);
    expect(random).not.toHaveBeenCalled();
  });

  it('world signature changes only when a threat input changes', () => {
    const g = grid(['..........']);
    const enemy = foe(6, 0);
    const units = [enemy, ally(1, 0)];
    const ctx = ctxFor(g, units);
    const before = threatWorldSignature(ctx, units);
    expect(threatWorldSignature(ctx, units)).toBe(before);
    enemy.col = 5;
    const moved = threatWorldSignature(ctx, units);
    expect(moved).not.toBe(before);
    applyCondition(enemy, 'root', 2);
    expect(threatWorldSignature(ctx, units)).not.toBe(moved);
    const rooted = threatWorldSignature(ctx, units);
    enemy.currentHP = 0;
    expect(threatWorldSignature(ctx, units)).not.toBe(rooted);
  });

  it('summaries read plainly', () => {
    expect(threatSummaryText({ count: 0, status: [], fogged: false })).toBe('No foe can reach');
    expect(threatSummaryText({ count: 2, status: [], fogged: false })).toBe('2 can reach');
    expect(threatSummaryText(null)).toBe('');
  });
});
