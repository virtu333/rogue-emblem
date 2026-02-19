// Colosseum Economy Simulator — Arena gold/XP flow and mercenary cost analysis
// Usage: node sim/colosseum.js [--trials N] [--seed S] [--csv]

import { installSeed, restoreMathRandom } from './lib/SeededRNG.js';
import { getData } from './lib/SimUnitFactory.js';
import {
  parseArgs,
  printHeader,
  printTable,
  meanStd,
  printRecommendations,
} from './lib/TableFormatter.js';
import { generateNodeMap } from '../src/engine/NodeMapGenerator.js';
import { getMercenaryPrice } from '../src/engine/ColosseumEngine.js';
import { ACT_CONFIG } from '../src/utils/constants.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const colosseumData = JSON.parse(
  readFileSync(join(__dirname, '..', 'data', 'colosseum.json'), 'utf-8'),
);

const opts = parseArgs({ trials: 500, seed: 42, csv: false });
if (opts.help) {
  console.log('Usage: node sim/colosseum.js [--trials N] [--seed S] [--csv]');
  process.exit(0);
}

const data = getData();
const issues = [];

// ────────────────────────────────────────
// 1. Colosseum spawn frequency per run
// ────────────────────────────────────────
printHeader('Colosseum Spawn Frequency');

const spawnResults = {};
for (const actId of ['act1', 'act2', 'act3', 'act4']) {
  spawnResults[actId] = { total: 0, spawned: 0 };
}

installSeed(opts.seed);
for (let t = 0; t < opts.trials; t++) {
  for (const actId of ['act1', 'act2', 'act3', 'act4']) {
    const config = ACT_CONFIG[actId];
    if (!config || config.rows <= 1) continue;
    spawnResults[actId].total++;
    const map = generateNodeMap(actId, config, data.mapTemplates || null, {
      colosseumConfig: colosseumData.nodeGeneration,
    });
    if (map.nodes.some((n) => n.type === 'colosseum')) {
      spawnResults[actId].spawned++;
    }
  }
}
restoreMathRandom();

const spawnCols = ['Act', 'Trials', 'Spawned', 'Rate'];
const spawnRows = Object.entries(spawnResults).map(([act, r]) => ({
  Act: act,
  Trials: r.total,
  Spawned: r.spawned,
  Rate: `${((r.spawned / r.total) * 100).toFixed(1)}%`,
}));
printTable(spawnCols, spawnRows);

const totalSpawned = Object.values(spawnResults).reduce((s, r) => s + r.spawned, 0);
const avgPerRun = totalSpawned / opts.trials;
console.log(`\nAverage Colosseum visits per run: ${avgPerRun.toFixed(2)}\n`);

// ────────────────────────────────────────
// 2. Arena gold flow by tier and win rate
// ────────────────────────────────────────
printHeader('Arena Net Gold per Visit (2 units × 3 fights each)');

const WIN_RATES = [0.5, 0.7, 0.9];
const FIGHTS_PER_UNIT = 3;
const UNITS_PER_VISIT = 2;
const totalFights = FIGHTS_PER_UNIT * UNITS_PER_VISIT;

const tierEntries = Object.entries(colosseumData.arena.tiers);
const goldCols = ['Tier', 'WinRate', 'Wins', 'Losses', 'GrossWin', 'LossFee', 'NetGold'];
const goldRows = [];

for (const [tierName, tier] of tierEntries) {
  for (const winRate of WIN_RATES) {
    const wins = Math.round(totalFights * winRate);
    const losses = totalFights - wins;
    const netGold = wins * tier.goldReward - losses * tier.entryFee;
    goldRows.push({
      Tier: tierName,
      WinRate: `${(winRate * 100).toFixed(0)}%`,
      Wins: wins,
      Losses: losses,
      GrossWin: `+${wins * tier.goldReward}G`,
      LossFee: `-${losses * tier.entryFee}G`,
      NetGold: `${netGold >= 0 ? '+' : ''}${netGold}G`,
    });
  }
}
printTable(goldCols, goldRows);

// ────────────────────────────────────────
// 3. Arena XP estimate
// ────────────────────────────────────────
printHeader('Arena XP per Unit (3 fights at tier)');

