// Static import cycles in src/ are held to tools/importCycleBaseline.json: no new cycle, and
// a cycle that is broken is written out of the baseline so it cannot come back.
// `npm run check:cycles` runs the same check; `npm run check:cycles -- --write` rewrites it.
import { describe, expect, it } from 'vitest';
import {
  buildImportGraph,
  compareToBaseline,
  findCycleGroups,
  readBaseline,
} from '../tools/importCycles.mjs';

const graphOf = (edges) => new Map(Object.entries(edges).map(([from, to]) => [from, new Set(to)]));

describe('import cycle finder', () => {
  it('finds a ring and a self-import, and nothing in a tree', () => {
    const groups = findCycleGroups(
      graphOf({
        'a.js': ['b.js'],
        'b.js': ['c.js'],
        'c.js': ['a.js', 'd.js'],
        'd.js': [],
        'e.js': ['e.js'],
        'f.js': ['d.js'],
      }),
    );
    expect(groups).toEqual([['a.js', 'b.js', 'c.js'], ['e.js']]);
  });

  it('fails a new cycle and a baseline cycle that is gone, and passes a match', () => {
    const baseline = [['a.js', 'b.js', 'c.js']];
    expect(compareToBaseline([['a.js', 'b.js', 'c.js']], baseline)).toEqual([]);
    const fresh = compareToBaseline(
      [
        ['a.js', 'b.js', 'c.js'],
        ['x.js', 'y.js'],
      ],
      baseline,
    );
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toMatch(/New import cycle.*x\.js, y\.js/);
    const shrunk = compareToBaseline([['a.js', 'b.js']], baseline);
    expect(shrunk).toHaveLength(1);
    expect(shrunk[0]).toMatch(/gone or smaller/);
  });

  it('reads static imports and re-exports, never a dynamic import()', () => {
    const graph = buildImportGraph();
    // engine/Grid.js imports ui modules statically (an allow-listed leak, eslint.config.js).
    expect(graph.get('engine/Grid.js').has('ui/fogState.js')).toBe(true);
    // The scene loader reaches scenes only through import(): lazy, so no cycle.
    expect([...graph.get('utils/sceneLoader.js')].some((m) => m.startsWith('scenes/'))).toBe(false);
  });
});

describe('src/ import cycles', () => {
  it('match the baseline', () => {
    const problems = compareToBaseline(findCycleGroups(buildImportGraph()), readBaseline());
    expect(problems, problems.join('\n\n')).toEqual([]);
  });
});
