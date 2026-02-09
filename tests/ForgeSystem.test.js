import { describe, it, expect } from 'vitest';
import { canForge, canForgeStat, isForged, getForgeCost, applyForge, getForgeDisplayInfo, getStatForgeCount } from '../src/engine/ForgeSystem.js';
import { FORGE_MAX_LEVEL, FORGE_BONUSES, FORGE_COSTS, FORGE_STAT_CAP } from '../src/utils/constants.js';

function makeWeapon(overrides = {}) {
  return {
    name: 'Iron Sword', type: 'Sword', tier: 'Iron',
    might: 5, hit: 90, crit: 0, weight: 5, range: '1', price: 500,
    ...overrides,
  };
}

describe('ForgeSystem', () => {
  describe('canForge', () => {
    it('returns true for a normal weapon at level 0', () => {
      expect(canForge(makeWeapon())).toBe(true);
    });

    it('returns true for a weapon below max forge level', () => {
      expect(canForge(makeWeapon({ _forgeLevel: 2 }))).toBe(true);
    });

    it('returns false for a weapon at max forge level', () => {
      expect(canForge(makeWeapon({ _forgeLevel: FORGE_MAX_LEVEL }))).toBe(false);
    });

    it('returns false for Staff', () => {
      expect(canForge(makeWeapon({ type: 'Staff' }))).toBe(false);
    });

    it('returns false for Scroll', () => {
      expect(canForge(makeWeapon({ type: 'Scroll' }))).toBe(false);
    });

    it('returns false for Consumable', () => {
      expect(canForge(makeWeapon({ type: 'Consumable' }))).toBe(false);
    });

    it('returns false for Accessory', () => {
      expect(canForge(makeWeapon({ type: 'Accessory' }))).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(canForge(null)).toBe(false);
      expect(canForge(undefined)).toBe(false);
    });

    it('returns true for Legendary weapons (can still forge)', () => {
      expect(canForge(makeWeapon({ tier: 'Legend' }))).toBe(true);
    });
  });

  describe('isForged', () => {
    it('returns false for unforged weapon', () => {
      expect(isForged(makeWeapon())).toBe(false);
    });

    it('returns true for forged weapon', () => {
      expect(isForged(makeWeapon({ _forgeLevel: 1 }))).toBe(true);
    });
  });

  describe('getStatForgeCount', () => {
    it('returns 0 for unforged weapon', () => {
      expect(getStatForgeCount(makeWeapon(), 'might')).toBe(0);
    });

    it('returns 0 for null weapon', () => {
      expect(getStatForgeCount(null, 'might')).toBe(0);
    });

    it('derives correct count from _forgeBonuses', () => {
      const wpn = makeWeapon({
        _forgeBonuses: { might: 2, crit: 10, hit: 0, weight: -2 },
      });
      expect(getStatForgeCount(wpn, 'might')).toBe(2);   // 2 / 1
      expect(getStatForgeCount(wpn, 'crit')).toBe(2);    // 10 / 5
      expect(getStatForgeCount(wpn, 'hit')).toBe(0);
      expect(getStatForgeCount(wpn, 'weight')).toBe(2);  // |-2 / -1| = 2
    });

    it('returns correct count after applying forges', () => {
      const wpn = makeWeapon();
      applyForge(wpn, 'might');
      applyForge(wpn, 'might');
      expect(getStatForgeCount(wpn, 'might')).toBe(2);
      expect(getStatForgeCount(wpn, 'crit')).toBe(0);
    });
  });

  describe('canForgeStat', () => {
    it('returns true for unforged weapon', () => {
      expect(canForgeStat(makeWeapon(), 'might')).toBe(true);
    });

    it('returns false at per-stat cap', () => {
      const wpn = makeWeapon();
      for (let i = 0; i < FORGE_STAT_CAP; i++) applyForge(wpn, 'might');
      expect(canForgeStat(wpn, 'might')).toBe(false);
    });

    it('returns true for other stats when one stat is capped', () => {
      const wpn = makeWeapon();
      for (let i = 0; i < FORGE_STAT_CAP; i++) applyForge(wpn, 'might');
      expect(canForgeStat(wpn, 'crit')).toBe(true);
      expect(canForgeStat(wpn, 'hit')).toBe(true);
      expect(canForgeStat(wpn, 'weight')).toBe(true);
    });

    it('returns false at total forge cap', () => {
      const wpn = makeWeapon();
      for (let i = 0; i < FORGE_MAX_LEVEL; i++) {
        const stats = ['might', 'crit', 'hit', 'weight'];
        // Spread across stats to avoid per-stat cap
        applyForge(wpn, stats[i % 4]);
      }
      expect(canForgeStat(wpn, 'might')).toBe(false);
    });

    it('returns false for excluded types', () => {
      expect(canForgeStat(makeWeapon({ type: 'Staff' }), 'might')).toBe(false);
    });
  });

  describe('getForgeCost', () => {
    it('uses per-stat count as cost index, not total level', () => {
      const wpn = makeWeapon();
      // First forge of might: should use index 0
      expect(getForgeCost(wpn, 'might')).toBe(FORGE_COSTS.might[0]);
      applyForge(wpn, 'might');
      // Second forge of might: should use index 1
      expect(getForgeCost(wpn, 'might')).toBe(FORGE_COSTS.might[1]);

      // First forge of crit: should use index 0, even though total level is 1
      expect(getForgeCost(wpn, 'crit')).toBe(FORGE_COSTS.crit[0]);
    });

    it('returns correct cost for each per-stat level of might', () => {
      const wpn = makeWeapon();
      for (let i = 0; i < FORGE_STAT_CAP; i++) {
        expect(getForgeCost(wpn, 'might')).toBe(FORGE_COSTS.might[i]);
        applyForge(wpn, 'might');
      }
    });

    it('returns correct cost for crit, hit, weight', () => {
      const wpn = makeWeapon();
      expect(getForgeCost(wpn, 'crit')).toBe(FORGE_COSTS.crit[0]);
      expect(getForgeCost(wpn, 'hit')).toBe(FORGE_COSTS.hit[0]);
      expect(getForgeCost(wpn, 'weight')).toBe(FORGE_COSTS.weight[0]);
    });

    it('returns -1 for weapon at max total forge level', () => {
      const wpn = makeWeapon({ _forgeLevel: FORGE_MAX_LEVEL });
      expect(getForgeCost(wpn, 'might')).toBe(-1);
    });

    it('returns -1 when stat is at per-stat cap', () => {
      const wpn = makeWeapon();
      for (let i = 0; i < FORGE_STAT_CAP; i++) applyForge(wpn, 'might');
      expect(getForgeCost(wpn, 'might')).toBe(-1);
      // But other stats should still have costs
      expect(getForgeCost(wpn, 'crit')).toBe(FORGE_COSTS.crit[0]);
    });

    it('returns -1 for invalid stat', () => {
      expect(getForgeCost(makeWeapon(), 'invalid')).toBe(-1);
    });
  });

  describe('applyForge', () => {
    it('increments might by FORGE_BONUSES.might', () => {
      const wpn = makeWeapon({ might: 5 });
      const result = applyForge(wpn, 'might');
      expect(result.success).toBe(true);
      expect(wpn.might).toBe(5 + FORGE_BONUSES.might);
    });

    it('increments crit by FORGE_BONUSES.crit', () => {
      const wpn = makeWeapon({ crit: 0 });
      applyForge(wpn, 'crit');
      expect(wpn.crit).toBe(FORGE_BONUSES.crit);
    });

    it('increments hit by FORGE_BONUSES.hit', () => {
      const wpn = makeWeapon({ hit: 90 });
      applyForge(wpn, 'hit');
      expect(wpn.hit).toBe(90 + FORGE_BONUSES.hit);
    });

    it('decrements weight (floors at 0)', () => {
      const wpn = makeWeapon({ weight: 5 });
      applyForge(wpn, 'weight');
      expect(wpn.weight).toBe(5 + FORGE_BONUSES.weight); // weight bonus is -1
    });

    it('weight floors at 0', () => {
      const wpn = makeWeapon({ weight: 0 });
      applyForge(wpn, 'weight');
      expect(wpn.weight).toBe(0);
    });

    it('updates _forgeLevel', () => {
      const wpn = makeWeapon();
      applyForge(wpn, 'might');
      expect(wpn._forgeLevel).toBe(1);
      applyForge(wpn, 'crit');
      expect(wpn._forgeLevel).toBe(2);
    });

    it('preserves _baseName across multiple forges', () => {
      const wpn = makeWeapon({ name: 'Iron Sword' });
      applyForge(wpn, 'might');
      expect(wpn._baseName).toBe('Iron Sword');
      applyForge(wpn, 'crit');
      expect(wpn._baseName).toBe('Iron Sword');
    });

    it('updates name with +N suffix', () => {
      const wpn = makeWeapon({ name: 'Steel Lance' });
      applyForge(wpn, 'might');
      expect(wpn.name).toBe('Steel Lance +1');
      applyForge(wpn, 'hit');
      expect(wpn.name).toBe('Steel Lance +2');
    });

    it('increases price by forge cost', () => {
      const wpn = makeWeapon({ price: 500 });
      applyForge(wpn, 'might');
      expect(wpn.price).toBe(500 + FORGE_COSTS.might[0]);
    });

    it('tracks cumulative bonuses in _forgeBonuses', () => {
      const wpn = makeWeapon();
      applyForge(wpn, 'might');
      applyForge(wpn, 'crit');
      expect(wpn._forgeBonuses.might).toBe(FORGE_BONUSES.might);
      expect(wpn._forgeBonuses.crit).toBe(FORGE_BONUSES.crit);
      expect(wpn._forgeBonuses.hit).toBe(0);
      expect(wpn._forgeBonuses.weight).toBe(0);
    });

    it('fails at max total forge level', () => {
      const wpn = makeWeapon({ _forgeLevel: FORGE_MAX_LEVEL });
      const result = applyForge(wpn, 'might');
      expect(result.success).toBe(false);
    });

    it('fails when stat is at per-stat cap', () => {
      const wpn = makeWeapon();
      for (let i = 0; i < FORGE_STAT_CAP; i++) applyForge(wpn, 'might');
      const result = applyForge(wpn, 'might');
      expect(result.success).toBe(false);
      expect(wpn._forgeLevel).toBe(FORGE_STAT_CAP); // unchanged
    });

    it('can mix different stats across forge levels (total > old cap of 3)', () => {
      const wpn = makeWeapon({ might: 5, crit: 0, hit: 90, weight: 5 });
      applyForge(wpn, 'might');
      applyForge(wpn, 'crit');
      applyForge(wpn, 'hit');
      expect(wpn.might).toBe(5 + FORGE_BONUSES.might);
      expect(wpn.crit).toBe(0 + FORGE_BONUSES.crit);
      expect(wpn.hit).toBe(90 + FORGE_BONUSES.hit);
      expect(wpn._forgeLevel).toBe(3);
      // Can still forge — not at total cap of 10
      expect(applyForge(wpn, 'weight').success).toBe(true);
      expect(wpn._forgeLevel).toBe(4);
    });

    it('can spread forges across all 4 stats to reach total cap of 10', () => {
      const wpn = makeWeapon({ might: 5, crit: 0, hit: 90, weight: 5 });
      const stats = ['might', 'crit', 'hit', 'weight'];
      // 4 stats × 2 each = 8
      for (const stat of stats) {
        applyForge(wpn, stat);
        applyForge(wpn, stat);
      }
      expect(wpn._forgeLevel).toBe(8);
      // 2 more to reach 10
      applyForge(wpn, 'might');
      applyForge(wpn, 'crit');
      expect(wpn._forgeLevel).toBe(10);
      // Now at total cap
      expect(canForge(wpn)).toBe(false);
      expect(applyForge(wpn, 'hit').success).toBe(false);
    });

    it('cannot exceed 10 total even when per-stat caps would allow 12', () => {
      const wpn = makeWeapon();
      const stats = ['might', 'crit', 'hit', 'weight'];
      let forgeCount = 0;
      // Try to forge 3 of each stat = 12 total, but cap is 10
      for (const stat of stats) {
        for (let i = 0; i < FORGE_STAT_CAP; i++) {
          const result = applyForge(wpn, stat);
          if (result.success) forgeCount++;
        }
      }
      expect(forgeCount).toBe(FORGE_MAX_LEVEL); // 10
      expect(wpn._forgeLevel).toBe(FORGE_MAX_LEVEL);
    });

    it('returns cost in result', () => {
      const wpn = makeWeapon();
      const result = applyForge(wpn, 'might');
      expect(result.cost).toBe(FORGE_COSTS.might[0]);
    });
  });

  describe('getForgeDisplayInfo', () => {
    it('returns base values for unforged weapon', () => {
      const info = getForgeDisplayInfo(makeWeapon({ name: 'Iron Axe' }));
      expect(info.baseName).toBe('Iron Axe');
      expect(info.level).toBe(0);
      expect(info.bonuses).toEqual({ might: 0, crit: 0, hit: 0, weight: 0 });
      expect(info.statCounts).toEqual({ might: 0, crit: 0, hit: 0, weight: 0 });
    });

    it('returns correct info for forged weapon', () => {
      const wpn = makeWeapon({ name: 'Iron Axe' });
      applyForge(wpn, 'might');
      applyForge(wpn, 'crit');
      const info = getForgeDisplayInfo(wpn);
      expect(info.baseName).toBe('Iron Axe');
      expect(info.level).toBe(2);
      expect(info.bonuses.might).toBe(FORGE_BONUSES.might);
      expect(info.bonuses.crit).toBe(FORGE_BONUSES.crit);
      expect(info.statCounts.might).toBe(1);
      expect(info.statCounts.crit).toBe(1);
      expect(info.statCounts.hit).toBe(0);
      expect(info.statCounts.weight).toBe(0);
    });
  });

  describe('serialization roundtrip', () => {
    it('forge data survives JSON stringify/parse', () => {
      const wpn = makeWeapon({ name: 'Iron Bow', might: 4, crit: 0, hit: 85, weight: 4 });
      applyForge(wpn, 'might');
      applyForge(wpn, 'weight');

      const restored = JSON.parse(JSON.stringify(wpn));
      expect(restored._forgeLevel).toBe(2);
      expect(restored._baseName).toBe('Iron Bow');
      expect(restored._forgeBonuses).toEqual({ might: 1, crit: 0, hit: 0, weight: -1 });
      expect(restored.name).toBe('Iron Bow +2');
      expect(restored.might).toBe(5);
      expect(restored.weight).toBe(3);
    });
  });
});
