#!/usr/bin/env node
// fuzz-runner.js — CLI entry point for fuzz and scripted runs.
// Usage:
//   node tests/agents/fuzz-runner.js --seeds 10 --scenario act1_rout_basic
//   node tests/agents/fuzz-runner.js --seeds 100 --all-scenarios
//   node tests/agents/fuzz-runner.js --seeds 20 --scenario act1_rout_basic --agent scripted

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
  const opts = { seeds: 10, scenario: null, allScenarios: false, agent: 'scripted', maxActions: 2000, failOnTimeout: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--seeds' && args[i + 1]) opts.seeds = parseInt(args[i + 1]);
    if (args[i] === '--scenario' && args[i + 1]) opts.scenario = args[i + 1];
    if (args[i] === '--all-scenarios') opts.allScenarios = true;
    if (args[i] === '--agent' && args[i + 1]) opts.agent = args[i + 1];
    if (args[i] === '--max-actions' && args[i + 1]) opts.maxActions = parseInt(args[i + 1]);
    if (args[i] === '--fail-on-timeout') opts.failOnTimeout = true;
  }
  return opts;
}

function agentFactory(type) {
  if (type === 'fuzz') return (driver) => new FuzzAgent();
  return (driver) => new ScriptedAgent(driver);
}

async function main() {
  const opts = parseArgs();
  const scenarios = opts.allScenarios ? FIXTURES : [opts.scenario || 'act1_rout_basic'];

  let totalRuns = 0;
  let passed = 0;
  let failures = [];
  let victories = 0;
  let defeats = 0;
  let timeouts = 0;
  let errors = 0;

  console.log(`\n=== Headless Battle Harness ===`);
  console.log(`Agent: ${opts.agent} | Seeds: 1-${opts.seeds} | Scenarios: ${scenarios.join(', ')} | Max actions: ${opts.maxActions}\n`);

  for (const scenarioId of scenarios) {
    const fixture = loadFixture(scenarioId);

    for (let seed = 1; seed <= opts.seeds; seed++) {
      totalRuns++;
      const runner = new ScenarioRunner(seed, fixture, agentFactory(opts.agent));
      const replay = await runner.run(opts.maxActions);

      const status = replay.failure ? 'FAIL' : replay.result;
      const icon = replay.failure ? 'X' : (replay.result === 'victory' ? 'V' : replay.result === 'defeat' ? 'D' : 'T');

      const isTimeoutFailure = opts.failOnTimeout && replay.result === 'timeout';

      if (replay.failure || isTimeoutFailure) {
        const failureInfo = replay.failure || {
          actionIndex: replay.actions.length - 1,
          invariant: 'timeout',
          message: `Timeout after ${opts.maxActions} actions (--fail-on-timeout)`,
          stack: null,
        };
        failures.push({ seed, scenario: scenarioId, failure: failureInfo });
        // Write failed replay
        mkdirSync(artifactsDir, { recursive: true });
        const filename = `${Date.now()}-${seed}-${scenarioId}.json`;
        writeFileSync(join(artifactsDir, filename), JSON.stringify(replay, null, 2));
        const failIcon = replay.failure ? 'X' : 'T!';
        console.log(`  [${failIcon}] seed=${seed} scenario=${scenarioId} — ${failureInfo.message}`);
        console.log(`      Replay saved: tests/artifacts/replays/${filename}`);
        errors++;
        if (isTimeoutFailure) timeouts++;
      } else {
        passed++;
        if (replay.result === 'victory') victories++;
        else if (replay.result === 'defeat') defeats++;
        else if (replay.result === 'timeout') timeouts++;
        process.stdout.write(`  [${icon}]`);
      }
    }
    console.log('');
  }

  console.log(`\n--- Results ---`);
  console.log(`Total: ${totalRuns} | Passed: ${passed} | Failed: ${errors}`);
  console.log(`Victories: ${victories} | Defeats: ${defeats} | Timeouts: ${timeouts}`);

  if (failures.length > 0) {
    console.log(`\nFailures:`);
    for (const f of failures) {
      console.log(`  seed=${f.seed} scenario=${f.scenario}: ${f.failure.message}`);
    }
    process.exit(1);
  }

  console.log(`\nAll runs passed.`);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
