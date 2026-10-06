#!/usr/bin/env node
// Summarises a Stryker JSON report (reports/mutation/<tag>.json).
//
//   node tools/mutationKills.mjs <report.json>                    score per source file
//   node tools/mutationKills.mjs <report.json> --survivors        list surviving mutants
//   node tools/mutationKills.mjs <with.json> --compare <without.json>
//       mutants <with> kills that <without> lets survive: what the tests left out of
//       the <without> run catch alone. Run <without> with those tests excluded (or as
//       the incremental retest after deleting them). A deletion is safe only when this
//       list is empty or every entry is an equivalent mutant.
import fs from 'node:fs';

const args = process.argv.slice(2);
const flag = (name) => args.indexOf(name);
const reportPath = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--compare');
if (!reportPath) {
  console.error(
    'usage: node tools/mutationKills.mjs <report.json> [--survivors] [--compare <other.json>]',
  );
  process.exit(2);
}

const KILLED = new Set(['Killed', 'Timeout']);
const SURVIVED = new Set(['Survived', 'NoCoverage']);

function load(file) {
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const mutants = new Map();
  for (const [source, { mutants: list }] of Object.entries(report.files)) {
    for (const m of list) {
      if (!KILLED.has(m.status) && !SURVIVED.has(m.status)) continue; // ignored, compile errors
      const { line, column } = m.location.start;
      const key = `${source}:${line}:${column} ${m.mutatorName} ${m.replacement ?? ''}`;
      mutants.set(key, {
        source,
        line,
        status: m.status,
        mutator: m.mutatorName,
        replacement: m.replacement ?? '',
      });
    }
  }
  return mutants;
}

const lines = new Map();
function codeAt(source, line) {
  if (!lines.has(source))
    lines.set(source, fs.existsSync(source) ? fs.readFileSync(source, 'utf8').split('\n') : []);
  return (lines.get(source)[line - 1] || '').trim().slice(0, 90);
}
const describe = (m) =>
  `${m.source}:${m.line} ${m.mutator} | ${codeAt(m.source, m.line)} => ${m.replacement.replace(/\s+/g, ' ').slice(0, 60)}`;

const report = load(reportPath);
const bySource = new Map();
for (const m of report.values()) {
  const row = bySource.get(m.source) || { total: 0, killed: 0 };
  row.total++;
  if (KILLED.has(m.status)) row.killed++;
  bySource.set(m.source, row);
}
let total = 0;
let killed = 0;
for (const [source, row] of [...bySource].sort(
  (a, b) => a[1].killed / a[1].total - b[1].killed / b[1].total,
)) {
  total += row.total;
  killed += row.killed;
  console.log(
    `${((100 * row.killed) / row.total).toFixed(1).padStart(5)}%  ${String(row.killed).padStart(5)}/${String(row.total).padEnd(5)}  ${source}`,
  );
}
console.log(
  `${((100 * killed) / total).toFixed(1).padStart(5)}%  ${String(killed).padStart(5)}/${String(total).padEnd(5)}  total`,
);

if (flag('--survivors') >= 0) {
  for (const m of report.values())
    if (SURVIVED.has(m.status))
      console.log(`${m.status === 'NoCoverage' ? 'uncovered' : 'survived '} ${describe(m)}`);
}

if (flag('--compare') >= 0) {
  const other = load(args[flag('--compare') + 1]);
  let shared = 0;
  const lost = [];
  for (const [key, m] of report) {
    const o = other.get(key);
    if (!o) continue;
    shared++;
    if (KILLED.has(m.status) && SURVIVED.has(o.status)) lost.push(m);
  }
  console.log(
    `\n${shared} mutants in both reports; ${lost.length} killed here survive in the other:`,
  );
  for (const m of lost) console.log(`  ${describe(m)}`);
}
