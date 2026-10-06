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
import {
  getMaxFights,
  getMaxFightsPerVisit,
  getMercenaryPrice,
} from '../src/engine/ColosseumEngine.js';
import { DIFFICULTY_IDS } from '../src/engine/DifficultyEngine.js';
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
// A colosseum visit is capped in total (arena.maxFightsPerVisit, per rung), on top of
// each unit's own cap: the table below is First Light, whose visit cap is the tighter
// of the two for 2 units.
const FIRST_LIGHT = DIFFICULTY_IDS[0];
const WIN_RATES = [0.5, 0.7, 0.9];
const FIGHTS_PER_UNIT = getMaxFights(FIRST_LIGHT, colosseumData);
const UNITS_PER_VISIT = 2;
const totalFights = Math.min(
  FIGHTS_PER_UNIT * UNITS_PER_VISIT,
  getMaxFightsPerVisit(FIRST_LIGHT, colosseumData),
);
printHeader(
  `Arena Net Gold per Visit (2 units × ${FIGHTS_PER_UNIT} fights each, capped at ${totalFights} bouts per visit)`,
);

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
// 3b. Visit yield: big army, before and after the visit cap
// ────────────────────────────────────────
printHeader('Arena Yield per Visit: big army (Vulneraries for everyone), before and after the cap');

// "Before" is every unit fighting its full per-unit cap (units × maxFightsPerUnit bouts);
// "after" is the visit cap on top. Bouts go round-robin across the army, which is the
// best case for XP (a unit's 3rd bout of a visit pays half, after 2 levels' worth).
// Gold and XP are expected values at the given win rate; a loss pays no XP.
function visitYield(tier, winRate, units, perUnit, visitCap) {
  const bouts = Math.min(units * perUnit, visitCap);
  let xp = 0;
  for (let b = 0; b < bouts; b++) {
    const fightNo = Math.floor(b / units); // this unit's 0-based bout of the visit
    const full = BASE_XP_VISIT * tier.xpMultiplier;
    xp += winRate * Math.round(fightNo >= 2 ? full * 0.5 : full);
  }
  const gold = bouts * (winRate * tier.goldReward - (1 - winRate) * tier.entryFee);
  return { bouts, gold: Math.round(gold), xp: Math.round(xp) };
}
const BASE_XP_VISIT = 50;
const VISIT_WIN_RATE = 0.7;
const ARMY_SIZES = [2, 4, 8];
const visitCols = [
  'Rung',
  'Tier',
  'Army',
  'Bouts before',
  'Gold before',
  'XP before',
  'Bouts after',
  'Gold after',
  'XP after',
];
const visitRows = [];
for (const rung of DIFFICULTY_IDS) {
  const perUnit = getMaxFights(rung, colosseumData);
  const visitCap = getMaxFightsPerVisit(rung, colosseumData);
  for (const tierName of ['silver', 'gold']) {
    const tier = colosseumData.arena.tiers[tierName];
    for (const units of ARMY_SIZES) {
      const before = visitYield(tier, VISIT_WIN_RATE, units, perUnit, Infinity);
      const after = visitYield(tier, VISIT_WIN_RATE, units, perUnit, visitCap);
      visitRows.push({
        Rung: rung,
        Tier: tierName,
        Army: `${units} units`,
        'Bouts before': before.bouts,
        'Gold before': `${before.gold}G`,
        'XP before': before.xp,
        'Bouts after': after.bouts,
        'Gold after': `${after.gold}G`,
        'XP after': after.xp,
      });
    }
  }
}
printTable(visitCols, visitRows);
console.log(
  `\n(win rate ${VISIT_WIN_RATE * 100}%, base XP ${BASE_XP_VISIT}; per-unit cap from getMaxFights)\n`,
);

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
