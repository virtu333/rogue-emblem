// The Unbroken Banner's price (docs/specs/blessings-v3.md §6, "6.4 As built"): the unit the
// banner held carries a Lingering Injury (the `wounded` burden) from that battle's victory on.
// The hold stamps the battle unit (`_bannerHeld`, UnitHealth.absorbLethal); the victory commit
// (RunManager.completeBattle) reads the stamp, takes the injury and drops the stamp.
//
// Realistic failures each test catches are named in it. Expected numbers come from the data
// (events.json `burdens.wounded`: -2, 3 battles, 2 on First Light), never from the code under test.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunManager, serializeUnit } from '../src/engine/RunManager.js';
import { absorbLethal } from '../src/engine/UnitHealth.js';
import { BANNER, createBattleBlessings } from '../src/engine/BattleBlessings.js';
import { serializeBattleUnit } from '../src/engine/BattleUnitState.js';
import { WOUND_STATS, settlementLines } from '../src/engine/Burdens.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const woundDef = data.events.burdens.wounded;

afterEach(() => vi.restoreAllMocks());

function bannerRun({ seed = 11, difficultyId = 'dusk' } = {}) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, difficultyId, autoSelectBlessing: false });
  rm.chooseBlessing(null);
  expect(rm.addBlessingMidRun('unbroken_banner', { earned: true, source: 'act_boss' })).toBe(true);
  return rm;
}

const firstBattle = (rm) => rm.getAvailableNodes().find((n) => n.type === 'battle');

/** The roster as battle units, the second one held by the banner (as absorbLethal leaves it). */
function survivorsWithHold(rm, heldIndex = 1) {
  const units = rm.getRoster().map((u) => structuredClone(u));
  const blessings = createBattleBlessings(rm.getBattleBlessingEffects());
  const held = units[heldIndex];
  expect(absorbLethal(held, -5, { blessings })).toMatchObject({ hp: 1, bannerHeld: true });
  held.currentHP = 1;
  return { units, held };
}

describe('the hold stamps the unit it holds', () => {
  it('stamps only when the banner holds', () => {
    // Failure: no stamp (the price is never paid), or a stamp on a blow the banner did not take.
    const blessings = createBattleBlessings({ lastStand: 1 });
    const a = { name: 'A', faction: 'player', currentHP: 3, stats: { HP: 20 } };
    const b = { name: 'B', faction: 'player', currentHP: 3, stats: { HP: 20 } };
    expect(absorbLethal(a, 2, { blessings }).hp).toBe(2);
    expect(a._bannerHeld).toBeUndefined();
    absorbLethal(a, -1, { blessings });
    expect(a._bannerHeld).toBe(true);
    expect(blessings.spent).toEqual([BANNER]);
    // Spent: the next lethal blow falls through, unstamped.
    expect(absorbLethal(b, -1, { blessings }).hp).toBe(-1);
    expect(b._bannerHeld).toBeUndefined();
    // No blessings held: nothing holds, nothing stamped.
    const c = { name: 'C', faction: 'player', currentHP: 3, stats: { HP: 20 } };
    absorbLethal(c, -1, { blessings: null });
    expect(c._bannerHeld).toBeUndefined();
  });

  it('the stamp rides a battle snapshot but never a run save', () => {
    // Failure: a suspend or rewind loses the stamp (the price skipped by reloading), or the
    // roster keeps it and a later battle's victory injures the unit again.
    const unit = {
      name: 'A',
      faction: 'player',
      currentHP: 1,
      stats: { HP: 20 },
      _bannerHeld: true,
    };
    expect(serializeBattleUnit(unit)._bannerHeld).toBe(true);
    expect(serializeUnit(unit)).not.toHaveProperty('_bannerHeld');
  });
});

