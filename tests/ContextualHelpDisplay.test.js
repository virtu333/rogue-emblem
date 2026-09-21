import { describe, it, expect } from 'vitest';
import {
  formatWeaponArtEffects,
  weaponArtCostText,
  weaponArtUsesText,
} from '../src/ui/weaponArtDisplay.js';
import { getCombatForecast } from '../src/engine/Combat.js';
import { getWeaponArtCombatMods } from '../src/engine/WeaponArtSystem.js';
import { proficiencyLabel } from '../src/ui/rosterDisplay.js';
import { loadGameData } from './testData.js';
const data = loadGameData();
const art = (id) => data.weaponArts.arts.find((entry) => entry.id === id);

describe('contextual combat explanations', () => {
  it('makes flavor-only arts show their actual numeric effects', () => {
    expect(formatWeaponArtEffects(art('sword_wrath_strike'))).toContain('+5 Attack · +10 Hit');
    expect(formatWeaponArtEffects(art('sword_dueling_blade'))).toContain('+30 Avoid');
    expect(formatWeaponArtEffects(art('sword_grounder'))).toContain(
      '×3 weapon might against flying',
    );
  });
  it('effectiveness multiplies weapon might, not total attack or final damage', () => {
    const grounder = art('sword_grounder');
    const unit = {
      stats: { HP: 30, STR: 10, MAG: 0, SKL: 10, SPD: 10, LCK: 0, DEF: 4, RES: 4 },
      currentHP: 30,
    };
    const defender = { ...unit, moveType: 'Flying', stats: { ...unit.stats, DEF: 6 } };
    const sword = { type: 'Sword', might: 5, weight: 0, hit: 100, crit: 0, range: '1' };
    const ordinary = getCombatForecast(unit, sword, defender, null, 1, null, null);
    const effective = getCombatForecast(unit, sword, defender, null, 1, null, null, {
      atkMods: getWeaponArtCombatMods(grounder),
    });
    expect(ordinary.attacker.damage).toBe(10 + 5 - 6);
    expect(effective.attacker.damage).toBe(10 + 5 * 3 - 6);
    expect(effective.attacker.damage).not.toBe(ordinary.attacker.damage * 3);
    expect(formatWeaponArtEffects(grounder)).toContain('×3 weapon might');
    expect(formatWeaponArtEffects(grounder)).not.toContain('triple damage');
  });
  it('uses effective accessory and blessing HP cost rather than authored base cost', () => {
    const unit = { accessory: { combatEffects: { bloodGem: true } } };
    expect(weaponArtCostText(unit, { hpCost: 8 }, { weaponArtHpCostDelta: -1 })).toBe(
      'HP cost 2 (base 8)',
    );
    expect(weaponArtCostText(unit, { hpCost: 3 })).toBe('HP cost 1 (base 3)');
  });
  it('labels remaining uses and resets the per-turn view at the next turn', () => {
    const a = { id: 'test', perMapLimit: 3, perTurnLimit: 1 };
    const unit = { _battleWeaponArtUsage: { map: { test: 2 }, turn: { test: 1 }, turnKey: '3' } };
    expect(weaponArtUsesText(unit, a, 3)).toBe('1/3 map uses left · 0/1 turn uses left');
    expect(weaponArtUsesText(unit, a, 4)).toBe('1/3 map uses left · 1/1 turn uses left');
  });
  it('distinguishes proficiency rank from class mastery', () => {
    expect(proficiencyLabel({ type: 'Sword', rank: 'Prof' })).toBe('Sword: Proficient');
    expect(proficiencyLabel({ type: 'Staff', rank: 'Mast' })).toBe('Staff: Master');
  });
});
