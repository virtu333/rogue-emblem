import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isEntity,
  getFootprint,
  getFootprintKeys,
  entityDistanceTo,
  combatDistance,
  pickBestWeapon,
  rollSplashTiles,
  rollSplashDamage,
  getEntityCenter,
} from '../src/engine/EntitySystem.js';

function makeEntity(col = 5, row = 5) {
  return {
    isEntity: true,
    col,
    row,
    stats: { HP: 120, STR: 24, MAG: 22, DEF: 22, RES: 20 },
    currentHP: 120,
    faction: 'enemy',
    inventory: [
      { name: 'Eldritch Grasp', type: 'Sword', might: 15, range: '1-4' },
      { name: 'Twisting Vortex', type: 'Tome', might: 14, range: '1-4' },
    ],
    weapon: null,
  };
}

function makeUnit(col = 2, row = 2) {
  return {
    col,
    row,
    stats: { HP: 30, STR: 10, MAG: 5, DEF: 8, RES: 6 },
    currentHP: 30,
    faction: 'player',
  };
}

describe('EntitySystem', () => {
  describe('isEntity', () => {
    it('returns true for Entity units', () => {
      expect(isEntity({ isEntity: true })).toBe(true);
    });

    it('returns false for normal units', () => {
      expect(isEntity({ col: 1, row: 1 })).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(isEntity(null)).toBe(false);
      expect(isEntity(undefined)).toBe(false);
    });
  });

  describe('getFootprint', () => {
    it('returns 9 tiles for Entity (3x3)', () => {
      const entity = makeEntity(5, 5);
      const fp = getFootprint(entity);
      expect(fp).toHaveLength(9);
    });

    it('anchor is top-left corner', () => {
      const entity = makeEntity(5, 5);
      const fp = getFootprint(entity);
      expect(fp[0]).toEqual({ col: 5, row: 5 });
      expect(fp[8]).toEqual({ col: 7, row: 7 });
    });

    it('returns 1 tile for normal unit', () => {
      const unit = makeUnit(3, 3);
      const fp = getFootprint(unit);
      expect(fp).toHaveLength(1);
      expect(fp[0]).toEqual({ col: 3, row: 3 });
    });
  });

  describe('getFootprintKeys', () => {
    it('returns string keys for all tiles', () => {
      const entity = makeEntity(5, 5);
      const keys = getFootprintKeys(entity);
      expect(keys).toHaveLength(9);
      expect(keys).toContain('5,5');
      expect(keys).toContain('7,7');
      expect(keys).toContain('6,6');
    });
  });

  describe('entityDistanceTo', () => {
    it('returns 0 when target is on a body tile', () => {
      const entity = makeEntity(5, 5);
      expect(entityDistanceTo(entity, 6, 6)).toBe(0);
    });

    it('returns min distance from nearest body tile', () => {
      const entity = makeEntity(5, 5);
      // Target at (4, 5) is 1 tile left of anchor
      expect(entityDistanceTo(entity, 4, 5)).toBe(1);
      // Target at (8, 5) is 1 tile right of rightmost col (7)
      expect(entityDistanceTo(entity, 8, 5)).toBe(1);
    });

    it('returns correct diagonal distance', () => {
      const entity = makeEntity(5, 5);
      // Target at (3, 3) — 2 from anchor (5,5)
      expect(entityDistanceTo(entity, 3, 3)).toBe(4);
    });
  });

  describe('combatDistance', () => {
    it('uses entityDistanceTo when attacker is Entity', () => {
      const entity = makeEntity(5, 5);
      const target = makeUnit(8, 5);
      expect(combatDistance(entity, target)).toBe(1);
    });

    it('uses entityDistanceTo when defender is Entity', () => {
      const entity = makeEntity(5, 5);
      const attacker = makeUnit(4, 6);
      expect(combatDistance(attacker, entity)).toBe(1);
    });

    it('uses gridDistance for normal units', () => {
      const a = makeUnit(1, 1);
      const b = makeUnit(4, 3);
      expect(combatDistance(a, b)).toBe(5);
    });
  });

  describe('pickBestWeapon', () => {
    it('picks weapon dealing more damage', () => {
      const entity = makeEntity();
      entity.weapon = entity.inventory[0];
      const target = { stats: { DEF: 20, RES: 5 } };
      const best = pickBestWeapon(entity, target, (ent, wpn, tgt) => {
        const stat = wpn.type === 'Tome' ? ent.stats.MAG : ent.stats.STR;
        return Math.max(0, stat + wpn.might - tgt.stats.DEF);
      });
      // STR(24)+15 - DEF(20) = 19 vs MAG(22)+14 - DEF(20) = 16
      expect(best.name).toBe('Eldritch Grasp');
    });

    it('picks magic weapon vs low RES target', () => {
      const entity = makeEntity();
      entity.weapon = entity.inventory[0];
      const target = { stats: { DEF: 30, RES: 5 } };
      const best = pickBestWeapon(entity, target, (ent, wpn, tgt) => {
        const stat = wpn.type === 'Tome' ? ent.stats.MAG : ent.stats.STR;
        const def = wpn.type === 'Tome' ? tgt.stats.RES : tgt.stats.DEF;
        return Math.max(0, stat + wpn.might - def);
      });
      // STR(24)+15 - DEF(30) = 9 vs MAG(22)+14 - RES(5) = 31
      expect(best.name).toBe('Twisting Vortex');
    });

    it('returns current weapon for single-weapon units', () => {
      const entity = makeEntity();
      entity.inventory = [entity.inventory[0]];
      entity.weapon = entity.inventory[0];
      const target = { stats: { DEF: 10 } };
      const best = pickBestWeapon(entity, target, () => 10);
      expect(best.name).toBe('Eldritch Grasp');
    });
  });

  describe('rollSplashTiles', () => {
    it('returns 0-2 tiles depending on rng', () => {
      const entity = makeEntity(5, 5);
      // rng=0 → shuffle no-ops, then count = floor(0 * (maxCount+1)) = 0
      const tiles0 = rollSplashTiles(3, 3, entity, 20, 20, 2, () => 0);
      expect(tiles0.length).toBe(0);
    });

    it('can return max count with high rng', () => {
      const entity = makeEntity(5, 5);
      // rng=0.99 → shuffle reverses, count = floor(0.99 * 3) = 2
      const tiles = rollSplashTiles(3, 3, entity, 20, 20, 2, () => 0.99);
      expect(tiles.length).toBe(2);
    });

    it('excludes Entity body tiles', () => {
      const entity = makeEntity(5, 5);
      const bodyKeys = new Set(getFootprintKeys(entity));
      const tiles = rollSplashTiles(5, 4, entity, 20, 20, 4, () => 0.99);
      for (const tile of tiles) {
        expect(bodyKeys.has(`${tile.col},${tile.row}`)).toBe(false);
      }
    });

    it('excludes primary target tile', () => {
      const entity = makeEntity(5, 5);
      const tiles = rollSplashTiles(3, 3, entity, 20, 20, 4, () => 0.99);
      for (const tile of tiles) {
        expect(tile.col === 3 && tile.row === 3).toBe(false);
      }
    });

    it('respects map bounds', () => {
      const entity = makeEntity(5, 5);
      const tiles = rollSplashTiles(0, 0, entity, 10, 10, 4, () => 0.99);
      for (const tile of tiles) {
        expect(tile.col).toBeGreaterThanOrEqual(0);
        expect(tile.row).toBeGreaterThanOrEqual(0);
        expect(tile.col).toBeLessThan(10);
        expect(tile.row).toBeLessThan(10);
      }
    });

    it('caps count by candidate count when fewer candidates than splashCount', () => {
      const entity = makeEntity(5, 5);
      // Target at (0,0): only candidates within Manhattan 1 are (1,0) and (0,1) — 2 candidates.
      // splashCount=10, but capped to 2 candidates. rng=0.99 → count = floor(0.99*3) = 2
      const tiles = rollSplashTiles(0, 0, entity, 20, 20, 10, () => 0.99);
      expect(tiles.length).toBeLessThanOrEqual(2);
    });
  });

  describe('rollSplashDamage', () => {
    it('returns value in [5, 10]', () => {
      for (let i = 0; i < 20; i++) {
        const dmg = rollSplashDamage();
        expect(dmg).toBeGreaterThanOrEqual(5);
        expect(dmg).toBeLessThanOrEqual(10);
      }
    });

    it('uses provided rng', () => {
      expect(rollSplashDamage(() => 0)).toBe(5);
      expect(rollSplashDamage(() => 0.999)).toBe(10);
    });
  });

  describe('getEntityCenter', () => {
    it('returns center of 3x3 footprint', () => {
      const entity = makeEntity(5, 5);
      expect(getEntityCenter(entity)).toEqual({ col: 6, row: 6 });
    });

    it('returns unit position for normal units', () => {
      const unit = makeUnit(3, 4);
      expect(getEntityCenter(unit)).toEqual({ col: 3, row: 4 });
    });
  });
});
