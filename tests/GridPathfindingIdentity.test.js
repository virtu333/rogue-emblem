// Identity proof for the heap pathfinding (docs/specs/large-maps/02-encounters-and-pacing.md
// §2.3, §2.4): computePath, computeMovementRange and the AI's shortest-path searches return
// exactly what the sorted-array / exhaustive versions they replaced returned, ties included.
//
// The replaced versions are kept, as references only, in tests/pathfindingReference.js.
// Each property runs both over seeded random boards (every terrain, ice fields, walls, occupancy of every
// faction, Pass, terrain cost reduction, every move type, an unknown move type, goals off
// the board, on the start or under a unit) and over generated battle maps.
//
// Ways the change could fail, and what catches each:
// - the heap pops equal-f entries in another order than the stable sort + shift() did, so
//   a different equal-cost path comes back: path identity (and the corpus check that a
//   LIFO tie order would be caught);
// - skipping stale entries or the early exit returns null, or a different path, where the
//   flood would have found one: path identity on blocked, impassable and off-board goals;
// - the typed-array indexing mixes tiles up or rebuilds the path wrongly (start off the
//   board, 1-wide boards): path identity;
// - the movement range's heap reorders arrivals, changing parents, slides or stops:
//   the whole range, entries in insertion order;
// - the branch and bound prunes a tile whose path would have won, or the memo hands back
//   a path for the wrong tile: recovery and chase decisions, identical objects.
import { describe, it, expect } from 'vitest';
import { computePath, computeMovementRange } from '../src/engine/Grid.js';
import { AIController } from '../src/engine/AIController.js';
import { getTerrainCostReduction } from '../src/engine/SkillSystem.js';
import { generateBattle } from '../src/engine/MapGenerator.js';
import { HeadlessGrid } from './harness/HeadlessGrid.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';
import {
  referenceComputePath,
  referenceComputeMovementRange,
  referencePathAwareChaseTile,
  referenceRecoveryFallbackTile,
} from './pathfindingReference.js';

// The references are the slow algorithms being replaced; a loaded CI box needs room.
const TIMEOUT = 60_000;

const gameData = loadGameData();
const terrainData = gameData.terrain;
const T = Object.fromEntries(terrainData.map((t, i) => [t.name, i]));
const MOVE_TYPES = ['Infantry', 'Cavalry', 'Armored', 'Flying'];
const FACTIONS = ['player', 'enemy', 'npc'];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

// Terrain mixes: open ground, rough country, an ice field, a walled maze, uniform cost
// (the most ties) and every terrain at once.
const MIXES = [
  { Plain: 70, Forest: 10, Mountain: 5, Wall: 5, Water: 5, Ice: 5 },
  { Plain: 30, Forest: 20, Mountain: 10, Sand: 10, Swamp: 10, Bog: 10, Water: 5, Wall: 5 },
  { Plain: 40, Ice: 45, Wall: 10, Water: 5 },
  { Floor: 55, Wall: 35, Pillar: 5, Ice: 5 },
  { Plain: 100 },
  Object.fromEntries(terrainData.map((t) => [t.name, 1])),
];

function randomBoard(rng) {
  const cols = rng() < 0.08 ? 1 : int(rng, 2, 30);
  const rows = rng() < 0.08 ? 1 : int(rng, 2, 20);
  const mix = Object.entries(pick(rng, MIXES));
  const total = mix.reduce((s, [, w]) => s + w, 0);
  const terrainAt = () => {
    let roll = rng() * total;
    for (const [name, weight] of mix) {
      roll -= weight;
      if (roll < 0) return T[name];
    }
    return T[mix[mix.length - 1][0]];
  };
  const mapLayout = Array.from({ length: rows }, () => Array.from({ length: cols }, terrainAt));
  const grid = new HeadlessGrid(cols, rows, terrainData, mapLayout);
  const density = pick(rng, [0, 0.05, 0.15, 0.3]);
  const unitPositions = new Map();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (rng() < density) unitPositions.set(`${c},${r}`, { faction: pick(rng, FACTIONS) });
    }
  }
  return { grid, unitPositions };
}

