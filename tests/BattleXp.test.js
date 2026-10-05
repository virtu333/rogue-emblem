// BattleXp: the XP rules BattleScene and the headless harness share. Expected values
// are worked by hand from the constants (XP_BASE_COMBAT 25, XP_KILL_BONUS 15,
// XP_LEVEL_DIFF_SCALE 5, XP_MIN / XP_DEFEND_SURVIVE 1, XP_BASE_HEAL 20).
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { applyXpGain, combatXpAwards, scaledXp } from '../src/engine/BattleXp.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

const unit = (name, level, extra = {}) => ({
  name,
  level,
  tier: 'base',
  faction: 'player',
  col: 0,
  row: 0,
  currentHP: 20,
  xp: 0,
  stats: { HP: 20 },
  ...extra,
});
const foe = (level = 5) => ({ name: 'Foe', level, tier: 'base', faction: 'enemy', currentHP: 0 });
const band = { name: "Mentor's Band", combatEffects: { xpShare: 0.5 } };
const awardsOf = (list) => list.map((a) => [a.unit.name, a.baseXp, a.share]);

describe('combatXpAwards', () => {
  it('a kill between equals earns base + kill bonus, times the reward multiplier', () => {
    // (25 + 15) × 1.5 = 60
    const hero = unit('Hero', 5);
    const got = combatXpAwards({
      unit: hero,
      opponent: foe(),
      opponentDied: true,
      rewardMultiplier: 1.5,
    });
    expect(awardsOf(got)).toEqual([['Hero', 60, false]]);
  });

  it('a hit that does not kill earns in proportion to the damage dealt', () => {
    // 25 × (10 / 20) = 12.5 → 12
    const hero = unit('Hero', 5);
    const got = combatXpAwards({
      unit: hero,
      opponent: foe(),
      opponentDied: false,
      damageDealt: 10,
      opponentHpAtStart: 20,
    });
    expect(awardsOf(got)).toEqual([['Hero', 12, false]]);
  });

  it('Training Doctrine raises a recruit’s combat XP, never a lord’s', () => {
    // floor(floor(25 × 0.5) × 1.2) = floor(14.4) = 14 for the recruit; 12 for the lord
    const args = { opponent: foe(), opponentDied: false, damageDealt: 10, opponentHpAtStart: 20 };
    const recruit = combatXpAwards({ ...args, unit: unit('Recruit', 5), recruitXpBonus: 0.2 });
    const lord = combatXpAwards({
      ...args,
      unit: unit('Lord', 5, { isLord: true }),
      recruitXpBonus: 0.2,
    });
    expect(awardsOf(recruit)).toEqual([['Recruit', 14, false]]);
    expect(awardsOf(lord)).toEqual([['Lord', 12, false]]);
  });

  it('late pressure scales the award', () => {
    // floor(40 × 0.5) = 20
    const got = combatXpAwards({
      unit: unit('Hero', 5),
      opponent: foe(),
      opponentDied: true,
      pressureXpMultiplier: 0.5,
    });
    expect(awardsOf(got)).toEqual([['Hero', 20, false]]);
  });

  it('surviving an attack while dealing no damage earns the minimum and shares nothing', () => {
    const holder = unit('Holder', 5, { accessory: band });
    const ally = unit('Ally', 3, { col: 1 });
    const args = {
      unit: holder,
      opponent: foe(),
      opponentDied: false,
      damageDealt: 0,
      opponentHpAtStart: 20,
      allies: [holder, ally],
    };
    expect(awardsOf(combatXpAwards({ ...args, survivedAttack: true }))).toEqual([
      ['Holder', 1, false],
    ]);
    expect(combatXpAwards(args)).toEqual([]);
  });

  it('an opponent worth no XP gives nothing', () => {
    expect(
      combatXpAwards({
        unit: unit('Hero', 5),
        opponent: { ...foe(), _noXP: true },
        opponentDied: true,
      }),
    ).toEqual([]);
  });

  it("Mentor's Band shares the ally's own formula, scaled like the holder's", () => {
    // Holder L5 vs L5 at half damage: floor(25 × 0.5) = 12.
    // Ally L3 vs L5: 25 + 2 × 5 = 35; × 0.5 band × 0.5 damage = 8.75 → 8.
    const holder = unit('Holder', 5, { accessory: band });
    const ally = unit('Ally', 3, { col: 1 });
    const farAlly = unit('Far', 3, { col: 3 });
    const got = combatXpAwards({
      unit: holder,
      opponent: foe(),
      opponentDied: false,
      damageDealt: 10,
      opponentHpAtStart: 20,
      allies: [holder, ally, farAlly],
    });
    expect(awardsOf(got)).toEqual([
      ['Holder', 12, false],
      ['Ally', 8, true],
    ]);
  });
});

