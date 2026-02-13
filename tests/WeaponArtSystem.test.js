import { describe, it, expect } from 'vitest';
import {
  getWeaponArtCombatMods,
  canUseWeaponArt,
  recordWeaponArtUse,
  applyWeaponArtCost,
  resetWeaponArtTurnUsage,
  normalizeWeaponArtSource,
  normalizeWeaponArtBinding,
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

  it('normalizes statScaling in combat mods', () => {
    const mods = getWeaponArtCombatMods(makeArt({
      combatMods: {
        statScaling: { stat: 'skl', divisor: 2 },
        activated: [{ id: 'weapon_art', name: 'Precise Cut' }],
      },
    }));
    expect(mods.statScaling).toEqual({ stat: 'SKL', divisor: 2 });
  });

  it('normalizes tactical-depth combat mod fields', () => {
    const mods = getWeaponArtCombatMods(makeArt({
      combatMods: {
        preventCounter: true,
        targetsRES: true,
        effectiveness: { moveType: 'Flying', multiplier: 3 },
        rangeBonus: 2,
        rangeOverride: 2,
        halfPhysicalDamage: true,
        vengeance: true,
      },
    }));
    expect(mods.preventCounter).toBe(true);
    expect(mods.targetsRES).toBe(true);
    expect(mods.effectiveness).toEqual({ moveTypes: ['flying'], multiplier: 3 });
    expect(mods.rangeBonus).toBe(2);
    expect(mods.rangeOverride).toEqual({ min: 2, max: 2 });
    expect(mods.halfPhysicalDamage).toBe(true);
    expect(mods.vengeance).toBe(true);
  });

  it('rejects weapon arts for wrong weapon type', () => {
    const unit = makeUnit();
    const weapon = { type: 'Lance' };
    const result = canUseWeaponArt(unit, weapon, makeArt());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('wrong_weapon_type');
  });

  it('supports allowedTypes compatibility for magic arts', () => {
    const art = makeArt({
      weaponType: 'Tome',
      allowedTypes: ['Tome', 'Light'],
      combatMods: { atkBonus: 5 },
    });

    const tomeUnit = makeUnit({ proficiencies: [{ type: 'Tome', rank: 'Prof' }] });
    expect(canUseWeaponArt(tomeUnit, { type: 'Tome' }, art).ok).toBe(true);

    const lightUnit = makeUnit({ proficiencies: [{ type: 'Light', rank: 'Prof' }] });
    expect(canUseWeaponArt(lightUnit, { type: 'Light' }, art).ok).toBe(true);

    const swordUnit = makeUnit({ proficiencies: [{ type: 'Sword', rank: 'Prof' }] });
    const blocked = canUseWeaponArt(swordUnit, { type: 'Sword' }, art);
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe('wrong_weapon_type');
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

  it('rejects malformed unlockAct config', () => {
    const unit = makeUnit({ faction: 'player' });
    const weapon = { type: 'Sword' };

    const result = canUseWeaponArt(unit, weapon, makeArt({ unlockAct: 'ac2' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_unlock_act_config');
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

  it('normalizes weapon-art source labels', () => {
    expect(normalizeWeaponArtSource('innate')).toBe('innate');
    expect(normalizeWeaponArtSource(' META_INNATE ')).toBe('meta_innate');
    expect(normalizeWeaponArtSource('player')).toBeNull();
  });

  it('normalizes legacy weapon-art binding fields fail-closed', () => {
    const weapon = {
      id: 'test_blade',
      weaponArtBinding: { artId: 'sword_precise_cut', source: 'scroll' },
    };
    normalizeWeaponArtBinding(weapon, { validArtIds: new Set(['sword_precise_cut']) });
    expect(weapon.weaponArtIds).toEqual(['sword_precise_cut']);
    expect(weapon.weaponArtSources).toEqual(['scroll']);
    expect(weapon.weaponArtId).toBe('sword_precise_cut');
    expect(weapon.weaponArtSource).toBe('scroll');
    expect(weapon.weaponArtBinding).toBeUndefined();

    const bad = {
      id: 'bad_blade',
      weaponArt: 'invalid_art',
      weaponArtSource: 'unknown_source',
    };
    normalizeWeaponArtBinding(bad, { validArtIds: new Set(['sword_precise_cut']) });
    expect(bad.weaponArtIds).toBeUndefined();
    expect(bad.weaponArtSources).toBeUndefined();
    expect(bad.weaponArtId).toBeUndefined();
    expect(bad.weaponArtSource).toBeUndefined();
    expect(bad.weaponArt).toBeUndefined();
  });

  it('recovers legacy art binding when modern field is present but invalid', () => {
    const weapon = {
      id: 'mixed_blade',
      weaponArtId: 'missing_art',
      weaponArtSource: 'scroll',
      weaponArtBinding: { artId: 'sword_precise_cut', source: 'scroll' },
    };
    normalizeWeaponArtBinding(weapon, { validArtIds: new Set(['sword_precise_cut']) });
    expect(weapon.weaponArtIds).toEqual(['sword_precise_cut']);
    expect(weapon.weaponArtSources).toEqual(['scroll']);
    expect(weapon.weaponArtId).toBe('sword_precise_cut');
    expect(weapon.weaponArtSource).toBe('scroll');
    expect(weapon.weaponArtBinding).toBeUndefined();
  });
  it('normalizes canonical weaponArtIds with legacy fallback and slot cap', () => {
    const weapon = {
      id: 'multi_blade',
      weaponArtIds: ['bad_id', 'sword_precise_cut', 'sword_precise_cut', 'extra'],
      weaponArtSources: ['scroll', 'meta_innate', 'innate', 'scroll'],
      weaponArtBinding: { artId: 'legacy_art', source: 'scroll' },
    };
    normalizeWeaponArtBinding(weapon, {
      validArtIds: new Set(['sword_precise_cut', 'legacy_art']),
      maxSlots: 3,
    });
    expect(weapon.weaponArtIds).toEqual(['sword_precise_cut', 'legacy_art']);
    expect(weapon.weaponArtSources).toEqual(['meta_innate', 'scroll']);
  });

  it('preserves source alignment when invalid and duplicate ids are filtered', () => {
    const weapon = {
      id: 'source_alignment_blade',
      weaponArtIds: ['bad_id', 'sword_precise_cut', 'sword_precise_cut', 'sword_comet_edge'],
      weaponArtSources: ['scroll', 'meta_innate', 'innate', 'scroll'],
    };

    normalizeWeaponArtBinding(weapon, {
      validArtIds: new Set(['sword_precise_cut', 'sword_comet_edge']),
      maxSlots: 3,
    });

    expect(weapon.weaponArtIds).toEqual(['sword_precise_cut', 'sword_comet_edge']);
    expect(weapon.weaponArtSources).toEqual(['meta_innate', 'scroll']);
  });
});
