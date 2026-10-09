// The Unbroken Banner (an earned blessing, docs/specs/blessings-v3.md §6; engine/BattleBlessings.js):
// once a battle, the first player unit a blow would fell survives at 1 HP. Miracle comes first,
// then Revival Stones, then the banner; the hold ends the exchange; it never holds an NPC ally
// or a foe; it covers every lethal path (the exchange, an area art, a ram's crash, a lethal
// after-combat blow) and touches nothing when the run does not hold it.
//
// Every expected number is worked by hand from the formulas in CLAUDE.md, never by running the
// code under test. Math.random() = 0 makes every strike land and no crit (crit = SKL/2 + 0 -
// foe LCK = 0):
//   Edric: STR 10, Iron Sword (Might 5, Wt 3), DEF 4 -> deals 10 + 5 - 4 = 11 to a DEF 4 foe;
//          attack speed 8 - max(0, 3 - floor(10 / 5)) = 7.
//   Foe:   STR 14, Iron Sword -> deals 14 + 5 - 4 = 15 to Edric; attack speed 7 at SPD 8.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCombatForecast, resolveCombat } from '../src/engine/Combat.js';
import { checkAstra, rollDefenseSkills, rollStrikeSkills } from '../src/engine/SkillSystem.js';
import {
  absorbLethal,
  applyCombatHP,
  damageUnit,
  damageUnitDetailed,
  setUnitHP,
} from '../src/engine/UnitHealth.js';
import {
  BANNER,
  bannerReadyFor,
  battleBlessingsAtStart,
  createBattleBlessings,
} from '../src/engine/BattleBlessings.js';
import { postCombatEffects, areaDamage } from '../src/engine/PostCombatEffects.js';
import { combatHpLost, combatXpAwards } from '../src/engine/BattleXp.js';
import { recordCombat } from '../src/engine/DeedSystem.js';
import { combatTimelineFacts } from '../src/engine/BattleTimelineFacts.js';
import { hasBattleDefeat } from '../src/engine/BattleDefeat.js';
import { XP_DEFEND_SURVIVE } from '../src/utils/constants.js';
import { prologueBattleParams } from '../src/engine/ScriptedBattle.js';
import {
  BANNER_HOLD_TEXT,
  counterRisk,
  forecastNotes,
  forecastProjection,
  forecastReadingPoints,
  projectedHpText,
} from '../src/ui/forecastDisplay.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const weapon = (name) => structuredClone(gameData.weapons.find((w) => w.name === name));

afterEach(() => vi.restoreAllMocks());

const STATS = { HP: 30, STR: 10, MAG: 0, SKL: 0, SPD: 8, DEF: 4, RES: 3, LCK: 0, MOV: 4 };

function unit(name, faction, { hp, stats = {}, ...extra } = {}) {
  const full = { ...STATS, ...stats };
  return {
    name,
    faction,
    level: 5,
    skills: [],
    stats: full,
    currentHP: hp ?? full.HP,
    col: faction === 'enemy' ? 1 : 0,
    row: 0,
    weaponRank: 'Prof',
    weapon: weapon('Iron Sword'),
    ...extra,
  };
}
const edric = (opts = {}) => unit('Edric', 'player', { isCommander: true, ...opts });
const foe = (opts = {}) => unit('Brigand', 'enemy', { ...opts, stats: { STR: 14, ...opts.stats } });

const banner = () => createBattleBlessings({ lastStand: 1 });
const ctx = (battleBlessings = null, extra = {}) => ({
  skillsData: gameData.skills,
  rollStrikeSkills,
  rollDefenseSkills,
  checkAstra,
  affixData: gameData.affixes,
  ...(battleBlessings ? { battleBlessings } : {}),
  ...extra,
});

