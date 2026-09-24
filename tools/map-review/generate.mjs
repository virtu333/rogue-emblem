import fs from 'node:fs';
import { generateBattle, validateBattleConfig } from '../../src/engine/MapGenerator.js';
import { createSeededRng } from '../../src/engine/BlessingEngine.js';
import { loadGameData } from '../../tests/testData.js';
import { BATTLEFIELD_LAB_MAPS } from '../../src/utils/battlefieldLabMaps.js';
const data = loadGameData(),
  cases = [];
function generate(t, seed, deployCount) {
  const old = Math.random;
  Math.random = createSeededRng(seed);
  try {
    return generateBattle({ act: t.act, objective: 'rout', templateId: t.id, deployCount }, data);
  } finally {
    Math.random = old;
  }
}
function metrics(m) {
  const costs = m.mapLayout.map((row) =>
    row.map((id) => Number(data.terrain[id].moveCost.Infantry)),
  );
  const dist = costs.map((row) => row.map(() => Infinity));
  for (const p of m.playerSpawns) dist[p.row][p.col] = 0;
  const pending = m.playerSpawns.map((p) => [p.col, p.row]);
  while (pending.length) {
    pending.sort((a, b) => dist[b[1]][b[0]] - dist[a[1]][a[0]]);
    const [x, y] = pending.pop();
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]) {
      const c = costs[ny]?.[nx];
      if (!(c > 0) || !Number.isFinite(c)) continue;
      const d = dist[y][x] + c;
      if (d < dist[ny][nx]) {
        dist[ny][nx] = d;
        pending.push([nx, ny]);
      }
    }
  }
  const distances = m.enemySpawns.map((e) => dist[e.row]?.[e.col] ?? Infinity),
    finite = distances.filter(Number.isFinite);
  let narrow = 0,
    passable = 0;
  costs.forEach((row, y) =>
    row.forEach((c, x) => {
      if (!(c > 0) || !Number.isFinite(c)) return;
      passable++;
      const ns = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ].filter(([a, b]) => costs[b]?.[a] > 0 && Number.isFinite(costs[b][a]));
      if (ns.length <= 2) narrow++;
    }),
  );
  return {
    nearest: finite.length ? Math.min(...finite) : null,
    unreachable: distances.length - finite.length,
    narrow,
    passable,
    terrain: [...new Set(m.mapLayout.flat())].map((i) => data.terrain[i].name),
  };
}
for (const t of BATTLEFIELD_LAB_MAPS)
  for (const seed of [42, 137, 908]) {
    const m = generate(t, seed, 2),
      crowd = generate(t, seed, 8);
    const repeat = generate(t, seed, 2);
    if (JSON.stringify(m) !== JSON.stringify(repeat)) throw Error('Non deterministic ' + t.id);
    cases.push({
      ...t,
      seed,
      cols: m.cols,
      rows: m.rows,
      players: m.playerSpawns,
      enemies: m.enemySpawns,
      mapLayout: m.mapLayout,
      metrics: metrics(m),
      violations: validateBattleConfig(m, data),
      crowd: {
        players: crowd.playerSpawns.length,
        enemies: crowd.enemySpawns.length,
        violations: validateBattleConfig(crowd, data),
        ...metrics(crowd),
      },
    });
  }
fs.writeFileSync(
  new URL('./cases.json', import.meta.url),
  JSON.stringify({ terrain: data.terrain, cases }, null, 2),
);
console.log(
  JSON.stringify(
    {
      cases: cases.length,
      dimensions: [...new Set(cases.map((c) => `${c.cols}x${c.rows}`))],
      violations: cases
        .filter((c) => c.violations.length || c.crowd.violations.length)
        .map((c) => ({ id: c.id, seed: c.seed, normal: c.violations, crowd: c.crowd.violations })),
      groundWarnings: cases
        .filter((c) => c.metrics.unreachable)
        .map((c) => ({ id: c.id, seed: c.seed, count: c.metrics.unreachable })),
    },
    null,
    2,
  ),
);
