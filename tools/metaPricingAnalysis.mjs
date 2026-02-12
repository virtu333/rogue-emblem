#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SOURCE_FILE = path.join(ROOT, 'data', 'metaUpgrades.json');
const CATEGORY_CURRENCY = {
  lord_bonuses: 'valor',
  starting_equipment: 'valor',
  starting_skills: 'valor',
  recruit_stats: 'supply',
  economy: 'supply',
  capacity: 'supply',
};

const RUN_REWARD_FULL_VICTORY = {
  normal: 530,
  hard: 662,
  lunatic: 795,
};

const PROFILES = {
  conservative: {
    label: 'Conservative',
    minCost: 50,
    roundTo: 25,
    multipliers: {
      recruit_stats: 0.75,
      lord_bonuses: 0.75,
      economy: 0.8,
      capacity: 0.8,
      starting_equipment: 0.8,
      starting_skills: 0.85,
    },
  },
  moderate: {
    label: 'Moderate',
    minCost: 50,
    roundTo: 25,
    multipliers: {
      recruit_stats: 0.6,
      lord_bonuses: 0.6,
      economy: 0.65,
      capacity: 0.65,
      starting_equipment: 0.65,
      starting_skills: 0.7,
    },
  },
  aggressive: {
    label: 'Aggressive Alpha',
    minCost: 50,
    roundTo: 25,
    multipliers: {
      recruit_stats: 0.45,
      lord_bonuses: 0.45,
      economy: 0.5,
      capacity: 0.5,
      starting_equipment: 0.5,
      starting_skills: 0.55,
    },
  },
  sandbox: {
    label: 'Sandbox Alpha',
    minCost: 25,
    roundTo: 25,
    multipliers: {
      recruit_stats: 0.3,
      lord_bonuses: 0.3,
      economy: 0.35,
      capacity: 0.35,
      starting_equipment: 0.35,
      starting_skills: 0.4,
    },
  },
};

function roundToStep(value, step) {
  return Math.round(value / step) * step;
}

function scaleCost(value, profile, category) {
  const mult = profile.multipliers[category] ?? 1;
  const scaled = roundToStep(value * mult, profile.roundTo);
  return Math.max(profile.minCost, scaled);
}

function summarize(upgrades) {
  const byCurrency = { valor: 0, supply: 0 };
  const byCategory = {};
  const tiers = [];

  for (const upgrade of upgrades) {
    const total = upgrade.costs.reduce((a, b) => a + b, 0);
    const currency = CATEGORY_CURRENCY[upgrade.category] || 'supply';
    byCurrency[currency] += total;
    byCategory[upgrade.category] = (byCategory[upgrade.category] || 0) + total;
    tiers.push(...upgrade.costs);
  }

  const sorted = [...tiers].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

  return {
    upgradeCount: upgrades.length,
    tierCount: tiers.length,
    totalCost: tiers.reduce((a, b) => a + b, 0),
    byCurrency,
    byCategory,
    distribution: {
      min: sorted[0],
      median: pct(0.5),
      p75: pct(0.75),
      p90: pct(0.9),
      max: sorted[sorted.length - 1],
    },
    fullVictoryRunsToMaxAll: {
      normal: {
        valor: Math.ceil(byCurrency.valor / RUN_REWARD_FULL_VICTORY.normal),
        supply: Math.ceil(byCurrency.supply / RUN_REWARD_FULL_VICTORY.normal),
      },
      hard: {
        valor: Math.ceil(byCurrency.valor / RUN_REWARD_FULL_VICTORY.hard),
        supply: Math.ceil(byCurrency.supply / RUN_REWARD_FULL_VICTORY.hard),
      },
      lunatic: {
        valor: Math.ceil(byCurrency.valor / RUN_REWARD_FULL_VICTORY.lunatic),
        supply: Math.ceil(byCurrency.supply / RUN_REWARD_FULL_VICTORY.lunatic),
      },
    },
  };
}

function applyProfile(upgrades, profile) {
  return upgrades.map((upgrade) => ({
    ...upgrade,
    costs: upgrade.costs.map((cost) => scaleCost(cost, profile, upgrade.category)),
  }));
}

function main() {
  const upgrades = JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf8'));
  const baseline = summarize(upgrades);
  const result = {
    generatedAt: new Date().toISOString(),
    source: path.relative(ROOT, SOURCE_FILE).replace(/\\/g, '/'),
    baseline,
    profiles: {},
  };

  for (const [key, profile] of Object.entries(PROFILES)) {
    const proposal = applyProfile(upgrades, profile);
    result.profiles[key] = {
      label: profile.label,
      multipliers: profile.multipliers,
      summary: summarize(proposal),
      deltas: {
        totalCostPct: Number(((summarize(proposal).totalCost / baseline.totalCost) * 100).toFixed(1)),
        valorPct: Number(((summarize(proposal).byCurrency.valor / baseline.byCurrency.valor) * 100).toFixed(1)),
        supplyPct: Number(((summarize(proposal).byCurrency.supply / baseline.byCurrency.supply) * 100).toFixed(1)),
      },
      sampleChanges: proposal.slice(0, 8).map((u, i) => ({
        id: u.id,
        before: upgrades[i].costs,
        after: u.costs,
      })),
    };
  }

  const outDir = path.join(ROOT, 'docs', 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'meta-pricing-analysis-2026-02-12.json');
  fs.writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);

  const proposalDir = path.join(ROOT, 'data', 'archive', 'metaUpgrades', 'proposals-2026-02-12');
  fs.mkdirSync(proposalDir, { recursive: true });
  for (const [key, profile] of Object.entries(PROFILES)) {
    const proposal = applyProfile(upgrades, profile);
    const proposalFile = path.join(proposalDir, `metaUpgrades.${key}.json`);
    fs.writeFileSync(proposalFile, `${JSON.stringify(proposal, null, 2)}\n`);
  }

  console.log(JSON.stringify({
    wrote: [
      path.relative(ROOT, outFile).replace(/\\/g, '/'),
      path.relative(ROOT, proposalDir).replace(/\\/g, '/'),
    ],
    baseline,
    profiles: Object.fromEntries(
      Object.entries(result.profiles).map(([k, v]) => [k, {
        label: v.label,
        totalCostPct: v.deltas.totalCostPct,
        byCurrency: v.summary.byCurrency,
        runs: v.summary.fullVictoryRunsToMaxAll,
      }])
    ),
  }, null, 2));
}

main();
