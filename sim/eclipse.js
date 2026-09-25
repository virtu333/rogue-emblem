// sim/eclipse.js — Eclipse tuning sim (docs/specs/eclipse.md "Tuning targets").
//
// Walks real node maps with RunManager (same generator, same par formula, same victory
// commit, same falls) under fixed rating profiles: every battle is cleared at
// par + offset turns (S = par-3, A = par, B = par+2, C = par+5). Battles are generated
// (for the real enemy count and terrain behind par) but not played, so the sim isolates
// the clock: shadow at each act's end, phase mix, and what the dark took — overall and
// "ahead" (still reachable by the party when it fell).
//
//   node sim/eclipse.js [--seeds 40] [--difficulty normal] [--csv]
//                       [--set bossRelief=6 --set laneBase.outer=7 ...]  (tuning trials)

import { RunManager } from '../src/engine/RunManager.js';
import { generateBattle } from '../src/engine/MapGenerator.js';
import { calculatePar } from '../src/engine/TurnBonusCalculator.js';
import { createSeededRng } from '../src/engine/BlessingEngine.js';
import { eclipsePhase } from '../src/engine/EclipseSystem.js';
import { loadGameData } from '../tests/testData.js';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SEEDS = Math.max(1, Number(arg('seeds', 40)));
const DIFFICULTY = arg('difficulty', 'normal');
const CSV = args.includes('--csv');
const PROFILES = [
  ['S', -3],
  ['A', 0],
  ['B', 2],
  ['C', 5],
];
const SERVICES = new Set(['shop', 'church', 'recruit', 'colosseum']);

function gameData() {
  const data = loadGameData();
  // --set path=value overrides eclipse.json for tuning trials (never written back).
  args.forEach((a, i) => {
    if (a !== '--set' || !args[i + 1]) return;
    const [path, raw] = args[i + 1].split('=');
    const keys = path.split('.');
    let target = data.eclipse;
    for (const k of keys.slice(0, -1)) target = target[k];
    target[keys.at(-1)] = Number(raw);
  });
  return data;
}

function withSeed(seed, fn) {
  const prev = Math.random;
  Math.random = createSeededRng(seed >>> 0);
  try {
    return fn();
  } finally {
    Math.random = prev;
  }
}

// Route policy: a steady player — prefer recruits and whole services, avoid eclipsed
// knots; deterministic tie-break by lane so runs are reproducible.
function chooseNode(nodes) {
  const score = (n) =>
    (n.eclipse ? -2 : 0) +
    (n.type === 'shop' || n.type === 'church' ? 2 : 0) +
    (n.type === 'recruit' ? 3 : 0) -
    Math.abs(n.col - 2) * 0.1;
  return [...nodes].sort((a, b) => score(b) - score(a) || a.col - b.col)[0];
}

function reachableAhead(rm) {
  const byId = new Map(rm.nodeMap.nodes.map((n) => [n.id, n]));
  const seen = new Set();
  const stack = rm.getAvailableNodes().map((n) => n.id);
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of byId.get(id)?.edges || []) stack.push(e);
  }
  return seen;
}

