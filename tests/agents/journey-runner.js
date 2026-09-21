#!/usr/bin/env node
// Vitest supplies the rendering-only mocks used by the production lifecycle
// adapters. Running through the same file keeps CLI and CI behavior identical.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseJourneyArgs(args) {
  const options = { maxActions: 600 };
  let seed,
    count = 10;
  const integer = (value, name, low, high) => {
    if (!/^\d+$/.test(value || '')) throw new Error(`${name} requires an integer`);
    const number = Number(value);
    if (number < low || number > high) throw new Error(`${name} must be ${low}–${high}`);
    return number;
  };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--seed') seed = integer(args[++i], flag, 0, 0xffffffff);
    else if (flag === '--seeds') count = integer(args[++i], flag, 1, 1000);
    else if (flag === '--max-actions') options.maxActions = integer(args[++i], flag, 1, 10000);
    else if (flag === '--soak-seconds') options.soakSeconds = integer(args[++i], flag, 1, 3600);
    else if (flag === '--trace' || flag === '--out') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a path`);
      options[flag.slice(2)] = resolve(value);
    } else throw new Error(`Unknown argument ${flag}`);
  }
  if (options.trace && options.soakSeconds) throw new Error('Choose replay or soak');
  if (options.trace) {
    const trace = JSON.parse(readFileSync(options.trace, 'utf8'));
    if (seed !== undefined && trace.seed !== seed) throw new Error('Seed differs from replay seed');
    seed = integer(String(trace.seed), 'replay seed', 0, 0xffffffff);
    options.seed = seed;
  }
  options.seeds = seed === undefined ? Array.from({ length: count }, (_, i) => i + 1) : [seed];
  return options;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseJourneyArgs(process.argv.slice(2));
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const child = spawnSync(
      process.execPath,
      [resolve(root, 'node_modules/vitest/vitest.mjs'), 'run', 'tests/harness/JourneyFuzz.test.js'],
      {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, JOURNEY_OPTIONS: JSON.stringify(options) },
      },
    );
    if (child.error) throw child.error;
    process.exitCode = child.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
