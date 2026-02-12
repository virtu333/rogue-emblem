import { describe, it, expect } from 'vitest';
import {
  getWeaponArtCombatMods,
  canUseWeaponArt,
  recordWeaponArtUse,
  applyWeaponArtCost,
  resetWeaponArtTurnUsage,
} from '../src/engine/WeaponArtSystem.js';

function makeUnit(overrides = {}) {
  return {
    name: 'Tester',
    stats: { HP: 24, STR: 8, MAG: 0, SKL: 10, SPD: 9, DEF: 6, RES: 3, LCK: 5 },
    currentHP: 24,
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    ...overrides,
  };
}

function makeArt(overrides = {}) {
  return {
    id: 'sword_precise_cut',
    name: 'Precise Cut',
    weaponType: 'Sword',
    requiredRank: 'Prof',
    hpCost: 2,
    perTurnLimit: 1,
    perMapLimit: 3,
    combatMods: {
      hitBonus: 20,
      critBonus: 5,
      activated: [{ id: 'weapon_art', name: 'Precise Cut' }],
    },
    ...overrides,
  };
}

describe('WeaponArtSystem', () => {
  it('normalizes combat mods', () => {
    const mods = getWeaponArtCombatMods(makeArt());
    expect(mods.hitBonus).toBe(20);
    expect(mods.critBonus).toBe(5);
    expect(mods.atkBonus).toBe(0);
    expect(Array.isArray(mods.activated)).toBe(true);
  });

  it('rejects weapon arts for wrong weapon type', () => {
    const unit = makeUnit();
    const weapon = { type: 'Lance' };
    const result = canUseWeaponArt(unit, weapon, makeArt());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('wrong_weapon_type');
  });

  it('enforces mastery rank requirement', () => {
    const unit = makeUnit({ proficiencies: [{ type: 'Sword', rank: 'Prof' }] });
    const weapon = { type: 'Sword' };
    const result = canUseWeaponArt(unit, weapon, makeArt({ requiredRank: 'Mast' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_rank');
  });

  it('enforces HP cost floor (cannot self-KO)', () => {
    const unit = makeUnit({ currentHP: 2 });
    const weapon = { type: 'Sword' };
    const result = canUseWeaponArt(unit, weapon, makeArt({ hpCost: 2 }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_hp');
  });

  it('tracks per-turn and per-map limits', () => {
    const unit = makeUnit();
    const weapon = { type: 'Sword' };
    const art = makeArt({ perTurnLimit: 1, perMapLimit: 2 });

    expect(canUseWeaponArt(unit, weapon, art, { turnNumber: 1 }).ok).toBe(true);
    recordWeaponArtUse(unit, art, { turnNumber: 1 });
    expect(canUseWeaponArt(unit, weapon, art, { turnNumber: 1 }).reason).toBe('per_turn_limit');

    resetWeaponArtTurnUsage(unit, { turnNumber: 2 });
    expect(canUseWeaponArt(unit, weapon, art, { turnNumber: 2 }).ok).toBe(true);
    recordWeaponArtUse(unit, art, { turnNumber: 2 });
    expect(canUseWeaponArt(unit, weapon, art, { turnNumber: 2 }).reason).toBe('per_map_limit');
  });

  it('applies HP cost but never drops below 1', () => {
    const unit = makeUnit({ currentHP: 5 });
    applyWeaponArtCost(unit, makeArt({ hpCost: 3 }));
    expect(unit.currentHP).toBe(2);

    applyWeaponArtCost(unit, makeArt({ hpCost: 99 }));
    expect(unit.currentHP).toBe(1);
  });
});

