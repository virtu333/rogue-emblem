import { describe, it, expect } from 'vitest';
import { generateBattle } from '../src/engine/MapGenerator.js';
import { SIEGE_ELIGIBLE_CLASSES } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withSeed(seed, fn) {
  const origRandom = Math.random;
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = origRandom;
  }
}

const siegeWeaponConfig = {
  act1: 0,
  act2: 0,
  act3: 0.99,
  act4: 0.99,
  finalBoss: 0.99,
  maxPerBattle: 1,
  weaponName: 'Bolting',
};

describe('siege weapon spawn assignment (T5)', () => {
  it('no siege weapons on act1/act2 when chance is 0', () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const act of ['act1', 'act2']) {
        const config = withSeed(seed, () =>
          generateBattle({ act, objective: 'rout', siegeWeaponConfig }, data),
        );
        const withSiege = config.enemySpawns.filter((s) => s.siegeWeapon);
        expect(withSiege.length).toBe(0);
      }
    }
  });

  it('only assigns siege weapons to SIEGE_ELIGIBLE_CLASSES', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const config = withSeed(seed, () =>
        generateBattle({ act: 'act4', objective: 'rout', siegeWeaponConfig }, data),
      );
      const withSiege = config.enemySpawns.filter((s) => s.siegeWeapon);
      for (const s of withSiege) {
        expect(SIEGE_ELIGIBLE_CLASSES.has(s.className)).toBe(true);
      }
    }
  });

  it('respects maxPerBattle cap', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const config = withSeed(seed, () =>
        generateBattle({ act: 'act4', objective: 'rout', siegeWeaponConfig }, data),
      );
      const withSiege = config.enemySpawns.filter((s) => s.siegeWeapon);
      expect(withSiege.length).toBeLessThanOrEqual(siegeWeaponConfig.maxPerBattle);
    }
  });

  it('no siege weapons when siegeWeaponConfig is null/absent', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const config = withSeed(seed, () =>
        generateBattle({ act: 'act4', objective: 'rout', siegeWeaponConfig: null }, data),
      );
      const withSiege = config.enemySpawns.filter((s) => s.siegeWeapon);
      expect(withSiege.length).toBe(0);
    }
    for (let seed = 1; seed <= 10; seed++) {
      const config = withSeed(seed, () => generateBattle({ act: 'act4', objective: 'rout' }, data));
      const withSiege = config.enemySpawns.filter((s) => s.siegeWeapon);
      expect(withSiege.length).toBe(0);
    }
  });

  it('RNG stability: same seed produces same siege assignment', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const config1 = withSeed(seed, () =>
        generateBattle({ act: 'act4', objective: 'rout', siegeWeaponConfig }, data),
      );
      const config2 = withSeed(seed, () =>
        generateBattle({ act: 'act4', objective: 'rout', siegeWeaponConfig }, data),
      );
      expect(config1.enemySpawns.length).toBe(config2.enemySpawns.length);
      for (let i = 0; i < config1.enemySpawns.length; i++) {
        expect(config1.enemySpawns[i].className).toBe(config2.enemySpawns[i].className);
        expect(config1.enemySpawns[i].siegeWeapon).toBe(config2.enemySpawns[i].siegeWeapon);
      }
    }
  });

  it('siege weapon name matches config weaponName', () => {
    let found = false;
    for (let seed = 1; seed <= 100; seed++) {
      const config = withSeed(seed, () =>
        generateBattle({ act: 'act4', objective: 'rout', siegeWeaponConfig }, data),
      );
      const withSiege = config.enemySpawns.filter((s) => s.siegeWeapon);
      for (const s of withSiege) {
        expect(s.siegeWeapon).toBe('Bolting');
        found = true;
      }
      if (found) break;
    }
    // With 0.99 chance and act4 having eligible classes, at least one spawn should occur
    expect(found).toBe(true);
  });
});
