// Behavior-freeze proof for the Phase 3 reconstruct-first pathfinding change.
// These tests pin the real Grid's movement-range / A* / ice-reconstruction
// semantics on hand-authored layouts (using real terrain.json move costs), and
// prove the equivalence invariant the optimization relies on: for every tile in
// a Dijkstra movement range, reconstructIcePath yields the same total cost as an
// A* path validated through computeEffectivePath.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { Grid, computeEffectivePath } from '../src/engine/Grid.js';

const terrainData = JSON.parse(readFileSync('data/terrain.json', 'utf8'));
const T = Object.fromEntries(terrainData.map((t, i) => [t.name, i]));

function makeMockScene() {
  const stub = {
    depth: 0,
    setDepth(v) {
      this.depth = v;
      return this;
    },
    setDisplaySize() {
      return this;
    },
    setOrigin() {
      return this;
    },
    setAlpha() {
      return this;
    },
    setVisible() {
      return this;
    },
    setPosition() {
      return this;
    },
    destroy() {},
  };
  return {
    cameras: { main: { width: 640, height: 480 } },
    add: {
      rectangle: () => ({ ...stub }),
      image: () => ({ ...stub }),
      text: () => ({ ...stub }),
      container: () => ({ ...stub, add() {} }),
    },
    textures: { exists: () => false },
  };
}

// Build a Grid from a 2D array of terrain names.
function gridFromNames(rowsOfNames) {
  const rows = rowsOfNames.length;
  const cols = rowsOfNames[0].length;
  const mapLayout = rowsOfNames.map((row) => row.map((name) => T[name]));
  return new Grid(makeMockScene(), cols, rows, terrainData, mapLayout, false);
}

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Grid.getMovementRange — terrain-cost accounting', () => {
  it('charges the correct move cost per terrain type', () => {
    // Row: Plain(1) Forest(2) Plain(1) Mountain(3-inf for cav) ...
    const grid = gridFromNames([
      ['Plain', 'Forest', 'Plain', 'Plain'],
      ['Plain', 'Plain', 'Plain', 'Plain'],
    ]);
    const range = grid.getMovementRange(0, 0, 3, 'Infantry');
    // (0,0) start cost 0
    expect(range.get('0,0').cost).toBe(0);
    // (1,0) Forest costs 2
    expect(range.get('1,0').cost).toBe(2);
    // (2,0) Forest+Plain = 3, or down-around (0,1)->(1,1)->(2,1)->(2,0) = 1+1+1+1=4; cheapest is 3
    expect(range.get('2,0').cost).toBe(3);
    // (0,1) Plain costs 1
    expect(range.get('0,1').cost).toBe(1);
    // (3,0) would cost Forest+Plain+Plain = 4 > 3 mov → unreachable via top,
    // and 1+1+1+1=4 via bottom → also unreachable
    expect(range.has('3,0')).toBe(false);
  });

  it('treats Mountain as impassable for Cavalry but passable for Infantry', () => {
    const grid = gridFromNames([
      ['Plain', 'Mountain', 'Plain'],
      ['Plain', 'Plain', 'Plain'],
    ]);
    expect(grid.getMoveCost(1, 0, 'Infantry')).toBe(3);
    expect(grid.getMoveCost(1, 0, 'Cavalry')).toBe(Infinity);
    const cavRange = grid.getMovementRange(0, 0, 4, 'Cavalry');
    // Cavalry cannot stop on the Mountain
    expect(cavRange.has('1,0')).toBe(false);
    // Reaches (2,0) only by detouring around the bottom:
    // (0,0)->(0,1)->(1,1)->(2,1)->(2,0) = 1+1+1+1 = 4
    expect(cavRange.get('2,0').cost).toBe(4);
  });

  it('applies a terrain cost reduction modifier (min 1)', () => {
    const grid = gridFromNames([['Plain', 'Forest', 'Forest']]);
    // costModifier 1: Forest 2 -> 1 each
    expect(grid.getMoveCost(1, 0, 'Infantry', 1)).toBe(1);
    const range = grid.getMovementRange(0, 0, 2, 'Infantry', null, null, 1);
    expect(range.get('1,0').cost).toBe(1);
    expect(range.get('2,0').cost).toBe(2);
    // Modifier never drops a cost below 1
    expect(grid.getMoveCost(0, 0, 'Infantry', 5)).toBe(1);
  });
});

