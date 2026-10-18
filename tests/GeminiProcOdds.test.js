// A Gemini partner's SKL or SPD counts in the wearer's skill proc odds, as the wearer's own stat
// would (the outside review of PR #440): on-attack procs, on-defend procs, a counter's procs and
// Astra all read the side's `procStatBonus` (SkillSystem.getSkillCombatMods → Combat.js).
//
// Odds worked by hand (getActivationChance: SKL and SPD skills at the stat, SKL_HALF at half):
//   Luna, Pavise (SKL) at SKL 19: 19% alone, 21% with a SKL partner.
//   Adept (SPD) at SPD 19: 19% alone, 21% with a SPD partner.
//   Astra (SKL_HALF) at SKL 41: floor(41 / 2) = 20% alone, floor(43 / 2) = 21% paired.
// The battle RNG is pinned at 0.2 (a roll of 20): each proc fires paired and not alone.
// Hit is sure at any roll (Iron Sword 95 + SKL x 2 against Avoid 0); the foe's LCK 40 leaves no
// crit (floor(SKL / 2) - 40 is below 0).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameData } from './testData.js';
import { resolveCombat } from '../src/engine/Combat.js';
import {
  checkAstra,
  getActivationChance,
  getSkillCombatMods,
  rollDefenseSkills,
  rollStrikeSkills,
} from '../src/engine/SkillSystem.js';

const data = loadGameData();
const catalogRing = data.accessories.find((a) => a.name === 'Gemini Ring');
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));
const ring = (stat, uid) => ({ ...structuredClone(catalogRing), uid, geminiStat: stat });

const unit = (name, stats, extra = {}) => ({
  name,
  faction: 'player',
  col: 0,
  row: 0,
  level: 10,
  currentHP: 200,
  stats: { HP: 200, STR: 10, MAG: 0, SKL: 0, SPD: 0, DEF: 0, RES: 0, LCK: 0, MOV: 5, ...stats },
  weaponRank: 'Prof',
  moveType: 'Infantry',
  skills: [],
  ...extra,
});

const armed = (u) => {
  u.weapon = weapon('Iron Sword');
  u.inventory = [u.weapon];
  return u;
};
// The wearer's own ring is a DEF one, so nothing here comes from its own stat.
const hero = (skills, stats) =>
  armed(unit('Hero', stats, { skills, accessory: ring('DEF', 'itm_1_hero') }));
const partner = (stat) => unit('Twin', {}, { accessory: ring(stat, 'itm_2_twin') });
const foe = (stats = {}) => unit('Foe', { DEF: 0, LCK: 40, ...stats }, { faction: 'enemy' });

const mods = (u, opponent, allies) =>
  getSkillCombatMods(u, opponent, allies, [opponent], data.skills, null, true, null, null);

function fight(attacker, defender, atkAllies, defAllies) {
  const ctx = {
    atkMods: mods(attacker, defender, atkAllies),
    defMods: mods(defender, attacker, defAllies),
    rollStrikeSkills,
    rollDefenseSkills,
    checkAstra,
    skillsData: data.skills,
  };
  vi.spyOn(Math, 'random').mockReturnValue(0.2);
  return resolveCombat(attacker, attacker.weapon, defender, defender.weapon || null, 1, null, null, ctx); // prettier-ignore
}

const procs = (result) =>
  result.events.flatMap((e) => [
    ...(e.skillActivations || []).map((a) => a.id),
    ...(e.type === 'skill' ? [e.name] : []),
  ]);

afterEach(() => vi.restoreAllMocks());

describe('getActivationChance with a stat bonus', () => {
  it('adds the bonus to the stat before the activation reads it', () => {
    const u = unit('U', { SKL: 7, SPD: 9 });
    expect(getActivationChance(u, 'SKL_HALF', 1, { SKL: 2 })).toBe(4); // floor(9 / 2)
    expect(getActivationChance(u, 'SKL', 1, { SKL: 2 })).toBe(9);
    expect(getActivationChance(u, 'SPD', 1, { SKL: 2 })).toBe(9); // only the stat it names
    expect(getActivationChance(u, 'SPD', 1, { SPD: 2 })).toBe(11);
    expect(getActivationChance(u, 'always', 1, { SKL: 2 })).toBe(100);
    // Before Gambler's Edge's scaling: (7 + 2) x 1.5 = 13.
    expect(getActivationChance(u, 'SKL', 1.5, { SKL: 2 })).toBe(13);
  });
});

