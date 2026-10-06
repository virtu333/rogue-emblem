// The test set Stryker runs against mutants (stryker.config.mjs). MUTATE_TESTS=fast
// (the default) is the unit suite without the slow files in
// tools/mutationSlowTests.json; MUTATE_TESTS=full is every vitest file CI runs
// (unit, harness, sim). Run fast first, then full: the incremental file makes the
// full pass retest only the fast pass's survivors against the added tests.
// MUTATE_TESTS=integration (with its own MUTATE_TAG) measures the slow tests alone.
import { defineConfig, mergeConfig } from 'vitest/config';
import { readFileSync, readdirSync } from 'node:fs';
import base from './vite.config.js';

const slow = JSON.parse(readFileSync('./tools/mutationSlowTests.json', 'utf8')).files;
const mode = process.env.MUTATE_TESTS || 'fast';
// Integration-style unit files: whole battles, presentation boundaries, parity and fuzz.
const INTEGRATION_NAME =
  /Integration|Presentation|Boundary|Parity|Fuzz|Journey|RealGrid|Invariance|Contract/;
const integration = readdirSync('tests').filter(
  (f) => f.endsWith('.test.js') && INTEGRATION_NAME.test(f),
);

export default defineConfig((env) =>
  mergeConfig(typeof base === 'function' ? base(env) : base, {
    test: {
      exclude: [
        'tests/e2e/**',
        'node_modules/**',
        '.claude/**',
        'tests/agents/**',
        'tests/fixtures/**',
        'tests/artifacts/**',
        ...(mode === 'fast'
          ? ['tests/harness/**', 'tests/sim/**', ...slow.map((f) => `tests/${f}`)]
          : []),
      ],
      // MUTATE_TESTS=integration keeps only the harness, sim and integration-style
      // files: what the suite would catch without its focused unit tests.
      ...(mode === 'integration'
        ? {
            include: [
              'tests/harness/**/*.test.js',
              'tests/sim/**/*.test.js',
              ...integration.map((f) => `tests/${f}`),
            ],
          }
        : {}),
    },
  }),
);
