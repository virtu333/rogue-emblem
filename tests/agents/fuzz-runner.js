#!/usr/bin/env node
// fuzz-runner.js - CLI entry point for fuzz/scripted harness runs.
// Examples:
//   node tests/agents/fuzz-runner.js --seed 42 --scenario act1_rout_basic --fail-on-timeout
//   node tests/agents/fuzz-runner.js --seeds 100 --all-scenarios --agent scripted

import { ScenarioRunner } from './ScenarioRunner.js';
import { ScriptedAgent } from './ScriptedAgent.js';
import { FuzzAgent } from './FuzzAgent.js';
import { loadFixture, FIXTURES } from '../fixtures/battles/index.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const artifactsDir = join(__dirname, '..', 'artifacts', 'replays');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    seed: null,
    seeds: 10,
    scenario: null,
    allScenarios: false,
    agent: 'scripted',
    maxActions: 2000,
    failOnTimeout: false,
    mode: 'reporting',
    timeoutRateThreshold: null,
    scenarioBudgets: {},
    useDefaultScenarioBudgets: false,
    allowSeeds: null,
    denySeeds: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--seed' && args[i + 1]) {
      opts.seed = parseInt(args[++i], 10);
    } else if (arg === '--seeds' && args[i + 1]) {
      opts.seeds = parseInt(args[++i], 10);
    } else if (arg === '--scenario' && args[i + 1]) {
      opts.scenario = args[++i];
    } else if (arg === '--all-scenarios') {
      opts.allScenarios = true;
    } else if (arg === '--agent' && args[i + 1]) {
      opts.agent = args[++i];
    } else if (arg === '--max-actions' && args[i + 1]) {
      opts.maxActions = parseInt(args[++i], 10);
    } else if (arg === '--fail-on-timeout') {
      opts.failOnTimeout = true;
    } else if (arg === '--mode' && args[i + 1]) {
      opts.mode = args[++i];
    } else if (arg === '--timeout-rate-threshold' && args[i + 1]) {
      opts.timeoutRateThreshold = parseFloat(args[++i]);
    } else if (arg === '--scenario-budget' && args[i + 1]) {
      const raw = args[++i];
      const eq = raw.indexOf('=');
      if (eq <= 0 || eq >= raw.length - 1) {
        throw new Error(`Invalid --scenario-budget "${raw}". Use "<scenario>=<maxActions>"`);
      }
      const scenarioId = raw.slice(0, eq);
      const maxActions = parseInt(raw.slice(eq + 1), 10);
      if (!Number.isFinite(maxActions) || maxActions <= 0) {
        throw new Error(`Invalid maxActions in --scenario-budget "${raw}"`);
      }
      opts.scenarioBudgets[scenarioId] = maxActions;
    } else if (arg === '--use-default-scenario-budgets') {
      opts.useDefaultScenarioBudgets = true;
    } else if (arg === '--allow-seeds' && args[i + 1]) {
      opts.allowSeeds = args[++i];
    } else if (arg === '--deny-seeds' && args[i + 1]) {
      opts.denySeeds = args[++i];
    }
  }
  if (opts.mode !== 'strict' && opts.mode !== 'reporting') {
    throw new Error(`Unknown mode "${opts.mode}". Expected "strict" or "reporting".`);
  }
  if (opts.failOnTimeout) {
    opts.mode = 'strict';
  }
  return opts;
}

const DEFAULT_SCENARIO_BUDGETS = {
  act1_rout_basic: 2000,
  act2_seize_basic: 2800,
  fog_recruit_visibility: 2800,
  healer_heavy: 3200,
};

function parseSeedList(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const parsed = raw
    .split(',')
    .map((x) => parseInt(x.trim(), 10))
    .filter((x) => Number.isFinite(x));
  return parsed.length > 0 ? new Set(parsed) : null;
}

function resolveSeedList(opts, startSeed, endSeed) {
  let seeds = [];
  for (let seed = startSeed; seed <= endSeed; seed++) {
    seeds.push(seed);
  }

  const allow = parseSeedList(opts.allowSeeds);
  const deny = parseSeedList(opts.denySeeds);
  if (allow) {
    seeds = seeds.filter((s) => allow.has(s));
  }
  if (deny) {
    seeds = seeds.filter((s) => !deny.has(s));
  }
  return seeds;
}