let generatedBoardsCache = null;
function generatedBoards() {
  if (generatedBoardsCache) return generatedBoardsCache;
  const boards = [];
  for (const size of ['18x13', '24x16']) {
    const [cols, rows] = size.split('x').map(Number);
    for (let seed = 1; seed <= 4; seed++) {
      installSeed(seed * 31);
      try {
        const gd = loadGameData();
        gd.mapSizes = ['Act 1', 'Act 2', 'Act 3', 'Act 4'].map((p) => ({
          phase: `${p} (B)`,
          mapSize: size,
          tiles: cols * rows,
        }));
        const config = generateBattle(
          {
            act: pick(mulberry32(seed), ['act1', 'act2', 'act3', 'act4']),
            objective: ['rout', 'seize', 'escape'][seed % 3],
            difficultyId: 'normal',
            deployCount: 7,
            row: 4,
          },
          gd,
        );
        const grid = new HeadlessGrid(config.cols, config.rows, terrainData, config.mapLayout);
        const unitPositions = new Map();
        for (const p of config.playerSpawns)
          unitPositions.set(`${p.col},${p.row}`, { faction: 'player' });
        for (const e of config.enemySpawns)
          unitPositions.set(`${e.col},${e.row}`, { faction: 'enemy' });
        for (const n of config.npcSpawns || [])
          unitPositions.set(`${n.col},${n.row}`, { faction: 'npc' });
        boards.push({ grid, unitPositions, spawns: config.enemySpawns });
      } finally {
        restoreMathRandom();
      }
    }
  }
  generatedBoardsCache = boards;
  return boards;
}

/** One random query's arguments (after the grid). */
function randomPathQuery(rng, grid, unitPositions, { allowUnknownMoveType = true } = {}) {
  const tile = () => ({ col: int(rng, 0, grid.cols - 1), row: int(rng, 0, grid.rows - 1) });
  const occupied = [...unitPositions.keys()];
  let start = tile();
  if (rng() < 0.03)
    start = pick(rng, [
      { col: -1, row: 0 },
      { col: grid.cols, row: grid.rows - 1 },
    ]);
  let goal;
  const g = rng();
  if (g < 0.08) goal = { ...start };
  else if (g < 0.13)
    goal = pick(rng, [
      { col: -1, row: 0 },
      { col: 0, row: grid.rows },
      { col: grid.cols + 2, row: 1 },
    ]);
  else if (g < 0.25 && occupied.length) {
    const [c, r] = pick(rng, occupied).split(',').map(Number);
    goal = { col: c, row: r };
  } else goal = tile();
  const moveType = allowUnknownMoveType && rng() < 0.03 ? 'Mystery' : pick(rng, MOVE_TYPES);
  const positions = rng() < 0.1 ? null : unitPositions;
  const moverFaction = pick(rng, ['enemy', 'enemy', 'player', 'npc', null]);
  const costModifier = pick(rng, [0, 0, 0, 1, 2]);
  const options = rng() < 0.3 ? { pass: true } : pick(rng, [null, {}, { pass: false }]);
  return [
    start.col,
    start.row,
    goal.col,
    goal.row,
    moveType,
    positions,
    moverFaction,
    costModifier,
    options,
  ];
}

const show = (value) => JSON.stringify(value);