describe('scaledXp', () => {
  it('applies par × (rate + blessings) × trait, floored, never below 1', () => {
    // 20 × 1.25 × (1 + 0.1) × 1 = 27.5 → 27
    expect(scaledXp(20, { parXpMultiplier: 1.25, xpMultiplier: 1, blessingXpDelta: 0.1 })).toBe(27);
    expect(scaledXp(20, { xpMultiplier: 0.5, traitXpMultiplier: 1.5 })).toBe(15);
    expect(scaledXp(0)).toBe(1);
  });
});

describe('applyXpGain', () => {
  it('levels the unit and snapshots its stats before any skill is granted', () => {
    const cls = data.classes.find((c) => c.name === 'Myrmidon');
    const hero = {
      ...unit('Hero', 1),
      className: cls.name,
      growths: Object.fromEntries(Object.keys(cls.baseStats || {}).map((k) => [k, 0])),
      stats: { ...(cls.baseStats || { HP: 20 }) },
      skills: [],
    };
    const { result, statsAfterGain, levelUps } = applyXpGain(hero, 150, { classes: data.classes });
    expect(hero.level).toBe(2);
    expect(hero.xp).toBe(50);
    expect(levelUps).toHaveLength(1);
    expect(levelUps[0].levelUp).toBe(result.levelUps[0]);
    expect(statsAfterGain).toEqual(hero.stats);
  });
});

describe('the headless harness gives heal XP as the game does', () => {
  it('a staff heal earns XP_BASE_HEAL through the battle multipliers, not half the HP healed', () => {
    // Before: floor(healed / 2). Now: scaledXp(20) = 20 × 1.25 (turn 1 is under par: S).
    const battle = Object.create(HeadlessBattle.prototype);
    Object.assign(battle, {
      _battleSession: 1,
      gameData: { ...data, deeds: null },
      turnManager: { turnNumber: 1 },
      turnPar: 8,
      battleParams: {},
      playerUnits: [],
      _finishUnitAction() {},
    });
    const staff = structuredClone(data.weapons.find((w) => w.name === 'Heal'));
    const healer = unit('Sera', 5, {
      stats: { HP: 20, MAG: 4 },
      inventory: [staff],
      weapon: staff,
      proficiencies: [{ type: 'Staff', rank: 'Prof' }],
      skills: [],
    });
    const hurt = unit('Edric', 5, { col: 1, currentHP: 4 });
    battle.playerUnits = [healer, hurt];
    battle._executeHeal(healer, hurt);
    expect(hurt.currentHP).toBeGreaterThan(4);
    expect(healer.xp).toBe(25);
  });
});

