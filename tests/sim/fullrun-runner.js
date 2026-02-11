#!/usr/bin/env node
// fullrun-runner.js - Seeded full-run simulator for balance + regression volume.

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { RunSimulationDriver } from './RunSimulationDriver.js';
import { ScriptedAgent } from '../agents/ScriptedAgent.js';
import { FuzzAgent } from '../agents/FuzzAgent.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const artifactsDir = join(__dirname, '..', 'artifacts', 'fullrun');

function parseOptionalNumber(raw, flag) {
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value for ${flag}: ${raw}`);
  }
  return parsed;
}

export function parseArgsFrom(args = process.argv.slice(2)) {
  const opts = {
    seed: null,
    seedStart: null,
    seedEnd: null,
    seeds: 20,
    difficulty: 'normal',
    invincibility: false,
    maxNodes: 300,
    maxBattleActions: 2600,
    mode: 'reporting',
    timeoutRateThreshold: 8,
    maxTimeoutRate: null,
    agent: 'scripted',
    minWinRate: null,
    maxDefeatRate: null,
    minAvgNodes: null,
    maxAvgNodes: null,
    minAvgRecruits: null,
    maxAvgUnitsLost: null,
    maxAvgTurns: null,
    writeArtifactsOnFailure: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--seed' && args[i + 1]) opts.seed = parseInt(args[++i], 10);
    else if (arg === '--seed-start' && args[i + 1]) opts.seedStart = parseInt(args[++i], 10);
    else if (arg === '--seed-end' && args[i + 1]) opts.seedEnd = parseInt(args[++i], 10);
    else if (arg === '--seeds' && args[i + 1]) opts.seeds = parseInt(args[++i], 10);
    else if (arg === '--difficulty' && args[i + 1]) opts.difficulty = args[++i];
    else if (arg === '--invincibility') opts.invincibility = true;
    else if (arg === '--max-nodes' && args[i + 1]) opts.maxNodes = parseInt(args[++i], 10);
    else if (arg === '--max-battle-actions' && args[i + 1]) opts.maxBattleActions = parseInt(args[++i], 10);
    else if (arg === '--mode' && args[i + 1]) opts.mode = args[++i];
    else if (arg === '--timeout-rate-threshold' && args[i + 1]) opts.timeoutRateThreshold = parseFloat(args[++i]);
    else if (arg === '--max-timeout-rate' && args[i + 1]) opts.maxTimeoutRate = parseOptionalNumber(args[++i], '--max-timeout-rate');
    else if (arg === '--agent' && args[i + 1]) opts.agent = args[++i];
    else if (arg === '--min-win-rate' && args[i + 1]) opts.minWinRate = parseOptionalNumber(args[++i], '--min-win-rate');
    else if (arg === '--max-defeat-rate' && args[i + 1]) opts.maxDefeatRate = parseOptionalNumber(args[++i], '--max-defeat-rate');
    else if (arg === '--min-avg-nodes' && args[i + 1]) opts.minAvgNodes = parseOptionalNumber(args[++i], '--min-avg-nodes');
    else if (arg === '--max-avg-nodes' && args[i + 1]) opts.maxAvgNodes = parseOptionalNumber(args[++i], '--max-avg-nodes');
    else if (arg === '--min-avg-recruits' && args[i + 1]) opts.minAvgRecruits = parseOptionalNumber(args[++i], '--min-avg-recruits');
    else if (arg === '--max-avg-units-lost' && args[i + 1]) opts.maxAvgUnitsLost = parseOptionalNumber(args[++i], '--max-avg-units-lost');
    else if (arg === '--max-avg-turns' && args[i + 1]) opts.maxAvgTurns = parseOptionalNumber(args[++i], '--max-avg-turns');
    else if (arg === '--no-artifacts') opts.writeArtifactsOnFailure = false;
  }

  if (!['strict', 'reporting'].includes(opts.mode)) {
    throw new Error(`Unknown mode "${opts.mode}". Expected strict|reporting.`);
  }
  if (!['scripted', 'fuzz'].includes(opts.agent)) {
    throw new Error(`Unknown agent "${opts.agent}". Expected scripted|fuzz.`);
  }
  if (opts.seedStart !== null && opts.seedEnd !== null && opts.seedStart > opts.seedEnd) {
    throw new Error(`Invalid seed range: --seed-start (${opts.seedStart}) is greater than --seed-end (${opts.seedEnd}).`);
  }
  return opts;
}

export function buildSeedList(opts) {
  const startSeed = opts.seed ?? opts.seedStart ?? 1;
  const endSeed = opts.seed ?? opts.seedEnd ?? opts.seeds;
  const seeds = [];
  for (let s = startSeed; s <= endSeed; s++) seeds.push(s);
  return { startSeed, endSeed, seeds };
}

function agentFactory(type) {
  if (type === 'fuzz') {
    return () => {
      const fuzz = new FuzzAgent();
      return {
        chooseAction: (legalActions) => fuzz.chooseAction(legalActions),
      };
    };
  }
  return (driver) => new ScriptedAgent(driver);
}

function ensureArtifact(result) {
  mkdirSync(artifactsDir, { recursive: true });
  const filename = `${Date.now()}-seed${result.seed}-${result.result}.json`;
  const fullPath = join(artifactsDir, filename);
  writeFileSync(fullPath, JSON.stringify(result, null, 2));
  return `tests/artifacts/fullrun/${filename}`;
}

async function runSingle(seed, gameData, opts) {
  installSeed(seed);
  try {
    const driver = new RunSimulationDriver(gameData, {
      runOptions: {
        runSeed: seed,
        difficultyId: opts.difficulty,
        autoSelectBlessing: false,
      },
      maxNodes: opts.maxNodes,
      maxBattleActions: opts.maxBattleActions,
      invincibility: opts.invincibility,
      battleAgentFactory: agentFactory(opts.agent),
    });
    const replay = await driver.run();
    return {
      seed,
      ...replay,
    };
  } finally {
    restoreMathRandom();
  }
}

export function computeSummary(totals) {
  const runs = totals.runs || 0;
  return {
    winRate: runs > 0 ? (totals.victories / runs) * 100 : 0,
    defeatRate: runs > 0 ? (totals.defeats / runs) * 100 : 0,
    timeoutRate: runs > 0 ? (totals.timeouts / runs) * 100 : 0,
    avgNodes: runs > 0 ? totals.totalNodes / runs : 0,
    avgBattles: runs > 0 ? totals.totalBattles / runs : 0,
    avgTurns: runs > 0 ? totals.totalTurns / runs : 0,
    avgGold: runs > 0 ? totals.totalGold / runs : 0,
    avgRecruits: runs > 0 ? totals.totalRecruits / runs : 0,
    avgUnitsLost: runs > 0 ? totals.totalUnitsLost / runs : 0,
  };
}

export function evaluateThresholdBreaches(summary, opts) {
  const breaches = [];
  const limits = [
    ['minWinRate', 'win_rate_pct', 'min', summary.winRate],
    ['maxDefeatRate', 'defeat_rate_pct', 'max', summary.defeatRate],
    ['minAvgNodes', 'avg_nodes', 'min', summary.avgNodes],
    ['maxAvgNodes', 'avg_nodes', 'max', summary.avgNodes],
    ['minAvgRecruits', 'avg_recruits', 'min', summary.avgRecruits],
    ['maxAvgUnitsLost', 'avg_units_lost', 'max', summary.avgUnitsLost],
    ['maxAvgTurns', 'avg_turns', 'max', summary.avgTurns],
  ];

  for (const [optKey, metricName, kind, metricValue] of limits) {
    const threshold = opts[optKey];
    if (threshold === null || threshold === undefined) continue;
    const hit = kind === 'min' ? metricValue < threshold : metricValue > threshold;
    if (hit) {
      breaches.push(`${metricName}=${metricValue.toFixed(2)} ${kind === 'min' ? '<' : '>'} threshold=${threshold.toFixed(2)}`);
    }
  }

  if (opts.maxTimeoutRate !== null && opts.maxTimeoutRate !== undefined) {
    if (summary.timeoutRate > opts.maxTimeoutRate) {
      breaches.push(`timeout_rate_pct=${summary.timeoutRate.toFixed(2)} > threshold=${opts.maxTimeoutRate.toFixed(2)}`);
    }
  } else if (opts.mode === 'reporting' && summary.timeoutRate > opts.timeoutRateThreshold) {
    breaches.push(`timeout_rate_pct=${summary.timeoutRate.toFixed(2)} > threshold=${opts.timeoutRateThreshold.toFixed(2)}`);
  }

  return breaches;
}

export async function runBatch(opts, gameDataOverride = null) {
  const gameData = gameDataOverride || loadGameData();
  const { startSeed, endSeed, seeds } = buildSeedList(opts);

  if (seeds.length === 0) {
    throw new Error('No seeds selected; adjust --seed, --seed-start/--seed-end, or --seeds.');
  }

  const totals = {
    runs: 0,
    victories: 0,
    defeats: 0,
    stuck: 0,
    timeouts: 0,
    totalNodes: 0,
    totalBattles: 0,
    totalTurns: 0,
    totalGold: 0,
    totalRecruits: 0,
    totalUnitsLost: 0,
  };
  const failures = [];

  console.log('\n=== Full Run Simulator ===');
  console.log(`Seeds: ${startSeed}-${endSeed} (${seeds.length} runs)`);
  console.log(`Difficulty: ${opts.difficulty} | Invincibility: ${opts.invincibility}`);
  console.log(`Agent: ${opts.agent} | Mode: ${opts.mode}`);
  console.log('');

  for (const seed of seeds) {
    const replay = await runSingle(seed, gameData, opts);
    totals.runs++;
    totals.totalNodes += replay.metrics.nodesVisited;
    totals.totalBattles += replay.metrics.battles;
    totals.totalTurns += replay.metrics.totalTurns;
    totals.totalGold += replay.gold || 0;
    totals.totalRecruits += replay.metrics.recruitsGained;
    totals.totalUnitsLost += replay.metrics.unitsLost;

    if (replay.result === 'victory') totals.victories++;
    else if (replay.result === 'defeat') totals.defeats++;
    else if (replay.result === 'stuck') totals.stuck++;
    else if (replay.result === 'timeout') totals.timeouts++;

    const hardFailure = replay.result === 'stuck';
    const timeoutFailure = replay.result === 'timeout' && opts.mode === 'strict';
    const isFailure = hardFailure || timeoutFailure;
    if (isFailure) {
      let artifactPath = null;
      if (opts.writeArtifactsOnFailure) {
        artifactPath = ensureArtifact(replay);
      }
      failures.push({ seed, result: replay.result, artifactPath });
      console.log(`  [FAIL] seed=${seed} result=${replay.result}${artifactPath ? ` replay=${artifactPath}` : ''}`);
    } else {
      const mark = replay.result === 'victory' ? 'V' : replay.result === 'timeout' ? 'T' : 'D';
      process.stdout.write(`  [${mark}]`);
    }
  }
  console.log('\n');

  const summary = computeSummary(totals);

  console.log('--- Summary ---');
  console.log(
    `runs=${totals.runs} victories=${totals.victories} defeats=${totals.defeats} stuck=${totals.stuck} timeouts=${totals.timeouts}`
  );
  console.log(
    `win_rate_pct=${summary.winRate.toFixed(2)} defeat_rate_pct=${summary.defeatRate.toFixed(2)} timeout_rate_pct=${summary.timeoutRate.toFixed(2)} avg_nodes=${summary.avgNodes.toFixed(2)} avg_battles=${summary.avgBattles.toFixed(2)}`
  );
  console.log(
    `avg_turns=${summary.avgTurns.toFixed(2)} avg_gold=${summary.avgGold.toFixed(0)} avg_recruits=${summary.avgRecruits.toFixed(2)} avg_units_lost=${summary.avgUnitsLost.toFixed(2)}`
  );

  const thresholdBreaches = evaluateThresholdBreaches(summary, opts);
  const thresholdBreach = thresholdBreaches.length > 0;
  if (thresholdBreach) {
    console.log('\n--- Threshold Breaches ---');
    for (const line of thresholdBreaches) console.log(line);
  }

  if (failures.length > 0) {
    console.log('\n--- Failures ---');
    for (const f of failures) {
      console.log(`seed=${f.seed} result=${f.result}${f.artifactPath ? ` replay=${f.artifactPath}` : ''}`);
    }
  }

  const ok = failures.length === 0 && !thresholdBreach;
  if (ok) {
    console.log('\nAll runs passed.');
  }
  return {
    ok,
    totals,
    summary,
    failures,
    thresholdBreaches,
    seeds: { startSeed, endSeed, count: seeds.length },
  };
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgsFrom(argv);
  const outcome = await runBatch(opts);
  if (!outcome.ok) process.exit(1);
}

const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectExecution) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