function fight(attacker, defender, skillCtx) {
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
const hps = (result) => strikes(result).map((e) => [e.attackerSide, e.targetHPAfter]);

describe('the state and the one rule (UnitHealth.absorbLethal)', () => {
  it('holds nothing when the run holds no earned blessing (null state, no key)', () => {
    expect(createBattleBlessings({ lastStand: 0, firstKillHeal: 0, firstTurnMov: 0 })).toBeNull();
    expect(createBattleBlessings(null)).toBeNull();
    const u = edric({ hp: 5 });
    expect(absorbLethal(u, 0)).toEqual({ hp: 0, stoneBroken: false });
    expect(absorbLethal(u, 0, { blessings: null })).toEqual({ hp: 0, stoneBroken: false });
  });

  it('a lethal blow on a player unit leaves 1 HP and spends the banner; the next one falls', () => {
    const state = banner();
    expect(absorbLethal(edric(), -3, { blessings: state })).toEqual({
      hp: 1,
      stoneBroken: false,
      bannerHeld: true,
    });
    expect(state.spent).toEqual([BANNER]);
    expect(absorbLethal(edric(), 0, { blessings: state })).toEqual({ hp: 0, stoneBroken: false });
  });

  it('never holds an NPC ally or a foe, and a blow that leaves HP spends nothing', () => {
    const state = banner();
    expect(absorbLethal(unit('Caravan', 'npc'), 0, { blessings: state }).hp).toBe(0);
    expect(absorbLethal(foe(), 0, { blessings: state }).hp).toBe(0);
    expect(absorbLethal(edric(), 3, { blessings: state })).toEqual({ hp: 3, stoneBroken: false });
    expect(state.spent).toEqual([]);
  });

  it('a Revival Stone is spent before the banner (stones first)', () => {
    const state = banner();
    const stoned = edric({ revivalStones: 1, revivalStonesMax: 1 });
    expect(absorbLethal(stoned, 0, { blessings: state })).toEqual({ hp: 30, stoneBroken: true });
    expect(state.spent).toEqual([]);
  });

  it('a scripted chapter never carries it, whatever the run holds', () => {
    const run = { getBattleBlessingEffects: () => ({ lastStand: 1, firstKillHeal: 10 }) };
    const chapter = prologueBattleParams(gameData.prologue.chapters[0], { seed: 1 });
    expect(battleBlessingsAtStart({ run, battleParams: chapter })).toBeNull();
    expect(battleBlessingsAtStart({ run, battleParams: { act: 'act1' } })).toMatchObject({
      lastStand: 1,
      firstKillHeal: 10,
      spent: [],
    });
    // A sim hands the harness the numbers in its battle params instead of a run.
    expect(
      battleBlessingsAtStart({ battleParams: { battleBlessings: { firstTurnMov: 1 } } }),
    ).toMatchObject({ firstTurnMov: 1 });
  });
});

describe('damageUnit: the non-combat lethal sources', () => {
  it('a floor-0 blow holds at 1 and reports only the HP down to 1 as lost', () => {
    const state = banner();
    const u = edric({ hp: 7 });
    expect(damageUnitDetailed(u, 20, { blessings: state })).toEqual({
      lost: 6,
      stoneBroken: false,
      bannerHeld: true,
    });
    expect(u.currentHP).toBe(1);
    expect(damageUnit(u, 20, { blessings: state })).toBe(1); // spent: this one fells it
    expect(u.currentHP).toBe(0);
  });

  it('a unit standing at 1 HP is held too (it loses nothing)', () => {
    const state = banner();
    const u = edric({ hp: 1 });
    expect(damageUnitDetailed(u, 5, { blessings: state })).toMatchObject({
      lost: 0,
      bannerHeld: true,
    });
    expect(u.currentHP).toBe(1);
  });

  it('floor-1 damage (poison, acid, lava) can never spend it', () => {
    const state = banner();
    const u = edric({ hp: 3 });
    expect(damageUnit(u, 10, { floor: 1, blessings: state })).toBe(2);
    expect(damageUnit(u, 10, { floor: 1, blessings: state })).toBe(0);
    expect(u.currentHP).toBe(1);
    expect(state.spent).toEqual([]);
  });

  it('a caller that hands no blessings holds nobody (the blessing-free battle is untouched)', () => {
    const u = edric({ hp: 7 });
    expect(damageUnitDetailed(u, 20)).toEqual({ lost: 7, stoneBroken: false });
    expect(u.currentHP).toBe(0);
  });

  it('setUnitHP is a plain write: never held', () => {
    const u = edric({ hp: 7 });
    setUnitHP(u, 0);
    expect(u.currentHP).toBe(0);
  });
});

describe('in the exchange (Combat.rollStrike)', () => {
  it('a lethal counter holds the attacker at 1 HP and ends the exchange', () => {
    // Edric (10 HP) strikes 30 -> 19; the counter's 15 would fell him: held at 1.
    const state = banner();
    const result = fight(edric({ hp: 10 }), foe(), ctx(state));
    expect(hps(result)).toEqual([
      ['attacker', 19],
      ['defender', 1],
    ]);
    expect(strikes(result)[1]).toMatchObject({ bannerHeld: true, hpBeforeHold: 10 });
    expect(result).toMatchObject({
      attackerHP: 1,
      attackerDied: false,
      defenderHP: 19,
      bannerHeld: { attacker: true, defender: false },
    });
    expect(result.stoneBroken).toBeUndefined();
    expect(state.spent).toEqual([BANNER]);
  });

  it('without the blessing the same counter kills (the contrast)', () => {
    const result = fight(edric({ hp: 10 }), foe(), ctx(null));
    expect(hps(result)).toEqual([
      ['attacker', 19],
      ['defender', 0],
    ]);
    expect(result.attackerDied).toBe(true);
    expect(result.bannerHeld).toBeUndefined();
  });

  it('a held attacker does not make its own follow-up', () => {
    // SPD 20: attack speed 19 doubles the foe's 7. Held on the counter; the follow-up (19 -> 8)
    // is not rolled. With 30 HP the counter leaves 15 and the follow-up lands.
    const fast = (hp) => edric({ hp, stats: { SPD: 20 } });
    const held = fight(fast(10), foe(), ctx(banner()));
    expect(hps(held)).toEqual([
      ['attacker', 19],
      ['defender', 1],
    ]);
    const open = fight(fast(30), foe(), ctx(banner()));
    expect(hps(open)).toEqual([
      ['attacker', 19],
      ['defender', 15],
      ['attacker', 8],
    ]);
  });

  it("a brave weapon's second hit never lands on the held unit", () => {
    // Twinsworn (Might 11) at STR 8: 8 + 11 - 4 = 15 a hit; its 5 Crit meets Edric's 5 LCK.
    // 10 HP: the first hit is held at 1, the second is not rolled and nothing counters.
    const brave = () => foe({ stats: { STR: 8 }, weapon: weapon('Twinsworn') });
    const state = banner();
    const result = fight(brave(), edric({ hp: 10, stats: { LCK: 5 } }), ctx(state));
    expect(hps(result)).toEqual([['attacker', 1]]);
    expect(result.bannerHeld).toEqual({ attacker: false, defender: true });
    // The control: 40 HP takes both hits (40 -> 25 -> 10), then counters.
    const control = fight(
      brave(),
      edric({ hp: 40, stats: { HP: 40, LCK: 5 } }),
      ctx(createBattleBlessings({ lastStand: 1 })),
    );
    expect(hps(control).slice(0, 2)).toEqual([
      ['attacker', 25],
      ['attacker', 10],
    ]);
  });

  it('a second lethal blow in the same battle falls, on the same unit or another ally', () => {
    const state = banner();
    const first = fight(edric({ hp: 10 }), foe(), ctx(state));
    expect(first.attackerHP).toBe(1);
    const second = fight(edric({ hp: 10 }), foe(), ctx(state));
    expect(second.attackerDied).toBe(true);
    const ally = unit('Sera', 'player', { hp: 10 });
    expect(fight(ally, foe(), ctx(state)).attackerDied).toBe(true);
  });

  it('Miracle comes first: a Miracle that leaves 1 HP spends no banner; the next blow is held', () => {
    // Miracle (LCK-based, procs at roll 0) turns the counter's 15 on 10 HP into 9: 1 HP left.
    const hero = edric({ hp: 10, skills: ['miracle'], stats: { LCK: 30 } });
    const state = banner();
    const first = fight(hero, foe(), ctx(state));
    expect(strikes(first)[1].skillActivations.map((a) => a.id)).toContain('miracle');
    expect(strikes(first)[1].bannerHeld).toBeUndefined();
    expect(first.attackerHP).toBe(1);
    expect(state.spent).toEqual([]);
    // Miracle is spent for the battle: the next lethal counter is the banner's.
    hero.currentHP = first.attackerHP;
    const second = fight(hero, foe(), ctx(state));
    expect(strikes(second)[1]).toMatchObject({ bannerHeld: true, targetHPAfter: 1 });
    expect(state.spent).toEqual([BANNER]);
  });

  it('a foe or an NPC ally is never held, and spends nothing', () => {
    const state = banner();
    // Edric's 11 fells a 10 HP foe.
    expect(fight(edric(), foe({ hp: 10 }), ctx(state)).defenderDied).toBe(true);
    // A green ally (the caravan, a recruit) falls to the foe's 15.
    const npc = unit('Recruit', 'npc', { hp: 10 });
    expect(fight(foe(), npc, ctx(state)).defenderDied).toBe(true);
    expect(state.spent).toEqual([]);
  });

  it('the commander is held like any ally, and its fall once spent still ends the battle', () => {
    const state = banner();
    const commander = edric({ hp: 10 });
    const first = fight(foe(), commander, ctx(state));
    applyCombatHP(foe(), commander, first);
    expect(commander.currentHP).toBe(1);
    expect(hasBattleDefeat([commander], [])).toBe(false);
    const second = fight(foe(), commander, ctx(state));
    applyCombatHP(foe(), commander, second);
    expect(commander.currentHP).toBe(0);
    expect(hasBattleDefeat([commander], [])).toBe(true);
  });

  it('a weapon’s after-combat poison spares the held unit (it would only claim a 0 HP loss)', () => {
    // Adder Blade at STR 14: 14 + 8 - 4 = 18 on Edric's 16 HP: held at 1, no poison number.
    const adder = () => foe({ weapon: weapon('Adder Blade') });
    const held = fight(adder(), edric({ hp: 16 }), ctx(banner()));
    expect(held.defenderHP).toBe(1);
    expect(held.poisonEffects).toEqual([]);
    // 30 HP: 30 -> 12, the counter, then the poison takes 5 (12 -> 7).
    const open = fight(adder(), edric({ hp: 30 }), ctx(banner()));
    expect(open.poisonEffects).toEqual([{ target: 'defender', damage: 5 }]);
    expect(open.defenderHP).toBe(7);
  });

  it('nothing that keys on a fall fires: no kill on the weapon, a held unit is not dead', () => {
    const brig = foe();
    const hero = edric({ hp: 10 });
    const result = fight(brig, hero, ctx(banner()));
    applyCombatHP(brig, hero, result);
    recordCombat(result, brig, hero);
    expect(hero.currentHP).toBe(1);
    expect(brig.weapon._kills).toBeUndefined();
    expect(result.defenderDied).toBe(false);
  });

  it('XP: the hold is HP lost down to 1 (not a bar), and the held defender earns survival XP', () => {
    // The held side lost 10 - 1 = 9 (a stone would count its whole bar: not here).
    const brig = foe();
    const hero = edric({ hp: 10 });
    const result = fight(brig, hero, ctx(banner()));
    expect(combatHpLost(result, 'defender', 10)).toBe(9);
    applyCombatHP(brig, hero, result);
    // The counter never came (the exchange ended): Edric dealt nothing, so the survival
    // minimum is what he earns, as for any unit that lived through an attack.
    const awards = combatXpAwards({
      unit: hero,
      opponent: brig,
      opponentDied: false,
      damageDealt: combatHpLost(result, 'attacker', 30),
      opponentHpAtStart: 30,
      survivedAttack: true,
    });
    expect(awards).toEqual([{ unit: hero, baseXp: XP_DEFEND_SURVIVE, share: false }]);
  });

  it('the battle record says the banner held', () => {
    const brig = foe();
    const hero = edric({ hp: 10 });
    const result = fight(brig, hero, ctx(banner()));
    expect(combatTimelineFacts({ grid: { fogEnabled: false } }, brig, hero, result)).toEqual([
      'Brigand hit Edric for 15 damage.',
      'Edric held by the Unbroken Banner.',
    ]);
  });
});

describe('the RNG stream and the events are untouched without a hold', () => {
  function drawsOf(skillCtx, hp) {
    let draws = 0;
    const sequence = [0.3, 0.1, 0.6, 0.2, 0.9, 0.05, 0.4, 0.7, 0.15, 0.5];
    vi.spyOn(Math, 'random').mockImplementation(() => sequence[draws++ % sequence.length]);
    const hero = edric({ hp, stats: { SPD: 20, SKL: 12 } });
    const result = resolveCombat(
      hero,
      hero.weapon,
      foe(),
      weapon('Iron Sword'),
      1,
      null,
      null,
      skillCtx,
    );
    vi.restoreAllMocks();
    return { draws, result };
  }

  it('the same fight draws the same numbers and yields the same events with or without it', () => {
    // 30 HP survives the exchange, so the banner never acts: nothing may differ.
    const without = drawsOf(ctx(null), 30);
    const withIt = drawsOf(ctx(createBattleBlessings({ lastStand: 1, firstKillHeal: 10 })), 30);
    expect(withIt.draws).toBe(without.draws);
    expect(withIt.result.events).toEqual(without.result.events);
    expect(Object.keys(withIt.result).sort()).toEqual(Object.keys(without.result).sort());
    for (const event of strikes(withIt.result)) {
      expect(event).not.toHaveProperty('bannerHeld');
      expect(event).not.toHaveProperty('hpBeforeHold');
    }
  });

  it('a hold draws nothing of its own: the exchange simply stops', () => {
    const without = drawsOf(ctx(null), 10);
    const withIt = drawsOf(ctx(banner()), 10);
    // Both exchanges stop at the counter (a fall, a hold): the same draws.
    expect(withIt.draws).toBe(without.draws);
  });
});

/** A post-combat world over `units` (AreaEffects.test.js's shape) with the battle's blessings. */
function world(units, battleBlessings, walls = []) {
  return {
    affixes: gameData.affixes,
    cols: 8,
    rows: 8,
    getMoveCost: (col, row) => (walls.some(([c, r]) => c === col && r === row) ? Infinity : 1),
    getTerrainAt: () => null,
    getUnitAt: (col, row) =>
      units.find((u) => u.col === col && u.row === row && u.currentHP > 0) || null,
    hostilesOf: (u) => units.filter((o) => o.faction !== u.faction && o.faction !== 'npc'),
    alliesOf: (u) => units.filter((o) => o.faction === u.faction),
    turnNumber: 1,
    ...(battleBlessings ? { battleBlessings } : {}),
  };
}
const landed = [{ type: 'strike', attackerSide: 'attacker', miss: false, damage: 1 }];

describe('after the exchange (PostCombatEffects): every floor-0 blow', () => {
  const blastArt = (amount, extra = {}) => ({
    id: 'fixture_blast',
    targeting: 'normal_attack',
    area: { shape: 'radius', radius: 1, damage: { kind: 'fixed', amount }, ...extra },
    combatMods: {},
  });

  it("a foe's area art: the ally it would fell is held at 1, and struck no more by it", () => {
    // A three-blow blast of 6 on a 10 HP ally: 10 -> 4, then 4 would fall: held at 1; the
    // third blow is not dealt. Another ally on 20 HP takes all three (20 -> 2).
    const caster = unit('Hexer', 'enemy', { col: 2, row: 2 });
    const target = unit('Target', 'player', { col: 3, row: 2, hp: 30 });
    const near = unit('Near', 'player', { col: 2, row: 1, hp: 10 });
    const tough = unit('Tough', 'player', { col: 1, row: 2, hp: 20 });
    const state = banner();
    const units = [caster, target, near, tough];
    const beats = [
      ...areaDamage(
        { area: blastArt(6).area, center: { col: 2, row: 2 }, blows: 3, requiresLiveSource: true },
        caster,
        null,
        world(units, state),
        {},
      ),
    ];
    expect([near.currentHP, tough.currentHP]).toEqual([1, 2]);
    expect(beats.filter((b) => b.kind === 'banner').map((b) => b.unit.name)).toEqual(['Near']);
    expect(beats.filter((b) => b.kind === 'remove')).toEqual([]);
    expect(state.spent).toEqual([BANNER]);
  });

  it('without the blessing the same blast fells the ally (the contrast)', () => {
    const caster = unit('Hexer', 'enemy', { col: 2, row: 2 });
    const near = unit('Near', 'player', { col: 2, row: 1, hp: 10 });
    const beats = [
      ...areaDamage(
        { area: blastArt(6).area, center: { col: 2, row: 2 }, blows: 3, requiresLiveSource: true },
        caster,
        null,
        world([caster, near], null),
        {},
      ),
    ];
    expect(near.currentHP).toBe(0);
    expect(beats.some((b) => b.kind === 'banner')).toBe(false);
  });

  it("a ram's crash into a wall holds the rammed ally", () => {
    // An enemy rams Edric (5 HP) one tile into a wall: the crash's 8 would fell him.
    const ram = {
      id: 'fixture_ram',
      targeting: 'normal_attack',
      effects: { afterCombat: [{ type: 'move', mode: 'ram', distance: 2, collisionDamage: 8 }] },
      combatMods: {},
    };
    const rammer = unit('Rammer', 'enemy', { col: 1, row: 1, moveType: 'Infantry' });
    const hero = edric({ col: 2, row: 1, hp: 5, moveType: 'Infantry' });
    const state = banner();
    const beats = [
      ...postCombatEffects(
        { attacker: rammer, defender: hero, result: { events: landed }, attackerWeaponArt: ram },
        world([rammer, hero], state, [[4, 1]]),
      ),
    ];
    expect([hero.col, hero.currentHP]).toEqual([3, 1]);
    expect(beats.some((b) => b.kind === 'banner' && b.unit === hero)).toBe(true);
  });

  it('a lethal after-combat blow (nonLethal: false) holds; one already held falls no further', () => {
    const scald = (amount) => ({
      id: 'fixture_scald',
      targeting: 'normal_attack',
      effects: { afterCombat: [{ type: 'damage', target: 'target', amount, nonLethal: false }] },
      combatMods: {},
    });
    const caster = unit('Scalder', 'enemy', { col: 1, row: 0 });
    const hero = edric({ col: 0, row: 0, hp: 6 });
    const state = banner();
    const beats = [
      ...postCombatEffects(
        {
          attacker: caster,
          defender: hero,
          result: { events: landed },
          attackerWeaponArt: scald(9),
        },
        world([caster, hero], state),
      ),
    ];
    expect(hero.currentHP).toBe(1);
    expect(beats.map((b) => b.kind)).toEqual(['hp', 'poison', 'banner']);

    // Held in the exchange itself (the result says so): the same blow cannot finish it,
    // even with the banner spent.
    const spent = createBattleBlessings({ lastStand: 1 }, { spent: [BANNER] });
    const heldHero = edric({ col: 0, row: 0, hp: 1 });
    [
      ...postCombatEffects(
        {
          attacker: caster,
          defender: heldHero,
          result: { events: landed, bannerHeld: { attacker: false, defender: true } },
          attackerWeaponArt: scald(9),
        },
        world([caster, heldHero], spent),
      ),
    ];
    expect(heldHero.currentHP).toBe(1);
  });
});

describe('the forecast says "1 HP (Unbroken Banner)"', () => {
  const forecastOf = (attacker, defender, state) =>
    getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      null,
      null,
      ctx(state),
    );

  it('carries `banner` only on a side it would hold, while it is ready', () => {
    const state = banner();
    const f = forecastOf(edric({ hp: 10 }), foe(), state);
    expect(f.attacker.banner).toBe(true);
    expect(f.defender).not.toHaveProperty('banner');
    expect(forecastOf(edric({ hp: 10 }), foe(), null).attacker).not.toHaveProperty('banner');
    state.spent.push(BANNER);
    expect(forecastOf(edric({ hp: 10 }), foe(), state).attacker).not.toHaveProperty('banner');
    expect(bannerReadyFor(state, edric())).toBe(false);
  });

  it('projects a lethal counter as a hold that ends the exchange, in the notes too', () => {
    const f = forecastOf(edric({ hp: 10, stats: { SPD: 20 } }), foe(), banner());
    const projection = forecastProjection(f);
    // 30 -> 19, the counter holds Edric at 1, and his follow-up is not counted.
    expect(projection).toEqual({ attackerHP: 1, defenderHP: 19, holds: 'attacker' });
    expect(projectedHpText(projection, 'attacker')).toBe(BANNER_HOLD_TEXT);
    expect(projectedHpText(projection, 'defender')).toBe('19 HP');
    expect(forecastNotes(f, true, 10)[0]).toBe(
      `If all hits land: ${BANNER_HOLD_TEXT} (no crits/procs)`,
    );
    expect(forecastReadingPoints(f).join(' ')).toMatch(/Unbroken Banner/);
  });

  it('without the banner the same exchange reads KO and the counter could defeat', () => {
    const f = forecastOf(edric({ hp: 10 }), foe(), null);
    expect(projectedHpText(forecastProjection(f), 'attacker')).toBe('KO');
    expect(counterRisk(f, 10)).toBe('The counterattack could defeat Edric.');
    expect(forecastReadingPoints(f).join(' ')).not.toMatch(/Unbroken Banner/);
  });

  it('the counter risk says the banner would hold, not that the counter could defeat', () => {
    const f = forecastOf(edric({ hp: 10 }), foe(), banner());
    expect(counterRisk(f, 10)).toBe(
      'The counterattack could fell Edric: the Unbroken Banner would hold at 1 HP.',
    );
  });

  it('a foe the attack would fell still reads KO (the banner is the army’s alone)', () => {
    const f = forecastOf(edric(), foe({ hp: 10 }), banner());
    expect(projectedHpText(forecastProjection(f), 'defender')).toBe('KO');
  });
});
