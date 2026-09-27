// Meta stat upgrade value — what each home-base stat track is worth in a real run.
// Usage: node sim/metaStatValue.js [--seeds N] [--seed-start S] [--difficulty normal|hard|lunatic]
//                                  [--commander NAME] [--partner NAME] [--variants a,b,...]
//                                  [--base-growth L] [--base-flat L] [--workers N] [--csv]
//
// Runs the real run loop (RunSimulationDriver + ScriptedAgent) on paired seeds.
// The baseline is the endgame meta loadout (every non-stat upgrade maxed) with
// every lord/recruit stat track set to --base-growth / --base-flat (default: max,
// i.e. the full endgame loadout). A variant `id=level` moves one track to that
// level (bare `id` = max level if the baseline has it below max, else 0); the
// report is the change in battles won on the same seeds. Useful for pricing the
// stat tracks against each other, not as an absolute measure: the agent is a
// bot, and its armies are mostly lords (it recruits little).

import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import { loadGameData } from '../tests/testData.js';
import { installSeed, restoreMathRandom } from './lib/SeededRNG.js';
import { RunSimulationDriver } from '../tests/sim/RunSimulationDriver.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';

const STATS = ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK'];
const STAT_TRACK_IDS = [];
for (const group of ['lord', 'recruit']) {
  for (const kind of ['growth', 'flat']) {
    for (const stat of STATS) STAT_TRACK_IDS.push(`${group}_${stat.toLowerCase()}_${kind}`);
  }
}

function parse(argv) {
  const opts = {
    seeds: 400,
    seedStart: 1,
    difficulty: 'normal',
    commander: 'Edric',
    partner: null,
    variants: null,
    baseGrowth: null,
    baseFlat: null,
    workers: 4,
    csv: false,
    child: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seeds') opts.seeds = Number(argv[++i]);
    else if (a === '--seed-start') opts.seedStart = Number(argv[++i]);
    else if (a === '--difficulty') opts.difficulty = argv[++i];
    else if (a === '--commander') opts.commander = argv[++i];
    else if (a === '--partner') opts.partner = argv[++i];
    else if (a === '--variants') opts.variants = argv[++i].split(',').filter(Boolean);
    else if (a === '--base-growth') opts.baseGrowth = Number(argv[++i]);
    else if (a === '--base-flat') opts.baseFlat = Number(argv[++i]);
    else if (a === '--workers') opts.workers = Math.max(1, Number(argv[++i]));
    else if (a === '--csv') opts.csv = true;
    else if (a === '--child') opts.child = true;
  }
  if (!opts.partner) opts.partner = opts.commander === 'Sera' ? 'Edric' : 'Sera';
  return opts;
}

function baselineLevel(opts, upgrade) {
  const base = upgrade.id.endsWith('_flat') ? opts.baseFlat : opts.baseGrowth;
  return base === null ? upgrade.maxLevel : Math.min(base, upgrade.maxLevel);
}

/** Variant `id` or `id=level` -> { upgradeId: level } over the baseline. */
function variantPurchases(variant, upgradesById, opts) {
  if (variant === 'baseline') return {};
  const [id, rawLevel] = variant.split('=');
  const upgrade = upgradesById.get(id);
  if (!upgrade) throw new Error(`Unknown variant "${variant}"`);
  if (rawLevel !== undefined) return { [id]: Number(rawLevel) };
  return { [id]: baselineLevel(opts, upgrade) < upgrade.maxLevel ? upgrade.maxLevel : 0 };
}

function buildMetaEffects(gameData, opts, purchases) {
  const meta = new MetaProgressionManager(gameData.metaUpgrades, '__sim_meta_stat_value__');
  for (const m of ['beatAct1', 'beatAct2', 'beatAct3', 'beatGame', 'beatHard', 'beatLunatic']) {
    meta.milestones.add(m);
  }
  const statTracks = new Set(STAT_TRACK_IDS);
  for (const upgrade of gameData.metaUpgrades) {
    meta.purchasedUpgrades[upgrade.id] = statTracks.has(upgrade.id)
      ? baselineLevel(opts, upgrade)
      : upgrade.maxLevel;
  }
  Object.assign(meta.purchasedUpgrades, purchases);
  const effects = meta.getActiveEffects({ weaponArtCatalog: gameData.weaponArts?.arts || [] });
  return { ...effects, startingLords: { commander: opts.commander, partner: opts.partner } };
}

