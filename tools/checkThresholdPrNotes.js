#!/usr/bin/env node

import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const STRICT_SLICE_FILE = 'tests/sim/fullrun-slices.js';
const THRESHOLD_FLAG_REGEX = /^--(?:min|max)-[a-z0-9-]+$/i;
const SLICE_DECLARATION_REGEX = /^\s{2}([a-z0-9_]+):\s*\{/i;
const STRING_LITERAL_REGEX = /'([^']*)'|"([^"]*)"/g;

function runGit(args) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    const stderr = (result.stderr || result.stdout || '').trim();
    throw new Error(`git ${args.join(' ')} failed: ${stderr || `exit=${result.status}`}`);
  }

  return (result.stdout || '').trim();
}

function tryRunGit(args) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return result;
}

function parseRange(range) {
  const [baseRef, headRef] = String(range || '').split('..');
  if (!baseRef || !headRef) return null;
  return { baseRef, headRef };
}

function toDisplayValue(value) {
  if (value === undefined) return '(missing)';
  if (value === null) return '(none)';
  return value;
}

export function extractSliceThresholdValues(sourceText) {
  const text = String(sourceText || '');
  const lines = text.split(/\r?\n/);
  const values = new Map();

  let currentSlice = null;
  let inArgs = false;
  let tokens = [];

  const flushArgs = () => {
    if (!currentSlice || tokens.length === 0) return;

    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (!THRESHOLD_FLAG_REGEX.test(token)) continue;
      const nextToken = tokens[i + 1];
      const value = typeof nextToken === 'string' && !nextToken.startsWith('--') ? nextToken : null;
      values.set(`${currentSlice}:${token}`, value);
    }
  };

  for (const line of lines) {
    const sliceMatch = line.match(SLICE_DECLARATION_REGEX);
    if (sliceMatch) {
      currentSlice = sliceMatch[1];
      inArgs = false;
      tokens = [];
      continue;
    }

    if (!currentSlice) continue;

    if (!inArgs && line.includes('args: [')) {
      inArgs = true;
      tokens = [];
    }

    if (!inArgs) continue;

    for (const match of line.matchAll(STRING_LITERAL_REGEX)) {
      const token = match[1] ?? match[2];
      if (typeof token === 'string') tokens.push(token);
    }

    if (line.includes('],')) {
      flushArgs();
      inArgs = false;
      tokens = [];
    }
  }

  return values;
}

export function extractChangedThresholdLines(previousSource, nextSource) {
  const previous = extractSliceThresholdValues(previousSource);
  const next = extractSliceThresholdValues(nextSource);
  const keys = Array.from(new Set([...previous.keys(), ...next.keys()])).sort();

  const changed = [];
  for (const key of keys) {
    const before = previous.get(key);
    const after = next.get(key);
    if (before === after) continue;

    const [sliceName, flag] = key.split(':');
    changed.push(`${sliceName} ${flag}: ${toDisplayValue(before)} -> ${toDisplayValue(after)}`);
  }

  return changed;
}

export function missingPrNoteSections(prBody) {
  const text = String(prBody || '');
  const checks = [
    {
      id: 'attribution command',
      ok: /(sim:fullrun:(?:harness:)?triage|fullrun-slice-triage)/i.test(text),
    },
    {
      id: 'first_bad_sha',
      ok: /first[_\s-]*bad[_\s-]*sha/i.test(text),
    },
    {
      id: 'parent_sha',
      ok: /parent[_\s-]*sha/i.test(text),
    },
    {
      id: 'failing metrics',
      ok: /(failing[_\s-]*metrics?|threshold[_\s-]*breaches?)/i.test(text),
    },
    {
      id: 'touched files',
      ok: /(touched[_\s-]*files?|files[_\s-]*changed)/i.test(text),
    },
  ];

  return checks.filter((check) => !check.ok).map((check) => check.id);
}

function selectDiffRangeFromPayload(payload) {
  const baseSha = payload?.pull_request?.base?.sha;
  const headSha = payload?.pull_request?.head?.sha;
  if (baseSha && headSha) return `${baseSha}..${headSha}`;
  return null;
}

function loadGithubEventPayload() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return null;
  try {
    return JSON.parse(readFileSync(eventPath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse GITHUB_EVENT_PATH payload: ${err?.message || err}`, {
      cause: err,
    });
  }
}

function readStrictSliceSources(preferredRange) {
  const ranges = [];
  if (preferredRange) ranges.push(preferredRange);

  const hasHeadParent = tryRunGit(['rev-parse', '--verify', 'HEAD^']);
  if ((hasHeadParent.status ?? 1) === 0) ranges.push('HEAD^..HEAD');

  for (const range of ranges) {
    const refs = parseRange(range);
    if (!refs) continue;

    const beforeAttempt = tryRunGit(['show', `${refs.baseRef}:${STRICT_SLICE_FILE}`]);
    if ((beforeAttempt.status ?? 1) !== 0) continue;

    const afterAttempt = tryRunGit(['show', `${refs.headRef}:${STRICT_SLICE_FILE}`]);
    if ((afterAttempt.status ?? 1) !== 0) continue;

    return {
      beforeText: beforeAttempt.stdout || '',
      afterText: afterAttempt.stdout || '',
    };
  }

  throw new Error(
    `Unable to compare ${STRICT_SLICE_FILE}. Tried ranges: ${ranges.join(', ') || '(none)'}`,
  );
}

export function validateThresholdPrNotes({ payload, beforeText, afterText }) {
  const changedThresholdLines = extractChangedThresholdLines(beforeText, afterText);
  if (changedThresholdLines.length === 0) {
    return { enforced: false, changedThresholdLines, missing: [] };
  }

  const prBody = payload?.pull_request?.body || '';
  const missing = missingPrNoteSections(prBody);
  return {
    enforced: true,
    changedThresholdLines,
    missing,
  };
}

export function main() {
  const payload = loadGithubEventPayload();
  if (!payload?.pull_request) {
    console.log('Threshold PR note check skipped (not a pull_request event).');
    return;
  }

  runGit(['rev-parse', '--show-toplevel']);
  const diffRange = selectDiffRangeFromPayload(payload);
  const { beforeText, afterText } = readStrictSliceSources(diffRange);
  const result = validateThresholdPrNotes({ payload, beforeText, afterText });

  if (!result.enforced) {
    console.log(`No strict threshold changes detected in ${STRICT_SLICE_FILE}.`);
    return;
  }

  if (result.missing.length > 0) {
    console.error(
      'Strict threshold changes detected, but PR notes are missing required triage fields.',
    );
    console.error(`Missing: ${result.missing.join(', ')}`);
    console.error('Changed threshold lines:');
    for (const line of result.changedThresholdLines) {
      console.error(`- ${line}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('Strict threshold PR notes check passed.');
}

const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectExecution) {
  main();
}