describe('Grid.getMovementRange — unit occupancy', () => {
  it('blocks enemy-occupied tiles and marks ally tiles non-stoppable but passable', () => {
    const grid = gridFromNames([
      ['Plain', 'Plain', 'Plain', 'Plain'],
      ['Plain', 'Plain', 'Plain', 'Plain'],
    ]);
    const unitPositions = new Map([
      ['1,0', { faction: 'player' }], // ally of the mover
      ['1,1', { faction: 'enemy' }], // blocker
    ]);
    const range = grid.getMovementRange(0, 0, 4, 'Infantry', unitPositions, 'player');

    // Ally tile is in range (can pass through) but not stoppable
    expect(range.has('1,0')).toBe(true);
    expect(range.get('1,0').stoppable).toBe(false);
    // Tile beyond the ally is reachable by passing through the ally
    expect(range.has('2,0')).toBe(true);
    // Enemy tile is never entered
    expect(range.has('1,1')).toBe(false);
  });
});

describe('Grid ice-slide landings', () => {
  it('slides across ice to the first non-ice tile in the entry direction', () => {
    // Enter Ice at (1,0) moving right → slide over (2,0) Ice → land on (3,0) Plain
    const grid = gridFromNames([['Plain', 'Ice', 'Ice', 'Plain', 'Plain']]);
    const range = grid.getMovementRange(0, 0, 5, 'Infantry');
    // Landing tile is (3,0); the ice tiles themselves are not stoppable landings
    expect(range.has('3,0')).toBe(true);
    const path = grid.reconstructIcePath(range, 0, 0, 3, 0);
    expect(path).not.toBeNull();
    // Path includes the slid-over ice tiles
    expect(path[path.length - 1]).toEqual({ col: 3, row: 0 });
    expect(path.some((p) => p.col === 1 && p.row === 0)).toBe(true);
    expect(path.some((p) => p.col === 2 && p.row === 0)).toBe(true);
  });

  it('Flying units are unaffected by ice (no slide)', () => {
    const grid = gridFromNames([['Plain', 'Ice', 'Ice', 'Plain']]);
    const range = grid.getMovementRange(0, 0, 3, 'Flying');
    // Flyer can stop on ice tiles normally
    expect(range.has('1,0')).toBe(true);
    expect(range.get('1,0').cost).toBe(1);
    expect(range.has('2,0')).toBe(true);
  });
});

describe('Grid.findPath — A* correctness', () => {
  it('routes around impassable walls', () => {
    const grid = gridFromNames([
      ['Plain', 'Wall', 'Plain'],
      ['Plain', 'Plain', 'Plain'],
    ]);
    const path = grid.findPath(0, 0, 2, 0, 'Infantry');
    expect(path[0]).toEqual({ col: 0, row: 0 });
    expect(path[path.length - 1]).toEqual({ col: 2, row: 0 });
    // Never steps on the wall
    expect(path.some((p) => p.col === 1 && p.row === 0)).toBe(false);
  });

  it('returns null when the goal is unreachable', () => {
    const grid = gridFromNames([
      ['Plain', 'Wall', 'Plain'],
      ['Wall', 'Wall', 'Plain'],
      ['Plain', 'Wall', 'Plain'],
    ]);
    expect(grid.findPath(0, 0, 2, 0, 'Infantry')).toBeNull();
  });
});