function resolveScenarioBudget(opts, scenarioId) {
  if (Number.isFinite(opts.scenarioBudgets[scenarioId])) {
    return opts.scenarioBudgets[scenarioId];
  }
  if (opts.useDefaultScenarioBudgets && Number.isFinite(DEFAULT_SCENARIO_BUDGETS[scenarioId])) {
    return DEFAULT_SCENARIO_BUDGETS[scenarioId];
  }
  return opts.maxActions;
}

function agentFactory(type) {
  if (type === 'fuzz') return () => new FuzzAgent();
  return (driver) => new ScriptedAgent(driver);
}

function ensureReplayArtifact(replay) {
  mkdirSync(artifactsDir, { recursive: true });
  const filename = `${Date.now()}-seed${replay.seed}-${replay.scenarioId}-${replay.result}.json`;
  const fullPath = join(artifactsDir, filename);
  writeFileSync(fullPath, JSON.stringify(replay, null, 2));
  return `tests/artifacts/replays/${filename}`;
}

function makeScenarioStats() {
  return {
    runs: 0,
    failures: 0,
    errors: 0,
    victories: 0,
    defeats: 0,
    timeouts: 0,
    totalTurns: 0,
    totalDurationMs: 0,
  };
}

function pct(part, whole) {
  if (whole <= 0) return '0.00';
  return ((part / whole) * 100).toFixed(2);
}

