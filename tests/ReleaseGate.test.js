import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { judgeCommit } from '../tools/releaseGate.js';

const ROOT = join(import.meta.dirname, '..');

// A ci.yml run as the Actions API lists it.
function run(id, createdAt, status, conclusion = null) {
  return {
    id,
    created_at: createdAt,
    status,
    conclusion,
    html_url: `https://example.test/runs/${id}`,
  };
}

const LANES = ['smoke', 'portrait-1of6', 'release'];

// The jobs of a draft pull request's run: gates green, browser lanes skipped.
const draftJobs = [
  { name: 'lint', conclusion: 'success' },
  { name: 'test', conclusion: 'success' },
  { name: 'harness', conclusion: 'success' },
  { name: 'e2e-lanes', conclusion: 'skipped' },
  { name: 'e2e (${{ matrix.id }})', conclusion: 'skipped' },
];

// The jobs of a full run: every browser lane ran and passed.
const fullJobs = [
  ...draftJobs.slice(0, 3),
  { name: 'e2e-lanes', conclusion: 'success' },
  ...LANES.map((lane) => ({ name: `e2e (${lane})`, conclusion: 'success' })),
];

describe('release gate', () => {
  it('refuses an upload on a draft run that skipped the browser lanes', () => {
    const verdict = judgeCommit({
      runs: [run(1, '2026-10-13T06:00:00Z', 'completed', 'success')],
      jobs: draftJobs,
      requireBrowserLanes: true,
    });
    expect(verdict.state).toBe('fail');
    expect(verdict.message).toMatch(/without its browser lanes/);
  });

  it('passes an upload once a run on the commit ran and passed every browser lane', () => {
    const verdict = judgeCommit({
      runs: [run(1, '2026-10-13T06:00:00Z', 'completed', 'success')],
      jobs: fullJobs,
      requireBrowserLanes: true,
    });
    expect(verdict.state).toBe('pass');
  });

  it('waits while the full run that follows "ready for review" is still going, ignoring the older draft run', () => {
    const verdict = judgeCommit({
      runs: [
        run(2, '2026-10-13T07:00:00Z', 'in_progress'),
        run(1, '2026-10-13T06:00:00Z', 'completed', 'success'),
      ],
      jobs: [],
      requireBrowserLanes: true,
    });
    expect(verdict).toMatchObject({ state: 'wait', url: 'https://example.test/runs/2' });
  });

  it.each(['cancelled', 'failure'])(
    'a %s full run is not replaced by an older green draft run',
    (conclusion) => {
      const verdict = judgeCommit({
        runs: [
          run(1, '2026-10-13T06:00:00Z', 'completed', 'success'),
          run(2, '2026-10-13T07:00:00Z', 'completed', conclusion),
        ],
        jobs: [],
        requireBrowserLanes: true,
      });
      expect(verdict).toMatchObject({ state: 'fail', url: 'https://example.test/runs/2' });
    },
  );

  it('of two runs started in the same second, judges the newer one, not the one it cancelled', () => {
    // Seen on #394: one push started two runs at 19:38:02 and the newer cancelled the older.
    const runs = [
      run(38456384099, '2026-10-13T19:38:02Z', 'queued'),
      run(38456383936, '2026-10-13T19:38:02Z', 'completed', 'cancelled'),
    ];
    for (const order of [runs, [...runs].reverse()]) {
      expect(judgeCommit({ runs: order, requireBrowserLanes: true })).toMatchObject({
        state: 'wait',
        url: 'https://example.test/runs/38456384099',
      });
    }
  });

  it('refuses a run whose lane job passed but no browser lane ran', () => {
    const verdict = judgeCommit({
      runs: [run(1, '2026-10-13T06:00:00Z', 'completed', 'success')],
      jobs: [...draftJobs.slice(0, 3), { name: 'e2e-lanes', conclusion: 'success' }],
      requireBrowserLanes: true,
    });
    expect(verdict.state).toBe('fail');
  });

  it("a pull request's validate check (no upload) accepts a draft run", () => {
    const verdict = judgeCommit({
      runs: [run(1, '2026-10-13T06:00:00Z', 'completed', 'success')],
      jobs: draftJobs,
      requireBrowserLanes: false,
    });
    expect(verdict.state).toBe('pass');
  });

  it('waits for a run that does not exist yet', () => {
    expect(judgeCommit({ runs: [], requireBrowserLanes: true })).toMatchObject({
      state: 'wait',
      noRun: true,
    });
  });

  it.each(['testflight.yml', 'play.yml'])(
    '%s asks for the browser lanes on every upload',
    (file) => {
      const wf = readFileSync(join(ROOT, '.github', 'workflows', file), 'utf8');
      expect(wf).toContain(
        "run: node tools/releaseGate.js ${{ github.event_name != 'pull_request' && '--require-browser-lanes' || '' }}",
      );
      expect(wf).toContain('sparse-checkout: tools/releaseGate.js');
    },
  );
});
