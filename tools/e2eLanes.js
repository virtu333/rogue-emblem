#!/usr/bin/env node
// E2E lanes: which CI job runs which Playwright spec.
//
// tests/e2e/lanes.json is the single source of truth. Everything else reads it:
//   - the Playwright configs select their files through specSelection();
//   - `npm run test:e2e:lane -- <lane>` (and the named lane scripts) run a lane;
//   - CI builds its e2e job matrix from `node tools/e2eLanes.js matrix`;
//   - `npm run check:e2e-lanes` fails when a spec is in no lane and not excluded,
//     when a lane names a spec that does not exist, or when a spec list appears
//     anywhere else (package.json scripts, workflows), where it would drift.
// A sharded lane is split by measured time (tests/e2e/durations.json, planShards), so
// a shard of slow specs does not hold the run up while another sits idle.
//
// Pure helpers are exported for tests; the CLI is at the bottom.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const E2E_DIR = 'tests/e2e';
export const LANES_FILE = `${E2E_DIR}/lanes.json`;
/** Measured seconds of test work per spec (refreshed from CI with `durations`). */
export const DURATIONS_FILE = `${E2E_DIR}/durations.json`;
/** A spec with no measurement yet (new) is assumed to take this long. */
export const DEFAULT_SPEC_SECONDS = 60;
export const DEFAULT_CONFIG = 'playwright.config.js';
/** Env var the lane runner sets; the Playwright configs then select only that lane. */
export const LANE_ENV = 'E2E_LANE';
/** Env var the lane runner sets to the shard it runs ("2/6"), for the duration report. */
export const SHARD_ENV = 'E2E_SHARD';

const LANE_NAME = /^[a-z0-9][a-z0-9-]*$/;
const SPEC_SUFFIX = '.spec.js';
const LANE_KEYS = new Set(['name', 'description', 'config', 'build', 'workers', 'shards', 'specs']);
const EXCLUSION_KEYS = new Set(['spec', 'reason']);

export function readLanes(root = REPO_ROOT) {
  return JSON.parse(readFileSync(join(root, LANES_FILE), 'utf8'));
}

/** Measured seconds per spec, or {} when the file is missing. */
export function readDurations(root = REPO_ROOT) {
  const file = join(root, DURATIONS_FILE);
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, 'utf8')).seconds ?? {};
}

/** "2/6" -> { index: 2, total: 6 }, or null. */
export function parseShard(value) {
  const match = /^(\d+)\/(\d+)$/.exec(String(value ?? ''));
  if (!match) return null;
  const index = Number(match[1]);
  const total = Number(match[2]);
  return index >= 1 && index <= total ? { index, total } : null;
}

/**
 * Split a lane's specs into `total` shards of about equal measured time: longest spec
 * first, each to the shard with the least time so far (ties to the lower shard), so
 * the split is the same on every machine. Specs keep the lane's order inside a shard.
 * A spec with no measurement counts as DEFAULT_SPEC_SECONDS.
 * @returns {{ specs: string[], seconds: number }[]} one entry per shard
 */
export function planShards(specs, total, durations = {}) {
  const cost = (spec) => {
    const seconds = Number(durations[spec]);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : DEFAULT_SPEC_SECONDS;
  };
  const shards = Array.from({ length: total }, () => ({ specs: new Set(), seconds: 0 }));
  const order = [...specs].sort((a, b) => cost(b) - cost(a) || (a < b ? -1 : a > b ? 1 : 0));
  for (const spec of order) {
    let target = shards[0];
    for (const shard of shards) if (shard.seconds < target.seconds) target = shard;
    target.specs.add(spec);
    target.seconds += cost(spec);
  }
  return shards.map((shard) => ({
    specs: specs.filter((spec) => shard.specs.has(spec)),
    seconds: shard.seconds,
  }));
}

/** Every Playwright spec under tests/e2e, as a path relative to it ("a.spec.js", "sub/b.spec.js"). */
export function listSpecFiles(root = REPO_ROOT) {
  const base = join(root, E2E_DIR);
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(SPEC_SUFFIX))
        out.push(relative(base, full).split(sep).join('/'));
    }
  };
  walk(base);
  return out.sort();
}

const configOf = (lane) => lane.config || DEFAULT_CONFIG;
const isPositiveInt = (n) => Number.isInteger(n) && n > 0;

/**
 * Every problem with the lanes manifest, as readable strings (empty when valid).
 * @param {object} manifest parsed lanes.json
 * @param {string[]} specFiles from listSpecFiles()
 * @param {{ fileExists?: (path: string) => boolean,
 *           sources?: { name: string, text: string }[] }} [options]
 *   fileExists checks lane configs (repo-relative); sources are files that must not
 *   carry their own spec lists (package.json, workflows).
 */
