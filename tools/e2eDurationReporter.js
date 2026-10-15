// Playwright reporter: how long each spec file and test took (tests/e2e/lanes.json
// shards are balanced from these numbers; see tools/e2eLanes.js).
//
// At the end of a run it writes e2e-durations/<lane>[-<shard>].json and, in CI, adds
// a table of the slowest files to the job summary. A file's time is the sum of its
// tests' times (every attempt, retries included): the work it gives the shard, whatever
// the number of workers. The default reporter still prints progress.

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { LANE_ENV, SHARD_ENV, REPO_ROOT, E2E_DIR } from './e2eLanes.js';

export const DURATIONS_DIR = 'e2e-durations';

/** Seconds, rounded to tenths. */
const seconds = (ms) => Math.round(ms / 100) / 10;

/**
 * The report a run leaves: per spec file, its tests' summed time and count, and per
 * test (title path) its time. Pure, for tests.
 * @param {{ file: string, title: string, durationMs: number, status: string }[]} results
 */
export function summarizeDurations(results, { lane = '', shard = '', wallMs = 0 } = {}) {
  const files = {};
  for (const r of results) {
    const entry = (files[r.file] ??= { seconds: 0, tests: 0, retried: 0, ms: 0, titles: {} });
    entry.ms += r.durationMs;
    entry.titles[r.title] = (entry.titles[r.title] ?? 0) + r.durationMs;
    if (r.retry > 0) entry.retried += 1;
    else entry.tests += 1;
  }
  const out = {};
  for (const [file, entry] of Object.entries(files).sort((a, b) => b[1].ms - a[1].ms)) {
    out[file] = {
      seconds: seconds(entry.ms),
      tests: entry.tests,
      retried: entry.retried,
      slowest: Object.entries(entry.titles)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([title, ms]) => ({ title, seconds: seconds(ms) })),
    };
  }
  const workMs = results.reduce((n, r) => n + r.durationMs, 0);
  return { lane, shard, wallSeconds: seconds(wallMs), workSeconds: seconds(workMs), files: out };
}

/** Markdown for the job summary. */
export function summaryMarkdown(report, limit = 15) {
  const name = report.lane ? `${report.lane}${report.shard ? ` ${report.shard}` : ''}` : 'e2e';
  const lines = [
    `### e2e durations: ${name}`,
    '',
    `Wall ${(report.wallSeconds / 60).toFixed(1)} min, test work ${(report.workSeconds / 60).toFixed(1)} min.`,
    '',
    '| Spec | Minutes | Tests | Retried |',
    '| --- | ---: | ---: | ---: |',
  ];
  for (const [file, entry] of Object.entries(report.files).slice(0, limit)) {
    lines.push(
      `| ${file} | ${(entry.seconds / 60).toFixed(1)} | ${entry.tests} | ${entry.retried} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

export default class E2eDurationReporter {
  constructor() {
    this.results = [];
    this.start = Date.now();
  }

  printsToStdio() {
    return false;
  }

  onBegin() {
    this.start = Date.now();
  }

  onTestEnd(test, result) {
    const base = join(REPO_ROOT, E2E_DIR);
    this.results.push({
      file: relative(base, test.location.file).split(sep).join('/'),
      title: test.titlePath().slice(3).join(' › '),
      durationMs: result.duration,
      status: result.status,
      retry: result.retry,
    });
  }

  onEnd() {
    const lane = process.env[LANE_ENV] || '';
    const shard = process.env[SHARD_ENV] || '';
    const report = summarizeDurations(this.results, {
      lane,
      shard,
      wallMs: Date.now() - this.start,
    });
    const dir = join(REPO_ROOT, DURATIONS_DIR);
    mkdirSync(dir, { recursive: true });
    const name = `${lane || 'all'}${shard ? `-${shard.replace('/', 'of')}` : ''}.json`;
    writeFileSync(join(dir, name), `${JSON.stringify(report, null, 2)}\n`);
    // Every spec, so the log alone can refresh tests/e2e/durations.json.
    const lines = Object.entries(report.files).map(
      ([file, entry]) => `  ${String(entry.seconds).padStart(6)} s  ${file}`,
    );
    console.log(
      `\n[e2e durations] work ${(report.workSeconds / 60).toFixed(1)} min:\n${lines.join('\n')}`,
    );
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown(report));
    }
  }
}
