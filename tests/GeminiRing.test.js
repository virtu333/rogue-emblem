// The Gemini Ring (engine/GeminiRing.js): +2 to the stat its instance carries, and +2 to
// each other worn Gemini Ring's stat while that ring's wearer stands on the field.
//
// Expected numbers are worked by hand from CLAUDE.md's formulas:
//   Avoid = SPD x 2 + LCK; Hit = weapon Hit + SKL x 2 + LCK - foe Avoid
//   Crit = floor(SKL / 2) + weapon Crit - foe LCK; Attack Speed = SPD - weight penalty
//   damage = STR (or MAG) + Might - DEF (or RES)
import { describe, expect, it } from 'vitest';
import { getCombatForecast } from '../src/engine/Combat.js';
import { getSkillCombatMods } from '../src/engine/SkillSystem.js';
import { equipAccessory, unequipAccessory } from '../src/engine/UnitManager.js';
import {
  GEMINI_STATS,
  geminiPartnerStats,
  geminiStatOf,
  accessoryStatEffects,
} from '../src/engine/GeminiRing.js';
import { accessoryDisplayName } from '../src/engine/AccessorySkillNames.js';
import { formatAccessoryDetail } from '../src/utils/accessoryText.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const catalogRing = gameData.accessories.find((a) => a.name === 'Gemini Ring');
const weapon = (name) => structuredClone(gameData.weapons.find((w) => w.name === name));

const ring = (stat, uid = `itm_1_${stat.toLowerCase()}`) => ({
  ...structuredClone(catalogRing),
  uid,
  geminiStat: stat,
});

const STATS = { HP: 30, STR: 10, MAG: 6, SKL: 7, SPD: 8, DEF: 4, RES: 3, LCK: 0, MOV: 5 };
function unit(name, faction, extra = {}) {
  return {
    name,
    faction,
    level: 5,
    skills: [],
    stats: { ...STATS },
    currentHP: STATS.HP,
    col: 0,
    row: 0,
    weaponRank: 'Prof',
    weapon: weapon('Iron Sword'),
    accessory: null,
    ...extra,
  };
}

const mods = (u, foe, allies) =>
  getSkillCombatMods(u, foe, allies, [foe], gameData.skills, null, true, null, null);

describe('the catalog row', () => {
  it('is in the Act II and III accessory pools and nowhere else', () => {
    const acts = ['act1', 'act2', 'act3', 'act4'].filter((act) =>
      gameData.lootTables[act].accessories.includes('Gemini Ring'),
    );
    expect(acts).toEqual(['act2', 'act3']);
    expect(catalogRing.effects).toEqual({});
    expect(catalogRing.legendary).toBeUndefined();
  });

  it('a catalog row with no uid carries no stat yet, and says so', () => {
    expect(geminiStatOf(catalogRing)).toBeNull();
    expect(formatAccessoryDetail(catalogRing)).toContain('+2 to one stat');
    expect(accessoryDisplayName(catalogRing)).toBe('Gemini Ring');
  });
});

describe("an instance's stat", () => {
  it('comes from its uid, the same every time it is read', () => {
    const a = { ...structuredClone(catalogRing), uid: 'itm_4_9xq2' };
    const first = geminiStatOf(a);
    expect(GEMINI_STATS).toContain(first);
    expect(geminiStatOf(structuredClone(a))).toBe(first);
    // Only the random suffix counts: the process counter in front does not.
    expect(geminiStatOf({ ...a, uid: 'itm_812_9xq2' })).toBe(first);
  });

  it('spreads over all six stats across many rings', () => {
    const seen = new Set();
    for (let i = 0; i < 400; i++)
      seen.add(
        geminiStatOf({ ...catalogRing, uid: `itm_${i}_${i.toString(36).padStart(4, '0')}` }),
      );
    expect([...seen].sort()).toEqual([...GEMINI_STATS].sort());
  });

  it('a stamped stat wins over the uid, and shows in the name and the text', () => {
    const r = ring('SPD');
    expect(geminiStatOf(r)).toBe('SPD');
    expect(accessoryDisplayName(r)).toBe('Gemini Ring (SPD)');
    expect(accessoryStatEffects(r)).toEqual({ SPD: 2 });
    expect(formatAccessoryDetail(r)).toContain('+2 SPD');
    expect(formatAccessoryDetail(r)).toContain('other Gemini Ring');
  });

  it('equipping gives exactly +2 to that stat and unequipping takes it back', () => {
    const u = unit('Ana', 'player');
    const r = ring('DEF');
    equipAccessory(u, r);
    expect(u.stats).toEqual({ ...STATS, DEF: 6 });
    unequipAccessory(u);
    expect(u.stats).toEqual(STATS);
  });

  it('a ring worn with no uid keeps the stat it was equipped with when it gains one', () => {
    const u = unit('Ana', 'player');
    const r = structuredClone(catalogRing);
    equipAccessory(u, r);
    const stat = r.geminiStat;
    expect(GEMINI_STATS).toContain(stat);
    expect(u.stats[stat]).toBe(STATS[stat] + 2);
    // A trade or a save gives the item a uid later; the stamped stat still decides.
    r.uid = 'itm_9_zzzz';
    unequipAccessory(u);
    expect(u.stats).toEqual(STATS);
  });
});