export function validateLanes(manifest, specFiles, { fileExists = () => true, sources = [] } = {}) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.lanes)) {
    return [`${LANES_FILE} must be an object with a "lanes" array`];
  }
  const excluded = manifest.excluded ?? [];
  if (!Array.isArray(excluded)) errors.push('"excluded" must be an array');
  const known = new Set(specFiles);
  const owner = new Map(); // spec -> lane name, or "excluded"
  const laneNames = new Set();

  const claim = (spec, holder, where) => {
    if (typeof spec !== 'string' || !spec.endsWith(SPEC_SUFFIX)) {
      errors.push(`${where}: "${spec}" is not a *${SPEC_SUFFIX} file name`);
      return;
    }
    if (!known.has(spec)) errors.push(`${where}: names ${E2E_DIR}/${spec}, which does not exist`);
    const previous = owner.get(spec);
    if (previous === holder) errors.push(`${where}: lists ${spec} twice`);
    else if (previous) errors.push(`${spec} is in both ${previous} and ${holder}`);
    else owner.set(spec, holder);
  };

  manifest.lanes.forEach((lane, i) => {
    const where = `lane ${lane?.name ? `"${lane.name}"` : `#${i + 1}`}`;
    if (!lane || typeof lane !== 'object') {
      errors.push(`${where}: must be an object`);
      return;
    }
    for (const key of Object.keys(lane)) {
      if (!LANE_KEYS.has(key)) errors.push(`${where}: unknown key "${key}"`);
    }
    if (typeof lane.name !== 'string' || !LANE_NAME.test(lane.name)) {
      errors.push(`${where}: name must be lower-case kebab-case`);
    } else if (laneNames.has(lane.name)) {
      errors.push(`${where}: duplicate lane name`);
    } else {
      laneNames.add(lane.name);
    }
    if (typeof lane.description !== 'string' || !lane.description.trim()) {
      errors.push(`${where}: needs a description`);
    }
    if (lane.config !== undefined) {
      if (typeof lane.config !== 'string' || !lane.config.trim()) {
        errors.push(`${where}: config must be a file name`);
      } else if (!fileExists(lane.config)) {
        errors.push(`${where}: config ${lane.config} does not exist`);
      }
    }
    if (lane.build !== undefined && typeof lane.build !== 'boolean') {
      errors.push(`${where}: build must be true or false`);
    }
    if (lane.workers !== undefined && !isPositiveInt(lane.workers)) {
      errors.push(`${where}: workers must be a positive integer`);
    }
    if (lane.shards !== undefined && !isPositiveInt(lane.shards)) {
      errors.push(`${where}: shards must be a positive integer`);
    }
    if (!Array.isArray(lane.specs) || lane.specs.length === 0) {
      errors.push(`${where}: needs a non-empty "specs" array`);
      return;
    }
    if (isPositiveInt(lane.shards) && lane.shards > lane.specs.length) {
      errors.push(`${where}: ${lane.shards} shards for ${lane.specs.length} specs`);
    }
    for (const spec of lane.specs) claim(spec, `lane "${lane.name}"`, where);
  });

  if (Array.isArray(excluded)) {
    excluded.forEach((entry, i) => {
      const where = `excluded #${i + 1}${entry?.spec ? ` (${entry.spec})` : ''}`;
      if (!entry || typeof entry !== 'object') {
        errors.push(`${where}: must be { spec, reason }`);
        return;
      }
      for (const key of Object.keys(entry)) {
        if (!EXCLUSION_KEYS.has(key)) errors.push(`${where}: unknown key "${key}"`);
      }
      if (typeof entry.reason !== 'string' || !entry.reason.trim()) {
        errors.push(`${where}: needs a reason`);
      }
      claim(entry.spec, 'the exclusion list', where);
    });
  }

  for (const spec of specFiles) {
    if (!owner.has(spec)) {
      errors.push(
        `${E2E_DIR}/${spec} is in no CI lane: add it to a lane in ${LANES_FILE} (or to "excluded" with a reason)`,
      );
    }
  }

  const specRef = /tests\/e2e\/[\w./-]+\.spec\.js/g;
  for (const { name, text } of sources) {
    const refs = [...new Set(String(text).match(specRef) || [])];
    if (refs.length) {
      errors.push(
        `${name} names e2e specs directly (${refs.join(', ')}); list them in ${LANES_FILE} and run the lane instead`,
      );
    }
  }
  return errors;
}

function findLane(manifest, name) {
  const lane = manifest.lanes.find((entry) => entry.name === name);
  if (!lane) {
    const names = manifest.lanes.map((entry) => entry.name).join(', ');
    throw new Error(`Unknown e2e lane "${name}". Lanes: ${names}`);
  }
  return lane;
}

