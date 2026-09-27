import { describe, it, expect } from 'vitest';
import { loadGameData } from './testData.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { RunManager } from '../src/engine/RunManager.js';
import { createRecruitUnit } from '../src/engine/UnitManager.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';

// The MAG and LCK home-base tracks reach the units they buy for: flat bonuses
// land on stats, growth bonuses on growths, for lords at run start and for
// recruits through the run's effective recruit bonuses.

const gameData = loadGameData();

function startRun(metaEffects) {
  installSeed(7);
  try {
    const run = new RunManager(gameData, metaEffects);
    run.startRun({ runSeed: 7, difficultyId: 'normal', applyBlessingsAtStart: false });
    return run;
  } finally {
    restoreMathRandom();
  }
}

function effectsFor(purchases) {
  const meta = new MetaProgressionManager(gameData.metaUpgrades);
  Object.assign(meta.purchasedUpgrades, purchases);
  return meta.getActiveEffects();
}

describe('MAG and LCK meta upgrades', () => {
  it('flat and growth tracks raise lord MAG and LCK at run start', () => {
    const base = startRun(null);
    const boosted = startRun(
      effectsFor({ lord_mag_flat: 3, lord_lck_flat: 2, lord_mag_growth: 4, lord_lck_growth: 1 }),
    );
    for (const name of ['Edric', 'Sera']) {
      const before = base.roster.find((u) => u.name === name);
      const after = boosted.roster.find((u) => u.name === name);
      expect(after.stats.MAG, `${name} MAG`).toBe(before.stats.MAG + 5);
      expect(after.stats.LCK, `${name} LCK`).toBe(before.stats.LCK + 3);
      expect(after.growths.MAG, `${name} MAG growth`).toBe(before.growths.MAG + 20);
      expect(after.growths.LCK, `${name} LCK growth`).toBe(before.growths.LCK + 5);
      expect(after.stats.STR, `${name} STR untouched`).toBe(before.stats.STR);
    }
  });

  it('flat and growth tracks raise recruit MAG and LCK', () => {
    const run = startRun(
      effectsFor({
        recruit_mag_flat: 2,
        recruit_lck_flat: 3,
        recruit_mag_growth: 5,
        recruit_lck_growth: 2,
      }),
    );
    const mage = gameData.classes.find((c) => c.name === 'Mage');
    // Recruit growths are rolled from class ranges: same seed, same rolls.
    const make = (statBonuses, growthBonuses) => {
      installSeed(11);
      try {
        return createRecruitUnit(
          { name: 'Test', level: 1 },
          mage,
          gameData.weapons,
          statBonuses,
          growthBonuses,
        );
      } finally {
        restoreMathRandom();
      }
    };
    const plain = make(null, null);
    const boosted = make(run.metaEffects.statBonuses, run.getEffectiveRecruitGrowthBonuses());
    expect(boosted.stats.MAG).toBe(plain.stats.MAG + 3);
    expect(boosted.stats.LCK).toBe(plain.stats.LCK + 5);
    expect(boosted.growths.MAG).toBe(plain.growths.MAG + 25);
    expect(boosted.growths.LCK).toBe(plain.growths.LCK + 10);
  });

  it('flat tracks unlock at growth tier 3; lord MAG flat also needs Act 1 beaten', () => {
    const meta = new MetaProgressionManager(gameData.metaUpgrades);
    meta.purchasedUpgrades.lord_mag_growth = 3;
    meta.purchasedUpgrades.lord_lck_growth = 2;
    meta.purchasedUpgrades.recruit_mag_growth = 3;
    expect(meta.meetsPrerequisites('lord_mag_flat')).toBe(false);
    expect(meta.meetsPrerequisites('lord_lck_flat')).toBe(false);
    expect(meta.meetsPrerequisites('recruit_mag_flat')).toBe(true);
    meta.milestones.add('beatAct1');
    meta.purchasedUpgrades.lord_lck_growth = 3;
    expect(meta.meetsPrerequisites('lord_mag_flat')).toBe(true);
    expect(meta.meetsPrerequisites('lord_lck_flat')).toBe(true);
  });
});
