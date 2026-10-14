#!/usr/bin/env node
// Release gate: the TestFlight and Play workflows build only a commit CI has validated.
//
// A draft pull request's CI run skips the browser lanes (e2e-lanes and the e2e matrix),
// and still ends green. Such a run is development CI, not release validation, so an
// upload asks for more than "CI passed": the newest CI run on the exact commit passed
// AND its browser lanes ran and passed. A pull request's own validate check (no upload)
// accepts a draft's run.
//
// Usage (in a workflow, with GH_TOKEN, GITHUB_REPOSITORY and COMMIT set):
//   node tools/releaseGate.js [--require-browser-lanes]
// Polls until the commit's newest CI run finishes, then exits 0 (pass) or 1 (fail).
//
// The verdict is the pure judgeCommit(), exported for tests/ReleaseGate.test.js.

import { pathToFileURL } from 'node:url';

export const LANES_JOB = 'e2e-lanes';
const E2E_JOB_PREFIX = 'e2e (';

/**
 * The newest run for the commit; a re-run updates the same run. Two runs can share a
 * created_at to the second (one push can start two, and the newer cancels the older
 * through CI's concurrency group), so the run id, which only grows, breaks the tie.
 */
export function newestRun(runs) {
  return (
    [...(runs || [])]
      .sort(
        (a, b) =>
          String(a.created_at).localeCompare(String(b.created_at)) || Number(a.id) - Number(b.id),
      )
      .pop() || null
  );
}

/** Did the browser lanes run and pass in this run's latest attempt? */
export function browserLanesPassed(jobs) {
  const list = jobs || [];
  const lanes = list.find((job) => job.name === LANES_JOB);
  const e2e = list.filter((job) => String(job.name).startsWith(E2E_JOB_PREFIX));
  return (
    lanes?.conclusion === 'success' &&
    e2e.length > 0 &&
    e2e.every((job) => job.conclusion === 'success')
  );
}

/**
 * @param {{ runs: object[], jobs?: object[], requireBrowserLanes?: boolean }} input
 *   runs: the ci.yml runs for the commit; jobs: the newest run's jobs (latest attempt).
 * @returns {{ state: 'wait'|'pass'|'fail', message: string, url?: string, noRun?: boolean }}
 */
export function judgeCommit({ runs, jobs, requireBrowserLanes = false }) {
  const run = newestRun(runs);
  if (!run) return { state: 'wait', noRun: true, message: 'No CI run for this commit yet.' };
  const url = run.html_url;
  if (run.status !== 'completed') return { state: 'wait', message: `CI is ${run.status}.`, url };
  if (run.conclusion === 'cancelled') {
    return {
      state: 'fail',
      message:
        'CI was cancelled (a newer push replaced it before it ran). Build the newest commit on the branch.',
      url,
    };
  }
  if (run.conclusion !== 'success')
    return { state: 'fail', message: `CI finished '${run.conclusion}'.`, url };
  if (requireBrowserLanes && !browserLanesPassed(jobs)) {
    return {
      state: 'fail',
      message:
        "CI passed without its browser lanes (a draft pull request's run). Mark the pull request ready for review and build once that run is green, or build a main commit.",
      url,
    };
  }
  return { state: 'pass', message: 'CI passed.', url };
}

async function api(path) {
  const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main(argv) {
  const commit = process.env.COMMIT;
  const requireBrowserLanes = argv.includes('--require-browser-lanes');
  const limitSeconds = 240 * 60;
  const noRunSeconds = 300;
  const started = Date.now();
  for (;;) {
    const elapsed = (Date.now() - started) / 1000;
    let verdict;
    try {
      const { workflow_runs: runs } = await api(
        `actions/workflows/ci.yml/runs?head_sha=${commit}&per_page=50`,
      );
      const run = newestRun(runs);
      const jobs =
        run?.status === 'completed' && run.conclusion === 'success'
          ? (await api(`actions/runs/${run.id}/jobs?filter=latest&per_page=100`)).jobs
          : [];
      verdict = judgeCommit({ runs, jobs, requireBrowserLanes });
    } catch (err) {
      verdict = { state: 'wait', message: `Could not read CI (${err.message}); retrying.` };
    }
    const where = verdict.url ? ` (${verdict.url})` : '';
    if (verdict.state === 'pass') {
      console.log(
        `CI passed on ${commit}${requireBrowserLanes ? ', browser lanes included' : ''}${where}`,
      );
      return 0;
    }
    if (verdict.state === 'fail') {
      console.log(`::error::CI on ${commit}: ${verdict.message}${where}`);
      return 1;
    }
    if (verdict.noRun && elapsed >= noRunSeconds) {
      console.log(
        `::error::No CI run exists for ${commit}. Build a commit CI has run on (main, or a branch with an open pull request).`,
      );
      return 1;
    }
    if (elapsed >= limitSeconds) {
      console.log(`::error::CI on ${commit} did not finish within 4 hours${where}`);
      return 1;
    }
    console.log(`${verdict.message} Waiting${where}`);
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
