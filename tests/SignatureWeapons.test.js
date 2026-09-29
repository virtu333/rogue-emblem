// Personal (signature) weapons, one per lord, given by Deadly Arsenal I in place of
// the commander's Steel weapon (playtest 2026-09-29 #18). Ways this can fail:
//  - a stat or rule drifts from the owner-approved line (pinned table below);
//  - a special reads fine on the card but combat ignores it (each rule is resolved
//    through getCombatForecast against numbers worked out by hand here);
//  - a tag promises something else than combat does (ItemKeywords);
//  - a personal weapon leaks into loot: a loot table, the loot-quality upgrade, or a
//    "first weapon of this type and tier" picker that hands out default gear.
import { describe, it, expect } from 'vitest';
import { loadGameData } from './testData.js';
import {
  getCombatForecast,
  getEffectivenessMultiplier,
  canCounter,
  resolveCombat,
} from '../src/engine/Combat.js';
import { getSkillCombatMods } from '../src/engine/SkillSystem.js';
import { getAttackRange } from '../src/engine/AttackOptions.js';
import { itemKeywords, itemBaseLine } from '../src/engine/ItemKeywords.js';
import { generateLootChoices } from '../src/engine/LootSystem.js';
import {
  grantSecondaryWeapons,
  canEquip,
  parseWeaponProficiencies,
} from '../src/engine/UnitManager.js';
import { isSignatureWeapon, signatureWeaponFor } from '../src/engine/SignatureWeapons.js';
import { validateCrossReferences } from '../tools/validateCrossReferences.js';

const data = loadGameData();
const weapon = (name) => data.weapons.find((w) => w.name === name);
const plain = data.terrain.find((t) => t.name === 'Plain');

// Owner-approved line (docs/playtest-triage-2026-09-29.md #18), after the sim pass.
const TABLE = {
  Edric: { name: 'Rapier', type: 'Sword', might: 7, hit: 95, crit: 5, weight: 2, range: '1' },
  Rowan: { name: 'Godsend', type: 'Lance', might: 8, hit: 85, crit: 10, weight: 5, range: '1' },
  Astrid: { name: 'Windward', type: 'Lance', might: 7, hit: 85, crit: 5, weight: 4, range: '1' },
  Cael: { name: 'Holdfast', type: 'Axe', might: 9, hit: 80, crit: 5, weight: 6, range: '1' },
  Kira: { name: 'Endgame', type: 'Tome', might: 6, hit: 95, crit: 5, weight: 2, range: '1-2' },
  Sera: {
    name: 'Threadlight',
    type: 'Light',
    might: 6,
    hit: 100,
    crit: 10,
    weight: 1,
    range: '1-2',
    special: '+1 SPD when equipped',
  },
  Voss: { name: 'Last Watch', type: 'Bow', might: 5, hit: 90, crit: 20, weight: 4, range: '1-2' },
};

function unit(overrides = {}) {
  return {
    name: 'Unit',
    className: 'Fighter',
    tier: 'base',
    level: 5,
    stats: { HP: 30, STR: 10, MAG: 10, SKL: 5, SPD: 5, DEF: 4, RES: 4, LCK: 0 },
    currentHP: 30,
    faction: 'player',
    weapon: null,
    inventory: [],
    proficiencies: [],
    skills: [],
    moveType: 'Infantry',
    weaponRank: 'Prof',
    col: 5,
    row: 5,
    accessory: null,
    ...overrides,
  };
}

function forecast(attacker, atkWeapon, defender, defWeapon, distance = 1, allies = [attacker]) {
  attacker.weapon = atkWeapon;
  defender.weapon = defWeapon;
  const skillCtx = {
    atkMods: getSkillCombatMods(attacker, defender, allies, [defender], data.skills, plain, true),
    defMods: getSkillCombatMods(defender, attacker, [defender], allies, data.skills, plain, false),
  };
  return getCombatForecast(
    attacker,
    atkWeapon,
    defender,
    defWeapon,
    distance,
    plain,
    plain,
    skillCtx,
  );
}