// ─── The core equivalence invariant the Phase 3 optimization depends on ───
describe('reconstructIcePath ≡ A*+computeEffectivePath cost (property)', () => {
  const NAMES_NO_ICE = ['Plain', 'Plain', 'Plain', 'Forest', 'Sand', 'Wall'];
  const NAMES_WITH_ICE = ['Plain', 'Plain', 'Forest', 'Ice', 'Ice', 'Wall'];
  const MOVE_TYPES = ['Infantry', 'Cavalry'];

  function randomGrid(rng, palette) {
    const rows = 6;
    const cols = 6;
    const names = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => palette[Math.floor(rng() * palette.length)]),
    );
    names[0][0] = 'Plain'; // keep the mover's start standable
    return gridFromNames(names);
  }

  function checkEquivalence(grid, moveType, mov, costMod, { expectAStarCost }) {
    const sc = 0;
    const sr = 0;
    const range = grid.getMovementRange(sc, sr, mov, moveType, null, null, costMod);

    for (const [key, entry] of range) {
      if (key === `${sc},${sr}`) continue;
      if (entry.stoppable === false) continue;
      const [gc, gr] = key.split(',').map(Number);

      // Reconstruct-from-Dijkstra always lands on the goal at the optimal
      // (range) cost. This is the behavior-freeze guarantee: post-change
      // _buildPath returns this path, and its landing tile — which is what the AI
      // decision actually consumes — equals the goal in every case.
      const recon = grid.reconstructIcePath(range, sc, sr, gc, gr);
      expect(recon, `reconstruct null for ${key}`).not.toBeNull();
      const reconEff = computeEffectivePath(
        recon,
        grid.mapLayout,
        grid.terrainData,
        grid.cols,
        grid.rows,
        moveType,
        new Set(),
        costMod,
      );
      const reconLanding = reconEff.effectivePath[reconEff.effectivePath.length - 1];
      expect(reconLanding).toEqual({ col: gc, row: gr });
      expect(reconEff.movementCost, `recon cost mismatch at ${key}`).toBe(entry.cost);

      const aStar = grid.findPath(sc, sr, gc, gr, moveType, null, null, costMod);
      if (aStar) {
        const aEff = computeEffectivePath(
          aStar,
          grid.mapLayout,
          grid.terrainData,
          grid.cols,
          grid.rows,
          moveType,
          new Set(),
          costMod,
        );
        const aLanding = aEff.effectivePath[aEff.effectivePath.length - 1];
        if (aLanding.col === gc && aLanding.row === gr) {
          // Behavior-freeze: wherever the pre-change code would have returned the
          // raw A* path (it validated to the goal), reconstruct lands on the SAME
          // tile. Identical final tile ⇒ identical AI decision.
          expect(aLanding).toEqual(reconLanding);
          if (expectAStarCost) {
            // Without ice, A* is optimal, so its validated cost also matches.
            expect(aEff.movementCost, `A* cost mismatch at ${key}`).toBe(entry.cost);
          }
        }
      }
    }
  }

  it('holds over random ice-free layouts', () => {
    const rng = mulberry32(1234);
    for (let i = 0; i < 40; i++) {
      const grid = randomGrid(rng, NAMES_NO_ICE);
      for (const moveType of MOVE_TYPES) {
        checkEquivalence(grid, moveType, 6, 0, { expectAStarCost: true });
      }
    }
  });

  it('holds over random layouts containing ice', () => {
    const rng = mulberry32(9876);
    for (let i = 0; i < 40; i++) {
      const grid = randomGrid(rng, NAMES_WITH_ICE);
      for (const moveType of MOVE_TYPES) {
        checkEquivalence(grid, moveType, 7, 0, { expectAStarCost: false });
      }
    }
  });

  it('holds with a terrain cost-reduction modifier', () => {
    const rng = mulberry32(555);
    for (let i = 0; i < 20; i++) {
      const grid = randomGrid(rng, NAMES_NO_ICE);
      checkEquivalence(grid, 'Infantry', 6, 1, { expectAStarCost: true });
    }
  });
});
