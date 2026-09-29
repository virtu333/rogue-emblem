// The recruit join bonus (RecruitScaling.applyRecruitJoinBonus): flat stats a recruit
// gets once, when it is created, from every recruit source. Ways it can go wrong,
// each caught below:
//   - the wrong stats or amounts by act (Act 1 closes the lords' base-stat head start;
//     Acts 2-4 give the Act 3 readiness package);
//   - the attack or guard stat picked wrongly (MAG for casters, lower of DEF/RES);
//   - a lord outside Act 3 gets it, or a promoted lord ever does;
//   - a recruit that joins promoted misses it in Acts 3-4 (the +8 package closes the
//     gap to the lords of its tier), or gets it earlier, or an enemy gets it;
//   - a recruit source skips it (recruit nodes, boss recruits, mercenaries, the
//     Vanguard Cadre);
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
import { buildRecruitNodeUnit } from '../src/engine/RecruitNodeSystem.js';
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

  it.each(['act3', 'act4'])(
    '%s: a recruit joining promoted gets +8 (HP 2, attack 2, SPD, DEF 2, RES)',
    (act) => {
      // RES above DEF: the promoted package is fixed stats, not "the weaker guard".
      const unit = sample('Sword', { tier: 'promoted' });
      unit.stats.RES = 9;
      const before = { ...unit.stats };
      applyRecruitJoinBonus(unit, act);
      expect(diff(unit.stats, before)).toEqual({
        HP: 2,
        STR: 2,
        MAG: 0,
        SKL: 0,
        SPD: 1,
        DEF: 2,
        RES: 1,
        LCK: 0,
      });
      expect(total(unit.stats) - total(before)).toBe(8);
      expect(unit.currentHP).toBe(24);
      expect(serializeUnit({ ...unit, name: 'X', inventory: [] }).stats).toEqual(unit.stats);
    },
  );

  it('a promoted caster gets MAG, not STR', () => {
    const unit = sample('Tome', { tier: 'promoted' });
    applyRecruitJoinBonus(unit, 'act4');
    expect([unit.stats.STR, unit.stats.MAG]).toEqual([8, 15]);
  });

  it('never touches a promoted recruit before Act 3, promoted lords, or non-recruit acts', () => {
    const cases = [
      ['act1', { tier: 'promoted' }],
      ['act2', { tier: 'promoted' }],
      ['finalBoss', { tier: 'promoted' }],
      ['postAct', { tier: 'promoted' }],
      ['act3', { tier: 'promoted', isLord: true }],
      ['act4', { tier: 'promoted', isLord: true }],
      ['act2', { tier: 'promoted', isLord: true }],
      ['act3', { tier: 'boss' }],
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
  function twice(build, seed = 7) {
    const out = [];
    for (const off of [false, true]) {
      joinBonus.off = off;
      vi.spyOn(Math, 'random').mockImplementation(seeded(seed));
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
    if (unit.tier === 'promoted') {
      // The promoted package: DEF 2, RES 1, and 2 to whichever attack stat it uses.
      expect(unit.stats.DEF - plain.stats.DEF).toBe(2);
      expect(unit.stats.RES - plain.stats.RES).toBe(1);
      expect(unit.stats.STR + unit.stats.MAG - plain.stats.STR - plain.stats.MAG).toBe(2);
    }
    expect(total(unit.stats) - total(plain.stats)).toBe(points);
  };

  it.each([
    ['act1', 'act2'],
    ['act2', 'act3'],
    ['act3', 'act4'],
  ])('boss recruits after the %s boss (%s pool): base +6, promoted +8 from Act 3', (act, pool) => {
    const roster = [{ name: 'Edric', isCommander: true, tier: 'promoted', level: 6 }];
    const promotedPool = pool === 'act3' || pool === 'act4';
    const seen = { base: 0, promoted: 0, promotedLords: 0 };
    // A few seeds: some boards recruit base classes, some roll the promotion.
    for (const seed of [7, 8, 9, 10, 11]) {
      const [boosted, plain] = twice(
        () => generateBossRecruitCandidates(act, roster, data, null),
        seed,
      );
      expect(boosted.length).toBe(plain.length);
      for (let i = 0; i < boosted.length; i++) {
        const [a, b] = [boosted[i].unit, plain[i].unit];
        if (boosted[i].isLord) {
          // A base lord gets the package only from the Act 3 pool; a promoted one never.
          if (a.tier === 'promoted') seen.promotedLords++;
          if (a.tier === 'base' && pool === 'act3') expectPackage(a, b, 6);
          else expect(a.stats).toEqual(b.stats);
        } else if (a.tier === 'base') {
          seen.base++;
          expectPackage(a, b, 6);
        } else {
          seen.promoted++;
          if (promotedPool) expectPackage(a, b, 8);
          else expect(a.stats).toEqual(b.stats);
        }
      }
    }
    // The Act 3 and 4 pools recruit promoted classes; the checks above must have run.
    if (promotedPool) {
      expect(seen.promoted).toBeGreaterThan(0);
      expect(seen.promotedLords).toBeGreaterThan(0);
    }
    expect(seen.base + seen.promoted).toBeGreaterThan(0);
  });

  // Act 3 boards draw only promoted classes; Act 2 boards reach them through
  // crossActPoolAccess and must not get the Act 3+ promoted package.
  it.each([
    ['act1', 8, 8],
    ['act2', 6, 0],
    ['act3', 6, 8],
    ['act4', 6, 8],
  ])('Colosseum mercenaries in %s: base +%i, promoted +%i', (act, basePoints, promotedPoints) => {
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
    const seen = { base: 0, promoted: 0 };
    for (let i = 0; i < boosted.length; i++) {
      const [a, b] = [boosted[i].unit, plain[i].unit];
      seen[a.tier]++;
      const points = a.tier === 'base' ? basePoints : promotedPoints;
      if (points === 0) expect(a.stats).toEqual(b.stats);
      else expectPackage(a, b, points);
    }
    if (act === 'act3' || act === 'act4') expect(seen.promoted).toBeGreaterThan(0);
    else expect(seen.base).toBeGreaterThan(0);
  });

  // Recruit nodes: a promoted preview class that keeps its promotion (a low roll),
  // built with and without the bonus on the same scripted draws.
  const nodeRoster = [
    {
      name: 'Edric',
      className: 'Lord',
      isLord: true,
      isCommander: true,
      level: 5,
      tier: 'promoted',
    },
  ];
  const scripted = (seq, rest) => {
    let i = 0;
    return () => (i < seq.length ? seq[i++] : rest);
  };
  const buildNode = (act, seq, rest) =>
    twice(() =>
      buildRecruitNodeUnit({
        preview: { className: 'Hero', name: 'Test Recruit' },
        nodeId: `${act}_3_2`,
        runSeed: 12345,
        act,
        roster: nodeRoster,
        gameData: data,
        rng: scripted(seq, rest),
      }),
    );

  it.each([
    ['act2', 0],
    ['act3', 8],
    ['act4', 8],
  ])('a recruit-node recruit joining promoted in %s gets +%i', (act, points) => {
    const [boosted, plain] = buildNode(act, [0.99, 0.99, 0.99, 0.1], 0.1);
    expect(boosted.isLord).toBe(false);
    expect(boosted.unit.tier).toBe('promoted');
    expect(boosted.unit.className).toBe('Hero');
    if (points === 0) expect(boosted.unit.stats).toEqual(plain.unit.stats);
    else expectPackage(boosted.unit, plain.unit, points);
  });

  it('a recruit-node recruit that fails its promotion roll still gets the base package', () => {
    const [boosted, plain] = buildNode('act3', [0.99, 0.99, 0.99, 0.99], 0.99);
    expect(boosted.unit.tier).toBe('base');
    expectPackage(boosted.unit, plain.unit, 6);
  });

  it('a recruit-node lord promoted in Acts 3-4 gets nothing', () => {
    for (const act of ['act3', 'act4']) {
      const [boosted, plain] = buildNode(act, [0, 0, 0], 0);
      expect(boosted.isLord).toBe(true);
      expect(boosted.unit.tier).toBe('promoted');
      expect(boosted.unit.stats).toEqual(plain.unit.stats);
    }
  });

  it('never gives an enemy the bonus, promoted or not', () => {
    for (const tier of ['base', 'promoted']) {
      const unit = sample('Sword', { tier, faction: 'enemy' });
      const before = structuredClone(unit);
      applyRecruitJoinBonus(unit, 'act3');
      expect(unit).toEqual(before);
    }
  });

  it('gives a promoted Vanguard Cadre recruit +8 from Act 3 and nothing before', () => {
    const paladin = (act) =>
      twice(() => {
        const run = new RunManager(data, { extraStartingUnitTier: 4 });
        run.actIndex = ['act1', 'act2', 'act3', 'act4'].indexOf(act);
        return run._createExtraStartingUnit('Paladin');
      });
    for (const act of ['act3', 'act4']) {
      const [a, b] = paladin(act);
      expect(a.tier).toBe('promoted');
      expectPackage(a, b, 8);
    }
    const [a, b] = paladin('act2');
    expect(a.tier).toBe('promoted');
    expect(a.stats).toEqual(b.stats);
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
