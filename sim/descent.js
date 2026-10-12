// sim/descent.js — Act V, the Descent, against the legacy two-node Act V, from the same runs
// (docs/sim-reports/act-v-descent.md for the method and a reading of the numbers).
//
//   npm run sim:descent -- [--trials N] [--seed S] [--difficulty all|normal,dusk,hard,lunatic]
//                          [--workers W] [--meta none|endgame] [--fork keyed|battle|event]
//                          [--phase all|capture|act5] [--arms legacy,descent] [--stones lieutenant=N]
//                          [--out runs.jsonl] [--from a.jsonl,...] [--md report.md]
//
// Each arm sets the route's switch on its own copy of the data (`enabled` on a clone: off for
// `legacy`, on for `descent`), never in the file, so the arms hold whatever the file ships.
//
// Each trial is one run, played in two parts:
//   1. CAPTURE. Acts I-IV (First Light: I-III) with the claiming player (tests/sim/
//      ClaimingRunDriver.js: loot, items, churches, Vision rewinds, a casual commander), up to
//      the advance into the final act (`stopBeforeAct`). The run (RunManager.toJSON) and the
//      battle stream's state are kept: the act's entry state.
//   2. ACT V, twice from that one entry state, with the stream put back to the same point:
//      `legacy` (the route switched off: the Ruins and the finale, the two-node act) and `descent`
//      (the route switched on). So the two arms differ only in the act (common random numbers),
//      and the comparison is paired run by run.
// An Act V replay plays under the checkout's Revival Stones table, not the one a capture
// snapshotted at its run's start; `--stones lieutenant=1` lays a count over it (a before/after).
// `--phase capture` writes the entry states only (`--out`); `--phase act5 --from captures`
// plays the act from saved entry states (with whatever data the checkout holds: the tuning
// loop), so a retune never replays Acts I-IV.
//
// The player in Act V is the claiming player. A commander fall it cannot rewind is counted, and
// the commander is restored so the act is measured to its end; the report reads a run as lost at
// its first such fall (permadeath), so "clear" means every Act V battle won with no commander
// fall left standing and none stalled at the turn cap.

import { fork } from 'child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { loadGameData } from '../tests/testData.js';
import { installStatefulSeed, restoreStatefulRandom } from './lib/StatefulRNG.js';
import { ClaimingRunDriver } from '../tests/sim/ClaimingRunDriver.js';
import { buildRunMetaEffects } from '../tests/sim/fullrun-runner.js';
import { RunManager } from '../src/engine/RunManager.js';
import { DIFFICULTY_IDS, resolveDifficultyMode } from '../src/engine/DifficultyEngine.js';
import { REVIVAL_STONE_KINDS } from '../src/engine/RevivalStones.js';
import { riteBand } from '../src/engine/Rite.js';
import { NODE_TYPES } from '../src/utils/constants.js';
import { parseArgs, printHeader, printTable } from './lib/TableFormatter.js';
import { policyHash } from '../tests/sim/ClaimingPolicies.js';
import { wilson } from './lib/BlessingReport.js';
import { captureCellKey, indexCaptures, pairTrials } from './lib/DescentTrials.js';
import { setSingleSlotPoolForSims } from '../src/engine/SkillSlots.js';

const RUNG_LABELS = {
  normal: 'First Light',
  dusk: 'Dusk',
  hard: 'Nightfall',
  lunatic: 'Black Sun',
};
const RUNG_SEED_OFFSET = { normal: 0, dusk: 100000, hard: 200000, lunatic: 300000 };
// `nolanding`: the Descent without the Nightfall/Black Sun route's Landing row (spec §2.2: the
// sims decide whether it stays); on a route without one it is the Descent itself.
export const ARMS = Object.freeze(['legacy', 'descent', 'nolanding']);
// The player every record was played by (sim/lib/DescentTrials.js: part of a trial's identity).
export const AGENT = 'claiming';

const rulesets = new WeakMap();
/**
 * The game data a record was played under, as a short hash (part of a trial's identity): two
 * replays of one capture under different data are different trials.
 */
export function rulesetOf(gameData) {
  if (!rulesets.has(gameData))
    rulesets.set(gameData, policyHash(JSON.stringify(gameData)).toString(16).padStart(8, '0'));
  return rulesets.get(gameData);
}

const opts = parseArgs({
  trials: 10,
  seed: 1,
  difficulty: 'all',
  workers: 1,
  meta: 'none',
  fork: 'keyed',
  phase: 'all',
  arms: 'legacy,descent',
  out: null,
  from: null,
  md: null,
  shard: null,
  stones: null,
  until: null,
  slots: 'split',
});

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain && opts.help) {
  console.log(
    'Usage: npm run sim:descent -- [--trials N] [--seed S] [--difficulty all|normal,...] [--workers W] [--meta none|endgame] [--fork keyed|battle|event] [--phase all|capture|act5] [--stones lieutenant=N] [--out f.jsonl] [--from a.jsonl,...] [--md report.md]',
  );
  process.exit(0);
}