describe('the personal weapon line', () => {
  it.each(Object.entries(TABLE))('%s: %s', (lord, expected) => {
    const w = weapon(expected.name);
    expect(w, expected.name).toBeTruthy();
    expect(w).toMatchObject({
      ...expected,
      tier: 'Steel',
      rankRequired: 'Prof',
      price: 1800,
      signatureOf: lord,
    });
    expect(signatureWeaponFor(lord, data.weapons)?.name).toBe(expected.name);
    // The lord can wield it from the start.
    const lordDef = data.lords.find((l) => l.name === lord);
    const proficiencies = parseWeaponProficiencies(lordDef.weapon);
    expect(canEquip({ proficiencies }, w)).toBe(true);
  });

  it('every lord has exactly one, and nothing else is a personal weapon', () => {
    const signatures = data.weapons.filter(isSignatureWeapon);
    expect(signatures.map((w) => `${w.signatureOf}:${w.name}`).sort()).toEqual(
      Object.entries(TABLE)
        .map(([lord, w]) => `${lord}:${w.name}`)
        .sort(),
    );
    expect(data.lords.map((l) => l.name).sort()).toEqual(Object.keys(TABLE).sort());
  });

  it('names are new: no other weapon, skill, art, accessory or consumable uses them', () => {
    const others = [
      ...data.weapons.filter((w) => !isSignatureWeapon(w)).map((w) => w.name),
      ...data.skills.map((s) => s.name),
      ...data.weaponArts.arts.map((a) => a.name),
      ...data.accessories.map((a) => a.name),
      ...data.consumables.map((c) => c.name),
    ];
    for (const { name } of Object.values(TABLE)) expect(others).not.toContain(name);
  });
});

