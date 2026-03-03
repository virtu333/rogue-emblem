#!/usr/bin/env node
// fullrun-slice-triage.js - Finds first bad commit for a deterministic full-run slice.

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { FULLRUN_SLICES } from './fullrun-slices.js';

function parseRange(range) {
  const [from, to] = String(range || '').split('..');
  if (!from || !to) {
    throw new Error(`Invalid --range value "${range}". Expected <from>..<to>.`);
  }
  return { from, to };
}

export function parseArgsFrom(argv = process.argv.slice(2)) {
  const opts = {
    slice: null,
    from: null,
    to: 'HEAD',
    firstParent: true,
    keepWorktree: false,
    verbose: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--slice' && argv[i + 1]) opts.slice = argv[++i];
    else if (arg === '--from' && argv[i + 1]) opts.from = argv[++i];
    else if (arg === '--to' && argv[i + 1]) opts.to = argv[++i];
    else if (arg === '--range' && argv[i + 1]) {
      const range = parseRange(argv[++i]);
      opts.from = range.from;
      opts.to = range.to;
    } else if (arg === '--no-first-parent') opts.firstParent = false;
    else if (arg === '--keep-worktree') opts.keepWorktree = true;
    else if (arg === '--verbose') opts.verbose = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
  }

  if (opts.help) return opts;
  if (!opts.slice) {
    throw new Error('Missing required --slice <slice-id>.');
  }
  if (!FULLRUN_SLICES[opts.slice]) {
    throw new Error(`Unknown slice "${opts.slice}".`);
  }
  if (!opts.from) {
    throw new Error('Missing required commit range start: --from <sha> or --range <from>..<to>.');
  }
  return opts;
}

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return result;
}

function runGit(repoRoot, args) {
  const result = runCommand('git', args, repoRoot);
  if ((result.status ?? 1) !== 0) {
    const stderr = (result.stderr || result.stdout || '').trim();
    throw new Error(`git ${args.join(' ')} failed: ${stderr || `exit=${result.status}`}`);
  }
  return (result.stdout || '').trim();
}

