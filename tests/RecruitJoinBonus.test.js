// The recruit join bonus (RecruitScaling.applyRecruitJoinBonus): flat stats a recruit
// gets once, when it is created, from every recruit source. Ways it can go wrong,
// each caught below:
//   - the wrong stats or amounts by act (Act 1 closes the lords' base-stat head start;
//     Acts 2-4 give the Act 3 readiness package);
//   - the attack or guard stat picked wrongly (MAG for casters, lower of DEF/RES);
//   - a promoted recruit, or a lord outside Act 3, gets it;
//   - a recruit source skips it (boss recruits, mercenaries, the Vanguard Cadre);
//   - it is lost on promotion or save.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyRecruitJoinBonus } from '../src/engine/RecruitScaling.js';

// Lets a test build the same recruit with the join bonus switched off.
const joinBonus = vi.hoisted(() => ({ off: false }));
vi.mock('../src/engine/RecruitScaling.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    applyRecruitJoinBonus: (...args) =>
      joinBonus.off ? undefined : actual.applyRecruitJoinBonus(...args),
  };
});
import {
  createBossLordUnit,
  generateBossRecruitCandidates,
} from '../src/engine/BossRecruitSystem.js';
import { generateMercenaryCandidates } from '../src/engine/ColosseumEngine.js';
import { createLordUnit, promoteUnit } from '../src/engine/UnitManager.js';
import { RunManager, serializeUnit } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const kira = data.lords.find((l) => l.name === 'Kira');
const tactician = data.classes.find((c) => c.name === kira.class);
const STATS = ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK'];
const total = (stats) => STATS.reduce((sum, s) => sum + (stats[s] || 0), 0);
afterEach(() => vi.restoreAllMocks());

function sample(type = 'Tome', extra = {}) {
  return {
    tier: 'base',
    stats: { HP: 22, STR: 8, MAG: 13, SKL: 9, SPD: 13, DEF: 6, RES: 5, LCK: 4 },
    currentHP: 22,
    proficiencies: [{ type }],
    ...extra,
  };
}
const diff = (after, before) => Object.fromEntries(STATS.map((s) => [s, after[s] - before[s]]));

