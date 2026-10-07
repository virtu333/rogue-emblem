// Lunar Brace (docs/specs/phase3.md 3F): a Lance art that adds floor(30% of the foe's DEF)
// as damage on a physical strike. `foeDefShare` is a combat-mod key, so it has to survive
// the art's mod normalisation and the merge, and the forecast has to show exactly what
// resolveCombat deals. Every number is worked by hand from the formula in CLAUDE.md:
//   Steel Lance: 9 might, 75 hit, 8 weight.  Attacker: STR 12, SKL 30 (Hit 75 + 60 is a sure hit).
//   Knight: DEF 20, RES 2, no weapon (no triangle). Plain strike: 12 + 9 - 20 = 1.
//   Lunar Brace on a plain: 1 + floor(0.3 x 20) = 1 + 6 = 7.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameData } from './testData.js';
import {
  artFollowUpStrike,
  forecastStrikeGroups,
  getCombatForecast,
  mergeCombatMods,
  resolveCombat,
  strikeDamage,
} from '../src/engine/Combat.js';
import { getWeaponArtCombatMods } from '../src/engine/WeaponArtSystem.js';
import { weaponArtSheet } from '../src/ui/weaponArtDisplay.js';
import { summarizeWeaponArtEffect } from '../src/ui/WeaponArtVisibility.js';

const data = loadGameData();
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));
const art = data.weaponArts.arts.find((a) => a.id === 'lance_lunar_brace');
const terrain = (name) => data.terrain.find((t) => t.name === name);

const unit = (name, stats, extra = {}) => ({
  name,
  faction: extra.faction || 'player',
  col: 0,
  row: 0,
  level: 5,
  currentHP: stats.HP ?? 60,
  stats: { HP: 60, STR: 0, MAG: 0, SKL: 0, SPD: 0, DEF: 0, RES: 0, LCK: 0, MOV: 5, ...stats },
  weaponRank: 'Prof',
  moveType: 'Infantry',
  ...extra,
});

// A lancer who never misses and never crits a knight with LCK 30 (crit 15 - 30 < 0).
const lancer = (stats = {}) => unit('Lancer', { STR: 12, SKL: 30, ...stats });
const knight = (stats = {}, extra = {}) =>
  unit('Knight', { DEF: 20, RES: 2, LCK: 30, ...stats }, { faction: 'enemy', ...extra });
const lunar = () => mergeCombatMods(null, art.combatMods);

afterEach(() => vi.restoreAllMocks());

describe('Lunar Brace data', () => {
  it('is a Steel Lance art for Prof rank in act 2, 3 HP, twice a battle', () => {
    expect(art).toMatchObject({
      name: 'Lunar Brace',
      weaponType: 'Lance',
      tierAffinity: 'Steel',
      unlockAct: 'act2',
      requiredRank: 'Prof',
      hpCost: 3,
      perMapLimit: 2,
      targeting: 'normal_attack',
    });
    // No area, no effects, no reach: an ordinary art that keeps its follow-up.
    expect(art.noFollowUp).toBeUndefined();
    expect(art.area).toBeUndefined();
    expect(art.effects).toBeUndefined();
  });

  it('keeps foeDefShare through the art-mod whitelist and the merge', () => {
    expect(getWeaponArtCombatMods(art).foeDefShare).toBe(0.3);
    expect(lunar().foeDefShare).toBe(0.3);
    // A merge adds the shares; another source of mods keeps its own.
    expect(mergeCombatMods({ foeDefShare: 0.3 }, { foeDefShare: 0.2 }).foeDefShare).toBeCloseTo(
      0.5,
    );
    expect(mergeCombatMods({ atkBonus: 2 }, lunar()).foeDefShare).toBe(0.3);
    // Junk is dropped, never NaN.
    expect(mergeCombatMods(null, { foeDefShare: 'x' }).foeDefShare).toBe(0);
    expect(mergeCombatMods(null, { foeDefShare: -1 }).foeDefShare).toBe(0);
    expect(getWeaponArtCombatMods({ combatMods: {} }).foeDefShare).toBe(0);
  });

  it('is taught by a scroll and described in the sheet', () => {
    const scroll = data.weapons.find((w) => w.teachesWeaponArtId === art.id);
    expect(scroll?.name).toBe('Lunar Brace Scroll');
    expect(scroll.allowedWeaponTypes).toEqual(['Lance']);
    const text = weaponArtSheet(art)
      .map((row) => row.text)
      .join('\n');
    expect(text).toContain("Adds 30% of the foe's Defense to damage");
    expect(summarizeWeaponArtEffect(art)).toContain('30% of foe DEF');
  });
});