function resolveCommit(repoRoot, ref) {
  return runGit(repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`]);
}

function buildCommitList(repoRoot, fromSha, toSha, firstParent) {
  const ancestryCheck = runCommand(
    'git',
    ['merge-base', '--is-ancestor', fromSha, toSha],
    repoRoot,
  );
  if ((ancestryCheck.status ?? 1) !== 0) {
    throw new Error(`Range is not ancestry-ordered: ${fromSha} is not an ancestor of ${toSha}.`);
  }

  const args = ['rev-list', '--reverse', '--ancestry-path'];
  if (firstParent) args.push('--first-parent');
  args.push(`${fromSha}..${toSha}`);
  const descendantsRaw = runGit(repoRoot, args);
  const descendants = descendantsRaw
    ? descendantsRaw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
  return [fromSha, ...descendants];
}

function ensureWorktree(repoRoot, toSha) {
  const worktreeDir = mkdtempSync(join(tmpdir(), 'fullrun-slice-triage-'));
  const addResult = runCommand(
    'git',
    ['worktree', 'add', '--detach', worktreeDir, toSha],
    repoRoot,
  );
  if ((addResult.status ?? 1) !== 0) {
    const stderr = (addResult.stderr || addResult.stdout || '').trim();
    throw new Error(`git worktree add failed: ${stderr || `exit=${addResult.status}`}`);
  }
  return worktreeDir;
}

function cleanupWorktree(repoRoot, worktreeDir) {
  const removeResult = runCommand('git', ['worktree', 'remove', '--force', worktreeDir], repoRoot);
  if ((removeResult.status ?? 1) !== 0) {
    const stderr = (removeResult.stderr || removeResult.stdout || '').trim();
    console.warn(`Warning: git worktree remove failed: ${stderr || `exit=${removeResult.status}`}`);
  }
  rmSync(worktreeDir, { recursive: true, force: true });
}

function checkoutCommit(worktreeDir, sha) {
  const checkout = runCommand('git', ['checkout', '--quiet', sha], worktreeDir);
  if ((checkout.status ?? 1) !== 0) {
    const stderr = (checkout.stderr || checkout.stdout || '').trim();
    throw new Error(`git checkout ${sha} failed: ${stderr || `exit=${checkout.status}`}`);
  }
}

function runSliceAtCommit(worktreeDir, sliceId) {
  const runnerPath = join(worktreeDir, 'tests', 'sim', 'fullrun-slice-runner.js');
  const result = runCommand(process.execPath, [runnerPath, '--slice', sliceId], worktreeDir);
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  return {
    exitCode: result.status ?? 1,
    ok: (result.status ?? 1) === 0,
    output,
  };
}

export function extractSectionLines(output, header) {
  const lines = String(output || '').split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) return [];

  const section = [];
  for (let i = start + 1; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) {
      if (section.length > 0) break;
      continue;
    }
    if ((line.startsWith('--- ') || line.startsWith('=== ')) && section.length > 0) break;
    section.push(line);
  }
  return section;
}

export function parseFailingMetrics(output, exitCode) {
  const thresholds = extractSectionLines(output, '--- Threshold Breaches ---');
  if (thresholds.length > 0) return thresholds;

  const failures = extractSectionLines(output, '--- Failures ---');
  if (failures.length > 0) return failures;

  const errors = String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('Error:') || line.startsWith('Fatal error:'));
  if (errors.length > 0) return errors;

  return [`slice exited with code ${exitCode}`];
}

function printUsage() {
  console.log(
    'Usage: node tests/sim/fullrun-slice-triage.js --slice <id> --from <sha> [--to <sha>]',
  );
  console.log('   or: node tests/sim/fullrun-slice-triage.js --slice <id> --range <from>..<to>');
  console.log('');
  console.log('Options:');
  console.log(
    '  --slice <id>            Full-run slice id from tests/sim/fullrun-slices.js (required)',
  );
  console.log('  --from <sha>            Start commit (required unless --range is provided)');
  console.log('  --to <sha>              End commit (default: HEAD)');
  console.log('  --range <from>..<to>    Commit range shorthand');
  console.log('  --no-first-parent       Walk full ancestry path instead of first-parent chain');
  console.log('  --keep-worktree         Leave temporary worktree on disk for local debugging');
  console.log('  --verbose               Print full failing slice output');
}

function formatOutput({
  sliceId,
  rangeFrom,
  rangeTo,
  firstBadSha,
  parentSha,
  failingMetrics,
  touchedFiles,
}) {
  console.log('\n=== Slice Attribution ===');
  console.log(`slice_id=${sliceId}`);
  console.log(`range=${rangeFrom}..${rangeTo}`);
  console.log(`first_bad_sha=${firstBadSha}`);
  console.log(`parent_sha=${parentSha || 'none'}`);
  console.log('\nfailing_metrics:');
  for (const line of failingMetrics) console.log(`- ${line}`);
  console.log('\ntouched_files_parent_to_bad:');
  if (touchedFiles.length === 0) {
    console.log('- (none)');
  } else {
    for (const file of touchedFiles) console.log(`- ${file}`);
  }
}

function parentOf(repoRoot, sha) {
  const result = runCommand('git', ['rev-parse', '--verify', `${sha}^`], repoRoot);
  if ((result.status ?? 1) !== 0) return null;
  return (result.stdout || '').trim() || null;
}

function filesChangedBetween(repoRoot, parentSha, badSha) {
  if (!parentSha) {
    const show = runGit(repoRoot, ['show', '--name-only', '--pretty=format:', badSha]);
    return show
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  const diff = runGit(repoRoot, ['diff', '--name-only', `${parentSha}..${badSha}`]);
  if (!diff) return [];
  return diff
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgsFrom(argv);
  if (opts.help) {
    printUsage();
    return;
  }

  const repoRoot = runGit(process.cwd(), ['rev-parse', '--show-toplevel']);
  const fromSha = resolveCommit(repoRoot, opts.from);
  const toSha = resolveCommit(repoRoot, opts.to);
  const commits = buildCommitList(repoRoot, fromSha, toSha, opts.firstParent);

  let worktreeDir = null;
  try {
    worktreeDir = ensureWorktree(repoRoot, toSha);
    let firstBad = null;

    for (let i = 0; i < commits.length; i++) {
      const sha = commits[i];
      checkoutCommit(worktreeDir, sha);
      const result = runSliceAtCommit(worktreeDir, opts.slice);
      console.log(
        `[${i + 1}/${commits.length}] ${sha.slice(0, 12)} ${result.ok ? 'PASS' : 'FAIL'}`,
      );

      if (!result.ok) {
        firstBad = {
          sha,
          result,
        };
        break;
      }
    }

    if (!firstBad) {
      console.log('\n=== Slice Attribution ===');
      console.log(`slice_id=${opts.slice}`);
      console.log(`range=${fromSha}..${toSha}`);
      console.log('first_bad_sha=none');
      process.exitCode = 1;
      return;
    }

    const parentSha = parentOf(repoRoot, firstBad.sha);
    const failingMetrics = parseFailingMetrics(firstBad.result.output, firstBad.result.exitCode);
    const touchedFiles = filesChangedBetween(repoRoot, parentSha, firstBad.sha);

    formatOutput({
      sliceId: opts.slice,
      rangeFrom: fromSha,
      rangeTo: toSha,
      firstBadSha: firstBad.sha,
      parentSha,
      failingMetrics,
      touchedFiles,
    });

    if (opts.verbose) {
      console.log('\n--- failing_slice_output ---');
      process.stdout.write(firstBad.result.output);
      if (!firstBad.result.output.endsWith('\n')) console.log('');
    }
  } finally {
    if (worktreeDir && !opts.keepWorktree) cleanupWorktree(repoRoot, worktreeDir);
  }
}

const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectExecution) {
  main().catch((err) => {
    console.error('Fatal error:', err?.message || err);
    process.exit(1);
  });
}
