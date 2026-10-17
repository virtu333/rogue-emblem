// The Longarm Bracer (combatEffects `meleeCounterRange: 2`, engine/AccessoryReactions.js): its
// wearer's 1-range weapons counter from up to 2 tiles. Only counters: attacks keep the weapon's
// own range. A counter from 2 tiles is no melee blow, so Thorns and the Briar Cloak skip it.
//
// Numbers worked by hand (CLAUDE.md's formulas; Math.random() = 0 lands every strike, SKL 0 /
// LCK 0 and 0-Crit weapons make none crit):
//   the archer: STR 10 + Iron Bow's Might 5 - Sera's DEF 4 = 11 a blow (SPD 8 against 8: no
//   double). Sera's counter: STR 10 + Iron Sword's Might 5 - the archer's DEF 4 = 11.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canCounter, getCombatForecast, parseRange, resolveCombat } from '../src/engine/Combat.js';
import {
  getSkillCombatMods,
  rollDefenseSkills,
  rollStrikeSkills,
} from '../src/engine/SkillSystem.js';
import { getAttackRange } from '../src/engine/AttackOptions.js';
import { meleeCounterRangeOf } from '../src/engine/AccessoryReactions.js';
import { AIController } from '../src/engine/AIController.js';
import { rollDefenseAffixes } from '../src/engine/AffixSystem.js';
import { formatAccessoryDetail } from '../src/utils/accessoryText.js';
import { canRollAccessorySkill } from '../src/engine/AccessorySkills.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const accessory = (name) => structuredClone(gameData.accessories.find((a) => a.name === name));
const weapon = (name) => structuredClone(gameData.weapons.find((w) => w.name === name));
const bracer = () => accessory('Longarm Bracer');

afterEach(() => vi.restoreAllMocks());

const BASE = { HP: 30, STR: 10, MAG: 0, SKL: 0, SPD: 8, DEF: 4, RES: 3, LCK: 0, MOV: 5 };
function unit(name, faction, extra = {}) {
  return {
    name,
    faction,
    level: 5,
    skills: [],
    stats: { ...BASE },
    currentHP: BASE.HP,
    col: 0,
    row: 0,
    moveType: 'Infantry',
    weaponRank: 'Prof',
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    weapon: weapon('Iron Sword'),
    accessory: null,
    _conditions: [],
    ...extra,
  };
}
const sera = (extra = {}) => unit('Sera', 'player', { accessory: bracer(), ...extra });
const archer = (extra = {}) => unit('Archer', 'enemy', { weapon: weapon('Iron Bow'), ...extra });

const ctx = (a, d, extra = {}) => {
  const args = (x, y, init) => [x, y, [x], [y], gameData.skills, null, init, null, null];
  return {
    skillsData: gameData.skills,
    rollStrikeSkills,
    rollDefenseSkills,
    atkMods: getSkillCombatMods(...args(a, d, true)),
    defMods: getSkillCombatMods(...args(d, a, false)),
    ...extra,
  };
};

function fight(attacker, defender, distance, extraCtx = {}) {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const result = resolveCombat(
    attacker,
    attacker.weapon,
    defender,
    defender.weapon,
    distance,
    null,
    null,
    ctx(attacker, defender, extraCtx),
  );
  vi.restoreAllMocks();
  return result;
}

const counters = (result) =>
  result.events.filter((e) => e.type === 'strike' && e.attackerSide === 'defender');

describe('the data', () => {
  it('is a legendary that drops in Acts III and IV and never binds a skill', () => {
    const item = bracer();
    expect(item.legendary).toBe(true);
    const acts = ['act1', 'act2', 'act3', 'act4'].filter((act) =>
      gameData.lootTables[act].accessories.includes('Longarm Bracer'),
    );
    expect(acts).toEqual(['act3', 'act4']);
    expect(canRollAccessorySkill(item)).toBe(false);
    expect(formatAccessoryDetail(item)).toContain(
      'Swords, lances and axes with range 1 counter from up to 2 tiles',
    );
  });
});

