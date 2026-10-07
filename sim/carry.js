// sim/carry.js — carried items (docs/specs/phase3.md 3G), measured on real node maps.
//
// Walks real runs with RunManager (the same generator, node maps and battle params as the
// game) and generates every battle node's map without playing it, then counts what the
// enemies carry: carriers per battle, and by item. It is an UPPER BOUND on what Steal can
// pay: it assumes a Thief robs every carrier, which no run does (a carrier that falls first
// loses its item, a Thief must reach it and be at least as fast). The Gold Pouches are the
// part that feeds the economy, so they are also given in gold, per run, to set beside the
// gold a run earns (`npm run sim:fullrun:pr`, progression_invincible --max-avg-gold).
//
//   node sim/carry.js [--seeds 60] [--difficulty lunatic | all] [--csv]
import { RunManager } from '../src/engine/RunManager.js';
import { generateBattle } from '../src/engine/MapGenerator.js';
import { createSeededRng } from '../src/engine/BlessingEngine.js';
import { loadGameData } from '../tests/testData.js';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SEEDS = Math.max(1, Number(arg('seeds', 60)));
const WHICH = arg('difficulty', 'all');
const CSV = args.includes('--csv');
const RUNGS = WHICH === 'all' ? ['normal', 'dusk', 'hard', 'lunatic'] : [WHICH];

function withSeed(seed, fn) {
  const prev = Math.random;
  Math.random = createSeededRng(seed >>> 0);
  try {
    return fn();
  } finally {
    Math.random = prev;
  }
}

const chooseNode = (nodes) =>
  [...nodes].sort((a, b) => a.col - b.col || String(a.id).localeCompare(String(b.id)))[0];

function runOnce(data, seed, difficultyId) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, difficultyId, applyBlessingsAtStart: false });
  const out = { battles: 0, carriers: 0, pouchGold: 0, byName: {}, byAct: {} };
  for (let guard = 0; guard < 400 && !rm.isRunComplete(); guard++) {
    const node = chooseNode(rm.getAvailableNodes());
    if (!node) break;
    if (['battle', 'boss', 'recruit'].includes(node.type)) {
      const params = rm.getBattleParams(node);
      params.deployCount = 4;
      params.isBoss = node.type === 'boss';
      const bc = withSeed(params.battleSeed ?? seed, () => generateBattle(params, data));
      out.battles++;
      for (const spawn of bc.enemySpawns.filter((s) => s.carries)) {
        out.carriers++;
        out.byName[spawn.carries] = (out.byName[spawn.carries] || 0) + 1;
        const act = rm.currentAct;
        out.byAct[act] = (out.byAct[act] || 0) + 1;
        if (spawn.carries === 'Gold Pouch') out.pouchGold += spawn.carryValue || 0;
      }
      rm.completeBattle(rm.roster, node.id, 0, { turnCount: 8, turnPar: 8 });
    } else rm.markNodeComplete(node.id);
    if (rm.isActComplete()) {
      if (rm.isRunComplete()) break;
      rm.advanceAct();
    }
  }
  return out;
}

const data = loadGameData();
if (CSV) console.log('difficulty,seed,battles,carriers,pouchGold');
for (const rung of RUNGS) {
  const runs = [];
  for (let seed = 1; seed <= SEEDS; seed++) runs.push(runOnce(data, seed, rung));
  if (CSV) {
    runs.forEach((r, i) =>
      console.log(`${rung},${i + 1},${r.battles},${r.carriers},${r.pouchGold}`),
    );
    continue;
  }
  const avg = (fn) => runs.reduce((a, r) => a + fn(r), 0) / runs.length;
  const names = new Set(runs.flatMap((r) => Object.keys(r.byName)));
  console.log(
    `\n=== Carried items · ${rung} · ${SEEDS} runs (upper bound: every carrier robbed) ===`,
  );
  console.log(
    `  per run: battles ${avg((r) => r.battles).toFixed(1)} · carriers ${avg((r) => r.carriers).toFixed(1)} · Gold Pouch gold ${avg((r) => r.pouchGold).toFixed(0)}`,
  );
  const byName = [...names].sort().map((n) => `${n} ${avg((r) => r.byName[n] || 0).toFixed(2)}`);
  console.log(`  by item per run: ${byName.join(' · ') || 'none'}`);
  const acts = [...new Set(runs.flatMap((r) => Object.keys(r.byAct)))].sort();
  console.log(
    `  by act per run: ${acts.map((a) => `${a} ${avg((r) => r.byAct[a] || 0).toFixed(2)}`).join(' · ') || 'none'}`,
  );
}