const rungs =
  String(opts.difficulty) === 'all'
    ? [...DIFFICULTY_IDS]
    : String(opts.difficulty)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
for (const rung of rungs)
  if (!DIFFICULTY_IDS.includes(rung)) throw new Error(`Unknown difficulty "${rung}".`);
const arms = String(opts.arms)
  .split(',')
  .map((s) => s.trim())
  .filter((a) => ARMS.includes(a));

/** The data with the Descent switched on (a copy: the file's `enabled` is never touched). */
export function descentGameData(gameData) {
  return { ...gameData, descent: { ...structuredClone(gameData.descent), enabled: true } };
}

/** The data with the Descent switched off: the legacy two-node act (a copy, as above). */
export function legacyGameData(gameData) {
  return { ...gameData, descent: { ...structuredClone(gameData.descent), enabled: false } };
}

/** The Descent on, with every route's Landing row taken out (a copy). */
export function noLandingGameData(gameData) {
  const data = descentGameData(gameData);
  for (const route of Object.values(data.descent.routes || {}))
    route.rows = route.rows.filter((row) => !row.nodes.some((n) => n.key === 'landing'));
  return data;
}

const ARM_DATA = { legacy: legacyGameData, descent: descentGameData, nolanding: noLandingGameData };

/**
 * The claiming player with the Descent's fork routed by policy: `keyed` (half the runs take the
 * Mortuary Column, half the event, by a hash of the run seed), `battle` or `event`. Everywhere
 * else it routes as the claiming player does.
 */
export class DescentDriver extends ClaimingRunDriver {
  _chooseNode(available) {
    const rm = this.runManager;
    const fork = this.options.fork || 'keyed';
    if (rm?.nodeMap?.descent && available.length > 1) {
      const battle = available.find((n) => n.type === NODE_TYPES.BATTLE);
      const event = available.find((n) => n.type === NODE_TYPES.EVENT);
      if (battle && event) {
        const wantEvent =
          fork === 'event' ||
          (fork === 'keyed' && policyHash(`descent-fork:${rm.runSeed >>> 0}`) % 2 === 1);
        return wantEvent ? event : battle;
      }
    }
    return super._chooseNode(available);
  }
}

function driverOptions(gameData, { rung, seed, rng, meta, fork = opts.fork }) {
  return {
    rng,
    fork,
    metaEffects: buildRunMetaEffects({ metaPreset: meta }, gameData),
    runOptions: { runSeed: seed, difficultyId: rung, autoSelectBlessing: false },
  };
}

/** What the army looks like at the act's entry. */
function entrySummary(rm) {
  const roster = rm.roster || [];
  return {
    roster: roster.length,
    avgLevel: roster.length ? roster.reduce((n, u) => n + (u.level || 0), 0) / roster.length : 0,
    promoted: roster.filter((u) => u.tier === 'promoted').length,
    vision: rm.visionChargesRemaining ?? 0,
    gold: rm.gold ?? 0,
    shadow: rm.eclipse?.shadow ?? 0,
    fallen: (rm.fallenUnits || []).length,
  };
}

/** Acts I-IV with the claiming player, up to the final act's entry. */
export async function captureEntry(gameData, { rung, seed, meta = 'none' }) {
  const rng = installStatefulSeed(seed);
  try {
    const driver = new DescentDriver(gameData, {
      ...driverOptions(gameData, { rung, seed, rng, meta }),
      stopBeforeAct: 'finalBoss',
    });
    const result = await driver.run();
    const rm = driver.runManager;
    const base = {
      kind: 'capture',
      difficulty: rung,
      seed,
      meta,
      agent: AGENT,
      ruleset: rulesetOf(gameData),
      result: result.result,
      pre: {
        battles: driver.battleLog.length,
        koBattles: driver.battleLog.filter((b) => b.commanderKOs > 0).length,
        deaths: driver.battleLog.reduce((n, b) => n + b.unitDeaths, 0),
        stalls: driver.battleLog.filter((b) => b.stalled).length,
        // Every battle before Act V by act and kind, a yardstick for the Descent's own nodes.
        byAct: Object.fromEntries(
          [...new Set(driver.battleLog.map((b) => b.act))].map((act) => {
            const of = (boss) => {
              const list = driver.battleLog.filter((b) => b.act === act && b.boss === boss);
              return {
                battles: list.length,
                koBattles: list.filter((b) => b.commanderKOs > 0).length,
                stalls: list.filter((b) => b.stalled).length,
                deaths: list.reduce((n, b) => n + b.unitDeaths, 0),
              };
            };
            return [act, { boss: of(true), other: of(false) }];
          }),
        ),
        // The act bosses before Act V (the Landing's yardstick, spec §11).
        bosses: driver.battleLog
          .filter((b) => b.boss)
          .map((b) => ({
            act: b.act,
            commanderKOs: b.commanderKOs,
            stalled: b.stalled,
            unitDeaths: b.unitDeaths,
            turns: b.turns,
            par: b.par,
          })),
        // Every battle's length and size, and the nodes walked (a run's pace: minutes of play).
        log: driver.battleLog.map((b) => ({
          act: b.act,
          boss: b.boss,
          turns: b.turns,
          deployed: b.deployed,
          commanderKOs: b.commanderKOs,
          stalled: b.stalled,
        })),
        path: driver.trace.map((t) => t.nodeType),
        reachedFirstActBoss: rm.reachedFirstActBoss === true,
      },
    };
    if (result.result !== 'paused') return base;
    return {
      ...base,
      entry: entrySummary(rm),
      run: rm.toJSON(),
      rngState: rng.getState(),
    };
  } finally {
    restoreStatefulRandom();
  }
}

