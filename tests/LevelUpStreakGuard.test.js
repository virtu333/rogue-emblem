// The level-up streak guard (UnitManager.levelUp, `{ guard: true }`): a player unit's levels
// from play (battle XP, Team XP, the arena: gainExperience({ guard })) never give two one-stat
// levels in a row while a stat came close, and an all-miss level goes to the closest miss.
// Everything comes from the same 8 draws, so the battle stream moves as before.
//
// Ways this can fail, one test (or more) each:
//   - a ninth draw (or a skipped one): every later roll of the battle changes
//   - the guard firing without a thin level before, or on a level that already has two stats
//   - the wrong stat: not the closest miss, a stat with 0 growth, a stat already gained,
//     a tie broken out of XP_STAT_NAMES order
//   - the all-miss fallback not taking the closest miss (or taking it for an unguarded unit)
//   - enemies, join levels, mercenaries or anything else unguarded rolling differently
//   - the flag not set from the final gains, touched by an extended level, or lost by a
//     save, a checkpoint or a promotion
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  closestMissStat,
  gainExperience,
  levelUp,
  levelUpFallbackStat,
  promoteUnit,
} from '../src/engine/UnitManager.js';
import { applyXpGain } from '../src/engine/BattleXp.js';
import { awardTeamXp } from '../src/engine/TeamXp.js';
import { serializeBattleUnit } from '../src/engine/BattleUnitState.js';
import { RunManager } from '../src/engine/RunManager.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { loadGameData } from './testData.js';

const STATS = ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK'];
const gainsOf = (list) =>
  Object.fromEntries(STATS.map((s) => [s, list.filter((x) => x === s).length]));

function counting(values) {
  let i = 0;
  const rng = () => values[i++ % values.length];
  rng.calls = () => i;
  return rng;
}
const unit = (growths, extra = {}) => ({
  name: 'Guarded',
  faction: 'player',
  tier: 'base',
  level: 5,
  xp: 0,
  growths: { HP: 0, STR: 0, MAG: 0, SKL: 0, SPD: 0, DEF: 0, RES: 0, LCK: 0, ...growths },
  stats: { HP: 20, STR: 5, MAG: 1, SKL: 5, SPD: 5, DEF: 5, RES: 1, LCK: 3 },
  currentHP: 20,
  skills: [],
  ...extra,
});

/** The levelUp of before the guard (copied from the previous source), the reference. */
function referenceLevelUp(u, rng) {
  if (u.level >= (u.tier === 'promoted' ? 20 : 20)) return null;
  const gains = {};
  let total = 0;
  for (const stat of STATS) {
    const gained = rng() * 100 < (u.growths[stat] || 0) ? 1 : 0;
    gains[stat] = gained;
    total += gained;
  }
  if (total === 0) gains[levelUpFallbackStat(u.growths)] = 1;
  return { gains, newLevel: u.level + 1 };
}

afterEach(() => vi.restoreAllMocks());

// Growths for the scripted cases: HP 80, STR 50, MAG 10, SKL 40, SPD 45, DEF 30, RES 20, LCK 35.
const G = { HP: 80, STR: 50, MAG: 10, SKL: 40, SPD: 45, DEF: 30, RES: 20, LCK: 35 };

describe('draws', () => {
  it('exactly 8 per level, guarded or not, thin before or not, even when nothing passes', () => {
    for (const draws of [[0.99], [0.01], [0.3, 0.6, 0.9, 0.2]])
      for (const options of [{}, { guard: true }])
        for (const thin of [false, true]) {
          const rng = counting(draws);
          levelUp(unit(G, { lastLevelUpThin: thin }), rng, options);
          expect(rng.calls()).toBe(8);
        }
  });

  it('gainExperience with the guard leaves a battle stream exactly where it would be without', () => {
    const cursor = (guard) => {
      const battle = createBattleRng(77);
      vi.spyOn(Math, 'random').mockImplementation(battle);
      gainExperience(unit(G, { lastLevelUpThin: true }), 450, { guard });
      vi.restoreAllMocks();
      return battle.getState();
    };
    expect(cursor(true)).toEqual(cursor(false));
  });
});

describe('the guard', () => {
  // Draws (x100): HP 95 (miss 15), STR 60 (miss 10), MAG 50 (miss 40), SKL 10 (pass),
  // SPD 52 (miss 7), DEF 99 (miss 69), RES 90 (miss 70), LCK 41 (miss 6).
  // One stat passes (SKL); the closest miss is LCK (41 - 35 = 6), then SPD (52 - 45 = 7).
  const draws = [0.95, 0.6, 0.5, 0.1, 0.52, 0.99, 0.9, 0.41];

  it('after a one-stat level, a one-stat level gets +1 to the closest miss (worked by hand)', () => {
    const result = levelUp(unit(G, { lastLevelUpThin: true }), counting(draws), { guard: true });
    expect(result.gains).toEqual(gainsOf(['SKL', 'LCK']));
    expect(result).toMatchObject({ guard: true, thinBefore: true, newLevel: 6 });
  });

  it('does nothing without a thin level before, or unguarded', () => {
    expect(levelUp(unit(G), counting(draws), { guard: true }).gains).toEqual(gainsOf(['SKL']));
    expect(levelUp(unit(G, { lastLevelUpThin: true }), counting(draws)).gains).toEqual(gainsOf(['SKL'])); // prettier-ignore
  });

  it('does nothing to a level that already has two stats', () => {
    const two = [...draws];
    two[0] = 0.1; // HP passes too
    const result = levelUp(unit(G, { lastLevelUpThin: true }), counting(two), { guard: true });
    expect(result.gains).toEqual(gainsOf(['HP', 'SKL']));
  });

  it('ties go to the earlier stat; a stat with no growth is never the miss', () => {
    // STR 75 vs 50 and SPD 75 vs 50: both miss by exactly 25; STR comes first. MAG (growth
    // 0) drew 0.0001 but is never a "miss".
    const g = { ...G, HP: 60, MAG: 0, SPD: 50 }; // HP misses by 39
    const tie = [0.99, 0.75, 0.0001, 0.1, 0.75, 0.99, 0.99, 0.99];
    const result = levelUp(unit(g, { lastLevelUpThin: true }), counting(tie), { guard: true });
    expect(result.gains).toEqual(gainsOf(['SKL', 'STR']));
  });

  it('closestMissStat skips stats already gained and returns null with none', () => {
    expect(closestMissStat({ STR: 3, SPD: 1 }, { SPD: 1 })).toBe('STR');
    expect(closestMissStat({}, {})).toBeNull();
  });
});

