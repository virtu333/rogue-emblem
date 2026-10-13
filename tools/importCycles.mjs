// Static import cycles in src/, held to a baseline (tools/importCycleBaseline.json).
//
// A cycle is a strongly connected group of modules: each one reaches every other one through
// static `import` / `export ... from` statements. Dynamic `import()` is left out (scene
// loading is lazy on purpose, and a dynamic import never runs during module evaluation).
//
// The check is a ratchet:
//   - a group that is not inside one baseline group is a new cycle and fails;
//   - a baseline group that is no longer exactly a group (it was split or broken) also fails,
//     so the baseline is written down again (`npm run check:cycles -- --write`) in the PR
//     that broke it, and it can never grow back unnoticed.
//
//   node tools/importCycles.mjs           check against the baseline
//   node tools/importCycles.mjs --write   rewrite the baseline from the current tree
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
export const BASELINE_PATH = join(ROOT, 'tools', 'importCycleBaseline.json');

const IMPORT_FROM =
  /(?:^|[\n;])\s*import\s+(?:type\s+)?(?:[\w$]+\s*,?\s*)?(?:\*\s*as\s+[\w$]+|\{[^}]*\})?\s*from\s*['"]([^'"]+)['"]/g;
const IMPORT_BARE = /(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/g;
const EXPORT_FROM =
  /(?:^|[\n;])\s*export\s*(?:\*(?:\s*as\s+[\w$]+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g;

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

function listJsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listJsFiles(full));
    else if (name.endsWith('.js') || name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

function resolveSpecifier(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [base, `${base}.js`, join(base, 'index.js')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate.endsWith('.js') || candidate.endsWith('.mjs') ? candidate : null;
    }
  }
  return null;
}

const toKey = (file) => relative(SRC, file).split(sep).join('/');

/** Every static import edge between src/ modules, as `{ [module]: Set<module> }`. */
export function buildImportGraph(srcDir = SRC) {
  const graph = new Map();
  for (const file of listJsFiles(srcDir)) {
    const text = stripComments(readFileSync(file, 'utf8'));
    const targets = new Set();
    for (const pattern of [IMPORT_FROM, IMPORT_BARE, EXPORT_FROM]) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text))) {
        const target = resolveSpecifier(file, match[1]);
        if (target && target.startsWith(srcDir)) targets.add(toKey(target));
      }
    }
    graph.set(toKey(file), targets);
  }
  return graph;
}

/** Strongly connected groups of two or more modules (or one that imports itself), sorted. */
export function findCycleGroups(graph) {
  let index = 0;
  const stack = [];
  const onStack = new Set();
  const indexOf = new Map();
  const low = new Map();
  const groups = [];

  // Iterative Tarjan: the import graph is deep enough to make recursion uncomfortable.
  for (const start of graph.keys()) {
    if (indexOf.has(start)) continue;
    const work = [[start, [...(graph.get(start) || [])], 0]];
    indexOf.set(start, index);
    low.set(start, index);
    index += 1;
    stack.push(start);
    onStack.add(start);
    while (work.length) {
      const frame = work[work.length - 1];
      const [node, edges] = frame;
      if (frame[2] < edges.length) {
        const next = edges[frame[2]];
        frame[2] += 1;
        if (!graph.has(next)) continue;
        if (!indexOf.has(next)) {
          indexOf.set(next, index);
          low.set(next, index);
          index += 1;
          stack.push(next);
          onStack.add(next);
          work.push([next, [...(graph.get(next) || [])], 0]);
        } else if (onStack.has(next)) {
          low.set(node, Math.min(low.get(node), indexOf.get(next)));
        }
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1][0];
        low.set(parent, Math.min(low.get(parent), low.get(node)));
      }
      if (low.get(node) === indexOf.get(node)) {
        const group = [];
        let member;
        do {
          member = stack.pop();
          onStack.delete(member);
          group.push(member);
        } while (member !== node);
        if (group.length > 1 || graph.get(node)?.has(node)) groups.push(group.sort());
      }
    }
  }
  return groups.sort((a, b) => a[0].localeCompare(b[0]));
}

export function readBaseline(path = BASELINE_PATH) {
  return JSON.parse(readFileSync(path, 'utf8')).groups;
}

/** Problems with the current groups against the baseline; empty when the check passes. */
export function compareToBaseline(current, baseline) {
  const problems = [];
  const baselineSets = baseline.map((group) => new Set(group));
  for (const group of current) {
    if (!baselineSets.some((set) => group.every((member) => set.has(member)))) {
      problems.push(
        `New import cycle (not in the baseline): ${group.join(', ')}.\n` +
          '  Move the shared piece to a leaf module instead of importing back.',
      );
    }
  }
  const currentKeys = new Set(current.map((group) => group.join('|')));
  for (const group of baseline) {
    if (!currentKeys.has(group.join('|'))) {
      problems.push(
        `Baseline cycle is gone or smaller: ${group.join(', ')}.\n` +
          '  Good: run `npm run check:cycles -- --write` and commit tools/importCycleBaseline.json.',
      );
    }
  }
  return problems;
}

function main() {
  const groups = findCycleGroups(buildImportGraph());
  if (process.argv.includes('--write')) {
    const body = {
      note: 'Static import cycles in src/ allowed today. Written by tools/importCycles.mjs --write; only ever shrink it.',
      groups,
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(body, null, 2)}\n`);
    console.log(`Wrote ${groups.length} cycle groups to ${relative(ROOT, BASELINE_PATH)}`);
    return;
  }
  const problems = compareToBaseline(groups, readBaseline());
  if (problems.length) {
    console.error(problems.join('\n\n'));
    process.exit(1);
  }
  console.log(`Import cycles match the baseline (${groups.length} groups).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
