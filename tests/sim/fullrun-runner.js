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

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    seed: null,
    seeds: 20,
    difficulty: 'normal',
    invincibility: false,
    maxNodes: 300,
    maxBattleActions: 2600,
    mode: 'reporting',
    timeoutRateThreshold: 8,
    agent: 'scripted',
    writeArtifactsOnFailure: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--seed' && args[i + 1]) opts.seed = parseInt(args[++i], 10);
    else if (arg === '--seeds' && args[i + 1]) opts.seeds = parseInt(args[++i], 10);
    else if (arg === '--difficulty' && args[i + 1]) opts.difficulty = args[++i];
    else if (arg === '--invincibility') opts.invincibility = true;
    else if (arg === '--max-nodes' && args[i + 1]) opts.maxNodes = parseInt(args[++i], 10);
    else if (arg === '--max-battle-actions' && args[i + 1]) opts.maxBattleActions = parseInt(args[++i], 10);
    else if (arg === '--mode' && args[i + 1]) opts.mode = args[++i];
    else if (arg === '--timeout-rate-threshold' && args[i + 1]) opts.timeoutRateThreshold = parseFloat(args[++i]);
    else if (arg === '--agent' && args[i + 1]) opts.agent = args[++i];
    else if (arg === '--no-artifacts') opts.writeArtifactsOnFailure = false;
  }

  if (!['strict', 'reporting'].includes(opts.mode)) {
    throw new Error(`Unknown mode "${opts.mode}". Expected strict|reporting.`);
  }
  if (!['scripted', 'fuzz'].includes(opts.agent)) {
    throw new Error(`Unknown agent "${opts.agent}". Expected scripted|fuzz.`);
  }
  return opts;
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

async function main() {
  const opts = parseArgs();
  const gameData = loadGameData();

  const startSeed = opts.seed ?? 1;
  const endSeed = opts.seed ?? opts.seeds;
  const seeds = [];
  for (let s = startSeed; s <= endSeed; s++) seeds.push(s);

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

  const winRate = totals.runs > 0 ? (totals.victories / totals.runs) * 100 : 0;
  const timeoutRate = totals.runs > 0 ? (totals.timeouts / totals.runs) * 100 : 0;
  const avgNodes = totals.runs > 0 ? totals.totalNodes / totals.runs : 0;
  const avgBattles = totals.runs > 0 ? totals.totalBattles / totals.runs : 0;
  const avgTurns = totals.runs > 0 ? totals.totalTurns / totals.runs : 0;
  const avgGold = totals.runs > 0 ? totals.totalGold / totals.runs : 0;

  console.log('--- Summary ---');
  console.log(
    `runs=${totals.runs} victories=${totals.victories} defeats=${totals.defeats} stuck=${totals.stuck} timeouts=${totals.timeouts}`
  );
  console.log(
    `win_rate_pct=${winRate.toFixed(2)} timeout_rate_pct=${timeoutRate.toFixed(2)} avg_nodes=${avgNodes.toFixed(2)} avg_battles=${avgBattles.toFixed(2)}`
  );
  console.log(
    `avg_turns=${avgTurns.toFixed(2)} avg_gold=${avgGold.toFixed(0)} avg_recruits=${(totals.totalRecruits / Math.max(1, totals.runs)).toFixed(2)} avg_units_lost=${(totals.totalUnitsLost / Math.max(1, totals.runs)).toFixed(2)}`
  );

  let thresholdBreach = false;
  if (opts.mode === 'reporting' && timeoutRate > opts.timeoutRateThreshold) {
    thresholdBreach = true;
    console.log(
      `timeout threshold breached: timeout_rate_pct=${timeoutRate.toFixed(2)} > threshold=${opts.timeoutRateThreshold.toFixed(2)}`
    );
  }

  if (failures.length > 0) {
    console.log('\n--- Failures ---');
    for (const f of failures) {
      console.log(`seed=${f.seed} result=${f.result}${f.artifactPath ? ` replay=${f.artifactPath}` : ''}`);
    }
  }

  if (failures.length > 0 || thresholdBreach) process.exit(1);
  console.log('\nAll runs passed.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