/**
 * The testMatch/testIgnore a Playwright config uses. With E2E_LANE set, exactly that
 * lane's specs when the lane uses this config, and nothing otherwise (so a config can
 * import another as its base; Playwright then reports "No tests found" if the lane is
 * run with the wrong config). With E2E_SHARD ("2/6") too, only that shard's specs
 * (planShards over tests/e2e/durations.json). Without a lane, a config that owns lanes (release,
 * compact) runs their specs, and the default config runs every spec except the ones
 * that belong to another config.
 * @returns {{ testMatch?: string[], testIgnore: string[] }}
 */
export function specSelection(
  configFile,
  { manifest = readLanes(), env = process.env, durations = () => readDurations() } = {},
) {
  const laneName = env[LANE_ENV];
  if (laneName) {
    const lane = findLane(manifest, laneName);
    if (configOf(lane) !== configFile) return { testMatch: [], testIgnore: [] };
    const shard = parseShard(env[SHARD_ENV]);
    if (!shard) return { testMatch: [...lane.specs], testIgnore: [] };
    if (shard.total > lane.specs.length) {
      throw new Error(
        `Lane "${lane.name}" has ${lane.specs.length} specs for ${shard.total} shards`,
      );
    }
    const plan = planShards(lane.specs, shard.total, durations());
    return { testMatch: plan[shard.index - 1].specs, testIgnore: [] };
  }
  const own = manifest.lanes.filter((lane) => configOf(lane) === configFile);
  const others = manifest.lanes.filter((lane) => configOf(lane) !== configFile);
  if (configFile === DEFAULT_CONFIG) {
    return { testIgnore: others.flatMap((lane) => lane.specs) };
  }
  return { testMatch: own.flatMap((lane) => lane.specs), testIgnore: [] };
}

/**
 * The CI job matrix: one entry per lane, or per shard of a sharded lane.
 * @returns {{ id: string, lane: string, shard: string, build: boolean }[]}
 */
export function ciMatrix(manifest) {
  return manifest.lanes.flatMap((lane) => {
    const shards = lane.shards || 1;
    const build = lane.build === true;
    if (shards === 1) return [{ id: lane.name, lane: lane.name, shard: '', build }];
    return Array.from({ length: shards }, (_, i) => ({
      id: `${lane.name}-${i + 1}of${shards}`,
      lane: lane.name,
      shard: `${i + 1}/${shards}`,
      build,
    }));
  });
}

/** The Playwright invocation for a lane. `extraArgs` may carry --shard=i/n or other flags. */
export function laneCommand(manifest, name, extraArgs = []) {
  const lane = findLane(manifest, name);
  const args = ['playwright', 'test', '--config', configOf(lane)];
  if (lane.workers && !extraArgs.some((arg) => /^(--workers|-j)(=|$)/.test(arg))) {
    args.push(`--workers=${lane.workers}`);
  }
  // A lane's shards are split by measured time (planShards), not by Playwright's
  // --shard, which splits by test count: the runner takes --shard=i/n off the command
  // line and the config selects the shard's specs from the env.
  const env = { [LANE_ENV]: lane.name };
  for (const arg of extraArgs) {
    const shard = /^--shard=(.*)$/.exec(arg);
    if (!shard) args.push(arg);
    else if (parseShard(shard[1])) env[SHARD_ENV] = shard[1];
    else throw new Error(`Bad shard "${shard[1]}": expected i/n`);
  }
  return { command: 'npx', args, env };
}

function sourcesToScan(root) {
  const sources = [];
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const [name, script] of Object.entries(pkg.scripts || {})) {
    sources.push({ name: `package.json script "${name}"`, text: script });
  }
  const workflows = join(root, '.github', 'workflows');
  if (existsSync(workflows)) {
    for (const file of readdirSync(workflows).filter((f) => /\.ya?ml$/.test(f))) {
      sources.push({
        name: `.github/workflows/${file}`,
        text: readFileSync(join(workflows, file), 'utf8'),
      });
    }
  }
  return sources;
}

/** Problems with tests/e2e/durations.json: a spec it names must exist, a time be a number. */
export function validateDurations(durations, specFiles) {
  const known = new Set(specFiles);
  const errors = [];
  for (const [spec, seconds] of Object.entries(durations)) {
    if (!known.has(spec)) errors.push(`${DURATIONS_FILE} names ${spec}, which does not exist`);
    if (!Number.isFinite(seconds) || seconds < 0) {
      errors.push(`${DURATIONS_FILE}: ${spec} needs a number of seconds`);
    }
  }
  return errors;
}

/**
 * New durations from duration reports (tools/e2eDurationReporter.js, one per shard):
 * each spec a report measured takes its new time, rounded to whole seconds; the rest
 * keep theirs. Specs that no longer exist are dropped.
 */