describe('each rule resolves in combat', () => {
  it('Godsend doubles its might against armour and cavalry, not infantry', () => {
    const godsend = weapon('Godsend');
    for (const moveType of ['Armored', 'Cavalry'])
      expect(getEffectivenessMultiplier(godsend, { moveType })).toBe(2);
    expect(getEffectivenessMultiplier(godsend, { moveType: 'Infantry' })).toBe(1);
    // STR 10 + 8 x 2 - DEF 4 = 22 against a cavalier; 10 + 8 - 4 = 14 against infantry.
    const rowan = unit({ proficiencies: [{ type: 'Lance', rank: 'Prof' }] });
    expect(forecast(rowan, godsend, unit({ moveType: 'Cavalry' }), null).attacker.damage).toBe(22);
    expect(forecast(rowan, godsend, unit(), null).attacker.damage).toBe(14);
  });

  it('Windward: +2 STR and +2 SPD with no ally adjacent, nothing with one', () => {
    const windward = weapon('Windward');
    const foe = unit({ col: 6, row: 5, stats: { ...unit().stats, SPD: 0 } });
    const astrid = unit({ proficiencies: [{ type: 'Lance', rank: 'Prof' }] });
    // Alone: 10 + 2 + 7 - 4 = 15 damage; AS 5 + 2 - max(0, 4 - floor(10/5)) = 5.
    const alone = forecast(astrid, windward, foe, null);
    expect(alone.attacker.damage).toBe(15);
    // Foe AS 0: alone AS 5 doubles (5 >= 0 + 5).
    expect(alone.attacker.doubles).toBe(true);
    const ally = unit({ name: 'Ally', col: 4, row: 5 });
    const together = forecast(astrid, windward, foe, null, 1, [astrid, ally]);
    // With an ally: 10 + 7 - 4 = 13; AS 5 - 2 = 3, no double.
    expect(together.attacker.damage).toBe(13);
    expect(together.attacker.doubles).toBe(false);
  });

  it('Holdfast gives +3 DEF while equipped (defending and attacking)', () => {
    const holdfast = weapon('Holdfast');
    const cael = unit({ proficiencies: [{ type: 'Axe', rank: 'Prof' }] });
    const raider = unit({ name: 'Raider', col: 6, row: 5 });
    const ironAxe = weapon('Iron Axe');
    // Raider hits Cael: 10 + 7 - (4 + 3) = 10. Unarmed-bonus baseline with Iron Axe: 13.
    expect(forecast(raider, ironAxe, cael, holdfast).attacker.damage).toBe(10);
    expect(forecast(raider, ironAxe, unit({ ...cael }), ironAxe).attacker.damage).toBe(13);
    // Cael attacks; the counter meets the same +3.
    expect(forecast(cael, holdfast, raider, ironAxe).defender.damage).toBe(10);
  });

  it('Endgame doubles its might against cavalry and fliers, and Kira casts it at 1-3', () => {
    const endgame = weapon('Endgame');
    for (const moveType of ['Cavalry', 'Flying'])
      expect(getEffectivenessMultiplier(endgame, { moveType })).toBe(2);
    expect(getEffectivenessMultiplier(endgame, { moveType: 'Armored' })).toBe(1);
    // MAG 10 + 6 x 2 - RES 4 = 18 against a flier.
    const kira = unit({ proficiencies: [{ type: 'Tome', rank: 'Prof' }] });
    expect(forecast(kira, endgame, unit({ moveType: 'Flying' }), null, 2).attacker.damage).toBe(18);
    const kiraDef = data.lords.find((l) => l.name === 'Kira');
    expect(getAttackRange({ skills: ['foresight'] }, endgame, { skillsData: data.skills })).toEqual(
      {
        min: 1,
        max: 2 + (kiraDef.personalSkill.includes('+1 range') ? 1 : 0),
      },
    );
  });

  it('Threadlight is a 1-2 light tome that adds +1 SPD while equipped', () => {
    const threadlight = weapon('Threadlight');
    expect(threadlight.special).toBe('+1 SPD when equipped');
    const sera = unit({ proficiencies: [{ type: 'Light', rank: 'Prof' }] });
    // MAG 10 + 6 - RES 4 = 12; hit 100 + SKL 5 x 2 + LCK 0 - foe avoid (SPD 5 x 2 + 0) = 100.
    const f = forecast(sera, threadlight, unit(), null, 2);
    expect(f.attacker.damage).toBe(12);
    expect(f.attacker.hit).toBe(100);
  });

  it('Threadlight: the +1 SPD lifts attack speed and tips a double, attacking and defending', () => {
    const threadlight = weapon('Threadlight');
    // The same tome without the bonus, so only the +1 SPD differs.
    const bare = { ...threadlight, special: '' };
    const sera = unit({ proficiencies: [{ type: 'Light', rank: 'Prof' }] });
    // Weight 1 - floor(STR 10 / 5) = 0 penalty. Attack speed = SPD 5 (+1) = 6 with, 5 without.
    // A foe of SPD 1 (no weapon, AS 1): needs AS >= 1 + 5 = 6.
    const slow = () => unit({ name: 'Slow', col: 6, row: 5, stats: { ...unit().stats, SPD: 1 } });
    const withBonus = forecast(sera, threadlight, slow(), null);
    expect(withBonus.attacker.as).toBe(6);
    expect(withBonus.attacker.doubles).toBe(true);
    const without = forecast(sera, bare, slow(), null);
    expect(without.attacker.as).toBe(5);
    expect(without.attacker.doubles).toBe(false);
    // The fight itself agrees with the forecast: two strikes with the bonus, one without.
    const strikes = (weaponUsed) => {
      const foe = slow();
      foe.stats.HP = 100;
      foe.currentHP = 100;
      const result = resolveCombat(sera, weaponUsed, foe, null, 1, plain, plain, {
        atkMods: {},
        defMods: {},
      });
      return result.events.filter((e) => e.type === 'strike' && e.attackerSide === 'attacker')
        .length;
    };
    expect(strikes(threadlight)).toBe(2);
    expect(strikes(bare)).toBe(1);
    // Defending: an Axeman of SPD 5 swinging an Iron Axe (weight 6 - floor(10/5) = 4 penalty)
    // has AS 1. Sera's counter needs AS >= 6: with the bonus 6 doubles, without 5 does not.
    const ironAxe = weapon('Iron Axe');
    const axeman = () => unit({ name: 'Axeman', col: 6, row: 5 });
    const counterWith = forecast(axeman(), ironAxe, sera, threadlight);
    expect(counterWith.attacker.as).toBe(1);
    expect(counterWith.defender.as).toBe(6);
    expect(counterWith.defender.doubles).toBe(true);
    const counterWithout = forecast(axeman(), ironAxe, sera, bare);
    expect(counterWithout.defender.as).toBe(5);
    expect(counterWithout.defender.doubles).toBe(false);
  });

  it('Last Watch shoots at 1 and 2 and adds +2 RES against magic only', () => {
    const lastWatch = weapon('Last Watch');
    expect(canCounter(unit(), lastWatch, 1)).toBe(true);
    expect(canCounter(unit(), lastWatch, 2)).toBe(true);
    expect(canCounter(unit(), lastWatch, 3)).toBe(false);
    const voss = unit({
      proficiencies: [
        { type: 'Sword', rank: 'Prof' },
        { type: 'Bow', rank: 'Prof' },
      ],
    });
    const mage = unit({ name: 'Mage', col: 7, row: 5 });
    // Fire: MAG 10 + 4 - (RES 4 + 2) = 8.
    expect(forecast(mage, weapon('Fire'), voss, lastWatch, 2).attacker.damage).toBe(8);
    // An archer's arrow meets plain DEF: 10 + 5 - 4 = 11.
    expect(
      forecast(unit({ name: 'Archer' }), weapon('Iron Bow'), voss, lastWatch, 2).attacker.damage,
    ).toBe(11);
  });
});

