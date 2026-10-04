// Par review 2026-10-04: pars were loose where clears are fast. A pushing army S-ranked
// every First Light map, 90%+ of escape maps on every rung and most Act IV maps (rout
// enemies charge from turn 1, so map size barely slows a clear, but it raises par).
// The tune, all locked into a map's battle config when it is generated:
//   - First Light inflation 3 → 1;
//   - escape par −2 (Black Sun −1);
//   - Act IV rout par −2 (Black Sun −1); seize keeps its own offset and floor.
// Ways it can go wrong, one test each:
//   - an offset lands on the wrong objective or act (or a rout offset stacks on seize);
//   - the battle (harness, as BattleScene) does not rate against the locked offset;
//   - the seize floor's First Light cap reads the old inflation and lifts a harder rung
//     above First Light;
//   - a harder rung ends up looser than an easier one (beyond Black Sun's agreed turn);
//   - bad offset shapes validate.
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { generateBattle, objectiveParOffsetFor } from '../src/engine/MapGenerator.js';
import { resolveDifficultyMode, validateDifficultyConfig } from '../src/engine/DifficultyEngine.js';
import { calculatePar } from '../src/engine/TurnBonusCalculator.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';

const data = loadGameData();
const RUNGS = ['normal', 'dusk', 'hard', 'lunatic']; // easiest first

// Written out by hand from the review (not read back from difficulty.json).
const ESCAPE = { normal: -2, dusk: -2, hard: -2, lunatic: -1 };
const ACT4_ROUT = { dusk: -2, hard: -2, lunatic: -1 };
const SEIZE = { dusk: -3, hard: -4, lunatic: -4 };
const INFLATION = { normal: 1, dusk: 2, hard: 3, lunatic: 3 };

const modifiers = (rung) => resolveDifficultyMode(data.difficulty, rung).modifiers;

function gen(rung, act, objective, seed, extra = {}) {
  installSeed(seed);
  try {
    return generateBattle(
      { ...modifiers(rung), difficultyId: rung, act, objective, deployCount: 6, row: 3, ...extra },
      data,
    );
  } finally {
    restoreMathRandom();
  }
}

/** Par of map `bc` on `rung` with `offset`, no floor. */
function parWith(bc, rung, offset) {
  return calculatePar(
    {
      cols: bc.cols,
      rows: bc.rows,
      enemyCount: bc.enemySpawns.length,
      objective: bc.objective,
      mapLayout: bc.mapLayout,
      terrainData: data.terrain,
      parBonus: bc.parBonus || 0,
      parInflation: INFLATION[rung],
      parOffset: offset,
    },
    data.turnBonus,
    rung,
  );
}

const lockedPar = (bc, rung) =>
  calculatePar(
    {
      cols: bc.cols,
      rows: bc.rows,
      enemyCount: bc.enemySpawns.length,
      objective: bc.objective,
      mapLayout: bc.mapLayout,
      terrainData: data.terrain,
      parBonus: bc.parBonus || 0,
      parInflation: bc.parInflation,
      parOffset: bc.parOffset,
      parFloor: bc.parFloor,
    },
    data.turnBonus,
    rung,
  );

describe('which maps the offsets reach', () => {
  it('escape maps lock their rung’s escape offset in every act', () => {
    let maps = 0;
    for (const rung of RUNGS) {
      for (const act of ['act1', 'act2', 'act3']) {
        for (let seed = 1; seed <= 3; seed++) {
          const bc = gen(rung, act, 'escape', seed);
          if (bc.objective !== 'escape') continue;
          maps++;
          expect(bc.parOffset, `${rung} ${act} ${seed}`).toBe(ESCAPE[rung]);
          expect(bc.parFloor).toBeUndefined();
          expect(lockedPar(bc, rung)).toBe(Math.max(1, parWith(bc, rung, 0) + ESCAPE[rung]));
        }
      }
    }
    expect(maps).toBeGreaterThan(24);
  });

  it('rout maps take an offset in Act IV only', () => {
    for (const rung of ['dusk', 'hard', 'lunatic']) {
      for (let seed = 1; seed <= 3; seed++) {
        const act4 = gen(rung, 'act4', 'rout', seed);
        expect(act4.parOffset, `${rung} act4 ${seed}`).toBe(ACT4_ROUT[rung]);
        expect(act4.parFloor).toBeUndefined();
        expect(lockedPar(act4, rung)).toBe(parWith(act4, rung, 0) + ACT4_ROUT[rung]);
        for (const act of ['act1', 'act2', 'act3', 'finalBoss'])
          expect(gen(rung, act, 'rout', seed).parOffset, `${rung} ${act}`).toBeUndefined();
      }
    }
    // First Light never reaches Act IV, and has no rout offset anywhere.
    expect(gen('normal', 'act3', 'rout', 1).parOffset).toBeUndefined();
  });

  it('Act IV seize keeps the seize offset alone (the rout offset never stacks on it)', () => {
    for (const rung of ['dusk', 'hard', 'lunatic']) {
      const bc = gen(rung, 'act4', 'seize', 2, { isBoss: true });
      expect(bc.objective).toBe('seize');
      expect(bc.parOffset).toBe(SEIZE[rung]);
      expect(Number.isInteger(bc.parFloor)).toBe(true);
    }
  });

  it('the harness (as BattleScene) rates an Act IV rout map against its locked offset', () => {
    installSeed(9);
    const battle = new HeadlessBattle(data, {
      ...modifiers('hard'),
      difficultyId: 'hard',
      act: 'act4',
      objective: 'rout',
      battleSeed: 909,
      deployCount: 6,
    });
    battle.init();
    restoreMathRandom();
    const bc = { ...battle.battleConfig, enemySpawns: battle.enemyUnits };
    expect(bc.parOffset).toBe(-2);
    expect(battle.turnPar).toBe(parWith(bc, 'hard', 0) - 2);
  });
});