function runOnce(data, seed, offset) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, difficultyId: DIFFICULTY, applyBlessingsAtStart: false });
  const out = {
    byAct: {},
    // Act pressure (the act's own shadow, uncapped by the global meter) at act end.
    byActPressure: {},
    fallsByAct: {},
    falls: 0,
    lostServices: 0,
    aheadFalls: 0,
    aheadServices: 0,
    battles: 0,
    eclipsedFought: 0,
  };
  for (let guard = 0; guard < 400 && !rm.isRunComplete(); guard++) {
    const node = chooseNode(rm.getAvailableNodes());
    if (!node) break;
    if (['battle', 'boss', 'recruit'].includes(node.type)) {
      const params = rm.getBattleParams(node);
      params.deployCount = 4;
      params.isBoss = node.type === 'boss';
      const bc = withSeed(params.battleSeed ?? seed, () => generateBattle(params, data));
      const par = calculatePar(
        {
          cols: bc.cols,
          rows: bc.rows,
          enemyCount: bc.enemySpawns.length,
          objective: bc.objective,
          mapLayout: bc.mapLayout,
          terrainData: data.terrain,
          parBonus: bc.parBonus || 0,
        },
        data.turnBonus,
        DIFFICULTY,
      );
      out.battles++;
      if (node.eclipse) out.eclipsedFought++;
      const turns = Number.isFinite(par) ? Math.max(1, par + offset) : 8;
      rm.completeBattle(rm.roster, node.id, 0, { turnCount: turns, turnPar: par });
      const fell = rm.lastEclipseCommit?.fell || [];
      const ahead = reachableAhead(rm);
      out.falls += fell.length;
      out.fallsByAct[rm.currentAct] = (out.fallsByAct[rm.currentAct] || 0) + fell.length;
      for (const id of fell) {
        const from = rm.nodeMap.nodes.find((n) => n.id === id)?.eclipse?.fromType;
        const service = SERVICES.has(from);
        if (service) out.lostServices++;
        if (ahead.has(id)) {
          out.aheadFalls++;
          if (service) out.aheadServices++;
        }
      }
    } else rm.markNodeComplete(node.id);
    if (rm.isActComplete()) {
      out.byAct[rm.currentAct] = rm.eclipse.shadow;
      out.byActPressure[rm.currentAct] = rm.eclipse.actShadow ?? 0;
      if (rm.isRunComplete()) break;
      rm.advanceAct();
    }
  }
  out.final = rm.eclipse.shadow;
  return out;
}

const data = gameData();
const acts = data.difficulty.modes[DIFFICULTY].actsIncluded;
const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : NaN;
};
const phaseMix = (arr) => {
  const counts = {};
  for (const v of arr) {
    const name = eclipsePhase(v, data.eclipse).name;
    counts[name] = (counts[name] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([k, v]) => `${k} ${Math.round((v / arr.length) * 100)}%`)
    .join(', ');
};

console.log(`\n=== Eclipse tuning sim · ${DIFFICULTY} · ${SEEDS} seeds per profile ===`);
if (CSV) console.log('profile,seed,act,shadow');
for (const [label, offset] of PROFILES) {
  const runs = [];
  for (let seed = 1; seed <= SEEDS; seed++) runs.push(runOnce(data, seed, offset));
  if (CSV) {
    runs.forEach((r, i) => {
      for (const act of acts) console.log(`${label},${i + 1},${act},${r.byAct[act] ?? ''}`);
    });
    continue;
  }
  console.log(`\n${label}-rank (par ${offset >= 0 ? '+' : ''}${offset}):`);
  for (const act of acts) {
    const vals = runs.map((r) => r.byAct[act]).filter(Number.isFinite);
    if (!vals.length) continue;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const mean = (key) => runs.reduce((a, r) => a + (r[key][act] || 0), 0) / runs.length;
    console.log(
      `  end of ${act.padEnd(9)} shadow avg ${avg.toFixed(1).padStart(5)}  p10 ${String(pct(vals, 0.1)).padStart(3)}  p50 ${String(pct(vals, 0.5)).padStart(3)}  p90 ${String(pct(vals, 0.9)).padStart(3)}  · ${phaseMix(vals)}  · act pressure ${mean('byActPressure').toFixed(1)} · knots taken ${mean('fallsByAct').toFixed(1)}`,
    );
  }
  const avg = (key) => runs.reduce((a, r) => a + r[key], 0) / runs.length;
  console.log(
    `  per run: battles ${avg('battles').toFixed(1)} · knots taken ${avg('falls').toFixed(1)} (ahead ${avg('aheadFalls').toFixed(1)}) · services lost ${avg('lostServices').toFixed(1)} (ahead ${avg('aheadServices').toFixed(1)}) · eclipsed battles fought ${avg('eclipsedFought').toFixed(1)}`,
  );
}
