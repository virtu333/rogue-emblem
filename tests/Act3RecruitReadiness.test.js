import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAct3RecruitBonus } from '../src/engine/RecruitScaling.js';
import {
  createBossLordUnit,
  generateBossRecruitCandidates,
} from '../src/engine/BossRecruitSystem.js';
import { createLordUnit, promoteUnit } from '../src/engine/UnitManager.js';
import { serializeUnit } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const kira = data.lords.find((l) => l.name === 'Kira');
const tactician = data.classes.find((c) => c.name === kira.class);
afterEach(() => vi.restoreAllMocks());

function sample(type = 'Tome') {
  return {
    tier: 'base',
    stats: { HP: 22, STR: 8, MAG: 13, SPD: 13, DEF: 6, RES: 5 },
    currentHP: 22,
    proficiencies: [{ type }],
  };
}

describe('Act 3 recruit readiness', () => {
  it('gives the agreed Kira package and serializes it as ordinary stats', () => {
    const unit = sample();
    applyAct3RecruitBonus(unit, 'act3');
    expect(unit.stats).toEqual({ HP: 24, STR: 8, MAG: 15, SPD: 14, DEF: 6, RES: 6 });
    expect(unit.currentHP).toBe(24);
    expect(serializeUnit(unit).stats).toEqual(unit.stats);
  });

  it.each(['Sword', 'Lance', 'Axe', 'Bow'])(
    'boosts physical offense for %s and DEF on a tie',
    (type) => {
      const unit = sample(type);
      unit.stats.RES = 6;
      applyAct3RecruitBonus(unit, 'act3');
      expect(unit.stats.STR).toBe(10);
      expect(unit.stats.MAG).toBe(13);
      expect(unit.stats.DEF).toBe(7);
    },
  );

  it.each(['Light', 'Staff'])('boosts MAG for %s', (type) => {
    const unit = sample(type);
    applyAct3RecruitBonus(unit, 'act3');
    expect(unit.stats.MAG).toBe(15);
  });

  it('leaves other acts and already-promoted recruits unchanged', () => {
    for (const [act, tier] of [
      ['act1', 'base'],
      ['act2', 'base'],
      ['act4', 'base'],
      ['act3', 'promoted'],
    ]) {
      const unit = { ...sample(), tier };
      const before = structuredClone(unit);
      applyAct3RecruitBonus(unit, act);
      expect(unit).toEqual(before);
    }
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
    applyAct3RecruitBonus(boosted, 'act3');
    const before = Object.fromEntries(
      Object.keys(plain.stats).map((s) => [s, boosted.stats[s] - plain.stats[s]]),
    );
    const cls = data.classes.find((c) => c.name === kira.promotedClass);
    for (const unit of [plain, boosted]) promoteUnit(unit, cls, kira.promotionBonuses, data.skills);
    for (const stat of Object.keys(before))
      expect(boosted.stats[stat] - plain.stats[stat]).toBe(before[stat]);
  });

  it('applies the package to unpromoted post-act-2 boss candidates entering act 3', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const roster = [{ name: 'Edric', tier: 'promoted', level: 6 }];
    const candidates = generateBossRecruitCandidates('act2', roster, data, null);
    // Same pool and rolls, but classified as act 4: no Act 3 bonus.
    const comparisonData = structuredClone(data);
    comparisonData.recruits.act4 = structuredClone(data.recruits.act3);
    const baseline = generateBossRecruitCandidates('act3', roster, comparisonData, null);
    expect(candidates.length).toBeGreaterThan(0);
    for (let i = 0; i < candidates.length; i++) {
      const a = candidates[i].unit;
      const b = baseline[i].unit;
      expect(a.tier).toBe('base');
      expect(a.className).toBe(b.className);
      expect(a.stats.HP - b.stats.HP).toBe(2);
      expect(a.stats.SPD - b.stats.SPD).toBe(1);
    }
  });
});