/** `--stones lieutenant=1,emperor=2` as `{ lieutenant: 1, emperor: 2 }`; unknown kinds throw. */
export function parseStoneOverride(text) {
  const out = {};
  for (const part of String(text || '')
    .split(',')
    .filter(Boolean)) {
    const [kind, count] = part.split('=').map((x) => x.trim());
    const n = Number(count);
    if (!REVIVAL_STONE_KINDS.includes(kind) || !Number.isInteger(n) || n < 0)
      throw new Error(`--stones: "${part}" is not <kind>=<count> (kinds: ${REVIVAL_STONE_KINDS})`);
    out[kind] = n;
  }
  return out;
}

/**
 * The Revival Stones table an Act V replay plays under: the checkout's data for the rung, with
 * `override` laid over it. A run snapshots the table at its start (`difficultyModifiers`), so a
 * capture made before a stone retune would otherwise replay Act V under the old count and the
 * tuning loop would measure nothing.
 */
export function revivalStonesForReplay(gameData, rung, override = {}) {
  const table = resolveDifficultyMode(gameData.difficulty, rung).modifiers.revivalStones;
  return { ...table, ...override };
}

/** The final act from a saved entry state, on one arm. */
export async function playActV(
  gameData,
  capture,
  arm,
  { stones = opts.stones, fork = opts.fork, until = opts.until } = {},
) {
  const data = ARM_DATA[arm](gameData);
  const rng = installStatefulSeed(0);
  rng.setState(capture.rngState);
  try {
    const driver = new DescentDriver(
      data,
      driverOptions(data, {
        rung: capture.difficulty,
        seed: capture.seed,
        rng,
        meta: capture.meta,
        fork,
      }),
    );
    // `--until <descentKey>`: stop once that node's battle is fought (won or lost), so a retune of
    // one node replays only the act up to it. Such a record ends `paused`, never `victory`.
    if (until)
      driver.options.stopWhen = (d) => d.battleLog.some((b) => b.descentKey === String(until));
    const rm = RunManager.fromJSON(structuredClone(capture.run), data);
    const override = typeof stones === 'string' ? parseStoneOverride(stones) : stones || {};
    rm.difficultyModifiers = {
      ...rm.difficultyModifiers,
      revivalStones: revivalStonesForReplay(gameData, capture.difficulty, override),
    };
    driver.runManager = rm;
    rm.advanceAct();
    driver.metrics.actsAdvanced++;
    driver._afterAct();
    const riteStart = rm.rite?.words ?? null;
    const result = await driver.run();
    const finaleNode = rm.nodeMap?.nodes?.find((n) => n.id === rm.nodeMap?.bossNodeId) || null;
    return {
      kind: 'act5',
      arm,
      difficulty: capture.difficulty,
      seed: capture.seed,
      // The trial's identity (sim/lib/DescentTrials.js): the arms of one trial share all of it.
      meta: capture.meta,
      fork,
      agent: AGENT,
      ruleset: rulesetOf(gameData),
      stones: rm.difficultyModifiers.revivalStones,
      result: result.result,
      routeId: rm.nodeMap?.descent?.routeId ?? null,
      riteStart,
      riteFinal: rm.rite?.words ?? null,
      riteLog: rm.rite?.log ?? null,
      finaleBoss: finaleNode?.battleParams?.bossName ?? null,
      path: driver.trace.map((t) => ({
        type: t.nodeType,
        key: rm.nodeMap?.nodes?.find((n) => n.id === t.nodeId)?.descentKey ?? null,
        eventId: t.eventId ?? null,
      })),
      eventChoices: driver.metrics.eventsByChoice,
      battles: driver.battleLog,
      visionAtEnd: rm.visionChargesRemaining ?? 0,
    };
  } finally {
    restoreStatefulRandom();
  }
}

// ── Jobs and workers ──────────────────────────────────────────────────────

function jobs() {
  const list = [];
  for (const rung of rungs)
    for (let i = 0; i < opts.trials; i++)
      list.push({ rung, seed: Number(opts.seed) + i + (RUNG_SEED_OFFSET[rung] || 0) });
  return list;
}

