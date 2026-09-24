#!/usr/bin/env node
// Terrain paint cost in Node, measured as process CPU time (robust on a busy
// machine, where wall-clock samples include other processes' time slices).
// Browser numbers (sync / time-sliced / worker, 1x and 4x CPU throttling)
// come from the preview page: preview.html?bench=1.
//
//   node tools/art/procedural-terrain/bench.mjs [--runs 7]
import {
  createTerrainJob,
  renderBattlefieldTerrain,
  repaintCells,
  PAINTED_TERRAIN,
} from '../../../src/art/terrain/index.js';
import { mulberry32 } from '../../../src/art/terrain/noise.js';
import { generateStudyMap } from './lib/maps.mjs';

const args = process.argv.slice(2);
const runs = Number(args[args.indexOf('--runs') + 1]) || 7;
const cpu = () => {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1000;
};
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function synthetic(cols, rows, seed) {
  const rng = mulberry32(seed);
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => PAINTED_TERRAIN[Math.floor(rng() * PAINTED_TERRAIN.length)]),
  );
}

const cases = [
  {
    label: 'synthetic 20x13, every terrain mixed (worst case)',
    names: synthetic(20, 13, 20),
    biome: 'grassland',
  },
  ...[
    ['eldritch_sanctum', 'finalBoss', 'seize'],
    ['act4_boss_intent_bastion', 'act4', 'seize'],
    ['eruption_point', 'act4', 'seize'],
    ['glacier_fortress', 'act4', 'seize'],
    ['river_crossing', 'act3', 'rout'],
    ['mire_crossing', 'act3', 'rout'],
    ['great_hall', 'act3', 'seize'],
  ].map(([templateId, act, objective]) => {
    const m = generateStudyMap({
      key: templateId,
      params: { act, objective, templateId },
      seed: 3,
    });
    return { label: templateId, names: m.names, biome: m.biome };
  }),
];

console.log(
  `CPU ms per paint (median of ${runs}); slice = longest single work unit (1 cell row, 1 pass)`,
);
console.log('case'.padEnd(52), 'size ', 'full', ' longest-unit', ' repaint-1-cell');
for (const c of cases) {
  renderBattlefieldTerrain({ names: c.names, biome: c.biome, seed: 5 }); // warm-up
  const full = [],
    unit = [];
  for (let i = 0; i < runs; i++) {
    const job = createTerrainJob({ names: c.names, biome: c.biome, seed: 5 });
    const t0 = cpu();
    let t = t0,
      worst = 0;
    for (const _ of job.steps(1)) {
      const n = cpu();
      worst = Math.max(worst, n - t);
      t = n;
    }
    job.finish();
    full.push(cpu() - t0);
    unit.push(worst);
  }
  const res = renderBattlefieldTerrain({ names: c.names, biome: c.biome, seed: 5 });
  const rng = mulberry32(9);
  const rep = [];
  for (let i = 0; i < runs * 3; i++) {
    const col = Math.floor(rng() * res.cols),
      row = Math.floor(rng() * res.rows);
    const pool = PAINTED_TERRAIN.filter((n) => n !== res.state.names[row][col]);
    const t0 = cpu();
    repaintCells(res, [{ col, row, name: pool[Math.floor(rng() * pool.length)] }]);
    rep.push(cpu() - t0);
  }
  console.log(
    c.label.padEnd(52),
    `${res.cols}x${res.rows}`.padEnd(5),
    median(full).toFixed(1).padStart(5),
    median(unit).toFixed(1).padStart(8),
    median(rep).toFixed(2).padStart(12),
  );
}
