// Fog-of-war rout maps: every procedural reinforcement comes from the front, the edge
// opposite the player's deployment (engine/RoutLadder.js `fogRoutFrontOnly`, applied by
// MapGenerator). Ways this can break: a ladder flank wave survives on a fogged map; a
// template wave or the Hunted wave keeps a flank edge; the rule leaks onto clear maps or
// seize maps; applying it moves the generation stream (a different map for the same seed);
// the scheduler still places an arrival off the front edge.

import { afterEach, describe, expect, it } from 'vitest';
import { generateBattle } from '../src/engine/MapGenerator.js';
import { resolveDifficultyMode } from '../src/engine/DifficultyEngine.js';
import {
  fogRoutFrontOnly,
  routLadderObjectiveLine,
  routLadderStatus,
} from '../src/engine/RoutLadder.js';
import {
  buildReinforcementTemplatePool,
  resolveBattleReinforcements,
} from '../src/engine/ReinforcementSpawns.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
afterEach(() => restoreMathRandom());

const RUNGS = ['normal', 'dusk', 'hard', 'lunatic'];
const ACTS = ['act1', 'act2', 'act3', 'act4'];
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

function params(difficultyId, act, extra = {}) {
  const m = resolveDifficultyMode(data.difficulty, difficultyId).modifiers;
  return {
    objective: 'rout',
    deployCount: 5,
    act,
    difficultyId,
    routLadder: m.routLadder,
    parInflation: m.parInflation,
    templateWavesRaisePar: m.templateWavesRaisePar,
    ...extra,
  };
}

function gen(p, seed) {
  installSeed(seed);
  try {
    return generateBattle(p, data);
  } finally {
    restoreMathRandom();
  }
}

