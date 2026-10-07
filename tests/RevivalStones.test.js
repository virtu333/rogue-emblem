// Revival Stones (docs/specs/phase3.md 3D): a boss with stones refills to full HP when a
// blow would drop it to 0, once per stone, and a broken stone ends the exchange.
//
// Every expected number below is worked by hand from the formulas in CLAUDE.md, never by
// running the code under test:
//   damage = STR + weapon Might - DEF          (Iron Sword Might 5, sword v sword: no triangle)
//   attack speed = SPD - max(0, weight 3 - floor(STR / 5)); a lead of 5 doubles
//   hit/crit are made certain/zero by Math.random() = 0 and crit = SKL/2 - foe LCK = 0.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveCombat, getCombatForecast } from '../src/engine/Combat.js';
import {
  checkAstra,
  rollDefenseSkills,
  rollStrikeSkills,
  getSkillCombatMods,
} from '../src/engine/SkillSystem.js';
import {
  absorbLethal,
  applyCombatHP,
  damageUnit,
  damageUnitDetailed,
  setUnitHP,
} from '../src/engine/UnitHealth.js';
import { recordCombat } from '../src/engine/DeedSystem.js';
import { calculateCombatXP } from '../src/engine/UnitManager.js';
import { combatHpLost, combatXpAwards } from '../src/engine/BattleXp.js';
import { getWeaponArtCombatMods } from '../src/engine/WeaponArtSystem.js';
import { revivalStoneCount, revivalStonesLine } from '../src/engine/RevivalStones.js';
import {
  forecastNotes,
  forecastProjection,
  forecastReadingPoints,
  projectedFallText,
} from '../src/ui/forecastDisplay.js';
import { bossBarView, createBossBarState, reduceBossBar } from '../src/ui/ceremonyContent.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const weapon = (name) => structuredClone(gameData.weapons.find((w) => w.name === name));

afterEach(() => vi.restoreAllMocks());

const STATS = { HP: 30, STR: 10, MAG: 0, SKL: 0, SPD: 8, DEF: 4, RES: 3, LCK: 0, MOV: 4 };

function unit(name, faction, stats = {}, extra = {}) {
  const full = { ...STATS, ...stats };
  return {
    name,
    faction,
    level: 5,
    skills: [],
    stats: full,
    currentHP: full.HP,
    col: faction === 'player' ? 0 : 1,
    row: 0,
    weaponRank: 'Prof',
    weapon: weapon('Iron Sword'),
    ...extra,
  };
}

/** The player's blade: 14 STR (15 damage on DEF 4), 19 attack speed v the boss's 3: doubles. */
const striker = (stats = {}, extra = {}) =>
  unit('Edric', 'player', { STR: 14, SPD: 20, DEF: 5, ...stats }, extra);

/** The boss: 4 DEF, 10 STR (10 damage on DEF 5), attack speed 3. */
function boss({ hp = 20, stones = 1, stats = {}, extra = {} } = {}) {
  const b = unit('Warchief', 'enemy', { HP: 20, SPD: 4, ...stats }, { isBoss: true, ...extra });
  b.currentHP = hp;
  if (stones > 0) {
    b.revivalStones = stones;
    b.revivalStonesMax = stones;
  }
  return b;
}

const ctx = (extra = {}) => ({
  skillsData: gameData.skills,
  rollStrikeSkills,
  rollDefenseSkills,
  checkAstra,
  affixData: gameData.affixes,
  ...extra,
});

function modsCtx(attacker, defender, extra = {}) {
  const masteryCtx = { classesData: gameData.classes, traitsData: null };
  const args = (a, d, initiating) => [
    a,
    d,
    [a],
    [d],
    gameData.skills,
    null,
    initiating,
    gameData.affixes,
    masteryCtx,
  ];
  return ctx({
    atkMods: getSkillCombatMods(...args(attacker, defender, true)),
    defMods: getSkillCombatMods(...args(defender, attacker, false)),
    ...extra,
  });
}

function fight(attacker, defender, skillCtx = null) {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const result = resolveCombat(
    attacker,
    attacker.weapon,
    defender,
    defender.weapon,
    1,
    null,
    null,
    skillCtx,
  );
  vi.restoreAllMocks();
  return result;
}

const strikes = (result) => result.events.filter((e) => e.type === 'strike');

