#!/usr/bin/env node
// fullrun-slice-runner.js - Runs deterministic full-run slice suites.

import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { FULLRUN_SLICES, FULLRUN_SLICE_SUITES } from './fullrun-slices.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const runnerPath = join(__dirname, 'fullrun-runner.js');

function parseArgs(argv = process.argv.slice(2)) {
  const opts = {
    suite: 'pr',
    slice: null,
    list: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--suite' && argv[i + 1]) opts.suite = argv[++i];
    else if (arg === '--slice' && argv[i + 1]) opts.slice = argv[++i];
    else if (arg === '--list') opts.list = true;
  }
  return opts;
}

function listAvailable() {
  console.log('Available slices:');
  for (const [id, def] of Object.entries(FULLRUN_SLICES)) {
    console.log(`- ${id}: ${def.description}`);
  }
  console.log('\nAvailable suites:');
  for (const [id, sliceIds] of Object.entries(FULLRUN_SLICE_SUITES)) {
    console.log(`- ${id}: ${sliceIds.join(', ')}`);
  }
}

function resolveSliceIds(opts) {
  if (opts.slice) {
    if (!FULLRUN_SLICES[opts.slice]) {
      throw new Error(`Unknown slice "${opts.slice}".`);
    }
    return [opts.slice];
  }

  const suite = FULLRUN_SLICE_SUITES[opts.suite];
  if (!suite) {
    throw new Error(`Unknown suite "${opts.suite}".`);
  }
  return suite;
}

function runSlice(sliceId) {
  const def = FULLRUN_SLICES[sliceId];
  if (!def) throw new Error(`Unknown slice "${sliceId}".`);

  console.log(`\n=== Slice: ${sliceId} ===`);
  console.log(def.description);

  const result = spawnSync(process.execPath, [runnerPath, ...def.args], {
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.list) {
    listAvailable();
    return;
  }

  const sliceIds = resolveSliceIds(opts);
  const failures = [];

  for (const sliceId of sliceIds) {
    const code = runSlice(sliceId);
    if (code !== 0) failures.push({ sliceId, code });
  }

  if (failures.length > 0) {
    console.log('\n--- Slice Failures ---');
    for (const failure of failures) {
      console.log(`slice=${failure.sliceId} exit_code=${failure.code}`);
    }
    process.exit(1);
  }

  console.log('\nAll slices passed.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
