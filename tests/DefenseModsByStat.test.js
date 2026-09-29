// Combat-mod defence follows the stat the strike is computed on. Physical damage is
// STR + Mt − DEF and magical damage is MAG + Mt − RES (CLAUDE.md, GDD 3.3), so a +DEF
// mod (Warded, Guard, Phalanx Band, Stalwart, a Knight's mastery…) must not cut a
// tome's damage, and a +RES mod must not cut a sword's. Before this fix `defBonus`
// was subtracted from every hit and `resBonus` again from magic, so Warded's +2/+2
// took 4 off every spell (playtest 2026-09-29 #17; flagged in docs/specs/traits-v2.md).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCombatForecast, resolveCombat } from '../src/engine/Combat.js';
import { applyImbue, getImbueById } from '../src/engine/ImbueSystem.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const plain = { name: 'Plain', avoidBonus: 0, defBonus: 0 };

afterEach(() => vi.restoreAllMocks());

const weapon = (extra) => ({ hit: 100, crit: 0, weight: 0, range: '1', might: 5, ...extra });
const SWORD = weapon({ name: 'Iron Sword', type: 'Sword' });
const FIRE = weapon({ name: 'Fire', type: 'Tome', range: '1-2' });
const MAGIC_SWORD = weapon({ name: 'Levin Blade', type: 'Sword', special: 'Magic sword' });

// STR 10 / MAG 10 against DEF 5 / RES 3: a sword hits 10 + 5 − 5 = 10, a tome 10 + 5 − 3 = 12.
function unit(extra = {}) {
  return {
    name: 'Unit',
    faction: 'player',
    className: 'Myrmidon',
    stats: { HP: 60, STR: 10, MAG: 10, SKL: 0, SPD: 5, DEF: 5, RES: 3, LCK: 0, MOV: 5 },
    currentHP: 60,
    skills: [],
    proficiencies: [
      { type: 'Sword', rank: 'Prof' },
      { type: 'Tome', rank: 'Prof' },
    ],
    ...extra,
  };
}
const mods = (extra = {}) => ({
  hitBonus: 0,
  avoidBonus: 0,
  critBonus: 0,
  atkBonus: 0,
  defBonus: 0,
  resBonus: 0,
  activated: [],
  ...extra,
});

/** Per-hit damage of the attacker's strike, from the forecast and from resolution. */
function attackerHit(atkWeapon, defenderMods, { atkMods = mods(), defWeapon = null } = {}) {
  const args = [
    unit({ name: 'A' }),
    atkWeapon,
    unit({ name: 'D', faction: 'enemy' }),
    defWeapon,
    1,
    plain,
    plain,
    { atkMods, defMods: defenderMods },
  ];
  const forecast = getCombatForecast(...args).attacker.damage;
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const strike = resolveCombat(...args).events.find(
    (e) => e.type === 'strike' && e.attackerSide === 'attacker',
  );
  vi.restoreAllMocks();
  return { forecast, resolved: strike.damage };
}

describe('a +DEF mod guards against DEF strikes only; a +RES mod against RES strikes', () => {
  it('against a sword: DEF +3 takes 3 off, RES +3 nothing', () => {
    expect(attackerHit(SWORD, mods())).toEqual({ forecast: 10, resolved: 10 });
    expect(attackerHit(SWORD, mods({ defBonus: 3 }))).toEqual({ forecast: 7, resolved: 7 });
    expect(attackerHit(SWORD, mods({ resBonus: 3 }))).toEqual({ forecast: 10, resolved: 10 });
  });

  it('against a tome: RES +3 takes 3 off, DEF +3 nothing, both together 3', () => {
    expect(attackerHit(FIRE, mods())).toEqual({ forecast: 12, resolved: 12 });
    expect(attackerHit(FIRE, mods({ defBonus: 3 }))).toEqual({ forecast: 12, resolved: 12 });
    expect(attackerHit(FIRE, mods({ resBonus: 3 }))).toEqual({ forecast: 9, resolved: 9 });
    expect(attackerHit(FIRE, mods({ defBonus: 3, resBonus: 3 }))).toEqual({
      forecast: 9,
      resolved: 9,
    });
  });

  it('a magic sword is a RES strike', () => {
    expect(attackerHit(MAGIC_SWORD, mods({ defBonus: 3 }))).toEqual({ forecast: 12, resolved: 12 });
    expect(attackerHit(MAGIC_SWORD, mods({ resBonus: 3 }))).toEqual({ forecast: 9, resolved: 9 });
  });

  it('an art that targets RES (Witchcut) meets RES bonuses, not DEF ones', () => {
    // Sword on RES: 10 + 5 − 3 = 12.
    const hexblade = mods({ targetsRES: true });
    expect(attackerHit(SWORD, mods({ defBonus: 3 }), { atkMods: hexblade })).toEqual({
      forecast: 12,
      resolved: 12,
    });
    expect(attackerHit(SWORD, mods({ resBonus: 3 }), { atkMods: hexblade })).toEqual({
      forecast: 9,
      resolved: 9,
    });
  });

  it('the counter follows the same rule (the attacker’s DEF buff vs a tome counter)', () => {
    const args = [
      unit({ name: 'A' }),
      SWORD,
      unit({ name: 'D', faction: 'enemy' }),
      FIRE,
      1,
      plain,
      plain,
      { atkMods: mods({ defBonus: 3 }), defMods: mods() },
    ];
    expect(getCombatForecast(...args).defender.damage).toBe(12);
    args[7] = { atkMods: mods({ resBonus: 3 }), defMods: mods() };
    expect(getCombatForecast(...args).defender.damage).toBe(9);
  });

  it('a weapon’s "+N DEF when equipped" does not cut a RES-targeting art either', () => {
    // A bow: outside the weapon triangle, so the sword's damage has no triangle step.
    const bulwark = weapon({
      name: 'Bulwark Bow',
      type: 'Bow',
      range: '2',
      special: '+5 DEF when equipped',
    });
    const hexblade = mods({ targetsRES: true });
    expect(attackerHit(SWORD, mods(), { atkMods: hexblade, defWeapon: bulwark }).forecast).toBe(12);
    // …while a plain sword strike still meets it: 10 + 5 − 5 − 5 = 5.
    expect(attackerHit(SWORD, mods(), { defWeapon: bulwark }).forecast).toBe(5);
  });
});

describe('Warded (+1 DEF, +2 RES) by the stat it meets', () => {
  const warded = () => {
    const w = structuredClone(SWORD);
    applyImbue(w, getImbueById(gameData.imbues, 'warded'));
    return w;
  };
  const hitOnWarded = (atkWeapon) => {
    const args = [
      unit({ name: 'A' }),
      atkWeapon,
      unit({ name: 'D', faction: 'enemy' }),
      warded(),
      1,
      plain,
      plain,
      { atkMods: mods(), defMods: mods(), imbuesData: gameData.imbues },
    ];
    return getCombatForecast(...args).attacker.damage;
  };
  it('a sword loses 1 (DEF), a tome loses 2 (RES), not 3', () => {
    expect(hitOnWarded(SWORD)).toBe(10 - 1);
    expect(hitOnWarded(FIRE)).toBe(12 - 2);
  });
});