async function runSeeds(opts, variant, seeds) {
  const gameData = loadGameData();
  const upgradesById = new Map(gameData.metaUpgrades.map((u) => [u.id, u]));
  const metaEffects = buildMetaEffects(
    gameData,
    opts,
    variantPurchases(variant, upgradesById, opts),
  );
  const rows = [];
  const quiet = { log: console.log, warn: console.warn, info: console.info };
  for (const seed of seeds) {
    installSeed(seed);
    console.log = console.warn = console.info = () => {};
    try {
      const driver = new RunSimulationDriver(gameData, {
        metaEffects: structuredClone(metaEffects),
        runOptions: { runSeed: seed, difficultyId: opts.difficulty, autoSelectBlessing: false },
      });
      const r = await driver.run();
      rows.push({
        seed,
        win: r.result === 'victory' ? 1 : 0,
        battles: r.completedBattles || 0,
        act: r.actIndex ?? 0,
      });
    } finally {
      Object.assign(console, quiet);
      restoreMathRandom();
    }
  }
  return rows;
}

function runInChild(opts, variant, seeds) {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), ['--child'], { stdio: 'inherit' });
    child.once('message', (msg) => {
      child.kill();
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg.rows);
    });
    child.once('error', reject);
    child.send({ opts, variant, seeds });
  });
}

async function runVariant(opts, variant) {
  const seeds = Array.from({ length: opts.seeds }, (_, i) => opts.seedStart + i);
  const chunks = Array.from({ length: opts.workers }, (_, w) =>
    seeds.filter((_, i) => i % opts.workers === w),
  ).filter((c) => c.length > 0);
  const parts = await Promise.all(chunks.map((c) => runInChild(opts, variant, c)));
  const bySeed = new Map(parts.flat().map((r) => [r.seed, r]));
  return seeds.map((s) => bySeed.get(s));
}

function pairedStats(base, rows, key) {
  const diffs = rows.map((r, i) => r[key] - base[i][key]);
  const n = diffs.length;
  const mean = diffs.reduce((s, d) => s + d, 0) / n;
  const variance = diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / Math.max(1, n - 1);
  return { mean, se: Math.sqrt(variance / n) };
}

async function main() {
  const opts = parse(process.argv.slice(2));
  const variants = ['baseline', ...(opts.variants || STAT_TRACK_IDS)];
  const results = new Map();
  for (const v of variants) results.set(v, await runVariant(opts, v));
  const base = results.get('baseline');
  const mean = (rows, k) => rows.reduce((s, r) => s + r[k], 0) / rows.length;

  const header = ['variant', 'win_pct', 'battles', 'd_battles', 'se', 'd_win_pct', 'se_win'];
  const lines = [];
  for (const v of variants) {
    const rows = results.get(v);
    const b = pairedStats(base, rows, 'battles');
    const w = pairedStats(base, rows, 'win');
    lines.push([
      v,
      (mean(rows, 'win') * 100).toFixed(1),
      mean(rows, 'battles').toFixed(2),
      b.mean.toFixed(3),
      b.se.toFixed(3),
      (w.mean * 100).toFixed(2),
      (w.se * 100).toFixed(2),
    ]);
  }
  console.log(
    `seeds=${opts.seeds} start=${opts.seedStart} difficulty=${opts.difficulty} ` +
      `lords=${opts.commander}+${opts.partner} ` +
      `base-growth=${opts.baseGrowth ?? 'max'} base-flat=${opts.baseFlat ?? 'max'}`,
  );
  if (opts.csv) {
    console.log(header.join(','));
    for (const l of lines) console.log(l.join(','));
  } else {
    const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
    const fmt = (cols) => cols.map((c, i) => c.padEnd(widths[i])).join('  ');
    console.log(fmt(header));
    for (const l of lines) console.log(fmt(l));
  }
}

if (process.argv.includes('--child')) {
  process.once('message', async ({ opts, variant, seeds }) => {
    try {
      process.send({ rows: await runSeeds(opts, variant, seeds) });
    } catch (err) {
      process.send({ error: err?.stack || String(err) });
    }
  });
} else {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
