// One vow per church (playtest 2026-09-28, Wave 4): Promotion or a minor blessing.
import { describe, expect, it } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { createUnit, resolvePromotionTargets } from '../src/engine/UnitManager.js';
import {
  promoteAtChurch,
  churchPromotionBlock,
  churchKindleBlock,
  churchReviveBlock,
  kindleAtChurch,
  reviveAtChurch,
} from '../src/engine/ChurchCommands.js';
import { PROLOGUE_BLESSING_BLOCK } from '../src/data/prologueContent.js';
import {
  churchBlessingBlock,
  churchBlessingOffers,
  churchVow,
  takeChurchBlessing,
} from '../src/engine/ChurchVow.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const tier1 = data.blessings.blessings.filter((b) => b.tier === 1).map((b) => b.id);

function run({ blessings = [] } = {}) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: 77 });
  rm.activeBlessings = blessings.map((id) => ({ id }));
  rm.gold = 99999;
  const unit = createUnit(
    data.classes.find((c) => c.name === 'Fighter'),
    10,
    data.weapons,
    {
      name: 'Bram',
    },
  );
  unit.faction = 'player';
  rm.roster.push(unit);
  const target = resolvePromotionTargets(unit, data.classes, data.lords)[0];
  return { rm, unit, target };
}

describe('the church vow', () => {
  it('the altar offers up to three tier-1 blessings the run does not hold, the same each visit', () => {
    const { rm } = run({ blessings: [tier1[0]] });
    const offers = churchBlessingOffers(rm, 'c1', data).map((b) => b.id);
    expect(offers.length).toBe(Math.min(3, tier1.length - 1));
    expect(offers.every((id) => tier1.includes(id) && id !== tier1[0])).toBe(true);
    expect(churchBlessingOffers(rm, 'c1', data).map((b) => b.id)).toEqual(offers);
    const all = run({ blessings: tier1 }).rm;
    expect(churchBlessingOffers(all, 'c1', data)).toEqual([]);
  });

  it('taking a blessing applies it now and closes promotion at this church only', () => {
    const { rm, unit, target } = run();
    const gold = rm.gold;
    expect(churchBlessingOffers(rm, 'c1', data).map((b) => b.id)).toContain('coin_of_fate');
    const result = takeChurchBlessing(rm, 'c1', 'coin_of_fate', data);
    expect(result.ok).toBe(true);
    expect(rm.gold).toBe(gold + 750); // Coin of Fate's boon
    expect(rm.getActiveBlessingIds()).toContain('coin_of_fate');
    expect(churchVow(rm, 'c1')).toBe('blessing');
    expect(churchPromotionBlock(rm, unit, 'c1', data)).toMatch(
      /Blessing: this altar promotes no one/,
    );
    expect(promoteAtChurch(rm, unit, 'c1', target, data).ok).toBe(false);
    // Once: the same altar gives no second blessing.
    const other = churchBlessingOffers(rm, 'c1', data)[0];
    expect(takeChurchBlessing(rm, 'c1', other.id, data).ok).toBe(false);
    // Another church is its own vow.
    expect(churchPromotionBlock(rm, unit, 'c2', data)).toBe('');
  });

  it('a promotion makes the vow; the blessings close, further promotions stay open', () => {
    const { rm, unit, target } = run();
    expect(promoteAtChurch(rm, unit, 'c1', target, data).ok).toBe(true);
    expect(churchVow(rm, 'c1')).toBe('promote');
    const offer = churchBlessingOffers(rm, 'c1', data)[0];
    expect(churchBlessingBlock(rm, 'c1', offer.id, data)).toMatch(/Promotion/);
    expect(takeChurchBlessing(rm, 'c1', offer.id, data).ok).toBe(false);
    expect(rm.getActiveBlessingIds()).not.toContain(offer.id);
  });

  it('a blessing not offered here is refused', () => {
    const { rm } = run();
    expect(takeChurchBlessing(rm, 'c1', 'forbidden_tome', data).ok).toBe(false);
    expect(churchVow(rm, 'c1')).toBeNull();
  });

  it('the vow survives a save and load, and each act starts with fresh churches', () => {
    const { rm } = run();
    takeChurchBlessing(rm, 'c1', churchBlessingOffers(rm, 'c1', data)[0].id, data);
    const restored = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    expect(churchVow(restored, 'c1')).toBe('blessing');
    restored.advanceAct();
    expect(churchVow(restored, 'c1')).toBeNull();
  });
});

describe("Harrow's Chapel (the prologue run)", () => {
  function prologueRun() {
    const rm = new RunManager(data, null);
    rm.startPrologue(data, data.prologue);
    rm.completeBattle(rm.roster, 'prologue_0', 0);
    rm.completeBattle(rm.roster, 'prologue_1', 0);
    rm.currentNodeId = 'prologue_2b';
    return rm;
  }

  it('the altar is shown greyed: every blessing says it begins with the first run', () => {
    const rm = prologueRun();
    rm.gold = 99999;
    const offers = churchBlessingOffers(rm, 'prologue_2b', data);
    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) {
      expect(churchBlessingBlock(rm, 'prologue_2b', offer.id, data)).toBe(PROLOGUE_BLESSING_BLOCK);
    }
    const before = rm.getActiveBlessingIds();
    expect(takeChurchBlessing(rm, 'prologue_2b', offers[0].id, data)).toEqual({
      ok: false,
      reason: PROLOGUE_BLESSING_BLOCK,
    });
    expect(rm.getActiveBlessingIds()).toEqual(before);
    expect(churchVow(rm, 'prologue_2b')).toBeNull();
  });

  it('no Kindle (the Eclipse sleeps), and revival still works for gold', () => {
    const rm = prologueRun();
    expect(rm.isEclipseActive()).toBe(false);
    expect(churchKindleBlock(rm, 'prologue_2b')).not.toBe('');
    expect(kindleAtChurch(rm, 'prologue_2b').ok).toBe(false);
    const gaspar = rm.roster.find((u) => u.name === 'Gaspar');
    rm.roster = rm.roster.filter((u) => u !== gaspar);
    rm.fallenUnits.push(gaspar);
    rm.gold = 99999;
    expect(churchReviveBlock(rm, gaspar)).toBe('');
    expect(reviveAtChurch(rm, gaspar).ok).toBe(true);
    expect(rm.roster).toContain(gaspar);
  });
});