describe('objectiveParOffsetFor', () => {
  it('reads a number for every act, or a table by act', () => {
    const offsets = { seize: -4, rout: { act4: -2 } };
    expect(objectiveParOffsetFor(offsets, 'seize', 'act1')).toBe(-4);
    expect(objectiveParOffsetFor(offsets, 'rout', 'act4')).toBe(-2);
    expect(objectiveParOffsetFor(offsets, 'rout', 'act3')).toBe(0);
    expect(objectiveParOffsetFor(offsets, 'rout', undefined)).toBe(0);
    expect(objectiveParOffsetFor(offsets, 'escape', 'act4')).toBe(0);
    expect(objectiveParOffsetFor(null, 'seize', 'act1')).toBe(0);
  });
});

describe('First Light and the rung order', () => {
  it('the seize floor’s cap is First Light’s own par', () => {
    // turnBonus.firstLightParInflation must follow First Light's inflation, or the cap
    // lifts a harder rung's seize par above First Light's.
    expect(data.turnBonus.firstLightParInflation).toBe(INFLATION.normal);
    expect(data.difficulty.modes.normal.parInflation).toBe(INFLATION.normal);
    const bc = {
      cols: 8,
      rows: 8,
      enemySpawns: Array(4).fill({}),
      mapLayout: Array.from({ length: 8 }, () => Array(8).fill(0)),
      objective: 'seize',
    };
    const firstLight = parWith(bc, 'normal', 0);
    const capped = calculatePar(
      {
        cols: 8,
        rows: 8,
        enemyCount: 4,
        objective: 'seize',
        mapLayout: bc.mapLayout,
        terrainData: data.terrain,
        parInflation: INFLATION.hard,
        parOffset: SEIZE.hard,
        parFloor: 99,
      },
      data.turnBonus,
      'hard',
    );
    expect(capped).toBe(firstLight);
  });

  it('escape and Act IV rout: First Light ≥ Dusk ≥ Nightfall; Black Sun at most a turn looser', () => {
    let maps = 0;
    for (const [act, objective] of [
      ['act2', 'escape'],
      ['act3', 'escape'],
      ['act4', 'rout'],
    ]) {
      for (let seed = 1; seed <= 8; seed++) {
        const bc = gen('dusk', act, objective, seed);
        if (bc.objective !== objective) continue;
        maps++;
        const offset = (rung) => (objective === 'escape' ? ESCAPE[rung] : ACT4_ROUT[rung] || 0);
        const pars = RUNGS.map((rung) => parWith(bc, rung, offset(rung)));
        const label = `${act} ${objective} ${seed}: ${pars.join(' / ')}`;
        expect(pars[1], label).toBeLessThanOrEqual(pars[0]);
        expect(pars[2], label).toBeLessThanOrEqual(pars[1]);
        // Black Sun takes a turn less of the tightening (owner's call, 2026-10-04).
        expect(pars[3], label).toBeLessThanOrEqual(pars[2] + 1);
      }
    }
    expect(maps).toBeGreaterThan(12);
  });
});

describe('validation', () => {
  it('takes a rout offset and offsets by act; rejects bad acts and values', () => {
    expect(validateDifficultyConfig(data.difficulty)).toEqual({ valid: true, errors: [] });
    const bad = structuredClone(data.difficulty);
    bad.modes.dusk.objectiveParOffset = { rout: { act9: -1, act4: 1.5 }, siege: -1 };
    bad.modes.hard.objectiveParOffset = { escape: 'tight' };
    bad.modes.lunatic.holdShare = { rout: 0.2 };
    const errors = validateDifficultyConfig(bad).errors.join('\n');
    expect(errors).toMatch(/dusk\.objectiveParOffset\.rout\.act9 is not an act id/);
    expect(errors).toMatch(/dusk\.objectiveParOffset\.rout\.act4 must be an integer/);
    expect(errors).toMatch(
      /dusk\.objectiveParOffset\.siege is not a rout\/seize\/escape objective/,
    );
    expect(errors).toMatch(/hard\.objectiveParOffset\.escape must be an integer/);
    expect(errors).toMatch(/lunatic\.holdShare\.rout is not a seize\/escape objective/);
  });
});