describe('UnitHealth.absorbLethal: the one rule', () => {
  const stoned = (stones = 2) => ({ stats: { HP: 40 }, currentHP: 3, revivalStones: stones });

  it('a blow that would take the bar to 0 breaks a stone and refills to max HP', () => {
    const u = stoned(2);
    expect(absorbLethal(u, 0)).toEqual({ hp: 40, stoneBroken: true });
    expect(u.revivalStones).toBe(1);
  });

  it('a negative result is lethal too', () => {
    const u = stoned(1);
    expect(absorbLethal(u, -7)).toEqual({ hp: 40, stoneBroken: true });
    expect(u.revivalStones).toBe(0);
  });

  it('a blow that leaves HP spends nothing', () => {
    const u = stoned(2);
    expect(absorbLethal(u, 1)).toEqual({ hp: 1, stoneBroken: false });
    expect(u.revivalStones).toBe(2);
  });

  it('a unit with no stones (or no field at all) is not absorbed', () => {
    const none = { stats: { HP: 40 }, currentHP: 3 };
    expect(absorbLethal(none, 0)).toEqual({ hp: 0, stoneBroken: false });
    expect(absorbLethal({ ...none, revivalStones: 0 }, 0)).toEqual({ hp: 0, stoneBroken: false });
    expect(none.revivalStones).toBeUndefined();
  });

  it('the last stone is spent; the next lethal blow stands', () => {
    const u = stoned(1);
    expect(absorbLethal(u, 0).stoneBroken).toBe(true);
    expect(absorbLethal(u, 0)).toEqual({ hp: 0, stoneBroken: false });
  });
});

describe('damageUnit: every non-combat lethal source goes through the same rule', () => {
  it('lethal damage breaks a stone, refills, and reports the whole bar as lost', () => {
    const u = boss({ hp: 9, stones: 2 });
    const { lost, stoneBroken } = damageUnitDetailed(u, 50);
    expect({ lost, stoneBroken, hp: u.currentHP, stones: u.revivalStones }).toEqual({
      lost: 9,
      stoneBroken: true,
      hp: 20,
      stones: 1,
    });
  });

  it('damageUnit returns that same HP lost', () => {
    const u = boss({ hp: 9, stones: 1 });
    expect(damageUnit(u, 9)).toBe(9);
    expect([u.currentHP, u.revivalStones]).toEqual([20, 0]);
  });

  it('damage that leaves HP, or cannot kill (floor 1), never touches a stone', () => {
    const u = boss({ hp: 9, stones: 1 });
    expect(damageUnit(u, 4)).toBe(4);
    expect(u.currentHP).toBe(5);
    expect(damageUnit(u, 99, { floor: 1 })).toBe(4); // poison, acid, lava: never lethal
    expect([u.currentHP, u.revivalStones]).toEqual([1, 1]);
  });

  it('the last bar falls for real', () => {
    const u = boss({ hp: 6, stones: 1 });
    damageUnit(u, 6);
    expect(u.currentHP).toBe(20);
    damageUnit(u, 20);
    expect([u.currentHP, u.revivalStones]).toEqual([0, 0]);
  });

  it('a unit already at 0 loses nothing and spends nothing', () => {
    const u = boss({ hp: 0, stones: 1 });
    expect(damageUnit(u, 5)).toBe(0);
    expect([u.currentHP, u.revivalStones]).toEqual([0, 1]);
  });

  it('setUnitHP is a plain write: a debug set or a revive is never absorbed', () => {
    const u = boss({ hp: 9, stones: 2 });
    setUnitHP(u, 0);
    expect([u.currentHP, u.revivalStones]).toEqual([0, 2]);
  });
});