describe('the set bonus', () => {
  it('needs another wearer: one ring alone gives no partner stat', () => {
    const a = unit('Ana', 'player', { accessory: ring('DEF') });
    const foe = unit('Brigand', 'enemy');
    expect(geminiPartnerStats(a, [a])).toEqual([]);
    const m = mods(a, foe, [a]);
    expect(m.activated.map((x) => x.id)).not.toContain('gemini_ring');
  });

  it("a SPD partner adds 4 Avoid and 2 Attack Speed to the wearer's combat", () => {
    const a = unit('Ana', 'player', { accessory: ring('DEF') });
    const b = unit('Bo', 'player', { accessory: ring('SPD', 'itm_2_bbbb') });
    const foe = unit('Brigand', 'enemy');
    const alone = mods(a, foe, [a]);
    const paired = mods(a, foe, [a, b]);
    expect(paired.avoidBonus - alone.avoidBonus).toBe(4);
    expect(paired.spdBonus - alone.spdBonus).toBe(2);
    expect(paired.atkBonus - alone.atkBonus).toBe(0);
    expect(paired.activated.map((x) => x.id)).toContain('gemini_ring');

    // Through the forecast: the foe's Hit on Ana drops by 4 with Bo on the field.
    const forecastHit = (allies) => {
      const skillCtx = {
        atkMods: mods(foe, a, [foe]),
        defMods: mods(a, foe, allies),
        skillsData: gameData.skills,
      };
      return getCombatForecast(foe, foe.weapon, a, a.weapon, 1, null, null, skillCtx).attacker.hit;
    };
    expect(forecastHit([a]) - forecastHit([a, b])).toBe(4);
  });

  it('STR helps a blade and not a tome; MAG the other way round', () => {
    const blade = unit('Ana', 'player', { accessory: ring('DEF') });
    const mage = unit('Mira', 'player', { accessory: ring('DEF'), weapon: weapon('Fire') });
    const foe = unit('Brigand', 'enemy');
    const str = unit('S', 'player', { accessory: ring('STR', 'itm_3_ssss') });
    const mag = unit('M', 'player', { accessory: ring('MAG', 'itm_3_mmmm') });
    expect(mods(blade, foe, [blade, str]).atkBonus - mods(blade, foe, [blade]).atkBonus).toBe(2);
    expect(mods(blade, foe, [blade, mag]).atkBonus - mods(blade, foe, [blade]).atkBonus).toBe(0);
    expect(mods(mage, foe, [mage, mag]).atkBonus - mods(mage, foe, [mage]).atkBonus).toBe(2);
    expect(mods(mage, foe, [mage, str]).atkBonus - mods(mage, foe, [mage]).atkBonus).toBe(0);
  });

  it('SKL adds 4 Hit and the Crit two more SKL would give', () => {
    const foe = unit('Brigand', 'enemy');
    const partner = unit('K', 'player', { accessory: ring('SKL', 'itm_3_kkkk') });
    // SKL 7 -> 9: floor(7/2) = 3, floor(9/2) = 4: +1 Crit.
    const odd = unit('Ana', 'player', { accessory: ring('DEF') });
    const diff = (u) => {
      const p = mods(u, foe, [u, partner]);
      const s = mods(u, foe, [u]);
      return { hit: p.hitBonus - s.hitBonus, crit: p.critBonus - s.critBonus };
    };
    expect(diff(odd)).toEqual({ hit: 4, crit: 1 });
  });

  it('DEF and RES partners raise the defence they name', () => {
    const a = unit('Ana', 'player', { accessory: ring('SPD') });
    const foe = unit('Brigand', 'enemy');
    const def = unit('D', 'player', { accessory: ring('DEF', 'itm_5_dddd') });
    const res = unit('R', 'player', { accessory: ring('RES', 'itm_5_rrrr') });
    const p = mods(a, foe, [a, def, res]);
    const s = mods(a, foe, [a]);
    expect([p.defBonus - s.defBonus, p.resBonus - s.resBonus]).toEqual([2, 2]);
  });

  it('three rings: each wearer gets both partners; two partners of one stat count once', () => {
    const a = unit('Ana', 'player', { accessory: ring('DEF') });
    const b = unit('Bo', 'player', { accessory: ring('SPD', 'itm_6_bbbb') });
    const c = unit('Cy', 'player', { accessory: ring('RES', 'itm_6_cccc') });
    const d = unit('Di', 'player', { accessory: ring('SPD', 'itm_6_dddd') });
    expect(geminiPartnerStats(a, [a, b, c]).map((p) => p.stat)).toEqual(['SPD', 'RES']);
    expect(geminiPartnerStats(b, [a, b, c]).map((p) => p.stat)).toEqual(['DEF', 'RES']);
    expect(geminiPartnerStats(a, [a, b, d])).toEqual([{ stat: 'SPD', bonus: 2 }]);
  });

  it('a partner who falls or is removed takes its half away', () => {
    const a = unit('Ana', 'player', { accessory: ring('DEF') });
    const b = unit('Bo', 'player', { accessory: ring('SPD', 'itm_7_bbbb') });
    expect(geminiPartnerStats(a, [a, b])).toHaveLength(1);
    b.currentHP = 0;
    expect(geminiPartnerStats(a, [a, b])).toEqual([]);
    b.currentHP = 5;
    b._removing = true;
    expect(geminiPartnerStats(a, [a, b])).toEqual([]);
  });

  it('a partner wearing some other accessory gives nothing', () => {
    const a = unit('Ana', 'player', { accessory: ring('DEF') });
    const power = structuredClone(gameData.accessories.find((x) => x.name === 'Power Ring'));
    const b = unit('Bo', 'player', { accessory: power });
    expect(geminiPartnerStats(a, [a, b])).toEqual([]);
  });
});
