// Merchant Caravan placement over real generated maps (playtest 2026-09-29, row 13):
// the merchant is caught between the armies, not inside the enemy formation. For every
// template a caravan can roll on (rout and seize, acts 2-4) and several seeds, a placed
// caravan is 6+ tiles from every enemy spawn and 4+ (6+ unless the map is cramped)
// from every player spawn, the army can walk to it, and its exit runs away from the
// enemy to the map edge without crossing an enemy spawn. When nothing qualifies the
// map simply has no caravan.
import { describe, it, expect } from 'vitest';
import { generateBattle } from '../src/engine/MapGenerator.js';
import {
  computeCaravanStep,
  createCaravanUnit,
  isCaravanAtEdge,
} from '../src/engine/CaravanSystem.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const ACTS = ['act2', 'act3', 'act4'];
const SEEDS = [1, 2, 3, 4, 5, 6];

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function withSeed(seed, fn) {
  const original = Math.random;
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

// Templates a caravan battle can use: ordinary rout/seize maps (boss keeps excluded).
const cases = [];
for (const objective of ['rout', 'seize'])
  for (const template of data.mapTemplates[objective] || []) {
    if (/boss|dark_champion|eldritch/.test(template.id)) continue;
    for (const act of ACTS)
      if (!Array.isArray(template.acts) || template.acts.includes(act))
        cases.push({ objective, templateId: template.id, act });
  }

const man = (a, b) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
const passable = (config, col, row) => {
  if (col < 0 || row < 0 || col >= config.cols || row >= config.rows) return false;
  const cost = data.terrain[config.mapLayout[row][col]]?.moveCost?.Infantry;
  return cost !== '--' && !Number.isNaN(parseInt(cost, 10));
};
function walkable(config, from) {
  const seen = new Set([`${from.col},${from.row}`]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const { col, row } = queue[i];
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const next = { col: col + dc, row: row + dr };
      const key = `${next.col},${next.row}`;
      if (seen.has(key) || !passable(config, next.col, next.row)) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return seen;
}

const results = [];
for (const c of cases)
  for (const seed of SEEDS) {
    const config = withSeed(seed * 7919 + c.templateId.length, () =>
      generateBattle(
        {
          act: c.act,
          objective: c.objective,
          templateId: c.templateId,
          hasCaravan: true,
          difficultyId: 'normal',
        },
        data,
      ),
    );
    results.push({ ...c, seed, config });
  }
const placed = results.filter((r) => r.config.caravanSpawn);

describe('caravan placement over generated maps', () => {
  it('covers every eligible template and act', () => {
    expect(new Set(cases.map((c) => c.templateId)).size).toBeGreaterThanOrEqual(12);
    expect(results.length).toBe(cases.length * SEEDS.length);
    // A caravan roll gets its caravan: a layout with no room is drawn again
    // (generateBattle), even on the cramped templates no caravan node is given.
    expect(placed.length / results.length).toBeGreaterThan(0.98);
  });

  it('is at least 6 tiles from every enemy spawn and 4 from every player spawn', () => {
    let farFromArmy = 0;
    for (const { config, templateId, act, seed } of placed) {
      const tile = config.caravanSpawn;
      const where = `${templateId}/${act}/seed ${seed} at ${tile.col},${tile.row}`;
      for (const s of config.enemySpawns) expect(man(tile, s), where).toBeGreaterThanOrEqual(6);
      const toArmy = Math.min(...config.playerSpawns.map((s) => man(tile, s)));
      expect(toArmy, where).toBeGreaterThanOrEqual(4);
      if (toArmy >= 6) farFromArmy++;
    }
    // The neutral band is the rule; nearer the army only on cramped maps (the redraw
    // that now rescues those maps is why this floor is below the one-layout 77%).
    expect(farFromArmy / placed.length).toBeGreaterThan(0.6);
  });

  it('is on open ground the army can walk to', () => {
    for (const { config, templateId, act, seed } of placed) {
      const tile = config.caravanSpawn;
      const where = `${templateId}/${act}/seed ${seed}`;
      expect(passable(config, tile.col, tile.row), where).toBe(true);
      const occupied = [...config.playerSpawns, ...config.enemySpawns].map(
        (s) => `${s.col},${s.row}`,
      );
      expect(occupied, where).not.toContain(`${tile.col},${tile.row}`);
      expect(walkable(config, config.playerSpawns[0]).has(`${tile.col},${tile.row}`), where).toBe(
        true,
      );
    }
  });

  it('exits away from the enemy: never through an enemy spawn, never nearer one', () => {
    for (const { config, templateId, act, seed } of placed) {
      const tile = config.caravanSpawn;
      const { dc, dr } = tile.exit;
      const where = `${templateId}/${act}/seed ${seed} exit ${dc},${dr}`;
      expect(Math.abs(dc) + Math.abs(dr), where).toBe(1);
      const enemyKeys = new Set(config.enemySpawns.map((s) => `${s.col},${s.row}`));
      const nearest = (t) => Math.min(...config.enemySpawns.map((s) => man(s, t)));
      const cx = config.enemySpawns.reduce((sum, s) => sum + s.col, 0) / config.enemySpawns.length;
      const cy = config.enemySpawns.reduce((sum, s) => sum + s.row, 0) / config.enemySpawns.length;
      const fromCentre = (t) => Math.abs(t.col - cx) + Math.abs(t.row - cy);
      let steps = 0;
      let prev = tile;
      for (
        let t = { col: tile.col + dc, row: tile.row + dr };
        t.col >= 0 && t.col < config.cols && t.row >= 0 && t.row < config.rows;
        t = { col: t.col + dc, row: t.row + dr }
      ) {
        expect(enemyKeys.has(`${t.col},${t.row}`), where).toBe(false);
        expect(nearest(t), where).toBeGreaterThanOrEqual(nearest(tile));
        expect(fromCentre(t), where).toBeGreaterThanOrEqual(fromCentre(prev));
        prev = t;
        steps++;
      }
      expect(steps, where).toBeGreaterThanOrEqual(4);
    }
  });

  it('a spawned merchant walks its exit: no step onto an enemy spawn, out at its own edge', () => {
    let exited = 0;
    for (const { config, templateId, act, seed } of placed) {
      const unit = createCaravanUnit(act, config.caravanSpawn);
      const enemyKeys = new Set(config.enemySpawns.map((s) => `${s.col},${s.row}`));
      const occupied = new Set([
        ...enemyKeys,
        ...config.playerSpawns.map((s) => `${s.col},${s.row}`),
      ]);
      for (let turn = 0; turn < 40 && !isCaravanAtEdge(unit, config.cols, config.rows); turn++) {
        const step = computeCaravanStep(
          unit,
          config.mapLayout,
          config.cols,
          config.rows,
          data.terrain,
          occupied,
        );
        if (!step) break; // held by a wall or a unit; the next turn may free it
        expect(enemyKeys.has(`${step.col},${step.row}`), `${templateId}/${act}/${seed}`).toBe(
          false,
        );
        Object.assign(unit, step);
      }
      if (isCaravanAtEdge(unit, config.cols, config.rows)) exited++;
    }
    // With the armies standing still, nearly every merchant reaches its edge.
    expect(exited / placed.length).toBeGreaterThan(0.9);
  });
});