describe('the exchange ends when a stone breaks (Q1)', () => {
  it('a doubling attacker: the follow-up that breaks the bar is the last strike', () => {
    // 20 HP: strike 15 -> 5; the boss counters for 10 (30 -> 20); the follow-up's 15 would
    // fell it, so a stone breaks (HP 20 again) and nothing else is rolled.
    const atk = striker();
    const b = boss({ hp: 20, stones: 2 });
    const result = fight(atk, b, ctx());
    expect(strikes(result).map((e) => [e.attackerSide, e.targetHPAfter])).toEqual([
      ['attacker', 5],
      ['defender', 20],
      ['attacker', 20],
    ]);
    expect(strikes(result).map((e) => Boolean(e.stoneBroken))).toEqual([false, false, true]);
    expect(result).toMatchObject({
      defenderHP: 20,
      defenderDied: false,
      attackerHP: 20,
      attackerDied: false,
      stoneBroken: { attacker: false, defender: true },
    });
    expect(b.revivalStones).toBe(1);
  });

  it('the same fight with no stones kills (the contrast the gate is measured against)', () => {
    const result = fight(striker(), boss({ hp: 20, stones: 0 }), ctx());
    expect(result.defenderHP).toBe(0);
    expect(result.defenderDied).toBe(true);
    expect(result.stoneBroken).toBeUndefined();
  });

  it('a break on the first strike stops the counter and the follow-up', () => {
    const result = fight(striker(), boss({ hp: 10, stones: 1 }), ctx());
    expect(strikes(result)).toHaveLength(1);
    expect(strikes(result)[0]).toMatchObject({
      attackerSide: 'attacker',
      stoneBroken: true,
      hpBeforeBreak: 10,
      targetHPAfter: 20,
    });
    expect(result.attackerHP).toBe(30); // never countered
    expect(result.defenderHP).toBe(20);
  });

  it('a brave weapon does not make its second hit on the new bar', () => {
    // Twinsworn: STR 8 + Might 11 - DEF 4 = 15 per hit. 10 HP: the first hit breaks the bar.
    // A second hit on the refilled 20 HP would leave 5; there is none.
    // (The foe's 5 LCK cancels Twinsworn's 5 Crit, so every hit is a plain 15.)
    const atk = striker({ STR: 8 }, { weapon: weapon('Twinsworn') });
    const b = boss({ hp: 10, stones: 1, stats: { LCK: 5 } });
    const result = fight(atk, b, ctx());
    expect(strikes(result)).toHaveLength(1);
    expect(result.defenderHP).toBe(20);
    expect(b.revivalStones).toBe(0);
    // The same blade on a bar that does not break lands both hits (the contrast).
    const open = fight(atk, boss({ hp: 40, stones: 0, stats: { HP: 40, LCK: 5 } }), ctx());
    expect(
      strikes(open)
        .slice(0, 2)
        .map((e) => e.targetHPAfter),
    ).toEqual([25, 10]);
  });

  it('a brave weapon whose second hit breaks the bar ends the exchange there', () => {
    // 20 HP: hit 15 -> 5, hit 15 would fell it: the stone breaks on hit two, no counter.
    const atk = striker({ STR: 8 }, { weapon: weapon('Twinsworn') });
    const result = fight(atk, boss({ hp: 20, stones: 1, stats: { LCK: 5 } }), ctx());
    expect(strikes(result).map((e) => e.targetHPAfter)).toEqual([5, 20]);
    expect(result.attackerHP).toBe(30);
  });

  it('an Adept bonus strike is not rolled after the strike that broke the bar', () => {
    // SPD 10 v 6: no doubling. 15 HP: the 15 damage breaks the bar. Adept would add a bonus
    // strike at full damage (15 -> 5 on the new bar); with no stone it procs as below.
    const atk = striker({ SPD: 10 }, { skills: ['adept'] });
    const withStone = boss({ hp: 15, stones: 1, stats: { SPD: 6 } });
    const stoned = fight(atk, withStone, modsCtx(atk, withStone));
    expect(strikes(stoned)).toHaveLength(1);
    expect(stoned.defenderHP).toBe(20);

    const plain = boss({ hp: 30, stones: 0, stats: { HP: 30, SPD: 6 } });
    const open = fight(atk, plain, modsCtx(atk, plain));
    expect(strikes(open).map((e) => Boolean(e.adeptStrike))).toEqual([false, true]);
    expect(open.defenderHP).toBe(0);
  });

  it('Astra stops its flurry on the break (the remaining hits are not rolled)', () => {
    // Astra: 5 hits at half damage = floor(15 / 2) = 7 each. 10 HP: 7 -> 3, then 7 breaks the bar.
    // Without the gate the three further hits (3 x 7 = 21) would fell the refilled 20 HP.
    const atk = striker({ SKL: 20 }, { skills: ['astra'] });
    const b = boss({ hp: 10, stones: 1, stats: { LCK: 10 } });
    const result = fight(atk, b, modsCtx(atk, b));
    expect(result.events.filter((e) => e.type === 'skill').map((e) => e.name)).toEqual(['Astra']);
    expect(strikes(result).map((e) => e.targetHPAfter)).toEqual([3, 20]);
    expect(result.defenderDied).toBe(false);
  });

  it('a weapon art follow-up is not rolled after the break', () => {
    // SPD 24 doubles even with an art (+10 needed): the first phase breaks the bar, so the
    // plain follow-up and the counter never happen.
    const atk = striker({ SPD: 30 });
    const b = boss({ hp: 10, stones: 1 });
    const art = gameData.weaponArts.arts.find((a) => a.id === 'sword_wrath_strike');
    const artMods = getWeaponArtCombatMods(art);
    const skillCtx = modsCtx(atk, b, { atkWeaponArtMods: artMods });
    skillCtx.atkMods = { ...skillCtx.atkMods, ...artMods };
    const result = fight(atk, b, skillCtx);
    expect(strikes(result)).toHaveLength(1);
    expect(result.attackerHP).toBe(30);
    // The control: on a bar that does not break, the art strike, the counter and the
    // art's plain follow-up all happen.
    const tall = boss({ hp: 100, stones: 0, stats: { HP: 100 } });
    const control = fight(atk, tall, skillCtx);
    expect(strikes(control).some((e) => e.artFollowUp)).toBe(true);
    expect(strikes(control).some((e) => e.attackerSide === 'defender')).toBe(true);
  });

  it('Desperation (all of the attacker’s hits first) ends at the break, with no counter', () => {
    const atk = striker();
    const b = boss({ hp: 10, stones: 1 });
    const skillCtx = modsCtx(atk, b);
    skillCtx.atkMods = { ...skillCtx.atkMods, desperation: true };
    const result = fight(atk, b, skillCtx);
    expect(result.events.some((e) => e.name === 'Desperation')).toBe(true);
    expect(strikes(result)).toHaveLength(1);
    expect(result.attackerHP).toBe(30);
    // The control: on a bar that does not break, both of the attacker's hits come first.
    const tall = boss({ hp: 100, stones: 0, stats: { HP: 100 } });
    const control = fight(atk, tall, skillCtx);
    expect(strikes(control).map((e) => e.attackerSide)).toEqual([
      'attacker',
      'attacker',
      'defender',
    ]);
  });

  it('the defender’s own Desperation phase is not announced once the bar broke', () => {
    // The boss defends (SPD 30 doubles the player at 19: 28 v 19 is not enough; give it more).
    const atk = striker({ SPD: 8 });
    const b = boss({ hp: 10, stones: 1, stats: { SPD: 40 } });
    const skillCtx = modsCtx(atk, b);
    skillCtx.defMods = { ...skillCtx.defMods, desperation: true };
    const result = fight(atk, b, skillCtx);
    expect(strikes(result)).toHaveLength(1);
    expect(result.events.some((e) => e.name === 'Desperation')).toBe(false);
    // The control: with a bar that holds, the boss's Desperation phase is announced.
    const tall = boss({ hp: 100, stones: 0, stats: { HP: 100, SPD: 40 } });
    const control = fight(atk, tall, skillCtx);
    expect(control.events.some((e) => e.name === 'Desperation')).toBe(true);
  });

  it('a stoned attacker whose bar breaks on the counter does not strike again', () => {
    // The boss attacks (SPD 20 doubles the player's 3): strike 10 (player 40 -> 30), the
    // player counters for 15 (boss 8: breaks), and the boss's follow-up is not rolled.
    const hero = unit('Edric', 'player', { HP: 40, STR: 14, SPD: 4, DEF: 5 });
    const b = boss({ hp: 8, stones: 1, stats: { SPD: 20 } });
    const result = fight(b, hero, ctx());
    expect(strikes(result).map((e) => [e.attackerSide, e.targetHPAfter])).toEqual([
      ['attacker', 30],
      ['defender', 20],
    ]);
    expect(result).toMatchObject({
      attackerHP: 20,
      attackerDied: false,
      defenderHP: 30,
      stoneBroken: { attacker: true, defender: false },
    });
    expect(b.revivalStones).toBe(0);
  });

  it('the result’s HP locals agree with the last strike’s targetHPAfter', () => {
    const b = boss({ hp: 10, stones: 1 });
    const result = fight(striker(), b, ctx());
    const last = strikes(result).at(-1);
    expect(result.defenderHP).toBe(last.targetHPAfter);
    expect(result.defenderHP).toBe(b.stats.HP);
  });

  it('a weapon’s after-combat poison waits: the fresh bar is not poisoned on the break', () => {
    // Adder Blade: 14 + 8 - 4 = 18 a hit, and "target loses 5 HP after combat".
    const atk = striker({}, { weapon: weapon('Adder Blade') });
    expect(atk.weapon.special).toMatch(/Poison: target loses 5 HP/);
    const b = boss({ hp: 10, stones: 1 });
    const result = fight(atk, b, ctx());
    expect(result.poisonEffects).toEqual([]);
    expect(result.defenderHP).toBe(20);
    // Without a stone, on a bar that holds (40 -> 22 -> 4), the foe is left to its poison.
    const open = fight(atk, boss({ hp: 40, stones: 0, stats: { HP: 40 } }), ctx());
    expect(open.poisonEffects).toEqual([{ target: 'defender', damage: 5 }]);
    expect(open.defenderHP).toBe(1);
  });
});

