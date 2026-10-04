// First Light keeps villages out of Act 1's first three node rows (difficulty.json
// `villageMinRow`), so a new player's opening fights never open with a scripted bandit
// wave that reads as reinforcements. Ways it can go wrong, one test each:
//   - the gate is missing, or covers the wrong rows (a village at row 0-2 on First Light,
//     or none at all from row 3 on);
//   - the gate leaks to Dusk / Nightfall / Black Sun, or to another act;
//   - the gate skips the village roll instead of discarding it, shifting the node-map
//     stream and changing the whole map;
//   - RunManager does not hand the rung's rule to either generateNodeMap call site;
//   - the data shape is not validated.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateNodeMap, villageMinRowFor } from '../src/engine/NodeMapGenerator.js';
import { resolveDifficultyMode, validateDifficultyConfig } from '../src/engine/DifficultyEngine.js';
import { createSeededRng } from '../src/engine/BlessingEngine.js';
import { RunManager } from '../src/engine/RunManager.js';
import { ACT_CONFIG, NODE_TYPES } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const SEEDS = 300;
const GATED_ROWS = 3;

afterEach(() => vi.restoreAllMocks());

/** The node-map options a run on this rung passes, minus the village rule under test. */
function mapFor(act, seed, villageMinRow) {
  vi.spyOn(Math, 'random').mockImplementation(createSeededRng(seed));
  const map = generateNodeMap(act, ACT_CONFIG[act], data.mapTemplates, { villageMinRow });
  vi.restoreAllMocks();
  return map;
}

const ruleOf = (id) => resolveDifficultyMode(data.difficulty, id).modifiers.villageMinRow;

/** Every village-bearing node's row, over the seeds. */
function villageRows(act, rule) {
  const rows = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    for (const node of mapFor(act, seed, rule).nodes) {
      if (node.battleParams?.hasVillage) rows.push(node.row);
    }
  }
  return rows;
}

describe('villageMinRow data', () => {
  it('only First Light carries the rule, and it covers Act 1 rows 0-2', () => {
    expect(data.difficulty.modes.normal.villageMinRow).toEqual({ act1: GATED_ROWS });
    for (const id of ['dusk', 'hard', 'lunatic']) {
      expect(ruleOf(id), id).toBeNull();
    }
  });

  it('the shipped difficulty config validates; bad shapes are named', () => {
    expect(validateDifficultyConfig(data.difficulty)).toEqual({ valid: true, errors: [] });
    const bad = structuredClone(data.difficulty);
    bad.modes.normal.villageMinRow = { act1: -1, act9: 2 };
    bad.modes.dusk.villageMinRow = { act2: 1.5 };
    bad.modes.hard.villageMinRow = [3];
    const errors = validateDifficultyConfig(bad).errors.join('\n');
    expect(errors).toMatch(/normal\.villageMinRow\.act1 must be a non-negative integer/);
    expect(errors).toMatch(/normal\.villageMinRow\.act9 is not an act id/);
    expect(errors).toMatch(/dusk\.villageMinRow\.act2 must be a non-negative integer/);
    expect(errors).toMatch(/hard\.villageMinRow must be null or an object/);
  });

  it('a missing act, map or bad value gates nothing', () => {
    expect(villageMinRowFor({ act1: 3 }, 'act1')).toBe(3);
    expect(villageMinRowFor({ act1: 3 }, 'act2')).toBe(0);
    expect(villageMinRowFor(null, 'act1')).toBe(0);
    expect(villageMinRowFor({ act1: -2 }, 'act1')).toBe(0);
    expect(villageMinRowFor({ act1: 'x' }, 'act1')).toBe(0);
  });
});