async function main() {
  const opts = parseArgs();
  const scenarios = opts.allScenarios ? FIXTURES : [opts.scenario || 'act1_rout_basic'];
  for (const scenarioId of scenarios) {
    if (!FIXTURES.includes(scenarioId)) {
      throw new Error(`Unknown scenario "${scenarioId}". Valid: ${FIXTURES.join(', ')}`);
    }
  }

  const startSeed = opts.seed ?? 1;
  const endSeed = opts.seed ?? opts.seeds;
  const seedList = resolveSeedList(opts, startSeed, endSeed);
  if (seedList.length === 0) {
    throw new Error('No seeds selected after applying allow/deny filters.');
  }
  const beganAt = Date.now();

  const totals = makeScenarioStats();
  const failures = [];
  const perScenario = new Map(scenarios.map((id) => [id, makeScenarioStats()]));

  console.log('\n=== Headless Battle Harness ===');
  console.log(
    `Agent: ${opts.agent} | Seeds: ${startSeed}-${endSeed} (selected=${seedList.length}) | Scenarios: ${scenarios.join(', ')} | Max actions(default): ${opts.maxActions}`
  );
  console.log(`Mode: ${opts.mode}`);
  if (opts.failOnTimeout) {
    console.log('Timeout policy: FAIL');
  }
  if (opts.mode === 'reporting' && opts.timeoutRateThreshold !== null) {
    console.log(`Timeout rate threshold: ${opts.timeoutRateThreshold}%`);
  }
  if (opts.useDefaultScenarioBudgets) {
    console.log(`Scenario budgets(default): ${JSON.stringify(DEFAULT_SCENARIO_BUDGETS)}`);
  }
  if (Object.keys(opts.scenarioBudgets).length > 0) {
    console.log(`Scenario budgets(overrides): ${JSON.stringify(opts.scenarioBudgets)}`);
  }
  if (opts.allowSeeds) {
    console.log(`Allow seeds: ${opts.allowSeeds}`);
  }
  if (opts.denySeeds) {
    console.log(`Deny seeds: ${opts.denySeeds}`);
  }
  console.log('');

  for (const scenarioId of scenarios) {
    const fixture = loadFixture(scenarioId);
    const stats = perScenario.get(scenarioId);

    const scenarioMaxActions = resolveScenarioBudget(opts, scenarioId);
    console.log(`  Scenario budget: ${scenarioId} -> max_actions=${scenarioMaxActions}`);

    for (const seed of seedList) {
      const runner = new ScenarioRunner(seed, fixture, agentFactory(opts.agent));
      const replay = await runner.run(scenarioMaxActions);

      stats.runs++;
      totals.runs++;
      stats.totalTurns += replay.finalTurn || 0;
      totals.totalTurns += replay.finalTurn || 0;
      stats.totalDurationMs += replay.durationMs || 0;
      totals.totalDurationMs += replay.durationMs || 0;

      const timedOut = replay.result === 'timeout';
      const hardFailure =
        Boolean(replay.failure) ||
        replay.result === 'error' ||
        replay.result === 'invariant_violation' ||
        replay.result === 'stuck';
      const timeoutFailure = timedOut && (opts.failOnTimeout || opts.mode === 'strict');
      const isFailure = hardFailure || timeoutFailure;
      const isError = replay.result === 'error' || replay.result === 'invariant_violation' || replay.result === 'stuck';

      if (replay.result === 'victory') {
        stats.victories++;
        totals.victories++;
      } else if (replay.result === 'defeat') {
        stats.defeats++;
        totals.defeats++;
      } else if (timedOut) {
        stats.timeouts++;
        totals.timeouts++;
      }

      if (isFailure) {
        stats.failures++;
        totals.failures++;
        if (isError || opts.failOnTimeout) {
          stats.errors++;
          totals.errors++;
        }

        const failureInfo = replay.failure || {
          actionIndex: replay.actions.length - 1,
          invariant: 'timeout',
          message: `Timeout after ${scenarioMaxActions} actions`,
          stack: null,
        };

        const replayPath = ensureReplayArtifact(replay);
        failures.push({
          seed,
          scenario: scenarioId,
          message: failureInfo.message,
          actionIndex: failureInfo.actionIndex,
          replayPath,
        });
        console.log(`  [FAIL] seed=${seed} scenario=${scenarioId} -> ${failureInfo.message}`);
        console.log(`        replay: ${replayPath}`);
      } else {
        const icon = replay.result === 'victory' ? 'V' : replay.result === 'defeat' ? 'D' : 'T';
        process.stdout.write(`  [${icon}]`);
      }
    }
    console.log(`  ${scenarioId}: runs=${stats.runs} fails=${stats.failures}`);
  }

  const elapsedMs = Date.now() - beganAt;
  const avgTurns = totals.runs > 0 ? (totals.totalTurns / totals.runs).toFixed(2) : '0.00';
  const avgDurationMs = totals.runs > 0 ? (totals.totalDurationMs / totals.runs).toFixed(2) : '0.00';
  const winRate = pct(totals.victories, totals.runs);
  const timeoutRate = Number(pct(totals.timeouts, totals.runs));

  console.log('\n--- Summary ---');
  console.log(
    `runs=${totals.runs} failures=${totals.failures} errors=${totals.errors} timeouts=${totals.timeouts} victories=${totals.victories} defeats=${totals.defeats}`
  );
  console.log(
    `avg_turns=${avgTurns} avg_run_ms=${avgDurationMs} win_rate_pct=${winRate} timeout_rate_pct=${timeoutRate.toFixed(2)} elapsed_ms=${elapsedMs}`
  );

  console.log('\n--- By Scenario ---');
  for (const scenarioId of scenarios) {
    const s = perScenario.get(scenarioId);
    const sAvgTurns = s.runs > 0 ? (s.totalTurns / s.runs).toFixed(2) : '0.00';
    const sWinRate = pct(s.victories, s.runs);
    console.log(
      `${scenarioId}: runs=${s.runs} failures=${s.failures} timeouts=${s.timeouts} avg_turns=${sAvgTurns} win_rate_pct=${sWinRate}`
    );
  }

  let thresholdBreach = false;
  if (opts.mode === 'reporting' && opts.timeoutRateThreshold !== null && timeoutRate > opts.timeoutRateThreshold) {
    thresholdBreach = true;
    console.log(
      `\nTimeout threshold breached: timeout_rate_pct=${timeoutRate.toFixed(2)} > threshold=${opts.timeoutRateThreshold.toFixed(2)}`
    );
  }

  if (failures.length > 0 || thresholdBreach) {
    if (failures.length > 0) {
      console.log('\n--- Failure Details ---');
      for (const f of failures) {
        console.log(`seed=${f.seed} scenario=${f.scenario} action=${f.actionIndex} :: ${f.message}`);
        console.log(`replay=${f.replayPath}`);
      }
    }
    process.exit(1);
  }

  console.log('\nAll runs passed.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