describe('Miracle comes first', () => {
  it('a Miracle that leaves 1 HP spends no stone; the next lethal blow breaks one', () => {
    // 15 damage on 12 HP is lethal: Miracle (LCK 30, procs at roll 0) leaves 1 HP. Only
    // then, with the Miracle spent, does a lethal blow take a stone.
    const atk = striker({ SPD: 8 });
    const b = boss({ hp: 12, stones: 1, stats: { LCK: 30 }, extra: { skills: ['miracle'] } });
    const first = fight(atk, b, ctx());
    const a = strikes(first)[0];
    expect(a.skillActivations.map((s) => s.id)).toContain('miracle');
    expect(a.stoneBroken).toBeUndefined();
    expect(a.targetHPAfter).toBe(1);
    expect(b.revivalStones).toBe(1);

    b.currentHP = first.defenderHP;
    const second = fight(atk, b, ctx());
    expect(strikes(second)[0]).toMatchObject({ stoneBroken: true, targetHPAfter: 20 });
    expect(b.revivalStones).toBe(0);
  });
});

describe('nothing that keys on a fall fires for a broken bar', () => {
  it('the weapon’s kill count rises on the last bar only', () => {
    const atk = striker();
    const b = boss({ hp: 10, stones: 1 });
    const broke = fight(atk, b, ctx());
    applyCombatHP(atk, b, broke);
    recordCombat(broke, atk, b);
    expect(atk.weapon._strikes).toBe(1);
    expect(atk.weapon._kills).toBeUndefined();

    b.currentHP = 10;
    const fell = fight(atk, b, ctx());
    applyCombatHP(atk, b, fell);
    recordCombat(fell, atk, b);
    expect(b.currentHP).toBe(0);
    expect(atk.weapon._kills).toBe(1);
  });

  it('a broken bar pays the damage award in full and no kill bonus', () => {
    const atk = striker();
    const b = boss({ hp: 10, stones: 1 });
    const hpAtStart = b.currentHP;
    const result = fight(atk, b, ctx());
    applyCombatHP(atk, b, result);
    expect(b.currentHP).toBe(20); // standing, so the scene passes opponentDied = false
    // The bar fell, so the damage dealt is the bar it held, not the (refilled) HP gap of 0.
    const dealt = combatHpLost(result, 'defender', hpAtStart);
    expect(dealt).toBe(10);
    const awards = combatXpAwards({
      unit: atk,
      opponent: b,
      opponentDied: false,
      damageDealt: dealt,
      opponentHpAtStart: hpAtStart,
    });
    expect(awards).toHaveLength(1);
    expect(awards[0].baseXp).toBe(calculateCombatXP(atk, b, false));
    expect(awards[0].baseXp).toBeLessThan(calculateCombatXP(atk, b, true));
  });

  it('combatHpLost reads damage taken, with or without a break', () => {
    expect(combatHpLost({ defenderHP: 7 }, 'defender', 20)).toBe(13);
    expect(combatHpLost({ attackerHP: 9 }, 'attacker', 9)).toBe(0);
    // A refilled bar (HP 20 again) that had 12 going in lost all 12, not 0 or -8.
    expect(combatHpLost({ defenderHP: 20, stoneBroken: { defender: true } }, 'defender', 12)).toBe(
      12,
    );
    // A heal past the start (a drain) cannot make the break "lose less than the bar".
    expect(combatHpLost({ attackerHP: 30, stoneBroken: { attacker: true } }, 'attacker', 6)).toBe(
      6,
    );
  });
});