function readLines(files) {
  const out = [];
  for (const file of files)
    for (const line of readFileSync(file, 'utf-8').split('\n'))
      if (line.trim()) out.push(JSON.parse(line));
  return out;
}

const fromFiles = () =>
  String(opts.from || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** One shard's work: capture and/or the two arms, a JSON line per record, written as it goes. */
async function playShard(shard, outFile) {
  const [k, n] = String(shard).split('/').map(Number);
  // `--slots single`: the skill/ability slot rule before #344 (one pool of five), for a paired
  // comparison against today's split (5 skills + 3 abilities). Records carry which rule played.
  if (!['split', 'single'].includes(String(opts.slots)))
    throw new Error(`--slots: "${opts.slots}" is not split or single`);
  setSingleSlotPoolForSims(opts.slots === 'single');
  const gameData = loadGameData();
  const write = (record) =>
    appendFileSync(outFile, `${JSON.stringify({ ...record, slots: String(opts.slots) })}\n`);
  const tryRecord = async (job, fn) => {
    try {
      return await fn();
    } catch (error) {
      return {
        kind: 'error',
        difficulty: job.difficulty,
        seed: job.seed,
        meta: job.meta,
        arm: job.arm ?? null,
        error: String(error?.stack || error),
      };
    }
  };
  if (opts.phase === 'act5') {
    const captures = readLines(fromFiles()).filter(
      (c) => c.kind === 'capture' && c.run && rungs.includes(c.difficulty),
    );
    // Two captures of one run would replay it twice under one identity: refuse before playing.
    indexCaptures(captures);
    for (const capture of captures.filter((_, i) => i % n === k))
      for (const arm of arms)
        write(await tryRecord({ ...capture, arm }, () => playActV(gameData, capture, arm)));
    return;
  }
  for (const job of jobs().filter((_, i) => i % n === k)) {
    const capture = await tryRecord({ difficulty: job.rung, seed: job.seed, meta: opts.meta }, () =>
      captureEntry(gameData, { rung: job.rung, seed: job.seed, meta: opts.meta }),
    );
    if (opts.phase === 'capture') {
      write(capture);
      continue;
    }
    // The entry state itself is large; the full run keeps its summary only.
    const { run, rngState, ...summary } = capture;
    write(summary);
    if (!run) continue;
    for (const arm of arms)
      write(
        await tryRecord({ ...capture, arm }, () =>
          playActV(gameData, { ...capture, run, rngState }, arm),
        ),
      );
  }
}

async function playAll() {
  const workers = Math.max(1, Math.min(2, Math.trunc(Number(opts.workers) || 1)));
  const dir = mkdtempSync(join(tmpdir(), 'sim-descent-'));
  const files = [];
  const started = Date.now();
  try {
    if (workers === 1) {
      const file = opts.out || join(dir, 'runs-0.jsonl');
      writeFileSync(file, '');
      files.push(file);
      await playShard('0/1', file);
    } else {
      const self = fileURLToPath(import.meta.url);
      const drop = ['--workers', '--out', '--md'];
      const args = process.argv
        .slice(2)
        .filter((a, i, all) => !drop.includes(a) && !drop.includes(all[i - 1]));
      await Promise.all(
        Array.from({ length: workers }, (_, k) => {
          const file = join(dir, `runs-${k}.jsonl`);
          writeFileSync(file, '');
          files.push(file);
          return new Promise((resolve, reject) => {
            const child = fork(self, [...args, '--shard', `${k}/${workers}`, '--out', file], {
              stdio: 'inherit',
            });
            child.on('exit', (code) =>
              code === 0 ? resolve() : reject(new Error(`worker ${k} exited ${code}`)),
            );
          });
        }),
      );
    }
    const records = readLines(files);
    if (opts.out && workers > 1)
      writeFileSync(opts.out, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return { records, seconds: (Date.now() - started) / 1000 };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── Report ────────────────────────────────────────────────────────────────

const Z95 = 1.959963984540054;
const pctCI = (k, n) => {
  if (!(n > 0)) return '-';
  const w = wilson(k, n);
  return `${(100 * w.p).toFixed(0)}% [${(100 * w.lo).toFixed(0)}, ${(100 * w.hi).toFixed(0)}]`;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const meanCI = (xs, d = 2) => {
  if (!xs.length) return '-';
  const m = mean(xs);
  if (xs.length < 2) return m.toFixed(d);
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
  const half = (Z95 * sd) / Math.sqrt(xs.length);
  return `${m.toFixed(d)} [${(m - half).toFixed(d)}, ${(m + half).toFixed(d)}]`;
};
const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** A battle is lost for good at a commander fall no rewind took back, or a stall at the cap. */
const battleLost = (b) => b.commanderKOs > 0 || b.stalled;

/**
 * One arm's run read with permadeath: the battles it fought until the first lost one (that one
 * included), and whether it cleared the act.
 */
export function permadeathView(record) {
  const fought = [];
  for (const b of record.battles || []) {
    fought.push(b);
    if (battleLost(b)) return { fought, cleared: false, lostAt: b };
  }
  return { fought, cleared: record.result === 'victory', lostAt: null };
}

/**
 * How a battle ended for the launch decision: `win`, `commander` (a commander fall no rewind took
 * back: the run is over) or `stall` (the turn cap with no such fall: the agent's limit).
 */
export function battleOutcome(b) {
  if (b.commanderKOs > 0) return 'commander';
  return b.stalled ? 'stall' : 'win';
}

/**
 * How an arm's Act V ended under permadeath: its first lost battle's outcome, else `win` for a
 * cleared act and `other` for a run that ended with neither (a driver timeout).
 */
export function actOutcome(record) {
  const view = permadeathView(record);
  if (view.lostAt) return battleOutcome(view.lostAt);
  return view.cleared ? 'win' : 'other';
}

/** The node a battle was fought at: its Descent key, else the legacy finale. */
const nodeKeyOf = (b) => b.descentKey || (b.boss ? 'finale (legacy)' : b.type);

/**
 * The boss a final-act boss battle seats, read from the data (null for any other battle): a
 * Descent node's `boss` (the gate's Lieutenant marked as such), the legacy finale's from
 * `enemies.json` `bosses.finalBoss` by rung (the Lieutenant on First Light and Dusk, the Entity
 * above).
 */
export function bossFightOf(b, rung, gameData) {
  if (b.descentKey) {
    for (const route of Object.values(gameData.descent?.routes || {}))
      for (const row of route.rows || [])
        for (const n of row.nodes || [])
          if (n.key === b.descentKey && n.boss)
            return n.bossRole === 'gate' ? `${n.boss} (gate)` : n.boss;
    return null;
  }
  if (!b.boss || b.act !== 'finalBoss') return null;
  const seat = (gameData.enemies?.bosses?.finalBoss || []).find((x) =>
    (x.difficultyFilter || []).includes(rung),
  );
  return seat?.name ?? 'finale';
}

function mdTable(columns, rows) {
  const esc = (v) => String(v ?? '-').replace(/\|/g, '\\|');
  return [
    `| ${columns.join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${columns.map((c) => esc(row[c])).join(' | ')} |`),
  ].join('\n');
}

const META_ORDER = ['none', 'quarter', 'half', 'endgame'];
const orderIndex = (list, x) => (list.includes(x) ? list.indexOf(x) : list.length);

/**
 * The paired view of a record set: Act V records grouped by experiment cell (rung, Home Base
 * preset, fork, agent, stones, ruleset) and paired by trial (sim/lib/DescentTrials.js), cells
 * ordered by rung then preset and named C1, C2, ... A duplicate trial throws.
 */
export function pairedCells(records) {
  const act5 = records.filter((r) => r.kind === 'act5');
  return pairTrials(act5, ARMS)
    .sort(
      (a, b) =>
        orderIndex(DIFFICULTY_IDS, a.cell.difficulty) -
          orderIndex(DIFFICULTY_IDS, b.cell.difficulty) ||
        orderIndex(META_ORDER, a.cell.meta) - orderIndex(META_ORDER, b.cell.meta) ||
        a.key.localeCompare(b.key),
    )
    .map((group, i) => ({ ...group, id: `C${i + 1}` }));
}

/**
 * Paired percentage-point differences (arm minus legacy) of a 0/1 measure over a cell's complete
 * trials; empty when the cell has no legacy arm or not `arm`.
 */
export function pairedDiffs(group, arm, measure) {
  if (!group.arms.includes('legacy') || !group.arms.includes(arm)) return [];
  return group.complete.map(
    (t) => 100 * (Number(measure(t.byArm[arm])) - Number(measure(t.byArm.legacy))),
  );
}

export function report(records, gameData, { seconds = null } = {}) {
  const md = [];
  const emit = (title, rows, note = null) => {
    if (!rows.length) return;
    const cols = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    printTable(cols, rows, { title });
    if (note) console.log(note);
    md.push(`### ${title}`, '', ...(note ? [note, ''] : []), mdTable(cols, rows), '');
  };
  const errors = records.filter((r) => r.kind === 'error');
  for (const e of errors)
    console.log(
      `Failed: ${e.difficulty} ${e.meta ?? ''} seed ${e.seed}${e.arm ? ` (${e.arm})` : ''}: ` +
        `${e.error.split('\n')[0]}`,
    );
  const captures = records.filter((r) => r.kind === 'capture');
  // Both throw on a duplicate identity: a record is never overwritten by another one.
  indexCaptures(captures);
  const cells = pairedCells(records);
  const complete = cells.reduce((n, g) => n + g.complete.length, 0);
  printHeader(`Act V, the Descent — ${complete} paired trials in ${cells.length} cell(s)`);
  if (seconds) console.log(`Played in ${seconds.toFixed(0)} s.`);
  const rite = gameData.descent?.rite;
  /** A cell's runs on one arm: its complete trials only, so every table reads one population. */
  const runsOf = (group, arm) => group.complete.map((t) => t.byArm[arm]).filter(Boolean);
  const head = (group) => ({
    cell: group.id,
    rung: RUNG_LABELS[group.cell.difficulty] || group.cell.difficulty,
    meta: group.cell.meta,
  });
  const capsOf = (group) => {
    const key = captureCellKey(group.cell);
    return captures.filter((c) => captureCellKey(c) === key);
  };
  const unpairedText = (group) =>
    Object.entries(group.unpaired)
      .filter(([, n]) => n > 0)
      .map(([arm, n]) => `${arm} ${n}`)
      .join(' · ') || '0';

  // The cells: every condition a record carries. Pooling cells hides a cohort behind another.
  emit(
    'The cells (an experiment cell is every condition but the seed; trials pair within a cell)',
    cells.map((group) => ({
      ...head(group),
      fork: group.cell.fork,
      agent: group.cell.agent,
      stones: group.cell.stones.replace(/,/g, ' '),
      ruleset: group.cell.ruleset,
      arms: group.arms.join(','),
      trials: group.trials.length,
      'complete trials': group.complete.length,
      'unpaired records': unpairedText(group),
    })),
  );
  for (const group of cells) {
    if (!group.pairable)
      console.log(
        `Cell ${group.id}: no partner arm (only ${group.arms.join(', ')}): ${unpairedText(group)} ` +
          'record(s) unpaired. A partner played under other conditions (another stone count, ' +
          'preset or ruleset) is another cell, never a pair.',
      );
    else if (group.complete.length < group.trials.length)
      console.log(
        `Cell ${group.id}: records with no partner arm (${unpairedText(group)}) are left out; ` +
          `every table reads its ${group.complete.length} complete trials.`,
      );
  }

  // Entry states.
  emit(
    'The runs and their Act V entry',
    cells.map((group) => {
      const caps = capsOf(group);
      const reached = caps.filter((c) => c.result === 'paused');
      const e = reached.map((c) => c.entry).filter(Boolean);
      return {
        ...head(group),
        captured: caps.length,
        'reached Act V': reached.length,
        'paired trials': group.complete.length,
        'no KO in I-IV': caps.length
          ? pctCI(caps.filter((c) => c.pre?.koBattles === 0).length, caps.length)
          : '-',
        roster: e.length ? mean(e.map((x) => x.roster)).toFixed(1) : '-',
        'avg level': e.length ? mean(e.map((x) => x.avgLevel)).toFixed(1) : '-',
        promoted: e.length ? mean(e.map((x) => x.promoted)).toFixed(1) : '-',
        vision: e.length ? mean(e.map((x) => x.vision)).toFixed(2) : '-',
      };
    }),
  );

  // Clear rates, arm by arm and paired, read two ways: strict (a stall at the turn cap is a loss)
  // and KO-free (no commander fall anywhere in the act: a stall is the agent's limit, not a
  // death, and a player plays on). KO-free is not a win rate: the outcome table splits them.
  const koFree = (r) =>
    !(r.battles || []).some((b) => b.commanderKOs > 0) && r.result !== 'timeout';
  const measures = [
    [
      'Act V clear rate (strict: every battle won, no unrewound commander fall, no stall), paired by trial',
      (r) => permadeathView(r).cleared,
      null,
    ],
    [
      'Act V KO-free rate (no unrewound commander fall anywhere in the act), paired by trial',
      koFree,
      'KO-free is NOT a win rate: a run stalled at the turn cap counts as not lost. ' +
        'The outcome table below splits wins from stalls.',
    ],
  ];
  const armLabel = { descent: 'Descent', nolanding: 'no Landing' };
  for (const [title, measure, note] of measures)
    emit(
      title,
      cells.map((group) => {
        const row = { ...head(group), n: group.complete.length };
        for (const arm of group.arms) {
          const runs = runsOf(group, arm);
          const label = arm === 'legacy' ? 'legacy' : armLabel[arm] || arm;
          row[label] = pctCI(runs.filter(measure).length, runs.length);
          if (arm === 'legacy') continue;
          const diffs = pairedDiffs(group, arm, measure);
          row[`Δ ${label} (pts)`] = diffs.length ? meanCI(diffs, 1) : '-';
        }
        return row;
      }),
      note,
    );

  // The launch decision's three outcomes, kept apart.
  const OUTCOMES = [
    ['win', 'win'],
    ['commander', 'commander loss'],
    ['stall', 'stall'],
  ];
  const anyOther = cells.some((g) =>
    g.arms.some((arm) => runsOf(g, arm).some((r) => actOutcome(r) === 'other')),
  );
  emit(
    'Act V outcome under permadeath: win / commander loss / stall, paired by trial',
    cells.flatMap((group) =>
      group.arms.map((arm) => {
        const runs = runsOf(group, arm);
        const row = { ...head(group), arm, n: runs.length };
        for (const [id, label] of OUTCOMES)
          row[label] = pctCI(runs.filter((r) => actOutcome(r) === id).length, runs.length);
        if (anyOther)
          row.other = pctCI(runs.filter((r) => actOutcome(r) === 'other').length, runs.length);
        for (const [id, label] of OUTCOMES) {
          const diffs = pairedDiffs(group, arm, (r) => actOutcome(r) === id);
          row[`Δ ${label} (pts)`] = arm === 'legacy' || !diffs.length ? '-' : meanCI(diffs, 1);
        }
        return row;
      }),
    ),
    'A commander loss is a commander fall no Vision rewind took back (the run would end there); ' +
      'a stall is the 30-turn cap with no such fall (the agent’s limit, not a death). ' +
      'Each run counts at its first lost battle.',
  );
  const bossRows = [];
  for (const group of cells)
    for (const arm of group.arms) {
      const fights = new Map();
      for (const r of runsOf(group, arm))
        for (const b of permadeathView(r).fought) {
          const boss = bossFightOf(b, group.cell.difficulty, gameData);
          if (!boss) continue;
          const key = `${nodeKeyOf(b)}|${boss}`;
          if (!fights.has(key)) fights.set(key, { node: nodeKeyOf(b), boss, list: [] });
          fights.get(key).list.push(b);
        }
      for (const { node, boss, list } of fights.values()) {
        const row = { ...head(group), arm, node, boss, reached: list.length };
        for (const [id, label] of OUTCOMES)
          row[label] = pctCI(list.filter((b) => battleOutcome(b) === id).length, list.length);
        row['turns-par (stalls)'] = meanCI(
          list
            .filter((b) => battleOutcome(b) === 'stall' && Number.isFinite(b.par))
            .map((b) => b.turns - b.par),
          1,
        );
        bossRows.push(row);
      }
    }
  emit(
    'The boss fights (the Lieutenant, the gate, the Entity): outcome among runs that reached them under permadeath',
    bossRows,
  );

  // Per node, both arms.
  const nodeRows = [];
  for (const group of cells)
    for (const arm of group.arms) {
      const runs = runsOf(group, arm);
      const keys = [];
      for (const r of runs)
        for (const b of r.battles || []) if (!keys.includes(nodeKeyOf(b))) keys.push(nodeKeyOf(b));
      for (const key of keys) {
        const casual = runs.flatMap((r) => (r.battles || []).filter((b) => nodeKeyOf(b) === key));
        const strict = runs.flatMap((r) =>
          permadeathView(r).fought.filter((b) => nodeKeyOf(b) === key),
        );
        const won = strict.filter((b) => !battleLost(b)).length;
        nodeRows.push({
          ...head(group),
          arm,
          node: key,
          reached: strict.length,
          'cleared (strict)': pctCI(won, strict.length),
          'KO battles (all)': pctCI(casual.filter((b) => b.commanderKOs > 0).length, casual.length),
          'stall%': pctCI(casual.filter((b) => b.stalled).length, casual.length),
          'deaths/battle': meanCI(casual.map((b) => b.unitDeaths)),
          rewinds: mean(casual.map((b) => b.rewinds)).toFixed(2),
          turns: mean(casual.map((b) => b.turns)).toFixed(1),
          par: mean(casual.filter((b) => Number.isFinite(b.par)).map((b) => b.par)).toFixed(1),
          'turns-par': meanCI(
            casual.filter((b) => Number.isFinite(b.par)).map((b) => b.turns - b.par),
            1,
          ),
        });
      }
    }
  emit(
    'Per node (strict: reached and cleared under permadeath; the rest over every battle fought)',
    nodeRows,
  );

  // The fork.
  emit(
    'The fork: Mortuary Column vs the event (Descent arm)',
    cells
      .filter((group) => group.arms.includes('descent'))
      .flatMap((group) =>
        ['column', 'side_stair'].map((branch) => {
          const runs = runsOf(group, 'descent').filter((r) =>
            (r.path || []).some((p) => p.key === branch),
          );
          return {
            ...head(group),
            branch,
            runs: runs.length,
            'Act V clear': pctCI(runs.filter((r) => permadeathView(r).cleared).length, runs.length),
            'Rite at finale (mean)': mean(runs.map((r) => r.riteFinal ?? 0)).toFixed(1),
          };
        }),
      ),
  );

  // The Rite.
  const descentCells = cells.filter((group) => group.arms.includes('descent'));
  if (rite) {
    const bandIds = rite.bands.map((b) => b.id);
    emit(
      'The Rite: words at entry, from the Vigil, and the band the finale was fought at',
      descentCells.map((group) => {
        const runs = runsOf(group, 'descent');
        const finals = runs.map((r) => r.riteFinal ?? 0);
        const vigils = runs
          .map((r) => (r.battles || []).find((b) => b.descentKey === 'vigil')?.vigil)
          .filter(Boolean);
        const row = {
          ...head(group),
          n: runs.length,
          'start (mean)': mean(runs.map((r) => r.riteStart ?? 0)).toFixed(2),
          'Vigil words (median)': median(vigils.map((v) => v.words)),
          'Vigil words (mean)': meanCI(
            vigils.map((v) => v.words),
            1,
          ),
          'final (median)': median(finals),
        };
        for (const id of bandIds)
          row[id] = pctCI(finals.filter((w) => riteBand(w, rite) === id).length, finals.length);
        return row;
      }),
    );
    emit(
      'The Vigil',
      descentCells.map((group) => {
        const vig = runsOf(group, 'descent').flatMap((r) =>
          (r.battles || []).filter((b) => b.descentKey === 'vigil'),
        );
        return {
          ...head(group),
          fought: vig.length,
          'words (mean)': meanCI(
            vig.map((b) => b.vigil?.words ?? 0),
            1,
          ),
          'Hollowed called (mean)': meanCI(
            vig.map((b) => b.vigil?.summoned ?? 0),
            1,
          ),
          'all four silenced': pctCI(
            vig.filter((b) => b.vigil?.voicesStanding === 0).length,
            vig.length,
          ),
          'cleared (no KO, no stall)': pctCI(vig.filter((b) => !battleLost(b)).length, vig.length),
          'turns-par': meanCI(
            vig.filter((b) => Number.isFinite(b.par)).map((b) => b.turns - b.par),
            1,
          ),
        };
      }),
    );
    // The finale (and the gate) by band.
    const bandRows = [];
    for (const group of descentCells)
      for (const key of ['gate', 'lieutenant', 'entity'])
        for (const id of bandIds) {
          const fights = runsOf(group, 'descent').flatMap((r) =>
            permadeathView(r).fought.filter((b) => b.descentKey === key && b.riteBand === id),
          );
          if (!fights.length) continue;
          bandRows.push({
            ...head(group),
            node: key,
            band: id,
            reached: fights.length,
            cleared: pctCI(fights.filter((b) => !battleLost(b)).length, fights.length),
            'no KO': pctCI(fights.filter((b) => b.commanderKOs === 0).length, fights.length),
            stall: pctCI(fights.filter((b) => battleOutcome(b) === 'stall').length, fights.length),
            'deaths/battle': meanCI(fights.map((b) => b.unitDeaths)),
            turns: mean(fights.map((b) => b.turns)).toFixed(1),
          });
        }
    emit('The gate and the finale by Rite band (strict)', bandRows);
  }

  // The Landing (spec §11: keep it only if the gate's loss rate without it is above the act
  // bosses'): the gate with and without the row, against the act bosses of the same runs.
  const landingRows = [];
  for (const group of cells) {
    const bosses = capsOf(group)
      .filter((c) => c.result === 'paused')
      .flatMap((c) => c.pre?.bosses || []);
    for (const arm of ['descent', 'nolanding'].filter((a) => group.arms.includes(a))) {
      const runs = runsOf(group, arm);
      const gates = runs.flatMap((r) =>
        permadeathView(r).fought.filter((b) => b.descentKey === 'gate'),
      );
      if (!gates.length) continue;
      landingRows.push({
        ...head(group),
        arm,
        'gate reached': gates.length,
        'gate lost': pctCI(gates.filter(battleLost).length, gates.length),
        'gate deaths/battle': meanCI(gates.map((b) => b.unitDeaths)),
        'Act V clear': pctCI(runs.filter((r) => permadeathView(r).cleared).length, runs.length),
        'act bosses lost (I-IV)': pctCI(bosses.filter(battleLost).length, bosses.length),
      });
    }
  }
  emit(
    'The Landing: the gate with and without it, against the act bosses before Act V',
    landingRows,
  );

  // Deaths over the whole act.
  emit(
    'Units lost over Act V (all battles fought, casual commander)',
    cells.flatMap((group) =>
      group.arms.map((arm) => {
        const runs = runsOf(group, arm);
        return {
          ...head(group),
          arm,
          battles: mean(runs.map((r) => (r.battles || []).length)).toFixed(1),
          'deaths/run': meanCI(
            runs.map((r) => (r.battles || []).reduce((n, b) => n + b.unitDeaths, 0)),
          ),
          'KO battles/run': meanCI(
            runs.map((r) => (r.battles || []).filter((b) => b.commanderKOs > 0).length),
          ),
          'rewinds/run': meanCI(
            runs.map((r) => (r.battles || []).reduce((n, b) => n + b.rewinds, 0)),
          ),
        };
      }),
    ),
  );
  return md.join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  if (opts.shard) {
    await playShard(opts.shard, opts.out);
    return;
  }
  const gameData = loadGameData();
  if (opts.from && opts.phase !== 'act5') {
    const text = report(readLines(fromFiles()), gameData);
    if (opts.md) writeFileSync(opts.md, text);
    return;
  }
  const { records, seconds } = await playAll();
  if (opts.phase === 'capture') {
    console.log(`Captured ${records.length} runs in ${seconds.toFixed(0)} s.`);
    return;
  }
  const text = report(records, gameData, { seconds });
  if (opts.md) writeFileSync(opts.md, text);
}

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