describe('Lunar Brace damage', () => {
  it("adds 30% of a DEF 20 Knight's DEF: 1 becomes 1 + 6 = 7", () => {
    const steel = weapon('Steel Lance');
    expect(strikeDamage(lancer(), steel, knight(), null, null)).toBe(1);
    expect(strikeDamage(lancer(), steel, knight(), null, null, lunar())).toBe(7);
  });

  it('floors the share and adds it even when armour stops the whole blow', () => {
    const steel = weapon('Steel Lance');
    // DEF 29: 12 + 9 - 29 < 0 is 0 damage; the share is floor(8.7) = 8.
    expect(strikeDamage(lancer(), steel, knight({ DEF: 29 }), null, null)).toBe(0);
    expect(strikeDamage(lancer(), steel, knight({ DEF: 29 }), null, null, lunar())).toBe(8);
    // DEF 3: 12 + 9 - 3 = 18, and floor(0.9) = 0 more.
    expect(strikeDamage(lancer(), steel, knight({ DEF: 3 }), null, null, lunar())).toBe(18);
  });

  it("reads the DEF the formula subtracts: terrain, the foe's DEF mods and its weapon's bonus", () => {
    const steel = weapon('Steel Lance');
    // DEF 23 on a Mountain (+2) is 25 to the formula: floor(7.5) = 7, not floor(6.9) = 6.
    expect(
      strikeDamage(lancer(), steel, knight({ DEF: 23 }), null, terrain('Mountain'), lunar()),
    ).toBe(7);
    // A +4 DEF buff (defMods) takes DEF 20 to 24: floor(7.2) = 7. The blow itself is 0.
    expect(strikeDamage(lancer(), steel, knight(), null, null, lunar(), { defBonus: 4 })).toBe(7);
    // Tidebreaker gives its wielder +5 DEF: DEF 15 + 5 = 20, floor(6) = 6. The axe beats the
    // lance (-1 damage): 12 + 9 - 1 - 20 < 0, so the blow is 0 and the strike deals 6.
    expect(
      strikeDamage(lancer(), steel, knight({ DEF: 15 }), weapon('Tidebreaker'), null, lunar()),
    ).toBe(6);
  });

  it('never reads RES: a magic strike, or an art that targets RES, is unchanged', () => {
    const mage = unit('Mage', { MAG: 12, SKL: 30 });
    const fire = weapon('Fire'); // 4 might
    // 12 + 4 - RES 2 = 14, with or without the share (the Knight's DEF 20 never enters).
    expect(strikeDamage(mage, fire, knight(), null, null)).toBe(14);
    expect(strikeDamage(mage, fire, knight(), null, null, lunar())).toBe(14);
    // A physical weapon whose art strikes RES: 12 + 9 - RES 2 = 19, no share either.
    const resLance = mergeCombatMods(lunar(), { targetsRES: true });
    expect(strikeDamage(lancer(), weapon('Steel Lance'), knight(), null, null, resLance)).toBe(19);
  });

  it('adds nothing against a foe with no DEF', () => {
    const steel = weapon('Steel Lance');
    expect(strikeDamage(lancer(), steel, knight({ DEF: 0 }), null, null, lunar())).toBe(21);
  });
});