describe('the forecast says "Breaks a bar"', () => {
  const forecastOf = (b, atk = striker()) =>
    getCombatForecast(atk, atk.weapon, b, b.weapon, 1, null, null, ctx());

  it('carries the stones left on each side', () => {
    const f = forecastOf(boss({ hp: 10, stones: 2 }));
    expect(f.defender.stones).toBe(2);
    expect(f.attacker.stones).toBe(0);
  });

  it('projects a lethal exchange on a stoned bar as a break that ends it', () => {
    // 20 HP, 15 damage twice (the follow-up): 5, then the break.
    const f = forecastOf(boss({ hp: 20, stones: 1 }));
    const projection = forecastProjection(f);
    expect(projection).toMatchObject({ defenderHP: 0, breaks: 'defender' });
    expect(projectedFallText(projection, 'defender')).toBe('Breaks a bar');
    expect(forecastNotes(f, false)[0]).toBe('If all hits land: Breaks a bar (no crits/procs)');
  });

  it('without a stone the same exchange reads KO', () => {
    const f = forecastOf(boss({ hp: 20, stones: 0 }));
    const projection = forecastProjection(f);
    expect(projection.breaks).toBeUndefined();
    expect(projectedFallText(projection, 'defender')).toBe('KO');
    expect(forecastNotes(f, false)[0]).toBe('If all hits land: KO (no crits/procs)');
  });

  it('a projection stops at the break: the counter and the second hit are not counted', () => {
    // 10 HP, stoned: the first strike breaks it, so the boss never counters.
    const f = forecastOf(boss({ hp: 10, stones: 1 }));
    expect(forecastProjection(f)).toMatchObject({ attackerHP: 30, breaks: 'defender' });
  });

  it('explains stones in the reading points only when a side has them', () => {
    expect(forecastReadingPoints(forecastOf(boss({ stones: 0 })))).toHaveLength(
      forecastReadingPoints(forecastOf(boss({ stones: 1 }))).length - 1,
    );
  });
});

