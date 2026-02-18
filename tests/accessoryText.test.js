import { describe, expect, it } from 'vitest';
import { formatAccessoryCombatEffect, formatAccessoryDetail, formatAccessoryEffects } from '../src/utils/accessoryText.js';

describe('accessory text helpers', () => {
  it('formats stat effects in stable order', () => {
    const accessory = { effects: { DEF: 2, STR: 1, LCK: 5 } };
    expect(formatAccessoryEffects(accessory)).toBe('+1 STR +5 LCK +2 DEF');
  });

  it('returns empty stat text for null or empty effects', () => {
    expect(formatAccessoryEffects(null)).toBe('');
    expect(formatAccessoryEffects({ effects: {} })).toBe('');
  });

  it('honors custom stat separator including empty string', () => {
    const accessory = { effects: { STR: 1, DEF: 2 } };
    expect(formatAccessoryEffects(accessory, { separator: '' })).toBe('+1 STR+2 DEF');
  });

  it('formats combat effects with condition labels', () => {
    const accessory = { combatEffects: { critBonus: 15, condition: 'below50' } };
    expect(formatAccessoryCombatEffect(accessory)).toBe('+15 Crit <50% HP');
  });

  it('formats non-crit combat effects', () => {
    expect(formatAccessoryCombatEffect({ combatEffects: { preventEnemyDouble: true } })).toBe('Block double attacks');
    expect(formatAccessoryCombatEffect({ combatEffects: { doubleThresholdReduction: 2 } })).toBe('Double at +3 SPD');
    expect(formatAccessoryCombatEffect({ combatEffects: { negateEffectiveness: true } })).toBe('Negate effectiveness');
  });

  it('formats multi-bonus combat effects and condition', () => {
    const accessory = { combatEffects: { atkBonus: 2, defBonus: 1, avoidBonus: 15, condition: 'above75' } };
    expect(formatAccessoryCombatEffect(accessory)).toBe('+2 Atk/+1 Def/+15 Avo >75% HP');
  });

  it('renders crit with other bonuses without masking later effects', () => {
    const accessory = { combatEffects: { critBonus: 10, atkBonus: 3, condition: 'isolated_duel' } };
    expect(formatAccessoryCombatEffect(accessory)).toBe('+10 Crit/+3 Atk isolated duel');
  });

  it('supports new accessory condition and effect labels', () => {
    const accessory = {
      combatEffects: {
        weaponArtHpCostReduction: 5,
        perHitHeal: 2,
        condition: 'on_forest_or_mountain',
      },
    };
    expect(formatAccessoryCombatEffect(accessory)).toBe('Art HP Cost -5/Heal +2/hit (forest/mountain)');
  });

  it('formats turn-start accessory effects for Soothing Stone-style items', () => {
    const accessory = {
      turnStartEffects: {
        healSelfPercent: 20,
      },
    };
    expect(formatAccessoryCombatEffect(accessory)).toBe('Turn start heal 20% HP');
    expect(formatAccessoryDetail(accessory)).toBe('Turn start heal 20% HP');
  });

  it('falls back to generic combat text for unknown combat effects', () => {
    const accessory = { combatEffects: { mysteryFlag: true } };
    expect(formatAccessoryCombatEffect(accessory)).toBe('Combat effect');
  });

  it('combines stats and combat detail text', () => {
    const accessory = { effects: { STR: 2 }, combatEffects: { negateEffectiveness: true } };
    expect(formatAccessoryDetail(accessory)).toBe('+2 STR | Negate effectiveness');
  });

  it('supports detail options for separator, fallback, and include flags', () => {
    const accessory = { effects: { STR: 2 }, combatEffects: { negateEffectiveness: true } };
    expect(formatAccessoryDetail(accessory, { separator: ' / ' })).toBe('+2 STR / Negate effectiveness');
    expect(formatAccessoryDetail(accessory, { separator: '' })).toBe('+2 STRNegate effectiveness');
    expect(formatAccessoryDetail(accessory, { includeCombat: false })).toBe('+2 STR');
    expect(formatAccessoryDetail(accessory, { includeStats: false })).toBe('Negate effectiveness');
    expect(formatAccessoryDetail({}, { fallback: 'None' })).toBe('None');
  });
});