describe('recruit join bonus', () => {
  it('Act 3: the agreed readiness package, serialized as ordinary stats', () => {
    const unit = sample();
    applyRecruitJoinBonus(unit, 'act3');
    expect(unit.stats).toEqual({
      HP: 24,
      STR: 8,
      MAG: 15,
      SKL: 9,
      SPD: 14,
      DEF: 6,
      RES: 6,
      LCK: 4,
    });
    expect(unit.currentHP).toBe(24);
    expect(serializeUnit({ ...unit, name: 'X', inventory: [] }).stats).toEqual(unit.stats);
  });

  it('Act 1: +8, one point where the lords lead (HP 2, attack 2, SKL, SPD, DEF, RES)', () => {
    const unit = sample('Axe');
    const before = { ...unit.stats };
    applyRecruitJoinBonus(unit, 'act1');
    expect(diff(unit.stats, before)).toEqual({
      HP: 2,
      STR: 2,
      MAG: 0,
      SKL: 1,
      SPD: 1,
      DEF: 1,
      RES: 1,
      LCK: 0,
    });
    expect(total(unit.stats) - total(before)).toBe(8);
    expect(unit.currentHP).toBe(24);
  });

  it.each(['act2', 'act4'])('%s: the same +6 package as Act 3', (act) => {
    const unit = sample('Sword');
    const before = { ...unit.stats };
    applyRecruitJoinBonus(unit, act);
    // RES 5 < DEF 6: the weaker guard gets the point.
    expect(diff(unit.stats, before)).toEqual({
      HP: 2,
      STR: 2,
      MAG: 0,
      SKL: 0,
      SPD: 1,
      DEF: 0,
      RES: 1,
      LCK: 0,
    });
  });

  it.each(['Sword', 'Lance', 'Axe', 'Bow'])('boosts STR for %s and DEF on a tie', (type) => {
    const unit = sample(type);
    unit.stats.RES = 6;
    applyRecruitJoinBonus(unit, 'act3');
    expect(unit.stats.STR).toBe(10);
    expect(unit.stats.MAG).toBe(13);
    expect(unit.stats.DEF).toBe(7);
  });

  it.each(['Light', 'Staff'])('boosts MAG for %s', (type) => {
    const unit = sample(type);
    applyRecruitJoinBonus(unit, 'act3');
    expect(unit.stats.MAG).toBe(15);
  });

  it('never touches promoted recruits, other acts, or lords outside Act 3', () => {
    const cases = [
      ['act1', { tier: 'promoted' }],
      ['act3', { tier: 'promoted' }],
      ['act4', { tier: 'promoted' }],
      ['finalBoss', {}],
      ['postAct', {}],
      ['act1', { isLord: true }],
      ['act2', { isLord: true }],
      ['act4', { isLord: true }],
    ];
    for (const [act, extra] of cases) {
      const unit = sample('Tome', extra);
      const before = structuredClone(unit);
      applyRecruitJoinBonus(unit, act);
      expect(unit, `${act} ${JSON.stringify(extra)}`).toEqual(before);
    }
    // A lord recruited unpromoted in Act 3 keeps the package it always had.
    const lord = sample('Tome', { isLord: true });
    applyRecruitJoinBonus(lord, 'act3');
    expect(lord.stats.HP).toBe(24);
  });

  it.each([
    ['act1', 1, 'Iron'],
    ['act2', 1, 'Steel'],
    ['act3', 8, 'Silver'],
    ['act4', 8, 'Silver'],
    ['act1', 13, 'Silver'],
  ])('equips recruited Kira in %s at level %i with %s', (act, level, tier) => {
    const unit = createBossLordUnit(kira, tactician, data.weapons, level, null, { act });
    expect(unit.weapon.tier).toBe(tier);
    expect(unit.weapon.type).toBe('Tome');
    expect(unit.inventory).toContain(unit.weapon);
    expect(unit.weapon).not.toBe(data.weapons.find((w) => w.name === unit.weapon.name));
  });

  it('keeps starting lord equipment unchanged', () => {
    expect(createLordUnit(kira, tactician, data.weapons).weapon.tier).toBe('Iron');
  });

  it('retains the bonus through promotion', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const plain = createBossLordUnit(kira, tactician, data.weapons, 13, null);
    const boosted = structuredClone(plain);
    applyRecruitJoinBonus(boosted, 'act3');
    const before = diff(boosted.stats, plain.stats);
    const cls = data.classes.find((c) => c.name === kira.promotedClass);
    for (const unit of [plain, boosted]) promoteUnit(unit, cls, kira.promotionBonuses, data.skills);
    expect(diff(boosted.stats, plain.stats)).toEqual(before);
  });

  // Boss recruits and mercenaries: the same draws built twice, once with the bonus
  // switched off (the mock above), must differ by exactly the act's package.
  function seeded(seed) {
    let x = seed;
    return () => {
      x = (x * 16807) % 2147483647;
      return x / 2147483647;
    };
  }
  function twice(build) {
    const out = [];
    for (const off of [false, true]) {
      joinBonus.off = off;
      vi.spyOn(Math, 'random').mockImplementation(seeded(7));
      out.push(build());
      vi.restoreAllMocks();
    }
    joinBonus.off = false;
    return out;
  }
  const expectPackage = (unit, plain, points) => {
    expect(unit.className).toBe(plain.className);
    expect(unit.stats.HP - plain.stats.HP).toBe(2);
    expect(unit.stats.SPD - plain.stats.SPD).toBe(1);
    expect(total(unit.stats) - total(plain.stats)).toBe(points);
  };

  it.each([
    ['act1', 'act2', 6],
    ['act2', 'act3', 6],
    ['act3', 'act4', 6],
  ])('boss recruits after the %s boss (%s pool) get +%i when base', (act, pool, points) => {
    const roster = [{ name: 'Edric', isCommander: true, tier: 'promoted', level: 6 }];
    const [boosted, plain] = twice(() => generateBossRecruitCandidates(act, roster, data, null));
    let base = 0;
    for (let i = 0; i < boosted.length; i++) {
      const [a, b] = [boosted[i].unit, plain[i].unit];
      // A base lord gets the package only from the Act 3 pool.
      if (a.tier !== 'base' || (boosted[i].isLord && pool !== 'act3')) {
        expect(a.stats).toEqual(b.stats);
        continue;
      }
      base++;
      expectPackage(a, b, points);
    }
    expect(base).toBeGreaterThan(0);
  });

  // Act 3 boards draw only promoted classes (the Act 3 and Act 4 pools): no bonus.
  it.each([
    ['act1', 8, true],
    ['act2', 6, true],
    ['act3', 6, false],
  ])('Colosseum mercenaries in %s get +%i when base, promoted ones none', (act, points, any) => {
    const board = () =>
      generateMercenaryCandidates(
        act,
        8,
        data.recruits,
        data.classes,
        data.weapons,
        data.skills,
        'normal',
        data.colosseum,
        seeded(11),
        null,
        [],
      );
    const [boosted, plain] = twice(board);
    expect(boosted.length).toBe(plain.length);
    let base = 0;
    for (let i = 0; i < boosted.length; i++) {
      const [a, b] = [boosted[i].unit, plain[i].unit];
      if (a.tier !== 'base') {
        expect(a.stats).toEqual(b.stats);
        continue;
      }
      base++;
      expectPackage(a, b, points);
    }
    expect(base > 0).toBe(any);
  });

  it('gives the Vanguard Cadre the Act 1 package', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const run = new RunManager(data, { extraStartingUnitTier: 1 });
    const unit = run._createExtraStartingUnit('Fighter');
    const fighter = data.classes.find((c) => c.name === 'Fighter');
    // Level 1, no meta stat bonuses: base stats plus exactly the Act 1 package.
    expect(unit.level).toBe(1);
    expect(unit.stats.HP).toBe(fighter.baseStats.HP + 2);
    expect(unit.stats.STR).toBe(fighter.baseStats.STR + 2);
    expect(unit.stats.SKL).toBe(fighter.baseStats.SKL + 1);
    expect(unit.stats.SPD).toBe(fighter.baseStats.SPD + 1);
    expect(unit.stats.DEF).toBe(fighter.baseStats.DEF + 1);
    expect(unit.stats.RES).toBe(fighter.baseStats.RES + 1);
    expect(unit.currentHP).toBe(unit.stats.HP);
  });
});
