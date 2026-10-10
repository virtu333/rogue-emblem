// sim/blessings.js — blessings v3 balance report with the claiming policies on
// (docs/sim-reports/blessings-v3-balance.md for the method and a reading of the numbers).
//
//   npm run sim:blessings -- [--trials N] [--seed S] [--difficulty all|normal,dusk,hard,lunatic]
//                            [--workers W] [--out runs.jsonl] [--from a.jsonl,b.jsonl]
//                            [--md report.md] [--csv]
//
// Each trial is one full run (tests/sim/ClaimingRunDriver.js: the shrine's pick, the gift, every
// earned pick, battle loot, Steal, Open Roll's swap, Vision rewinds, church vows, the forge, the
// arena), seeded: the run seed, the battles' Math.random (StatefulRNG) and every policy choice
// follow from `--seed` and the trial's index, and each rung has its own seed range, so rungs are
// independent samples. `--trials` is per rung.
//
// `--workers W` splits the trials over W child processes (each writes its runs to a JSON-lines
// file) and reports on the union; `--out` keeps the runs, `--from` reports on saved runs without
// playing any. `--csv` prints the per-card tables as CSV; `--md` writes them as Markdown.

import { fork } from 'child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { loadGameData } from '../tests/testData.js';
import { installStatefulSeed, restoreStatefulRandom } from './lib/StatefulRNG.js';
import { ClaimingRunDriver } from '../tests/sim/ClaimingRunDriver.js';
import { DIFFICULTY_IDS } from '../src/engine/DifficultyEngine.js';
import { parseArgs, printHeader, printTable, toCSV } from './lib/TableFormatter.js';
import {
  OUTCOMES,
  MIN_TAKEN_FOR_FLAG,
  Z_FAMILY,
  claimCoverage,
  earnedCardRows,
  flagsFor,
  fmtDiff,
  rungSummary,
  startCardRows,
  wilson,
} from './lib/BlessingReport.js';

const RUNG_LABELS = {
  normal: 'First Light',
  dusk: 'Dusk',
  hard: 'Nightfall',
  lunatic: 'Black Sun',
};
// Each rung's runs use their own seeds (the shrine's offer and the policy's pick follow the seed).
const RUNG_SEED_OFFSET = { normal: 0, dusk: 100000, hard: 200000, lunatic: 300000 };

const opts = parseArgs({
  trials: 20,
  seed: 1,
  difficulty: 'all',
  workers: 1,
  out: null,
  from: null,
  md: null,
  shard: null,
  csv: false,
});

