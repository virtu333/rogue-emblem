// Skeleton XP slice (docs/specs/phase3.md "Sims"): a Necromancer battle fought to the last
// turn must not pay more XP than the same battle without one.
//
// A Necromancer raises a Skeleton every phase it is short of two, without end, so the
// question is the tail: what can a party take from them when it fights nothing else for as
// long as the XP still flows? This slice plays that worst case through the real harness
// battle (HeadlessBattle: its XP path, its par clock and its late-pressure decay are the
// scene's, engine/BattleXp.js) on a real generated Act IV Black Sun rout:
//
//   - every turn from 1 to 40, a unit of every level (base 1-20, promoted 1-12) kills a
//     Skeleton of every level a Necromancer raises in Act IV (9-18), or is attacked by one and
//     lives, and the XP it earns is read off the unit;
//   - the control is an ordinary foe of the same level: the same battle without a Necromancer
//     pays what its foes pay, and no Skeleton ever pays more than a quarter of one.
//
// What must hold:
//   1. a Skeleton never pays more than a quarter of what an ordinary foe of its level pays
//      for the same kill (plus the 1 XP an award always rounds up to);
//   2. being attacked by a Skeleton and living pays nothing, ever (an ordinary foe pays the
//      survival minimum, which for an endless supply of Skeletons would never stop);
//   3. from the last step of the late-pressure table on (XP x0.1) a Skeleton pays at most
//      1 XP a kill, and a unit that out-levels the Skeletons by the over-level tier (7
//      effective levels) earns nothing from them on any turn;
//   4. a Necromancer raises at most six Skeletons in a battle, so the very worst case is six
//      kills on the six best turns (1 to 6): they pay at most six quarter-kills of an
//      ordinary foe of the Skeleton's level, (rounding up included).
// (HeadlessBattleNecromancy.test.js bounds a whole harness battle at six quarter-kills.)
// Ways this breaks: the quarter is dropped, the survival minimum applies to a raised unit, a
// raise pays gold or a whole share, the late-pressure table stops reaching the Skeleton.
import { afterEach, describe, expect, it } from 'vitest';
import { GameDriver } from '../harness/GameDriver.js';
import { getXpEffectiveLevel, calculateCombatXP } from '../../src/engine/UnitManager.js';
import { getLatePressureState } from '../../src/engine/TurnBonusCalculator.js';
import { NECROMANCER_RAISE_CAP } from '../../src/utils/constants.js';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';

const data = loadGameData();
const TURNS = 40;
// Act IV Necromancers show promoted levels 1 to 10 (effective 13 to 22, Black Sun's bonus
// included): their Skeletons are that less 4.
const SKELETON_LEVELS = Array.from({ length: 10 }, (_, i) => i + 9);
const PARTY = [
  ...Array.from({ length: 20 }, (_, i) => ({ tier: 'base', level: i + 1 })),
  ...Array.from({ length: 12 }, (_, i) => ({ tier: 'promoted', level: i + 1 })),
];

afterEach(() => restoreMathRandom());

function setup() {
  installSeed(5);
  const driver = new GameDriver(data, {
    act: 'act4',
    objective: 'rout',
    battleSeed: 5,
    difficultyId: 'lunatic',
  });
  driver.init();
  const b = driver.battle;
  const unit = b.playerUnits[0];
  // The battle's own clock, every other XP multiplier neutral: this slice reads the decay.
  b.battleParams.xpMultiplier = 1;
  b.battleParams.blessingXpDelta = 0;
  unit.skills = [];
  return { b, unit };
}

const skeleton = (level, raised = true) => ({
  className: 'Skeleton',
  name: 'Skeleton',
  faction: 'enemy',
  tier: 'base',
  level,
  currentHP: 12,
  ...(raised ? { _raisedBy: 'u9' } : {}),
});

/** The XP `unit` (set to `who`) takes from one event against `victim`, on turn `turn`. */
function earned(b, unit, who, victim, turn, event) {
  Object.assign(unit, { tier: who.tier, level: who.level, xp: 0, currentHP: 20 });
  const level0 = unit.level;
  b.turnManager.turnNumber = turn;
  if (event === 'kill') b._awardCombatXP(unit, victim, true, null, null);
  // Attacked and living, with no counter that hurt: only the survival minimum can pay.
  else b._awardCombatXP(unit, victim, false, 0, victim.currentHP, { survivedAttack: true });
  return (unit.level - level0) * 100 + unit.xp;
}

