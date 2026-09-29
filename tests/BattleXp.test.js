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