export function mergeDurations(previous, reports, specFiles) {
  const known = new Set(specFiles);
  const measured = {};
  for (const report of reports) {
    for (const [spec, entry] of Object.entries(report.files ?? {})) {
      measured[spec] = (measured[spec] ?? 0) + entry.seconds;
    }
  }
  const merged = { ...previous };
  for (const [spec, seconds] of Object.entries(measured)) merged[spec] = Math.round(seconds);
  return Object.fromEntries(
    Object.keys(merged)
      .filter((spec) => known.has(spec))
      .sort()
      .map((spec) => [spec, merged[spec]]),
  );
}

function readReports(dir) {
  const reports = [];
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.json')) reports.push(JSON.parse(readFileSync(full, 'utf8')));
    }
  };
  walk(dir);
  return reports;
}

/** Validate the repository's real manifest; returns the error list. */
export function checkRepository(root = REPO_ROOT) {
  let manifest;
  try {
    manifest = readLanes(root);
  } catch (error) {
    return [`cannot read ${LANES_FILE}: ${error.message}`];
  }
  let durations;
  try {
    durations = readDurations(root);
  } catch (error) {
    return [`cannot read ${DURATIONS_FILE}: ${error.message}`];
  }
  const specFiles = listSpecFiles(root);
  return [
    ...validateLanes(manifest, specFiles, {
      fileExists: (file) => existsSync(join(root, file)),
      sources: sourcesToScan(root),
    }),
    ...validateDurations(durations, specFiles),
  ];
}

function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'check') {
    const errors = checkRepository();
    if (errors.length) {
      console.error(`[check:e2e-lanes] ${errors.length} problem(s):`);
      for (const error of errors) console.error(`  - ${error}`);
      return 1;
    }
    const manifest = readLanes();
    const laned = manifest.lanes.reduce((n, lane) => n + lane.specs.length, 0);
    const excluded = (manifest.excluded || []).length;
    console.log(
      `[check:e2e-lanes] OK: ${laned} specs in ${manifest.lanes.length} lanes, ${excluded} excluded.`,
    );
    return 0;
  }
  if (command === 'matrix') {
    console.log(JSON.stringify(ciMatrix(readLanes())));
    return 0;
  }
  if (command === 'list') {
    for (const lane of readLanes().lanes) {
      console.log(`${lane.name} (${lane.specs.length}): ${lane.description}`);
    }
    return 0;
  }
  if (command === 'plan') {
    // Each sharded lane's split and its estimated minutes of test work per shard.
    const durations = readDurations();
    for (const lane of readLanes().lanes) {
      const total = lane.shards || 1;
      const plan = planShards(lane.specs, total, durations);
      plan.forEach((shard, i) => {
        const id = total > 1 ? `${lane.name} ${i + 1}/${total}` : lane.name;
        const minutes = (shard.seconds / 60).toFixed(1).padStart(5);
        console.log(`${minutes} min of test work  ${id}: ${shard.specs.join(', ')}`);
      });
    }
    return 0;
  }
  if (command === 'durations' && rest[0]) {
    // Refresh tests/e2e/durations.json from a folder of duration reports (the CI
    // e2e-durations-* artifacts of one full run, unzipped side by side).
    const reports = readReports(rest[0]);
    if (!reports.length) {
      console.error(`[e2e durations] no reports under ${rest[0]}`);
      return 1;
    }
    const seconds = mergeDurations(readDurations(), reports, listSpecFiles());
    const body = {
      $comment:
        'Seconds of test work per spec (all its tests, retries included) from a CI run, used by tools/e2eLanes.js to split sharded lanes evenly. Refresh: download the e2e-durations-* artifacts of a full CI run into one folder, then node tools/e2eLanes.js durations <folder>.',
      seconds,
    };
    writeFileSync(join(REPO_ROOT, DURATIONS_FILE), `${JSON.stringify(body, null, 2)}\n`);
    console.log(`[e2e durations] ${reports.length} reports -> ${DURATIONS_FILE}`);
    return 0;
  }
  if (command === 'run' && rest[0]) {
    const [name, ...extra] = rest;
    const { command: bin, args, env } = laneCommand(readLanes(), name, extra);
    console.log(`[e2e lane ${name}] ${bin} ${args.join(' ')}`);
    const result = spawnSync(bin, args, {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...env },
      shell: process.platform === 'win32',
    });
    if (result.error) throw result.error;
    return result.status ?? 1;
  }
  console.error(
    'Usage: node tools/e2eLanes.js check | matrix | list | plan | durations <dir> | run <lane> [playwright args]',
  );
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  process.exit(main(process.argv.slice(2)));
}
