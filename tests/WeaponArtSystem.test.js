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

  it('enforces owner and faction constraints when configured', () => {
    const unit = makeUnit({ faction: 'player' });
    const weapon = { type: 'Sword' };

    const enemyOnly = canUseWeaponArt(unit, weapon, makeArt({ owner: 'enemy' }));
    expect(enemyOnly.ok).toBe(false);
    expect(enemyOnly.reason).toBe('owner_scope_mismatch');

    const factionOnly = canUseWeaponArt(unit, weapon, makeArt({ allowedFactions: ['enemy'] }));
    expect(factionOnly.ok).toBe(false);
    expect(factionOnly.reason).toBe('faction_mismatch');
  });

  it('rejects malformed owner/faction constraint config', () => {
    const unit = makeUnit({ faction: 'player' });
    const weapon = { type: 'Sword' };

    expect(canUseWeaponArt(unit, weapon, makeArt({ allowedOwners: { bad: true } })).reason)
      .toBe('invalid_owner_scope_config');
    expect(canUseWeaponArt(unit, weapon, makeArt({ allowedFactions: ['players'] })).reason)
      .toBe('invalid_faction_config');
  });

  it('supports legendary weapon id gating', () => {
    const unit = makeUnit({ faction: 'player' });
    const art = makeArt({ legendaryWeaponIds: ['legend_sword'] });

    const mismatch = canUseWeaponArt(unit, { type: 'Sword', id: 'iron_sword' }, art);
    expect(mismatch.ok).toBe(false);
    expect(mismatch.reason).toBe('legendary_weapon_required');

    const match = canUseWeaponArt(unit, { type: 'Sword', id: 'legend_sword' }, art);
    expect(match.ok).toBe(true);
  });

  it('applies AI-specific guardrails when context.isAI is true', () => {
    const unit = makeUnit({ faction: 'enemy', currentHP: 10, stats: { ...makeUnit().stats, HP: 20 } });
    const weapon = { type: 'Sword' };

    const disabled = canUseWeaponArt(unit, weapon, makeArt({ aiEnabled: false }), { isAI: true });
    expect(disabled.ok).toBe(false);
    expect(disabled.reason).toBe('ai_disabled');

    const disabledZeroCost = canUseWeaponArt(unit, weapon, makeArt({ hpCost: 0, aiEnabled: false }), { isAI: true });
    expect(disabledZeroCost.ok).toBe(false);
    expect(disabledZeroCost.reason).toBe('ai_disabled');

    const defaultFloorBlocked = canUseWeaponArt(
      makeUnit({ faction: 'enemy', currentHP: 6, stats: { ...makeUnit().stats, HP: 20 } }),
      weapon,
      makeArt({ hpCost: 2 }),
      { isAI: true }
    );
    expect(defaultFloorBlocked.ok).toBe(false);
    expect(defaultFloorBlocked.reason).toBe('ai_hp_floor');

    const floorBlocked = canUseWeaponArt(
      unit,
      weapon,
      makeArt({ hpCost: 3, aiMinHpAfterCostPercent: 0.5 }),
      { isAI: true }
    );
    expect(floorBlocked.ok).toBe(false);
    expect(floorBlocked.reason).toBe('ai_hp_floor');

    const perTurnArt = makeArt({ perTurnLimit: 2, aiPerTurnLimit: 1 });
    expect(canUseWeaponArt(unit, weapon, perTurnArt, { isAI: true, turnNumber: 1 }).ok).toBe(true);
    recordWeaponArtUse(unit, perTurnArt, { turnNumber: 1 });
    const blocked = canUseWeaponArt(unit, weapon, perTurnArt, { isAI: true, turnNumber: 1 });
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe('per_turn_limit');
  });
});