describe('Lunar Brace in the forecast and in combat', () => {
  const ctx = () => ({ atkWeaponArtMods: getWeaponArtCombatMods(art) });
  const forecast = (a, d, defTerrain = null, skillCtx = ctx()) =>
    getCombatForecast(a, a.weapon, d, d.weapon || null, 1, null, defTerrain, skillCtx);
  const resolve = (a, d, defTerrain = null, skillCtx = ctx()) => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01); // always hits, never crits (see the header)
    return resolveCombat(a, a.weapon, d, d.weapon || null, 1, null, defTerrain, skillCtx);
  };
  const strikesOf = (result) =>
    result.events.filter((e) => e.type === 'strike' && e.attackerSide === 'attacker');

  it('the forecast shows 7 and the strike deals 7', () => {
    const a = lancer({ SPD: 5 });
    a.weapon = weapon('Steel Lance');
    const d = knight();
    expect(forecast(a, d).attacker.damage).toBe(7);
    const strikes = strikesOf(resolve(structuredClone(a), structuredClone(d)));
    expect(strikes.map((e) => e.damage)).toEqual([7]);
  });

  it("forecast and strike agree on terrain, the foe's weapon and a crit-free hit", () => {
    for (const [def, defTerrain, defWeapon, expected] of [
      [20, null, null, 7], // 1 + 6
      [23, terrain('Mountain'), null, 7], // 0 + floor(7.5)
      [23, terrain('Forest'), null, 7], // DEF 24 on a Forest: 12 + 9 - 24 < 0; floor(7.2)
      [15, null, weapon('Tidebreaker'), 6], // 0 + floor(0.3 x 20)
    ]) {
      const a = lancer({ SPD: 5 });
      a.weapon = weapon('Steel Lance');
      const d = knight({ DEF: def });
      if (defWeapon) d.weapon = defWeapon;
      expect(forecast(a, d, defTerrain).attacker.damage, `DEF ${def}`).toBe(expected);
      const strikes = strikesOf(resolve(structuredClone(a), structuredClone(d), defTerrain));
      expect(strikes[0].damage, `DEF ${def}`).toBe(expected);
    }
  });

  it("a follow-up is the plain strike (the art's share rides its own strike only)", () => {
    // Attack Speed: 30 - max(0, 8 - floor(12 / 5)) = 24 against 0. An art keeps its follow-up
    // only with 10 more Attack Speed than the foe, so this one follows up.
    const a = lancer({ SPD: 30 });
    a.weapon = weapon('Steel Lance');
    const d = knight();
    const f = forecast(a, d).attacker;
    expect(f.attackCount).toBe(2);
    expect(forecastStrikeGroups(f).map((g) => [g.damage, g.count])).toEqual([
      [7, 1],
      [1, 1],
    ]);
    const strikes = strikesOf(resolve(structuredClone(a), structuredClone(d)));
    expect(strikes.map((e) => [e.damage, Boolean(e.artFollowUp)])).toEqual([
      [7, false],
      [1, true],
    ]);
  });

  it('artFollowUpStrike adds the share when its own mods carry it, Luna included', () => {
    const striker = lancer();
    const target = knight();
    const steel = weapon('Steel Lance');
    const none = artFollowUpStrike(striker, steel, target, null, null, { strikerMods: null });
    expect(none.damage).toBe(1);
    const withShare = artFollowUpStrike(striker, steel, target, null, null, {
      strikerMods: mergeCombatMods(null, { foeDefShare: 0.3 }),
    });
    expect(withShare.damage).toBe(7);
    // Luna halves DEF first: 12 + 9 - 10 = 11, and the share reads that DEF 10: floor(3) = 3.
    expect(none.lunaDamage).toBe(11);
    expect(withShare.lunaDamage).toBe(14);
  });

  it("a Luna strike halves the foe's DEF and so does its share", () => {
    const a = lancer({ SPD: 5 });
    a.weapon = weapon('Steel Lance');
    const d = knight();
    const luna = {
      ...ctx(),
      rollStrikeSkills: () => ({
        luna: true,
        modifiedDamage: 0,
        heal: 0,
        extraStrike: false,
        activated: [{ id: 'luna', name: 'Luna' }],
      }),
      skillsData: data.skills,
    };
    const strikes = strikesOf(resolve(structuredClone(a), structuredClone(d), null, luna));
    // 14, not 11: the Lunar Brace bonus is kept when Luna lowers the DEF.
    expect(strikes.map((e) => e.damage)).toEqual([14]);
  });

  it('a magic strike is unchanged in the forecast and in combat', () => {
    const mage = unit('Mage', { MAG: 12, SKL: 30, SPD: 5 });
    mage.weapon = weapon('Fire');
    const d = knight();
    const skillCtx = ctx(); // the art's mods on a tome user: the share must be ignored
    expect(forecast(mage, d, null, skillCtx).attacker.damage).toBe(14);
    const strikes = strikesOf(resolve(structuredClone(mage), structuredClone(d), null, skillCtx));
    expect(strikes[0].damage).toBe(14);
  });
});