if (opts.help) {
  console.log(
    'Usage: npm run sim:blessings -- [--trials N] [--seed S] [--difficulty all|normal,dusk,hard,lunatic] [--workers W] [--out runs.jsonl] [--from a.jsonl,b.jsonl] [--md report.md] [--csv]',
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

/** The jobs: one per (rung, trial). */
function jobs() {
  const list = [];
  for (const rung of rungs)
    for (let i = 0; i < opts.trials; i++)
      list.push({ rung, seed: Number(opts.seed) + i + (RUNG_SEED_OFFSET[rung] || 0) });
  return list;
}

/** One full run with every claiming policy on. */
export async function playRun(gameData, { rung, seed }) {
  const rng = installStatefulSeed(seed);
  try {
    const driver = new ClaimingRunDriver(gameData, {
      rng,
      runOptions: { runSeed: seed, difficultyId: rung, autoSelectBlessing: false },
    });
    const result = await driver.run();
    delete result.trace;
    return { seed, ...result };
  } finally {
    restoreStatefulRandom();
  }
}

async function playShard(shard, outFile) {
  const [k, n] = String(shard).split('/').map(Number);
  const gameData = loadGameData();
  const list = jobs().filter((_, i) => i % n === k);
  for (const job of list) {
    // A run that throws is kept as an error record (the report counts it and leaves it out), so
    // one bad run never loses the rest of the batch.
    let result;
    try {
      result = await playRun(gameData, job);
    } catch (error) {
      result = { seed: job.seed, difficulty: job.rung, error: String(error?.stack || error) };
    }
    appendFileSync(outFile, `${JSON.stringify(result)}\n`);
  }
}

function readRuns(files) {
  const runs = [];
  for (const file of files)
    for (const line of readFileSync(file, 'utf-8').split('\n'))
      if (line.trim()) runs.push(JSON.parse(line));
  return runs;
}

async function playAll() {
  const workers = Math.max(1, Math.trunc(Number(opts.workers) || 1));
  const dir = mkdtempSync(join(tmpdir(), 'sim-blessings-'));
  const files = [];
  const started = Date.now();
  try {
    if (workers === 1) {
      // Written as it goes: a long batch stopped early keeps what it played.
      const file = opts.out || join(dir, 'runs-0.jsonl');
      writeFileSync(file, '');
      files.push(file);
      await playShard('0/1', file);
    } else {
      const self = fileURLToPath(import.meta.url);
      const args = process.argv.slice(2).filter((a, i, all) => {
        const prev = all[i - 1];
        return (
          !['--workers', '--out', '--md', '--from'].includes(a) &&
          !['--workers', '--out', '--md', '--from'].includes(prev)
        );
      });
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
    const runs = readRuns(files);
    if (opts.out && workers > 1)
      writeFileSync(opts.out, runs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return { runs, seconds: (Date.now() - started) / 1000 };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── Report ────────────────────────────────────────────────────────────────

const pct = (x) => (Number.isFinite(x) ? `${(100 * x).toFixed(0)}%` : '-');
const num = (x, d = 2) => (Number.isFinite(x) ? Number(x.toFixed(d)) : null);

function cardTableRows(rows, { earned = false } = {}) {
  return rows.map((row) => {
    const out = {
      card: row.name,
      kind: row.kind,
      offered: earned ? row.offeredRuns : row.offered,
      taken: row.taken,
    };
    if (earned) {
      out.granted = row.granted;
      out['compared with'] =
        row.basis === 'source' ? 'source peers' : row.basis === 'none' ? '-' : 'the other card';
    }
    out.exercised =
      row.exercise.rate == null
        ? row.exercise.text || '-'
        : `${pct(row.exercise.rate)} ${row.exercise.text}`;
    for (const outcome of OUTCOMES)
      out[`Δ${outcome.label}`] = fmtDiff(
        row.diffs[outcome.key],
        outcome.scale,
        outcome.key === 'gold' ? 0 : outcome.scale === 100 ? 1 : 2,
      );
    out.flags = flagsFor(row)
      .map((f) => `${f.outcome} ${f.direction}${f.level === 'family-wise' ? ' (FW)' : ''}`)
      .join('; ');
    return out;
  });
}

function mdTable(columns, rows) {
  const esc = (v) => String(v ?? '-').replace(/\|/g, '\\|');
  return [
    `| ${columns.join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${columns.map((c) => esc(row[c])).join(' | ')} |`),
  ].join('\n');
}

function report(allRuns, gameData, { seconds = null } = {}) {
  const md = [];
  const failed = allRuns.filter((r) => r.error);
  const runs = allRuns.filter((r) => !r.error);
  for (const f of failed)
    console.log(`Run failed: ${f.difficulty} seed ${f.seed}: ${f.error.split('\n')[0]}`);
  const present = [...new Set(runs.map((r) => r.difficulty))];
  printHeader(`Blessings v3 with the claiming policies — ${runs.length} runs`);
  if (seconds) console.log(`Played in ${seconds.toFixed(0)} s.`);

  const summary = rungSummary(runs).map((s) => ({
    rung: RUNG_LABELS[s.rung] || s.rung,
    runs: s.runs,
    battles: num(s.battles, 1),
    'koBattle%': num(100 * s.koBattleRate, 1),
    'ko/battle': num(s.koPerBattle),
    'deaths/battle': num(s.deathsPerBattle),
    winsBeforeKO: num(s.winsBeforeKO),
    'stall%': num(100 * s.stallRate, 1),
    'clean%': num(100 * s.clean, 1),
    gold: Math.round(s.gold),
    rewinds: num(s.rewinds),
    stalls: num(s.stalls),
  }));
  const summaryCols = Object.keys(summary[0] || {});
  printTable(summaryCols, summary, { title: 'Outcomes per rung (all runs)' });
  md.push('### Outcomes per rung (all runs)', '', mdTable(summaryCols, summary), '');

  const coverage = claimCoverage(runs).map((c) => ({
    claim: c.claim,
    'per run': num(c.perRun),
    'runs with any': pct(c.runsWithAny),
  }));
  printTable(['claim', 'per run', 'runs with any'], coverage, {
    title: 'Claiming policy coverage',
  });
  md.push(
    '### Claiming policy coverage',
    '',
    mdTable(['claim', 'per run', 'runs with any'], coverage),
    '',
  );

  const startRows = startCardRows(runs, gameData, { rungs: present });
  const earnedRows = earnedCardRows(runs, gameData, { rungs: present });
  const startCols = [
    'card',
    'kind',
    'offered',
    'taken',
    'exercised',
    ...OUTCOMES.map((o) => `Δ${o.label}`),
    'flags',
  ];
  const earnedCols = [
    'card',
    'kind',
    'offered',
    'taken',
    'granted',
    'compared with',
    'exercised',
    ...OUTCOMES.map((o) => `Δ${o.label}`),
    'flags',
  ];
  const startTable = cardTableRows(startRows);
  const earnedTable = cardTableRows(earnedRows, { earned: true });
  if (opts.csv) {
    console.log('\n# start cards and gifts');
    toCSV(startCols, startTable);
    console.log('\n# earned cards');
    toCSV(earnedCols, earnedTable);
  } else {
    printTable(startCols, startTable, {
      title: 'Start cards and gifts (took it − offered it, took another)',
    });
    printTable(earnedCols, earnedTable, { title: 'Earned cards (from the first offer on)' });
  }
  md.push(
    '### Start cards and gifts',
    '',
    'Took it − offered it and took something else (or nothing), over the whole run.',
    '',
    mdTable(startCols, startTable),
    '',
    '### Earned cards',
    '',
    "Took it − offered it in a pick and took the other card, over the run's battles from that offer on; a card its source offers alone (an eclipsed elite's drop, the Colosseum's) is compared at each run's first offer from that source (this card first against another card first). `granted`: given by an event (no choice, not compared).",
    '',
    mdTable(earnedCols, earnedTable),
    '',
  );

  // Per rung: each card's take count and koBattle% difference.
  for (const rung of present) {
    const sub = runs.filter((r) => r.difficulty === rung);
    const rows = [
      ...startCardRows(sub, gameData, { rungs: [rung] }),
      ...earnedCardRows(sub, gameData, { rungs: [rung] }).map((r) => ({
        ...r,
        offered: r.offeredRuns,
      })),
    ].map((row) => ({
      card: row.name,
      kind: row.kind,
      offered: row.offered,
      taken: row.taken,
      'ΔkoBattle%': fmtDiff(row.diffs.koBattleRate, 100, 1),
      'Δdeaths/battle': fmtDiff(row.diffs.deathsPerBattle, 1, 2),
      ΔwinsBeforeKO: fmtDiff(row.diffs.winsBeforeKO, 1, 2),
      'Δstall%': fmtDiff(row.diffs.stallRate, 100, 1),
    }));
    const cols = [
      'card',
      'kind',
      'offered',
      'taken',
      'ΔkoBattle%',
      'Δdeaths/battle',
      'ΔwinsBeforeKO',
      'Δstall%',
    ];
    if (!opts.csv)
      printTable(cols, rows, {
        title: `Per card — ${RUNG_LABELS[rung] || rung} (${sub.length} runs)`,
      });
    md.push(`### ${RUNG_LABELS[rung] || rung} (${sub.length} runs)`, '', mdTable(cols, rows), '');
  }

  // Flags.
  const flagged = [...startRows, ...earnedRows]
    .map((row) => ({ row, flags: flagsFor(row) }))
    .filter((entry) => entry.flags.length);
  const flagRows = flagged.flatMap(({ row, flags }) =>
    flags.map((f) => ({
      card: row.name,
      taken: row.taken,
      outcome: f.outcome,
      reading: f.direction,
      level: f.level,
      delta: Number.isFinite(f.delta)
        ? `${f.delta.toFixed(2)} [${f.lo.toFixed(2)}, ${f.hi.toFixed(2)}]`
        : '',
    })),
  );
  printTable(['card', 'taken', 'outcome', 'reading', 'level', 'delta'], flagRows, {
    title: `Flags (95% interval excludes 0, at least ${MIN_TAKEN_FOR_FLAG} takers; FW: |z| ≥ ${Z_FAMILY})`,
  });
  md.push(
    '### Flags',
    '',
    mdTable(['card', 'taken', 'outcome', 'reading', 'level', 'delta'], flagRows),
    '',
  );

  const cleanAll = runs.filter((r) =>
    (r.battleLog || []).every((b) => b.commanderKOs === 0),
  ).length;
  const w = wilson(cleanAll, runs.length);
  console.log(
    `Runs with no commander KO (a would-be win): ${cleanAll}/${runs.length} (${pct(w.p)}, 95% ${pct(w.lo)}-${pct(w.hi)}).`,
  );
  if (opts.md) writeFileSync(opts.md, md.join('\n'));
}

async function main() {
  const gameData = loadGameData();
  if (opts.shard) {
    await playShard(opts.shard, opts.out);
    return;
  }
  if (opts.from) {
    report(readRuns(String(opts.from).split(',')), gameData);
    return;
  }
  const { runs, seconds } = await playAll();
  report(runs, gameData, { seconds });
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect)
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