describe('what the player is shown', () => {
  it('the boss bar reducer carries stones and stonesMax, and the view reads them', () => {
    const snapshot = (stones) => ({
      key: 'b1',
      name: 'Warchief',
      hp: 20,
      max: 20,
      wordless: false,
      stones,
      stonesMax: 2,
    });
    let s = reduceBossBar(createBossBarState(), { type: 'sync', boss: snapshot(2) });
    expect(bossBarView(s)).toMatchObject({ stones: 2, stonesMax: 2, stonesText: 'Stones 2/2' });
    s = reduceBossBar(s, { type: 'sync', boss: snapshot(1) });
    expect(bossBarView(s)).toMatchObject({ stones: 1, stonesMax: 2, stonesText: 'Stones 1/2' });
  });

  it('a refill is a rise, not a "just lost" chunk', () => {
    const sync = (hp, stones) => ({
      type: 'sync',
      boss: { key: 'b1', name: 'W', hp, max: 20, stones, stonesMax: 1 },
    });
    let s = reduceBossBar(createBossBarState(), sync(5, 1));
    s = reduceBossBar(s, sync(20, 0));
    expect(bossBarView(s)).toMatchObject({ fillPct: 100, lostPct: 100 });
  });

  it('a boss with no stones shows none', () => {
    const s = reduceBossBar(createBossBarState(), {
      type: 'sync',
      boss: { key: 'b1', name: 'W', hp: 20, max: 20 },
    });
    expect(bossBarView(s)).toMatchObject({ stones: 0, stonesMax: 0, stonesText: '' });
  });

  it('the unit detail line reads remaining stones, and nothing once none are left', () => {
    expect(revivalStonesLine(boss({ stones: 2 }))).toBe('Revival Stones: 2');
    expect(revivalStonesLine(boss({ stones: 0 }))).toBe('');
    const spent = boss({ stones: 2 });
    spent.revivalStones = 0;
    expect(revivalStonesLine(spent)).toBe('');
    expect(revivalStoneCount(spent)).toEqual({ remaining: 0, max: 2 });
  });
});