const BASE_XP = 50;
const xpCols = [
  'Tier',
  'XP Mult',
  'Fights 1-2 XP',
  'Fight 3 XP (DR)',
  'Total XP (3 wins)',
  'Approx Levels',
];
const xpRows = [];
for (const [tierName, tier] of tierEntries) {
  const normalXP = Math.round(BASE_XP * tier.xpMultiplier) * 2;
  const drXP = Math.round(BASE_XP * tier.xpMultiplier * 0.5);
  const totalXP = normalXP + drXP;
  xpRows.push({
    Tier: tierName,
    'XP Mult': `${tier.xpMultiplier}×`,
    'Fights 1-2 XP': normalXP,
    'Fight 3 XP (DR)': drXP,
    'Total XP (3 wins)': totalXP,
    'Approx Levels': `~${(totalXP / 100).toFixed(1)}`,
  });
}
printTable(xpCols, xpRows);

// ────────────────────────────────────────
// 4. Mercenary pricing analysis
// ────────────────────────────────────────
printHeader('Mercenary Pricing by Act + Difficulty');

installSeed(opts.seed);
const mercCols = ['Act', 'Difficulty', 'Mean Cost', 'Std Dev', 'Min', 'Max'];
const mercRows = [];
for (const actId of ['act1', 'act2', 'act3', 'act4']) {
  for (const diff of [null, 'hard', 'lunatic']) {
    const prices = [];
    for (let i = 0; i < 200; i++) {
      prices.push(getMercenaryPrice(actId, false, diff, colosseumData, Math.random));
    }
    const { mean, std } = meanStd(prices);
    mercRows.push({
      Act: actId,
      Difficulty: diff || 'normal',
      'Mean Cost': `${Math.round(mean)}G`,
      'Std Dev': `±${Math.round(std)}G`,
      Min: `${Math.min(...prices)}G`,
      Max: `${Math.max(...prices)}G`,
    });
  }
}
restoreMathRandom();
printTable(mercCols, mercRows);

// ────────────────────────────────────────
// 5. Mercenary vs standard recruit cost comparison
// ────────────────────────────────────────
printHeader('Mercenary vs Standard Recruit Investment');

const compCols = ['Type', 'Base Cost', 'Gear Investment', 'Total Act 1', 'Total Act 3', 'Quality'];
const compRows = [
  {
    Type: 'Standard Recruit',
    'Base Cost': 'Free',
    'Gear Investment': '500-1000G',
    'Total Act 1': '500-1000G',
    'Total Act 3': '1000-2000G',
    Quality: 'Normal stats',
  },
  {
    Type: 'Colosseum Merc',
    'Base Cost': '300-500G',
    'Gear Investment': 'Included',
    'Total Act 1': '300-500G',
    'Total Act 3': '800-1200G',
    Quality: '+1/2 stats, 50% skill',
  },
];
printTable(compCols, compRows);

// ────────────────────────────────────────
// Recommendations
// ────────────────────────────────────────
if (avgPerRun < 1.0) {
  issues.push(`Low spawn rate (${avgPerRun.toFixed(2)}/run) — consider raising spawnChance`);
}
if (avgPerRun > 2.5) {
  issues.push(`High spawn rate (${avgPerRun.toFixed(2)}/run) — may dilute battle encounters`);
}

const bronzeTier = colosseumData.arena.tiers.bronze;
const bronzeNetAt50 =
  Math.round(totalFights * 0.5) * bronzeTier.goldReward -
  Math.round(totalFights * 0.5) * bronzeTier.entryFee;
if (bronzeNetAt50 < 0) {
  issues.push(
    `Bronze tier unprofitable at 50% win rate (${bronzeNetAt50}G) — consider lowering entry fee`,
  );
}

const platTier = colosseumData.arena.tiers.platinum;
if (platTier) {
  const platNetAt70 =
    Math.round(totalFights * 0.7) * platTier.goldReward -
    Math.round(totalFights * 0.3) * platTier.entryFee;
  if (platNetAt70 > 3000) {
    issues.push(`Platinum at 70% win rate gives ${platNetAt70}G — may be too generous`);
  }
}

printRecommendations(issues);