describe('who it reaches for', () => {
  it('a 1-range weapon counters from 1 and 2 tiles, never 3', () => {
    const s = sera();
    expect([1, 2, 3].map((d) => canCounter(s, s.weapon, d))).toEqual([true, true, false]);
    const plain = sera({ accessory: null });
    expect([1, 2, 3].map((d) => canCounter(plain, plain.weapon, d))).toEqual([true, false, false]);
  });

  it('lances and axes too; a weapon that already reaches 2 is unchanged; a staff never', () => {
    for (const name of ['Iron Lance', 'Iron Axe']) {
      const s = sera({ weapon: weapon(name) });
      expect(canCounter(s, s.weapon, 2), name).toBe(true);
    }
    const handAxe = gameData.weapons.find((w) => w.type === 'Axe' && w.range === '1-2');
    const thrower = sera({ weapon: structuredClone(handAxe) });
    expect([2, 3].map((d) => canCounter(thrower, thrower.weapon, d))).toEqual([true, false]);
    const bow = sera({ weapon: weapon('Iron Bow') });
    expect([1, 2, 3].map((d) => canCounter(bow, bow.weapon, d))).toEqual([false, true, false]);
    const staff = gameData.weapons.find((w) => w.type === 'Staff' && w.range === '1');
    expect(meleeCounterRangeOf(sera(), staff, parseRange(staff.range))).toBe(0);
    expect(canCounter(sera({ weapon: structuredClone(staff) }), staff, 1)).toBe(false);
  });

  it('it never widens an attack', () => {
    const s = sera();
    expect(getAttackRange(s, s.weapon, { skillsData: gameData.skills })).toMatchObject({
      min: 1,
      max: 1,
    });
  });
});

describe('in combat', () => {
  it('an archer at 2 tiles is countered: forecast and resolution agree', () => {
    const a = archer();
    const s = sera();
    const f = getCombatForecast(a, a.weapon, s, s.weapon, 2, null, null, ctx(a, s));
    expect(f.defender.canCounter).toBe(true);
    expect(f.defender.damage).toBe(11);
    const r = fight(a, s, 2);
    expect(counters(r).length).toBe(1);
    expect(r.attackerHP).toBe(30 - 11);
    expect(r.defenderHP).toBe(30 - 11);
    // Without the bracer Sera only takes the arrow.
    const plain = fight(archer(), sera({ accessory: null }), 2);
    expect(counters(plain).length).toBe(0);
    expect(plain.attackerHP).toBe(30);
  });

  it('the usual no-counter rules still hold: Sleep, a foe that prevents counters', () => {
    const asleep = sera({ _conditions: [{ id: 'sleep', turns: 2 }] });
    const sleepy = getCombatForecast(
      archer(),
      archer().weapon,
      asleep,
      asleep.weapon,
      2,
      null,
      null,
      ctx(archer(), asleep),
    );
    expect(sleepy.defender.canCounter).toBe(false);
    const a = archer();
    const s = sera();
    const c = ctx(a, s);
    c.atkMods = { ...c.atkMods, preventCounter: true };
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const r = resolveCombat(a, a.weapon, s, s.weapon, 2, null, null, c);
    expect(counters(r).length).toBe(0);
  });

  it('a counter from 2 tiles is not pricked by Thorns', () => {
    const a = archer({ affixes: ['thorns'] });
    const r = fight(a, sera(), 2, { affixData: gameData.affixes, rollDefenseAffixes });
    const counter = counters(r)[0];
    expect(counter).toBeTruthy();
    expect(counter.reflectTaken || 0).toBe(0);
    expect(r.defenderHP).toBe(30 - 11);
    // The same thorny foe beside her pricks her counter: the affix is live in this context.
    const beside = fight(unit('Thorny', 'enemy', { affixes: ['thorns'] }), sera(), 1, {
      affixData: gameData.affixes,
      rollDefenseAffixes,
    });
    expect(counters(beside)[0].reflectTaken).toBeGreaterThan(0);
  });
});

describe('the enemy sees it', () => {
  it('an archer scores the bracer wearer lower, for the counter it would take', () => {
    const ai = new AIController({}, gameData);
    const a = archer({ col: 0, row: 0 });
    const wearer = sera({ col: 2, row: 0 });
    const plain = sera({ col: 2, row: 0, accessory: null });
    expect(ai._scoreAttackTarget(a, wearer)).toBeLessThan(ai._scoreAttackTarget(a, plain));
  });
});