// Pinned before applyXpGain also returned a gain record (docs/specs/exp-bars.md §2.5):
// what it returned, what it did to the unit and how many Math.random draws it took
// must not change. Every expected value is worked by hand: growths are 100 (HP) or 0
// (the rest), so each level-up is exactly +1 HP and takes one draw per stat (8);
// an extended level-up takes one draw (the stat pick).
describe('applyXpGain: results, unit state and RNG draws (pinned)', () => {
  const growths = { HP: 100, STR: 0, MAG: 0, SKL: 0, SPD: 0, DEF: 0, RES: 0, LCK: 0 };
  const statsOf = (hp) => ({ HP: hp, STR: 5, MAG: 0, SKL: 5, SPD: 5, DEF: 5, RES: 0, LCK: 0 });
  const fighter = (level, xp, extra = {}) => ({
    name: 'Pin',
    className: 'Myrmidon',
    tier: 'base',
    faction: 'player',
    level,
    xp,
    growths: { ...growths },
    stats: statsOf(20),
    currentHP: 20,
    skills: [],
    ...extra,
  });
  /** Run applyXpGain with a counting Math.random (always 0.5: every 100 growth hits). */
  function run(u, xp, options = {}) {
    let draws = 0;
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      draws++;
      return 0.5;
    });
    try {
      const out = applyXpGain(u, xp, { classes: data.classes, ...options });
      return { out, draws };
    } finally {
      spy.mockRestore();
    }
  }
  const plusOneHp = (newLevel) => ({
    gains: { HP: 1, STR: 0, MAG: 0, SKL: 0, SPD: 0, DEF: 0, RES: 0, LCK: 0 },
    newLevel,
  });
  const state = (u) => ({
    level: u.level,
    xp: u.xp,
    extendedLevels: u.extendedLevels,
    HP: u.stats.HP,
    currentHP: u.currentHP,
    skills: [...u.skills],
  });

  it('a gain inside the level: no level-up, no draws', () => {
    const u = fighter(5, 40);
    const { out, draws } = run(u, 30);
    expect(draws).toBe(0);
    expect(state(u)).toEqual({
      level: 5,
      xp: 70,
      extendedLevels: undefined,
      HP: 20,
      currentHP: 20,
      skills: [],
    });
    expect(out.result).toEqual({ levelUps: [] });
    expect(out.statsAfterGain).toEqual(statsOf(20));
    expect(out.levelUps).toEqual([]);
  });

  it('two wraps in one gain: two level-ups, 16 draws, 10 XP left over', () => {
    const u = fighter(5, 80);
    const { out, draws } = run(u, 130); // 210 → 110 (Lv 6) → 10 (Lv 7)
    expect(draws).toBe(16);
    expect(state(u)).toEqual({
      level: 7,
      xp: 10,
      extendedLevels: undefined,
      HP: 22,
      currentHP: 22,
      skills: [],
    });
    expect(out.result).toEqual({ levelUps: [plusOneHp(6), plusOneHp(7)] });
    expect(out.statsAfterGain).toEqual(statsOf(22));
    expect(out.levelUps).toEqual([
      { levelUp: plusOneHp(6), learnedIds: [], blockedIds: [] },
      { levelUp: plusOneHp(7), learnedIds: [], blockedIds: [] },
    ]);
  });

  it('reaching level 10 teaches the class skill after the stat snapshot', () => {
    const u = fighter(9, 90);
    const { out } = run(u, 20);
    expect(state(u)).toEqual({
      level: 10,
      xp: 10,
      extendedLevels: undefined,
      HP: 21,
      currentHP: 21,
      skills: ['vantage'],
    });
    expect(out.levelUps).toEqual([
      { levelUp: plusOneHp(10), learnedIds: ['vantage'], blockedIds: [] },
    ]);
  });

  it('reaching the cap keeps what is left under 100, and spends 100 more before clamping', () => {
    const near = fighter(19, 90);
    const a = run(near, 30); // 120 → 20 at Lv 20: the loop stops, 20 stays
    expect(a.draws).toBe(8);
    expect(state(near)).toMatchObject({ level: 20, xp: 20, HP: 21 });
    expect(a.out.result).toEqual({ levelUps: [plusOneHp(20)] });

    const over = fighter(19, 90);
    run(over, 200); // 290 → 190 at Lv 20 → 90 (levelUp refuses) → min(90, 99) = 90
    expect(state(over)).toMatchObject({ level: 20, xp: 90, HP: 21 });

    const huge = fighter(19, 90);
    run(huge, 320); // 410 → 310 at Lv 20 → 210 → min(210, 99) = 99
    expect(state(huge)).toMatchObject({ level: 20, xp: 99, HP: 21 });
  });

  it('at the cap nothing is added and nothing is drawn', () => {
    const u = fighter(20, 20);
    const { out, draws } = run(u, 50);
    expect(draws).toBe(0);
    expect(state(u)).toMatchObject({ level: 20, xp: 20, HP: 20 });
    expect(out.result).toEqual({ levelUps: [] });
    expect(out.levelUps).toEqual([]);
    // A promoted unit too, unless extended leveling is on.
    const promoted = fighter(20, 0, { tier: 'promoted', className: 'Swordmaster' });
    expect(run(promoted, 50).draws).toBe(0);
    expect(promoted.xp).toBe(0);
  });

  it('extended leveling: a promoted unit at 20 keeps wrapping, one draw per bonus level', () => {
    const u = fighter(20, 50, { tier: 'promoted', className: 'Swordmaster' });
    const { out, draws } = run(u, 170, { extendedLevelingEnabled: true }); // 220 → 120 → 20
    expect(draws).toBe(2);
    expect(state(u)).toMatchObject({ level: 20, xp: 20, extendedLevels: 2 });
    expect(out.result.levelUps.map((l) => [l.isExtended, l.newLevel, l.extendedLevel])).toEqual([
      [true, 20, 1],
      [true, 20, 2],
    ]);
    // A base unit at 20 is capped even with extended leveling on.
    const base = fighter(20, 0);
    expect(run(base, 50, { extendedLevelingEnabled: true }).draws).toBe(0);
    expect(base.xp).toBe(0);
  });
});
