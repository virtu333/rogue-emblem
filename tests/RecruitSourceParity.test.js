// Every recruit source gets what a recruit-node recruit gets (playtest 2026-09-29):
// seasoned growths (the upper half of each class range), the recruit stat/growth meta
// upgrades and the Skilled Recruits skill. Ways it can go wrong, each caught below:
//   - boss recruits roll the full growth range or skip Skilled Recruits;
//   - Colosseum mercenaries ignore the recruit stat/growth upgrades or Skilled Recruits,
//     or roll the full range;
//   - the Vanguard Cadre rolls the full range.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateBossRecruitCandidates } from '../src/engine/BossRecruitSystem.js';
import { generateMercenaryCandidates } from '../src/engine/ColosseumEngine.js';
import { RunManager } from '../src/engine/RunManager.js';
import { RECRUIT_SKILL_POOL } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = { ...loadGameData(), traits: null }; // traits change growths: keep them out
const STATS = ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK'];
afterEach(() => vi.restoreAllMocks());

function seeded(seed) {
  let x = seed;
  return () => {
    x = (x * 16807) % 2147483647;
    return x / 2147483647;
  };
}

/** The base class a recruit rolled its growths from (its own, or the one it promoted from). */
function growthClass(unit) {
  const own = data.classes.find((c) => c.name === unit.className);
  return own.growthRanges ? own : data.classes.find((c) => c.name === own.promotesFrom);
}

/**
 * Every growth is at least the seasoned floor: ceil((lo + hi) / 2) of the class range,
 * plus the meta growth bonus and the promoted class's growth bonus.
 */
function expectSeasoned(unit, metaGrowth = {}) {
  const base = growthClass(unit);
  const promo =
    unit.tier === 'promoted' ? data.classes.find((c) => c.name === unit.className) : null;
  for (const stat of STATS) {
    const [lo, hi] = base.growthRanges[stat].split('-').map(Number);
    const extra = (metaGrowth[stat] || 0) + (promo?.growthBonuses?.[stat] || 0);
    expect(unit.growths[stat], `${unit.className} ${stat}`).toBeGreaterThanOrEqual(
      Math.ceil((lo + hi) / 2) + extra,
    );
    expect(unit.growths[stat], `${unit.className} ${stat}`).toBeLessThanOrEqual(hi + extra);
  }
}

// Roll the lowest growth every time: a full-range roll then lands on `lo`, well below
// the seasoned floor, so a source that forgot `seasoned` fails.
const lowRolls = () => vi.spyOn(Math, 'random').mockReturnValue(0);

describe('boss recruits', () => {
  it.each(['act1', 'act2', 'act3'])('after the %s boss: seasoned growths', (act) => {
    lowRolls();
    const roster = [{ name: 'Edric', isCommander: true, tier: 'promoted', level: 6 }];
    const candidates = generateBossRecruitCandidates(act, roster, { ...data, lords: [] }, null);
    expect(candidates.length).toBeGreaterThan(0);
    for (const { unit } of candidates) expectSeasoned(unit);
  });

  it('get the Skilled Recruits skill and the recruit growth upgrade', () => {
    const roster = [{ name: 'Edric', isCommander: true, tier: 'base', level: 8 }];
    const meta = { growthBonuses: { SPD: 10 }, recruitRandomSkill: true };
    vi.spyOn(Math, 'random').mockImplementation(seeded(5));
    const withSkill = generateBossRecruitCandidates('act1', roster, { ...data, lords: [] }, meta);
    expect(withSkill.length).toBe(3);
    for (const { unit } of withSkill) {
      expect(
        unit.skills.some((id) => RECRUIT_SKILL_POOL.includes(id)),
        unit.className,
      ).toBe(true);
      expectSeasoned(unit, meta.growthBonuses);
    }
    // Without the upgrade (act 2 pool, no class innate from that pool): no pool skill.
    vi.spyOn(Math, 'random').mockImplementation(seeded(5));
    const plain = generateBossRecruitCandidates('act1', roster, { ...data, lords: [] }, null);
    const poolSkills = plain.filter(({ unit }) =>
      unit.skills.some((id) => RECRUIT_SKILL_POOL.includes(id)),
    );
    expect(poolSkills.length).toBeLessThan(plain.length);
  });
});

describe('Colosseum mercenaries', () => {
  const board = (act, meta, rngSeed = 9) =>
    generateMercenaryCandidates(
      act,
      8,
      data.recruits,
      data.classes,
      data.weapons,
      data.skills,
      'normal',
      data.colosseum,
      seeded(rngSeed),
      null,
      [],
      meta,
    );

  it.each(['act1', 'act2', 'act3'])('%s: seasoned growths', (act) => {
    lowRolls();
    const mercs = board(act, null);
    expect(mercs.length).toBeGreaterThan(0);
    for (const { unit } of mercs) expectSeasoned(unit);
  });

  it('get the recruit stat and growth upgrades', () => {
    vi.spyOn(Math, 'random').mockImplementation(seeded(3));
    const plain = board('act2', null);
    vi.spyOn(Math, 'random').mockImplementation(seeded(3));
    const boosted = board('act2', { statBonuses: { DEF: 3, HP: 2 } });
    expect(boosted.length).toBe(plain.length);
    for (let i = 0; i < plain.length; i++) {
      const [a, b] = [boosted[i].unit, plain[i].unit];
      expect(a.className).toBe(b.className);
      // +3 DEF (the join bonus's guard point can move from DEF to RES, so count both).
      expect(a.stats.DEF + a.stats.RES - b.stats.DEF - b.stats.RES).toBe(3);
      expect(a.stats.DEF - b.stats.DEF).toBeGreaterThanOrEqual(2);
      expect(a.stats.HP - b.stats.HP).toBe(2);
      expect(a.currentHP).toBe(a.stats.HP);
    }
    lowRolls();
    for (const { unit } of board('act2', { growthBonuses: { STR: 15 } }))
      expectSeasoned(unit, { STR: 15 });
  });

  it('get the Skilled Recruits skill', () => {
    vi.spyOn(Math, 'random').mockImplementation(seeded(4));
    const knowsPoolSkill = ({ unit }) => unit.skills.some((id) => RECRUIT_SKILL_POOL.includes(id));
    const mercs = [];
    for (let seed = 1; seed <= 6; seed++)
      mercs.push(...board('act1', { recruitRandomSkill: true }, seed));
    expect(mercs.every(knowsPoolSkill)).toBe(true);
    // Without it, only the board's own 50% roll gives one: some go without.
    const plain = [];
    for (let seed = 1; seed <= 6; seed++) plain.push(...board('act1', null, seed));
    expect(plain.every(knowsPoolSkill)).toBe(false);
  });
});

describe('Vanguard Cadre', () => {
  it('rolls seasoned growths', () => {
    lowRolls();
    const run = new RunManager(data, { extraStartingUnitTier: 1 });
    for (const className of ['Fighter', 'Archer', 'Mage', 'Cavalier']) {
      const unit = run._createExtraStartingUnit(className);
      expectSeasoned(unit);
    }
  });
});