describe('tags say what combat does', () => {
  it.each([
    ['Rapier', ['x2 vs Armored, Cavalry'], 'Steel Sword'],
    ['Godsend', ['x2 vs Armored, Cavalry'], 'Steel Lance'],
    ['Windward', ['Alone: +2 STR, +2 SPD'], 'Steel Lance'],
    ['Holdfast', ['+3 DEF'], 'Steel Axe'],
    ['Endgame', ['x2 vs Cavalry, Flying'], 'Tome'],
    ['Threadlight', ['+1 SPD'], 'Light Tome'],
    ['Last Watch', ['Close range', '+2 RES'], 'Steel Bow'],
  ])('%s', (name, tags, base) => {
    expect(itemKeywords(weapon(name)).map((t) => t.text)).toEqual(tags);
    expect(itemBaseLine(weapon(name))).toBe(base);
  });
});

describe('personal weapons never drop, sell or default', () => {
  const names = new Set(Object.values(TABLE).map((w) => w.name));

  it('no loot table (and so no shop) lists one', () => {
    for (const [act, table] of Object.entries(data.lootTables))
      for (const [pool, list] of Object.entries(table))
        if (Array.isArray(list))
          for (const entry of list) {
            const entryName = typeof entry === 'string' ? entry : entry?.name;
            expect(names.has(entryName), `${act}.${pool}: ${entryName}`).toBe(false);
          }
  });

  it('the cross-reference check refuses a personal weapon in a loot table', () => {
    const lootTables = structuredClone(data.lootTables);
    lootTables.act2.weapons.push('Godsend');
    const { errors } = validateCrossReferences({ ...data, lootTables });
    expect(errors.some((e) => e.includes('Godsend'))).toBe(true);
    expect(validateCrossReferences(data).errors).toEqual([]);
  });

  it('the loot-quality upgrade never turns a drop into one', () => {
    const realRandom = Math.random;
    let seed = 7;
    Math.random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const seen = new Set();
    try {
      for (let i = 0; i < 1500; i++) {
        const choices = generateLootChoices(
          'act1',
          data.lootTables,
          data.weapons,
          data.consumables,
          3,
          60,
        );
        for (const choice of choices) if (choice?.item?.name) seen.add(choice.item.name);
      }
    } finally {
      Math.random = realRandom;
    }
    // The upgrade did lift drops into the Steel pools this test watches...
    expect(seen.has('Steel Lance') || seen.has('Horsebane')).toBe(true);
    expect(seen.has('Steel Axe') || seen.has('Hammer')).toBe(true);
    // ...and never onto a personal weapon.
    expect([...seen].filter((n) => names.has(n))).toEqual([]);
  });

  it('default-gear pickers (first weapon of a type and tier) never pick one', () => {
    for (const type of ['Sword', 'Lance', 'Axe', 'Bow', 'Tome', 'Light'])
      for (const tier of ['Iron', 'Steel', 'Silver']) {
        const u = unit({ proficiencies: [{ type, rank: 'Prof' }] });
        grantSecondaryWeapons(u, data.weapons, tier);
        expect(
          u.inventory.map((w) => w.name).filter((n) => names.has(n)),
          `${type} ${tier}`,
        ).toEqual([]);
        const firstOfTier = data.weapons.find((w) => w.type === type && w.tier === tier);
        expect(names.has(firstOfTier?.name), `${type} ${tier}`).toBe(false);
      }
  });
});
