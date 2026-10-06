// Mutation testing for the pure engine (see "Mutation testing" in CLAUDE.md).
// One module:  MUTATE=src/engine/Combat.js npx stryker run
// The JSON report records which tests kill each mutant; tools/mutationKills.mjs
// turns reports into per-test-file unique kills.
const mutate = process.env.MUTATE ? process.env.MUTATE.split(',') : ['src/engine/**/*.js'];
const tag = process.env.MUTATE_TAG || 'engine';

export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.mutation.config.js', related: false },
  coverageAnalysis: 'perTest',
  mutate,
  reporters: ['json', 'progress'],
  jsonReporter: { fileName: `reports/mutation/${tag}.json` },
  concurrency: 4,
  timeoutMS: 5000,
  incremental: true,
  incrementalFile: `reports/stryker-incremental-${tag}.json`,
  ignorePatterns: ['References', 'reports', '.claude', 'dist', 'test-results'],
};
