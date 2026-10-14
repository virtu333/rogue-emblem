// Toppling Cut: a Steel Sword art that adds floor(15% of the foe's max HP) to its strike,
// after DEF or RES, so it bites even where the blade cannot scratch. Built as the answer to
// the Entity (about 124 HP on Nightfall, DEF 25): 18 extra on a strike. Every number is
// worked by hand from the formula in CLAUDE.md:
//   Steel Sword: 8 might, 85 hit, 5 weight. Attacker: STR 10, SKL 30 (85 + 60: a sure hit).
//   Colossus: HP 124, DEF 25, RES 2, LCK 40 (never critted). Plain strike: 10 + 8 - 25 < 0 = 0.
//   Toppling Cut: 0 + floor(0.15 x 124) = 18.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameData } from './testData.js';
import {
  artFollowUpStrike,
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
const art = data.weaponArts.arts.find((a) => a.id === 'sword_toppling_cut');

const unit = (name, stats, extra = {}) => ({
  name,
  faction: extra.faction || 'player',
  col: 0,
  row: 0,
  level: 10,
  currentHP: stats.HP ?? 60,
  stats: { HP: 60, STR: 0, MAG: 0, SKL: 0, SPD: 0, DEF: 0, RES: 0, LCK: 0, MOV: 5, ...stats },
  weaponRank: 'Prof',
  moveType: 'Infantry',
  ...extra,
});

const swordsman = (stats = {}) => {
  const u = unit('Swordsman', { STR: 10, SKL: 30, ...stats });
  u.weapon = weapon('Steel Sword');
  return u;
};
const colossus = (stats = {}, extra = {}) =>
  unit('Colossus', { HP: 124, DEF: 25, RES: 2, LCK: 40, ...stats }, { faction: 'enemy', ...extra });
const topple = () => mergeCombatMods(null, art.combatMods);

afterEach(() => vi.restoreAllMocks());

describe('Toppling Cut data', () => {
  it('is a Steel Sword art for Prof rank in act 2, 6 HP, twice a battle', () => {
    expect(art).toMatchObject({
      name: 'Toppling Cut',
      weaponType: 'Sword',
      tierAffinity: 'Steel',
      unlockAct: 'act2',
      requiredRank: 'Prof',
      hpCost: 6,
      perMapLimit: 2,
      targeting: 'normal_attack',
    });
    expect(art.combatMods.foeMaxHpShare).toBe(0.15);
    expect(art.area).toBeUndefined();
    expect(art.effects).toBeUndefined();
  });

  it('keeps foeMaxHpShare through the art-mod whitelist and the merge, junk dropped', () => {
    expect(getWeaponArtCombatMods(art).foeMaxHpShare).toBe(0.15);
    expect(topple().foeMaxHpShare).toBe(0.15);
    expect(mergeCombatMods({ atkBonus: 2 }, topple()).foeMaxHpShare).toBe(0.15);
    expect(
      mergeCombatMods({ foeMaxHpShare: 0.15 }, { foeMaxHpShare: 0.1 }).foeMaxHpShare,
    ).toBeCloseTo(0.25);
    expect(mergeCombatMods(null, { foeMaxHpShare: 'x' }).foeMaxHpShare).toBe(0);
    expect(mergeCombatMods(null, { foeMaxHpShare: -1 }).foeMaxHpShare).toBe(0);
    expect(getWeaponArtCombatMods({ combatMods: {} }).foeMaxHpShare).toBe(0);
  });

  it('is taught by a Sword scroll the Act II pool can drop, and the sheet says what it does', () => {
    const scroll = data.weapons.find((w) => w.teachesWeaponArtId === art.id);
    expect(scroll?.name).toBe('Toppling Cut Scroll');
    expect(scroll.allowedWeaponTypes).toEqual(['Sword']);
    const text = weaponArtSheet(art)
      .map((row) => row.text)
      .join('\n');
    expect(text).toContain("Adds 15% of the foe's max HP to damage");
    expect(summarizeWeaponArtEffect(art)).toContain('15% of foe max HP');
  });
});

describe('Toppling Cut damage', () => {
  it("adds 15% of the foe's max HP even when armour stops the whole blow: 0 becomes 18", () => {
    const s = swordsman();
    expect(strikeDamage(s, s.weapon, colossus(), null, null)).toBe(0);
    expect(strikeDamage(s, s.weapon, colossus(), null, null, topple())).toBe(18);
  });

  it('reads max HP, not current HP, and floors the share', () => {
    const s = swordsman();
    const hurt = colossus({}, { currentHP: 10 });
    expect(strikeDamage(s, s.weapon, hurt, null, null, topple())).toBe(18);
    // A 45 HP soldier with DEF 5: 10 + 8 - 5 = 13, plus floor(6.75) = 6.
    expect(strikeDamage(s, s.weapon, colossus({ HP: 45, DEF: 5 }), null, null, topple())).toBe(19);
  });

  it('works on a RES strike too (a share of HP, not of a defence)', () => {
    const mage = unit('Mage', { MAG: 12, SKL: 30 });
    const fire = weapon('Fire'); // 4 might: 12 + 4 - RES 2 = 14
    expect(strikeDamage(mage, fire, colossus(), null, null)).toBe(14);
    expect(strikeDamage(mage, fire, colossus(), null, null, topple())).toBe(32);
  });
});

describe('Toppling Cut in the forecast and in combat', () => {
  const ctx = () => ({ atkWeaponArtMods: getWeaponArtCombatMods(art) });
  const forecast = (a, d) => getCombatForecast(a, a.weapon, d, null, 1, null, null, ctx());
  const resolve = (a, d) => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01); // always hits, never crits
    return resolveCombat(a, a.weapon, d, null, 1, null, null, ctx());
  };
  const strikesOf = (result) =>
    result.events.filter((e) => e.type === 'strike' && e.attackerSide === 'attacker');

  it('the forecast shows 18 and the strike deals 18', () => {
    const a = swordsman({ SPD: 5 });
    const d = colossus();
    expect(forecast(a, d).attacker.damage).toBe(18);
    expect(strikesOf(resolve(structuredClone(a), structuredClone(d))).map((e) => e.damage)).toEqual(
      [18],
    );
  });

  it("a follow-up is the plain strike (the art's share rides its own strike only)", () => {
    // Attack Speed 30 - max(0, 5 - 2) = 27 against 0: an art keeps its follow-up at +10.
    const a = swordsman({ SPD: 30 });
    const d = colossus({ DEF: 10 }); // plain: 10 + 8 - 10 = 8
    const strikes = strikesOf(resolve(structuredClone(a), structuredClone(d)));
    expect(strikes.map((e) => [e.damage, Boolean(e.artFollowUp)])).toEqual([
      [8 + 18, false],
      [8, true],
    ]);
  });

  it('artFollowUpStrike adds the share only when its own mods carry it, Luna included', () => {
    const s = swordsman();
    const d = colossus({ DEF: 10 });
    const none = artFollowUpStrike(s, s.weapon, d, null, null, { strikerMods: null });
    const withShare = artFollowUpStrike(s, s.weapon, d, null, null, { strikerMods: topple() });
    expect(none.damage).toBe(8);
    expect(withShare.damage).toBe(26);
    // Luna halves DEF: 10 + 8 - 5 = 13; the share is the same 18.
    expect(none.lunaDamage).toBe(13);
    expect(withShare.lunaDamage).toBe(31);
  });
});