describe('the side view carries only what a proc reads', () => {
  it('a SKL or SPD partner names its stat; a DEF partner names none', () => {
    const h = hero([], { SKL: 19 });
    expect(mods(h, foe(), [h, partner('SKL')]).procStatBonus).toEqual({ SKL: 2 });
    expect(mods(h, foe(), [h, partner('SPD')]).procStatBonus).toEqual({ SPD: 2 });
    expect(mods(h, foe(), [h, partner('DEF')]).procStatBonus).toBeUndefined();
    expect(mods(h, foe(), [h]).procStatBonus).toBeUndefined();
  });
});

describe("a partner's stat in the wearer's procs", () => {
  it('Luna on attack: 19% alone does not fire on a roll of 20, 21% paired does', () => {
    const run = (allies) => {
      const h = hero(['luna'], { SKL: 19 });
      return procs(fight(h, foe(), allies(h), null));
    };
    expect(run((h) => [h])).not.toContain('luna');
    expect(run((h) => [h, partner('SKL')])).toContain('luna');
  });

  it('Adept reads a SPD partner', () => {
    const run = (allies) => {
      const h = hero(['adept'], { SPD: 19, SKL: 10 });
      return procs(fight(h, foe(), allies(h), null));
    };
    expect(run((h) => [h])).not.toContain('adept');
    expect(run((h) => [h, partner('SPD')])).toContain('adept');
  });

  it('Astra: floor(41 / 2) = 20 alone, floor(43 / 2) = 21 paired', () => {
    const run = (allies) => {
      const h = hero(['astra'], { SKL: 41 });
      return procs(fight(h, foe(), allies(h), null));
    };
    expect(run((h) => [h])).not.toContain('Astra');
    expect(run((h) => [h, partner('SKL')])).toContain('Astra');
  });

  it('Pavise when the wearer is struck reads its own side, not the attacker', () => {
    const run = (allies) => {
      const h = hero(['pavise'], { SKL: 19, LCK: 40 });
      h.weapon = null; // no counter: only the defence is rolled
      h.inventory = [];
      const attacker = armed(foe({ STR: 20 }));
      return procs(fight(attacker, h, [attacker], allies(h)));
    };
    expect(run((h) => [h])).not.toContain('pavise');
    expect(run((h) => [h, partner('SKL')])).toContain('pavise');
  });

  it("a counter's Luna reads the defending wearer's partner", () => {
    const run = (allies) => {
      const h = hero(['luna'], { SKL: 19, LCK: 40 });
      const attacker = armed(foe({ STR: 20 }));
      return fight(attacker, h, [attacker], allies(h))
        .events.filter((e) => e.type === 'strike' && e.attackerSide === 'defender')
        .flatMap((e) => (e.skillActivations || []).map((a) => a.id));
    };
    expect(run((h) => [h])).not.toContain('luna');
    expect(run((h) => [h, partner('SKL')])).toContain('luna');
  });

  it('the foe never gains from the wearer’s partner', () => {
    // The foe attacks with Luna at SKL 19 into the paired wearer: still 19%, no proc.
    const h = hero([], { LCK: 40 });
    const attacker = armed(foe({ STR: 20, SKL: 19 }));
    attacker.skills = ['luna'];
    const result = fight(attacker, h, [attacker], [h, partner('SKL')]);
    const foeProcs = result.events
      .filter((e) => e.type === 'strike' && e.attackerSide === 'attacker')
      .flatMap((e) => (e.skillActivations || []).map((a) => a.id));
    expect(foeProcs).not.toContain('luna');
  });
});