describe('node maps', () => {
  it('without the rule, Act 1 rows 0-2 do roll villages (the test is meaningful)', () => {
    expect(villageRows('act1', null).filter((r) => r < GATED_ROWS).length).toBeGreaterThan(20);
  });

  it('First Light Act 1: no village in rows 0-2, villages still from row 3', () => {
    const rows = villageRows('act1', ruleOf('normal'));
    expect(rows.filter((r) => r < GATED_ROWS)).toEqual([]);
    expect(rows.length).toBeGreaterThan(20);
    expect(Math.min(...rows)).toBe(GATED_ROWS);
  });

  it.each(['dusk', 'hard', 'lunatic'])('%s Act 1 rows 0-2 can still roll villages', (id) => {
    const rows = villageRows('act1', ruleOf(id));
    expect(rows.filter((r) => r < GATED_ROWS).length).toBeGreaterThan(20);
  });

  it('First Light Act 2 and Act 3 rows 0-2 can still roll villages', () => {
    for (const act of ['act2', 'act3']) {
      const rows = villageRows(act, ruleOf('normal'));
      expect(rows.filter((r) => r < GATED_ROWS).length, act).toBeGreaterThan(20);
    }
  });

  it('the gate discards the roll: the same seed gives the same map minus those villages', () => {
    let dropped = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const open = mapFor('act1', seed, null);
      const gated = mapFor('act1', seed, ruleOf('normal'));
      for (const node of open.nodes) {
        if (node.row < GATED_ROWS && node.battleParams?.hasVillage) {
          delete node.battleParams.hasVillage;
          dropped++;
        }
      }
      // ids, types, edges, objectives, battle seeds, templates, fog: all of it.
      expect(gated, `seed ${seed}`).toEqual(open);
    }
    expect(dropped).toBeGreaterThan(20);
  });

  it('the stream is kept for battle nodes only: a gated row still draws its village roll', () => {
    // Same seed, same node list: if the roll were skipped, the later battleSeeds would move.
    const open = mapFor('act1', 7, null);
    const gated = mapFor('act1', 7, ruleOf('normal'));
    expect(gated.nodes.map((n) => n.battleParams?.battleSeed)).toEqual(
      open.nodes.map((n) => n.battleParams?.battleSeed),
    );
    expect(gated.nodes.some((n) => n.type === NODE_TYPES.BATTLE && n.row < GATED_ROWS)).toBe(true);
  });
});

describe('RunManager hands the rung rule to the node map', () => {
  const startRun = (difficultyId, runSeed) => {
    const rm = new RunManager(data);
    rm.startRun({ difficultyId, runSeed, applyBlessingsAtStart: false });
    return rm;
  };
  const rowsWithVillage = (rm) =>
    rm.nodeMap.nodes.filter((n) => n.battleParams?.hasVillage).map((n) => n.row);

  it('a First Light run opens Act 1 without a village in rows 0-2', () => {
    let later = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const rows = rowsWithVillage(startRun('normal', seed));
      expect(
        rows.filter((r) => r < GATED_ROWS),
        `seed ${seed}`,
      ).toEqual([]);
      later += rows.length;
    }
    expect(later).toBeGreaterThan(0);
  });

  it('a Dusk run does not get the gate', () => {
    let early = 0;
    for (let seed = 1; seed <= 120; seed++) {
      early += rowsWithVillage(startRun('dusk', seed)).filter((r) => r < GATED_ROWS).length;
    }
    expect(early).toBeGreaterThan(0);
  });

  it('advancing into Act 2 on First Light lifts the gate', () => {
    let early = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const rm = startRun('normal', seed);
      rm.advanceAct();
      expect(rm.currentAct).toBe('act2');
      early += rowsWithVillage(rm).filter((r) => r < GATED_ROWS).length;
    }
    expect(early).toBeGreaterThan(0);
  });

  it('the act-transition call site passes the rule too (a rung gating Act 2)', () => {
    const difficulty = structuredClone(data.difficulty);
    difficulty.modes.normal.villageMinRow = { act2: GATED_ROWS };
    let later = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const rm = new RunManager({ ...data, difficulty });
      rm.startRun({ difficultyId: 'normal', runSeed: seed, applyBlessingsAtStart: false });
      rm.advanceAct();
      const rows = rowsWithVillage(rm);
      expect(
        rows.filter((r) => r < GATED_ROWS),
        `seed ${seed}`,
      ).toEqual([]);
      later += rows.length;
    }
    expect(later).toBeGreaterThan(0);
  });

  it('a saved run keeps its saved node map, villages and all (no migration)', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rm = startRun('hard', seed); // Act 1 rows 0-2 may hold villages here
      const saved = JSON.parse(JSON.stringify(rm.toJSON()));
      const loaded = RunManager.fromJSON(saved, data);
      expect(loaded.nodeMap).toEqual(rm.nodeMap);
    }
  });
});