describe("computePath (binary-heap A*) returns the sorted-array search's exact paths", () => {
  it(
    'on seeded random boards: every terrain, ice, occupancy, Pass, cost reduction, odd goals',
    () => {
      const rng = mulberry32(0xa57a2);
      let queries = 0;
      let found = 0;
      let lifoDiffers = 0;
      const mismatches = [];
      for (let b = 0; b < 300; b++) {
        const { grid, unitPositions } = randomBoard(rng);
        for (let q = 0; q < 30; q++) {
          const args = randomPathQuery(rng, grid, unitPositions);
          const expected = referenceComputePath(grid, ...args);
          const actual = computePath(grid, ...args);
          queries++;
          if (expected) found++;
          if (show(actual) !== show(expected)) mismatches.push({ b, q, args, expected, actual });
          if (show(referenceComputePath(grid, ...args, 'lifo')) !== show(expected)) lifoDiffers++;
        }
      }
      expect(mismatches.slice(0, 3)).toEqual([]);
      expect(queries).toBe(9000);
      expect(found).toBeGreaterThan(4500);
      // The corpus is tie-sensitive: popping equal-f entries in another order is caught.
      expect(lifoDiffers).toBeGreaterThan(1500);
    },
    TIMEOUT,
  );

  it(
    'on generated battle maps, from every enemy spawn, for every move type',
    () => {
      const rng = mulberry32(0xb0a7d);
      let queries = 0;
      const mismatches = [];
      for (const { grid, unitPositions, spawns } of generatedBoards()) {
        for (const spawn of spawns) {
          for (let q = 0; q < 6; q++) {
            const goal = { col: int(rng, 0, grid.cols - 1), row: int(rng, 0, grid.rows - 1) };
            for (const moveType of MOVE_TYPES) {
              const args = [
                spawn.col,
                spawn.row,
                goal.col,
                goal.row,
                moveType,
                unitPositions,
                'enemy',
                0,
                null,
              ];
              const expected = referenceComputePath(grid, ...args);
              const actual = computePath(grid, ...args);
              queries++;
              if (show(actual) !== show(expected)) mismatches.push({ args, expected, actual });
            }
          }
        }
      }
      expect(mismatches.slice(0, 3)).toEqual([]);
      expect(queries).toBeGreaterThan(1000);
    },
    TIMEOUT,
  );

  it('an unknown move type (every cost NaN) still floods breadth-first as the sort did', () => {
    // Every cost is NaN, so every f is NaN and the old sort's comparator never ordered two
    // entries: it popped them first in, first out, a breadth-first flood whose first
    // discovery of a tile is its parent. Worked by hand on an open board (up, down, left,
    // right): (0,0) finds (0,1) then (1,0); (0,1) finds (1,1); (1,1) finds (2,1).
    const open = new HeadlessGrid(
      9,
      7,
      terrainData,
      Array.from({ length: 7 }, () => Array(9).fill(T.Plain)),
    );
    expect(computePath(open, 0, 0, 2, 1, 'Mystery')).toEqual([
      { col: 0, row: 0 },
      { col: 0, row: 1 },
      { col: 1, row: 1 },
      { col: 2, row: 1 },
    ]);
    const mismatches = [];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 9; col++) {
        const expected = referenceComputePath(open, 4, 3, col, row, 'Mystery');
        const actual = computePath(open, 4, 3, col, row, 'Mystery');
        if (show(actual) !== show(expected)) mismatches.push({ col, row, expected, actual });
      }
    }
    expect(mismatches.slice(0, 3)).toEqual([]);
  });
});

describe("computeMovementRange (heap queue) builds the re-sorted queue's exact range", () => {
  it(
    'on seeded random boards, entries in the same insertion order',
    () => {
      const rng = mulberry32(0x3a9e);
      let queries = 0;
      let slides = 0;
      const mismatches = [];
      for (let b = 0; b < 200; b++) {
        const { grid, unitPositions } = randomBoard(rng);
        for (let q = 0; q < 12; q++) {
          const [col, row, , , moveType, positions, faction, costModifier, options] =
            randomPathQuery(rng, grid, unitPositions, { allowUnknownMoveType: false });
          if (col < 0 || col >= grid.cols) continue;
          const mov = pick(rng, [0, 1, 3, 5, 6, 8, 10, 15, 40]);
          const args = [col, row, mov, moveType, positions, faction, costModifier, options];
          const expected = [...referenceComputeMovementRange(grid, ...args)];
          const actual = [...computeMovementRange(grid, ...args)];
          queries++;
          if (expected.some(([, e]) => e.slidePath)) slides++;
          if (show(actual) !== show(expected)) mismatches.push({ b, q, args });
        }
      }
      expect(mismatches.slice(0, 3)).toEqual([]);
      expect(queries).toBeGreaterThan(2000);
      expect(slides).toBeGreaterThan(400);
    },
    TIMEOUT,
  );
});