/** The edge the player's army faces: independent of RoutLadder, from the spawns' centres. */
function expectedFront(config) {
  const mean = (list, key) => list.reduce((s, t) => s + t[key], 0) / list.length;
  const foes = config.enemySpawns.filter((s) => !s.isBoss);
  const dx = mean(foes, 'col') - mean(config.playerSpawns, 'col');
  const dy = mean(foes, 'row') - mean(config.playerSpawns, 'row');
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

function onEdge(edge, tile, config) {
  if (edge === 'left') return tile.col === 0;
  if (edge === 'right') return tile.col === config.cols - 1;
  if (edge === 'top') return tile.row === 0;
  return tile.row === config.rows - 1;
}

/** Every edge a procedural arrival of this config may take. */
function namedEdges(r) {
  const edges = [];
  for (const e of r.spawnEdges || []) edges.push(e);
  for (const w of r.waves || []) edges.push(...(w.edges || []));
  for (const w of r.repeatingWaves || []) edges.push(...(w.edges || []));
  for (const w of r.ladder?.waves || []) edges.push(w.edge);
  if (r.hunted) edges.push(...r.hunted.edges);
  return edges;
}

describe('fogRoutFrontOnly', () => {
  it('points every procedural wave at the front and leaves authored waves alone', () => {
    const scripted = [{ turn: 1, spawns: [{ col: 0, row: 0, className: 'Fighter' }] }];
    const input = {
      spawnEdges: ['right', 'top'],
      waves: [
        { turn: 4, count: [1, 2], edges: ['right'] },
        { turn: 7, count: [2, 3], edges: ['top', 'right'] },
      ],
      scriptedWaves: scripted,
      hunted: { turn: 3, count: [2, 2], xpMultiplier: 0.5, edges: ['top', 'right'] },
      ladder: {
        front: 'right',
        flanks: ['top', 'bottom'],
        minPlayerDistance: 3,
        waves: [
          { turn: 4, count: [1, 2], edge: 'right', xpMultiplier: 0.75 },
          { turn: 7, count: [2, 2], edge: 'top', xpMultiplier: 0.5 },
          { turn: 10, count: [2, 3], edge: 'bottom', xpMultiplier: 0.25 },
        ],
      },
    };
    const before = structuredClone(input);
    const out = fogRoutFrontOnly(input, 'right');
    expect(input).toEqual(before);
    expect(out.spawnEdges).toEqual(['right']);
    expect(out.waves.map((w) => w.edges)).toEqual([['right'], ['right']]);
    expect(out.waves.map((w) => [w.turn, w.count])).toEqual([
      [4, [1, 2]],
      [7, [2, 3]],
    ]);
    expect(out.hunted).toEqual({ ...input.hunted, edges: ['right'] });
    expect(out.ladder.waves.map((w) => w.edge)).toEqual(['right', 'right', 'right']);
    expect(out.ladder.waves.map((w) => [w.turn, w.count, w.xpMultiplier])).toEqual(
      input.ladder.waves.map((w) => [w.turn, w.count, w.xpMultiplier]),
    );
    expect(out.ladder.frontOnly).toBe(true);
    expect(out.scriptedWaves).toBe(scripted);
  });

  it('names no fallback edge in the objective line once every wave is at the front', () => {
    const out = fogRoutFrontOnly(
      {
        ladder: {
          front: 'left',
          flanks: ['top', 'bottom'],
          waves: [
            { turn: 4, count: [1, 1], edge: 'left' },
            { turn: 8, count: [1, 2], edge: 'top' },
          ],
        },
      },
      'left',
    );
    const line = routLadderObjectiveLine(routLadderStatus(out, { resolvedThroughTurn: 4 }));
    expect(line).toBe('Reinforcements 1/2 · T8: up to 2, left edge');
  });
});

describe('a fogged rout map', () => {
  it('names only the front for every wave, on every rung and act', () => {
    let ladders = 0;
    let templateWaves = 0;
    for (const rung of RUNGS) {
      for (const act of ACTS) {
        for (const seed of SEEDS) {
          const label = `${rung} ${act} seed ${seed}`;
          const config = gen(params(rung, act, { fogEnabled: true }), seed);
          const r = config.reinforcements;
          if (!r) continue;
          const front = expectedFront(config);
          if (r.ladder) {
            ladders++;
            expect(r.ladder.front, label).toBe(front);
          }
          templateWaves += r.waves?.length || 0;
          for (const edge of namedEdges(r)) expect(edge, label).toBe(front);
        }
      }
    }
    // The sweep reached both kinds of wave (First Light keeps template waves, Dusk+ ladders).
    expect(ladders).toBeGreaterThan(50);
    expect(templateWaves).toBeGreaterThan(0);
  });

  it('is the same map as without fog: only the reinforcement edges differ', () => {
    for (const rung of RUNGS) {
      for (const seed of SEEDS) {
        const fog = gen(params(rung, 'act2', { fogEnabled: true }), seed);
        const clear = gen(params(rung, 'act2'), seed);
        const label = `${rung} seed ${seed}`;
        expect(fog.mapLayout, label).toEqual(clear.mapLayout);
        expect(fog.enemySpawns, label).toEqual(clear.enemySpawns);
        expect(fog.playerSpawns, label).toEqual(clear.playerSpawns);
        expect(fog.templateId, label).toBe(clear.templateId);
        const strip = (r) =>
          r && {
            ...r,
            spawnEdges: undefined,
            waves: r.waves?.map((w) => ({ ...w, edges: undefined })),
            ladder: r.ladder && {
              ...r.ladder,
              frontOnly: undefined,
              waves: r.ladder.waves.map((w) => ({ ...w, edge: undefined })),
            },
          };
        expect(strip(fog.reinforcements), label).toEqual(strip(clear.reinforcements));
      }
    }
  });

  it('keeps the flank waves on a clear rout map', () => {
    let flankWaves = 0;
    for (const seed of SEEDS) {
      const r = gen(params('hard', 'act3'), seed).reinforcements;
      flankWaves += r.ladder.waves.filter((w) => w.edge !== r.ladder.front).length;
    }
    expect(flankWaves).toBeGreaterThan(0);
  });

  it('sends the Hunted wave from the front too', () => {
    for (const rung of RUNGS) {
      for (const seed of SEEDS) {
        const huntedWave = { turn: 3, count: [2, 3], xpMultiplier: 0.5 };
        const config = gen(params(rung, 'act2', { fogEnabled: true, huntedWave }), seed);
        expect(config.reinforcements.hunted.edges, `${rung} ${seed}`).toEqual([
          expectedFront(config),
        ]);
      }
    }
  });

  it('leaves a fogged seize map as it was', () => {
    for (const seed of SEEDS) {
      const p = { ...params('hard', 'act2'), objective: 'seize' };
      const fog = gen({ ...p, fogEnabled: true }, seed);
      const clear = gen(p, seed);
      expect(fog.reinforcements, `seed ${seed}`).toEqual(clear.reinforcements);
    }
  });

  it('places every procedural arrival on the front edge, turn by turn', () => {
    let arrivals = 0;
    for (const rung of RUNGS) {
      for (const act of ['act2', 'act4']) {
        for (const seed of SEEDS) {
          const huntedWave = { turn: 2, count: [2, 2], xpMultiplier: 0.5 };
          const battleParams = params(rung, act, { fogEnabled: true, huntedWave });
          const config = gen(battleParams, seed);
          const front = expectedFront(config);
          const templates = buildReinforcementTemplatePool({
            battleConfig: config,
            battleParams,
            gameData: data,
          });
          const enemyUnits = config.enemySpawns.map((s) => ({ col: s.col, row: s.row }));
          for (let turn = 1; turn <= 14; turn++) {
            const { spawns } = resolveBattleReinforcements({
              turn,
              seed: 500 + seed,
              battleConfig: config,
              battleParams,
              gameData: data,
              templates,
              playerUnits: config.playerSpawns.map((s) => ({ col: s.col, row: s.row })),
              enemyUnits,
            });
            for (const spawn of spawns) {
              if (spawn.waveType === 'scripted') continue;
              arrivals++;
              const label = `${rung} ${act} seed ${seed} T${turn} ${spawn.waveType}`;
              expect(spawn.edge, label).toBe(front);
              expect(onEdge(front, spawn, config), label).toBe(true);
              enemyUnits.push({ col: spawn.col, row: spawn.row });
            }
          }
        }
      }
    }
    expect(arrivals).toBeGreaterThan(100);
  });

  it('still brings a crowded front wave in when player units park on the front edge', () => {
    // Two units spaced along the front edge used to cover every tile within 3 of a player
    // unit, and with no flank to fall back to each wave was lost. Now an arrival comes closer
    // on the front instead, never next to a player unit.
    const tally = (fog) => {
      let requested = 0;
      let spawned = 0;
      let closest = Infinity;
      let relaxed = 0;
      for (const rung of ['dusk', 'hard', 'lunatic']) {
        for (const act of ACTS) {
          for (const seed of SEEDS) {
            const battleParams = params(rung, act, fog ? { fogEnabled: true } : {});
            const config = gen(battleParams, seed);
            const ladder = config.reinforcements?.ladder;
            if (!ladder) continue;
            const front = ladder.front;
            const span = front === 'left' || front === 'right' ? config.rows : config.cols;
            const at = (k) =>
              front === 'right'
                ? { col: config.cols - 1, row: k }
                : front === 'left'
                  ? { col: 0, row: k }
                  : front === 'top'
                    ? { col: k, row: 0 }
                    : { col: k, row: config.rows - 1 };
            const parked = [at(Math.floor(span / 4)), at(Math.floor((3 * span) / 4))];
            const templates = buildReinforcementTemplatePool({
              battleConfig: config,
              battleParams,
              gameData: data,
            });
            for (let turn = 1; turn <= 14; turn++) {
              const result = resolveBattleReinforcements({
                turn,
                seed: 900 + seed,
                battleConfig: config,
                battleParams,
                gameData: data,
                templates,
                playerUnits: parked,
              });
              for (const wave of result.dueWaves) {
                if (wave.waveType !== 'ladder') continue;
                requested += wave.requestedCount;
                spawned += wave.spawnedCount;
              }
              for (const spawn of result.spawns) {
                if (spawn.waveType !== 'ladder') continue;
                const d = Math.min(
                  ...parked.map((p) => Math.abs(p.col - spawn.col) + Math.abs(p.row - spawn.row)),
                );
                closest = Math.min(closest, d);
                if (d <= 3) relaxed++;
                if (fog) expect(spawn.edge).toBe(front);
              }
            }
          }
        }
      }
      return { requested, spawned, closest, relaxed };
    };

    const fog = tally(true);
    expect(fog.requested).toBeGreaterThan(200);
    expect(fog.spawned / fog.requested).toBeGreaterThan(0.95);
    expect(fog.closest).toBeGreaterThanOrEqual(2);
    expect(fog.relaxed).toBeGreaterThan(0);

    // A clear map keeps its flanks and its full exclusion: nothing lands within 3.
    const clear = tally(false);
    expect(clear.closest).toBeGreaterThanOrEqual(4);
    expect(clear.relaxed).toBe(0);
  });

  it("sends a fogged set piece's Hunted wave from the front too", () => {
    let checked = 0;
    for (const rung of RUNGS) {
      for (const seed of SEEDS) {
        const huntedWave = { turn: 3, count: [2, 2], xpMultiplier: 0.5 };
        const config = gen(
          params(rung, 'act2', { setPiece: 'toll_house', fogEnabled: true, huntedWave }),
          seed,
        );
        if (config.objective !== 'rout') continue;
        checked++;
        const front = expectedFront(config);
        for (const edge of namedEdges(config.reinforcements))
          expect(edge, `${rung} ${seed}`).toBe(front);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