describe('Skeleton XP never outlasts the late-pressure table', () => {
  const { b, unit } = setup();
  const par = b.turnPar;
  const table = data.turnBonus.latePressure.xpMultipliers;
  const floorTurn = (() => {
    for (let t = 1; t <= 200; t++)
      if (getLatePressureState(t, par, data.turnBonus).xpMultiplier === table.at(-1)) return t;
    throw new Error('the late-pressure table never reaches its last step');
  })();

  it('the battle has a par and the table a last step inside the window', () => {
    expect(Number.isFinite(par)).toBe(true);
    expect(table.at(-1)).toBeLessThanOrEqual(0.1);
    expect(floorTurn).toBeGreaterThan(par);
    expect(floorTurn).toBeLessThan(TURNS);
  });

  it('1. a Skeleton pays at most a quarter of what an ordinary foe pays for the same event', () => {
    for (const who of PARTY)
      for (const s of SKELETON_LEVELS)
        for (let t = 1; t <= TURNS; t++) {
          const sk = earned(b, unit, who, skeleton(s), t, 'kill');
          const plain = earned(b, unit, who, skeleton(s, false), t, 'kill');
          // Rounding: a quarter is floored before the par scale, which can round a 0 up to 1.
          expect(sk, `${who.tier} ${who.level} vs L${s} turn ${t}`).toBeLessThanOrEqual(
            Math.floor(plain / 4) + 1,
          );
        }
  });

  it('2. surviving a Skeleton pays nothing, on any turn (an ordinary foe pays the minimum)', () => {
    let ordinaryPays = 0;
    for (const who of PARTY)
      for (const s of SKELETON_LEVELS)
        for (let t = 1; t <= TURNS; t++) {
          expect(earned(b, unit, who, skeleton(s), t, 'survive')).toBe(0);
          ordinaryPays += earned(b, unit, who, skeleton(s, false), t, 'survive') > 0 ? 1 : 0;
        }
    expect(ordinaryPays).toBeGreaterThan(0); // the control does pay: the zero above is the rule
  });

  it('3. at the last step of the table a Skeleton pays at most 1 XP a kill; out-levelled, none', () => {
    for (const who of PARTY)
      for (const s of SKELETON_LEVELS) {
        const effective = who.tier === 'promoted' ? who.level + 12 : who.level;
        for (let t = floorTurn; t <= TURNS; t++) {
          const xp = earned(b, unit, who, skeleton(s), t, 'kill');
          expect(xp, `${who.tier} ${who.level} L${s} t${t}`).toBeLessThanOrEqual(1);
          if (effective - s >= 7) expect(xp).toBe(0);
        }
      }
  });

  it('out-levelled by 7 effective levels, a unit earns nothing from Skeletons on any turn', () => {
    for (const who of PARTY)
      for (const s of SKELETON_LEVELS) {
        const effective = who.tier === 'promoted' ? who.level + 12 : who.level;
        if (effective - s < 7) continue;
        for (let t = 1; t <= TURNS; t++)
          expect(earned(b, unit, who, skeleton(s), t, 'kill'), `${who.tier} ${who.level} L${s} t${t}`).toBe(0); // prettier-ignore
      }
  });

  it('4. six Skeleton kills on the six best turns pay at most six quarter-kills of an ordinary foe', () => {
    // The whole battle's worth: a Necromancer raises six in all (NECROMANCER_RAISE_CAP), the
    // best a party can do is kill them on turns 1 to 6. That is six quarters of what the same
    // six kills of an ordinary foe of the Skeleton's level would pay, rounding up included.
    let mostFarmed = 0;
    let mostShare = 0;
    for (const who of PARTY)
      for (const s of SKELETON_LEVELS) {
        let farmed = 0;
        let ceiling = 0;
        let ordinary = 0;
        for (let t = 1; t <= NECROMANCER_RAISE_CAP; t++) {
          farmed += earned(b, unit, who, skeleton(s), t, 'kill');
          const plain = earned(b, unit, who, skeleton(s, false), t, 'kill');
          ordinary += plain;
          ceiling += Math.floor(plain / 4) + 1;
        }
        expect(farmed, `${who.tier} ${who.level} vs L${s}`).toBeLessThanOrEqual(ceiling);
        if (ordinary > 0) mostShare = Math.max(mostShare, farmed / ordinary);
        mostFarmed = Math.max(mostFarmed, farmed);
      }
    // Never more than 0.3 of six ordinary same-level kills (a quarter, and rounding up).
    expect(mostShare).toBeLessThanOrEqual(0.3);
    expect(mostFarmed).toBeGreaterThan(0); // the slice does see XP where it is paid
  });

  it("XP formula check: the control numbers are the engine's own (calculateCombatXP)", () => {
    // A level 1 recruit killing a level 1 Skeleton: 25 + 15 raw, a quarter of it.
    expect(calculateCombatXP({ level: 1, tier: 'base' }, skeleton(1), true)).toBe(40);
    expect(getXpEffectiveLevel({ level: 4, tier: 'promoted' })).toBe(16);
  });
});