describe('AI shortest-path searches (branch and bound + memo) decide exactly as before', () => {
  function randomEnemy(rng, grid) {
    return {
      name: 'Probe',
      faction: 'enemy',
      col: int(rng, 0, grid.cols - 1),
      row: int(rng, 0, grid.rows - 1),
      moveType: pick(rng, MOVE_TYPES),
      mov: pick(rng, [0, 3, 4, 5, 7]),
      // Pathfinder (terrain cost reduction) now and then.
      skills: rng() < 0.15 ? ['pathfinder'] : [],
      weapon: pick(rng, [{ range: '1' }, { range: '1-2' }, { range: '2' }, { range: '2-3' }, null]),
    };
  }

  function decisionWorld(rng, ai, grid, unitPositions, enemy) {
    const positions = new Map(unitPositions);
    positions.delete(`${enemy.col},${enemy.row}`);
    const costMod = getTerrainCostReduction(enemy, gameData.skills);
    const moveRange = grid.getMovementRange(
      enemy.col,
      enemy.row,
      enemy.mov,
      enemy.moveType,
      positions,
      'enemy',
      costMod,
    );
    const candidates = [{ col: enemy.col, row: enemy.row }];
    for (const [key, entry] of moveRange) {
      if (entry.stoppable === false || positions.has(key)) continue;
      const [col, row] = key.split(',').map(Number);
      candidates.push({ col, row });
    }
    const targets = [];
    const count = int(rng, 1, 7);
    for (let i = 0; i < count; i++) {
      targets.push({
        name: `T${i}`,
        col: int(rng, 0, grid.cols - 1),
        row: int(rng, 0, grid.rows - 1),
      });
    }
    return { positions, moveRange: rng() < 0.8 ? moveRange : null, candidates, targets };
  }

  function countPathCalls(ai, fn) {
    const original = ai._findPathWithIceFallback;
    let calls = 0;
    ai._findPathWithIceFallback = function (...args) {
      calls++;
      return original.apply(this, args);
    };
    try {
      return { result: fn(), calls };
    } finally {
      ai._findPathWithIceFallback = original;
    }
  }

  it(
    '_findRecoveryFallbackTile on random and generated boards',
    () => {
      const rng = mulberry32(0x5eed);
      const boards = [...Array.from({ length: 150 }, () => randomBoard(rng)), ...generatedBoards()];
      let decisions = 0;
      let chosen = 0;
      let referenceCalls = 0;
      let calls = 0;
      const mismatches = [];
      for (const { grid, unitPositions } of boards) {
        const ai = new AIController(grid, gameData, { objective: 'rout' });
        for (let q = 0; q < 8; q++) {
          const enemy = randomEnemy(rng, grid);
          const { positions, moveRange, candidates, targets } = decisionWorld(
            rng,
            ai,
            grid,
            unitPositions,
            enemy,
          );
          const expected = countPathCalls(ai, () =>
            referenceRecoveryFallbackTile(ai, enemy, targets, candidates, positions, moveRange),
          );
          const actual = countPathCalls(ai, () =>
            ai._findRecoveryFallbackTile(enemy, targets, candidates, positions, moveRange),
          );
          decisions++;
          referenceCalls += expected.calls;
          calls += actual.calls;
          if (expected.result) chosen++;
          const same =
            expected.result === null
              ? actual.result === null
              : actual.result !== null &&
                actual.result.target === expected.result.target &&
                actual.result.pathLength === expected.result.pathLength &&
                show(actual.result.tile) === show(expected.result.tile);
          if (!same)
            mismatches.push({
              q,
              enemy,
              targets,
              expected: expected.result,
              actual: actual.result,
            });
        }
      }
      expect(mismatches.slice(0, 3)).toEqual([]);
      expect(decisions).toBeGreaterThan(1200);
      expect(chosen).toBeGreaterThan(600);
      // The bound and the memo do prune (the point of the change).
      expect(calls).toBeLessThan(referenceCalls * 0.5);
    },
    TIMEOUT,
  );

  it(
    '_findPathAwareChaseTile on random and generated boards',
    () => {
      const rng = mulberry32(0xc4a5e);
      const boards = [...Array.from({ length: 150 }, () => randomBoard(rng)), ...generatedBoards()];
      let decisions = 0;
      let chosen = 0;
      const mismatches = [];
      for (const { grid, unitPositions } of boards) {
        const ai = new AIController(grid, gameData, { objective: 'rout' });
        for (let q = 0; q < 8; q++) {
          const enemy = randomEnemy(rng, grid);
          const { positions, moveRange, candidates, targets } = decisionWorld(
            rng,
            ai,
            grid,
            unitPositions,
            enemy,
          );
          const target = targets[0];
          const expected = referencePathAwareChaseTile(
            ai,
            enemy,
            target,
            candidates,
            positions,
            moveRange,
          );
          const actual = ai._findPathAwareChaseTile(
            enemy,
            target,
            candidates,
            positions,
            moveRange,
          );
          decisions++;
          if (expected) chosen++;
          if (show(actual) !== show(expected)) mismatches.push({ enemy, target, expected, actual });
        }
      }
      expect(mismatches.slice(0, 3)).toEqual([]);
      expect(decisions).toBeGreaterThan(1200);
      expect(chosen).toBeGreaterThan(500);
    },
    TIMEOUT,
  );
});