describe('the all-miss fallback', () => {
  // Every roll fails: HP 99 (19), STR 70 (20), MAG 50 (40), SKL 45 (5), SPD 99 (54),
  // DEF 99 (69), RES 99 (79), LCK 99 (64). Closest miss: SKL; highest growth: HP.
  const misses = [0.99, 0.7, 0.5, 0.45, 0.99, 0.99, 0.99, 0.99];

  it('guarded: the closest miss; unguarded: the highest growth, as before', () => {
    expect(levelUp(unit(G), counting(misses), { guard: true }).gains).toEqual(gainsOf(['SKL']));
    expect(levelUp(unit(G), counting(misses)).gains).toEqual(gainsOf(['HP']));
  });

  it('after a thin level, an all-miss level takes the two closest misses', () => {
    const result = levelUp(unit(G, { lastLevelUpThin: true }), counting(misses), { guard: true });
    expect(result.gains).toEqual(gainsOf(['SKL', 'HP']));
  });

  it('no growth above 0: levelUpFallbackStat stays the last resort (HP)', () => {
    expect(levelUp(unit({}), counting([0.5]), { guard: true }).gains).toEqual(gainsOf(['HP']));
  });
});

describe('who rolls with it', () => {
  it('unguarded rolls (enemies, join levels, mercenaries) are exactly the old rule', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const growths = Object.fromEntries(STATS.map((s, i) => [s, (seed * 7 + i * 13) % 90]));
      const a = createBattleRng(seed);
      const b = createBattleRng(seed);
      const u = unit(growths, { lastLevelUpThin: true, faction: 'enemy' });
      expect(levelUp(u, a)).toEqual(referenceLevelUp(u, b));
      expect(a.getState()).toEqual(b.getState());
    }
  });

  it('battle XP guards a player unit, never a foe; gainExperience alone never guards', () => {
    const scripted = [0.95, 0.6, 0.5, 0.1, 0.52, 0.99, 0.9, 0.41];
    const gainFor = (faction, via) => {
      vi.spyOn(Math, 'random').mockImplementation(counting(scripted));
      const u = unit(G, { lastLevelUpThin: true, faction });
      const out =
        via === 'battle'
          ? applyXpGain(u, 100, { classes: [] }).result.levelUps[0]
          : gainExperience(u, 100).levelUps[0];
      vi.restoreAllMocks();
      return { gains: out.gains, flag: u.lastLevelUpThin };
    };
    expect(gainFor('player', 'battle')).toEqual({ gains: gainsOf(['SKL', 'LCK']), flag: false });
    expect(gainFor('enemy', 'battle')).toEqual({ gains: gainsOf(['SKL']), flag: true });
    expect(gainFor('player', 'plain')).toEqual({ gains: gainsOf(['SKL']), flag: true });
  });

  it('Team XP guards the roster', () => {
    vi.spyOn(Math, 'random').mockImplementation(counting([0.95, 0.6, 0.5, 0.1, 0.52, 0.99, 0.9, 0.41])); // prettier-ignore
    const u = unit(G, { lastLevelUpThin: true, xp: 90 });
    const [entry] = awardTeamXp([u], 25, []);
    expect(entry.gains).toEqual(gainsOf(['SKL', 'LCK']));
  });
});

describe('the flag', () => {
  it('is set from the final gains of each guarded level; extended levels leave it', () => {
    vi.spyOn(Math, 'random').mockImplementation(counting([0.95, 0.6, 0.5, 0.1, 0.52, 0.99, 0.99, 0.99])); // prettier-ignore
    const u = unit(G);
    gainExperience(u, 100, { guard: true });
    expect(u.lastLevelUpThin).toBe(true); // SKL alone
    const promoted = unit(G, { tier: 'promoted', level: 20, lastLevelUpThin: true });
    gainExperience(promoted, 100, { guard: true, extendedLevelingEnabled: true });
    expect(promoted.extendedLevels).toBe(1);
    expect(promoted.lastLevelUpThin).toBe(true);
  });

  it('rides a battle checkpoint, the run save and a promotion', () => {
    const u = unit(G, { lastLevelUpThin: true });
    expect(serializeBattleUnit(u).lastLevelUpThin).toBe(true);
    const data = loadGameData();
    const rm = new RunManager(data);
    rm.startRun({ runSeed: 5, applyBlessingsAtStart: false });
    rm.roster[0].lastLevelUpThin = true;
    const back = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    expect(back.roster[0].lastLevelUpThin).toBe(true);
    const promoted = unit(G, { lastLevelUpThin: true, className: 'Myrmidon', level: 10 });
    const cls = data.classes.find((c) => c.name === 'Swordmaster');
    promoteUnit(promoted, cls, cls.promotionBonuses || {}, data.skills);
    expect(promoted.lastLevelUpThin).toBe(true);
  });
});