describe('the victory commit takes the injury', () => {
  it('the held survivor carries a Lingering Injury at the rung’s numbers', () => {
    // Failure: no burden, the wrong unit, a stat outside the list, or numbers not the catalog's.
    for (const difficultyId of ['normal', 'dusk']) {
      const rm = bannerRun({ difficultyId });
      const node = firstBattle(rm);
      const { units, held } = survivorsWithHold(rm);
      expect(rm.completeBattle(units, node.id, 0, { turnCount: 3, turnPar: 9 })).toBe(true);
      const battles = woundDef.onRung?.[difficultyId]?.battles ?? woundDef.battles;
      expect(rm.burdens).toHaveLength(1);
      const [wound] = rm.burdens;
      expect(wound).toMatchObject({
        id: 'wounded',
        unitUid: held.unitUid,
        unitName: held.name,
        value: woundDef.value,
        battles,
      });
      expect(WOUND_STATS).toContain(wound.stat);
      // The band names it; the roster keeps no stamp.
      expect(rm.lastBurdenSettlement.bannerWound).toEqual({
        name: held.name,
        stat: wound.stat,
        value: woundDef.value,
        battles,
      });
      expect(settlementLines(rm.lastBurdenSettlement)).toContain(
        `${held.name}: Lingering Injury ${woundDef.value} ${wound.stat}`,
      );
      expect(rm.roster.some((u) => '_bannerHeld' in u)).toBe(false);
      // The save keeps it.
      const back = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
      expect(back.burdens).toEqual(rm.burdens);
    }
  });

  it('the stat is keyed to the run and the node, never Math.random', () => {
    // Failure: a reload or a replay of the same victory injures a different stat.
    const random = vi.spyOn(Math, 'random');
    const stats = [];
    for (let i = 0; i < 2; i++) {
      const rm = bannerRun({ seed: 23 });
      const node = firstBattle(rm);
      random.mockClear();
      rm.completeBattle(survivorsWithHold(rm).units, node.id, 0, { turnCount: 3, turnPar: 9 });
      stats.push(rm.burdens[0].stat);
    }
    expect(stats[0]).toBe(stats[1]);
    // Over many seeds the stat varies (it is drawn, not fixed to one).
    const seen = new Set();
    for (let seed = 1; seed <= 30; seed++) {
      const rm = bannerRun({ seed });
      rm.completeBattle(survivorsWithHold(rm).units, firstBattle(rm).id, 0, {
        turnCount: 3,
        turnPar: 9,
      });
      seen.add(rm.burdens[0].stat);
    }
    expect(seen.size).toBeGreaterThan(2);
  });

  it('no hold, or a held unit that fell later, takes no injury', () => {
    // Failure: every victory injures someone, or a fallen unit's injury lingers on the roster.
    const plain = bannerRun();
    plain.completeBattle(plain.getRoster(), firstBattle(plain).id, 0, { turnCount: 3, turnPar: 9 });
    expect(plain.burdens).toEqual([]);
    expect(plain.lastBurdenSettlement?.bannerWound).toBeUndefined();

    const fell = bannerRun();
    const { units, held } = survivorsWithHold(fell);
    const survivors = units.filter((u) => u !== held);
    fell.completeBattle(survivors, firstBattle(fell).id, 0, { turnCount: 3, turnPar: 9 });
    expect(fell.burdens).toEqual([]);
  });

  it('a fresh hold replaces an injury already carried (one injury at a time)', () => {
    // Failure: two injury records (the burden is one unit at a time), or the old one kept.
    const rm = bannerRun();
    const other = rm.getRoster()[0];
    rm.burdens = [
      {
        id: 'wounded',
        unitUid: other.unitUid,
        unitName: other.name,
        stat: 'STR',
        value: -2,
        battles: 3,
      },
    ];
    const { units, held } = survivorsWithHold(rm, 1);
    rm.completeBattle(units, firstBattle(rm).id, 0, { turnCount: 3, turnPar: 9 });
    expect(rm.burdens).toHaveLength(1);
    expect(rm.burdens[0].unitUid).toBe(held.unitUid);
  });
});
