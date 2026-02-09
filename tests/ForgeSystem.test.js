import { describe, it, expect } from 'vitest';
import { canForge, isForged, getForgeCost, applyForge, getForgeDisplayInfo } from '../src/engine/ForgeSystem.js';
import { FORGE_MAX_LEVEL, FORGE_BONUSES, FORGE_COSTS } from '../src/utils/constants.js';

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

  describe('getForgeCost', () => {
    it('returns correct cost for each forge level of might', () => {
      for (let lvl = 0; lvl < FORGE_MAX_LEVEL; lvl++) {
        const wpn = makeWeapon({ _forgeLevel: lvl });
        expect(getForgeCost(wpn, 'might')).toBe(FORGE_COSTS.might[lvl]);
      }
    });

    it('returns correct cost for crit, hit, weight', () => {
      const wpn = makeWeapon();
      expect(getForgeCost(wpn, 'crit')).toBe(FORGE_COSTS.crit[0]);
      expect(getForgeCost(wpn, 'hit')).toBe(FORGE_COSTS.hit[0]);
      expect(getForgeCost(wpn, 'weight')).toBe(FORGE_COSTS.weight[0]);
    });

    it('returns -1 for weapon at max forge level', () => {
      const wpn = makeWeapon({ _forgeLevel: FORGE_MAX_LEVEL });
      expect(getForgeCost(wpn, 'might')).toBe(-1);
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

    it('fails at max forge level', () => {
      const wpn = makeWeapon({ _forgeLevel: FORGE_MAX_LEVEL });
      const result = applyForge(wpn, 'might');
      expect(result.success).toBe(false);
    });

    it('can mix different stats across forge levels', () => {
      const wpn = makeWeapon({ might: 5, crit: 0, hit: 90 });
      applyForge(wpn, 'might');
      applyForge(wpn, 'crit');
      applyForge(wpn, 'hit');
      expect(wpn.might).toBe(5 + FORGE_BONUSES.might);
      expect(wpn.crit).toBe(0 + FORGE_BONUSES.crit);
      expect(wpn.hit).toBe(90 + FORGE_BONUSES.hit);
      expect(wpn._forgeLevel).toBe(3);
      expect(applyForge(wpn, 'might').success).toBe(false); // at cap
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
