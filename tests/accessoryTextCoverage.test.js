import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import {
  formatAccessoryCombatEffect,
  formatAccessoryDetail,
  HANDLED_ACCESSORY_COMBAT_EFFECT_KEYS,
  HANDLED_ACCESSORY_TURN_START_EFFECT_KEYS,
} from '../src/utils/accessoryText.js';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function getConditionLabel(condition) {
  if (condition === 'below50') return '<50% HP';
  if (condition === 'above75') return '>75% HP';
  if (condition === 'on_forest') return '(forest)';
  if (condition === 'no_ally_within_2') return 'no ally <=2';
  if (condition === 'enemies_nearby_2plus') return '2+ enemies <=2';
  if (condition === 'on_forest_or_mountain') return '(forest/mountain)';
  if (condition === 'isolated_duel') return 'isolated duel';
  return '';
}

function assertKeyRendered(key, combatText, accessory) {
  const combatEffects = accessory?.combatEffects || {};
  if (key === 'atkBonus') return combatText.includes('Atk');
  if (key === 'avoidBonus') return combatText.includes('Avo');
  if (key === 'buffDEF')
    return combatText.includes(String(combatEffects.buffDEF)) && combatText.includes('Def');
  if (key === 'buffRES')
    return combatText.includes(String(combatEffects.buffRES)) && combatText.includes('Res');
  if (key === 'condition') return combatText.includes(getConditionLabel(combatEffects.condition));
  if (key === 'critBonus') return combatText.includes('Crit');
  if (key === 'defBonus') return combatText.includes('Def');
  if (key === 'doubleThresholdReduction') return combatText.includes('Double at +');
  if (key === 'gamblerCoin') return combatText.includes('Gambler');
  if (key === 'goldPerKill') return combatText.includes(`${combatEffects.goldPerKill}g/kill`);
  if (key === 'hitBonus') return combatText.includes('Hit');
  if (key === 'moontide') return combatText.includes('Moontide');
  if (key === 'negateEffectiveness') return combatText.includes('Negate effectiveness');
  if (key === 'negateFlierWeakness') return combatText.includes('Negate bow flier weakness');
  if (key === 'perHitHeal') return combatText.includes('Heal +');
  if (key === 'phoenixBrooch') return combatText.includes('Phoenix');
  if (key === 'phoenixHeal') return combatText.includes(String(combatEffects.phoenixHeal));
  if (key === 'phoenixThreshold') return combatText.includes('% HP');
  if (key === 'preventEnemyDouble') return combatText.includes('Block double attacks');
  if (key === 'resBonus') return combatText.includes('Res');
  if (key === 'turnStartHealPercent') return combatText.includes('Turn start heal');
  if (key === 'weaponArtCostReduction')
    return combatText.includes(`Art HP Cost -${combatEffects.weaponArtCostReduction}`);
  if (key === 'weaponArtDefBuff') return combatText.includes('Recoil Guard');
  return true;
}

describe('accessory text coverage', () => {
  it('includes handlers for all combat/turn-start keys used in data', () => {
    const accessories = readJson('data/accessories.json');
    const unknownCombatKeys = new Set();
    const unknownTurnStartKeys = new Set();

    for (const accessory of accessories) {
      for (const key of Object.keys(accessory?.combatEffects || {})) {
        if (!HANDLED_ACCESSORY_COMBAT_EFFECT_KEYS.includes(key)) {
          unknownCombatKeys.add(key);
        }
      }
      for (const key of Object.keys(accessory?.turnStartEffects || {})) {
        if (!HANDLED_ACCESSORY_TURN_START_EFFECT_KEYS.includes(key)) {
          unknownTurnStartKeys.add(key);
        }
      }
    }

    const issues = [];
    if (unknownCombatKeys.size > 0) {
      issues.push(`Unknown combat effect keys: ${Array.from(unknownCombatKeys).sort().join(', ')}`);
    }
    if (unknownTurnStartKeys.size > 0) {
      issues.push(
        `Unknown turn-start effect keys: ${Array.from(unknownTurnStartKeys).sort().join(', ')}`,
      );
    }

    expect(issues, issues.join('\n')).toEqual([]);
  });

  it('renders specific detail text for every accessory with gameplay effects', () => {
    const accessories = readJson('data/accessories.json');

    for (const accessory of accessories) {
      const hasEffects = Object.keys(accessory?.effects || {}).length > 0;
      const hasCombatEffects = Object.keys(accessory?.combatEffects || {}).length > 0;
      const hasTurnStartEffects = Object.keys(accessory?.turnStartEffects || {}).length > 0;
      if (!hasEffects && !hasCombatEffects && !hasTurnStartEffects) continue;

      const detail = formatAccessoryDetail(accessory);
      expect(detail, `${accessory.name} should render accessory detail text`).not.toBe('');
      expect(detail, `${accessory.name} should not render placeholder combat text`).not.toContain(
        'Combat effect',
      );
    }
  });

  it('renders meaningful combat text for each combat key used in data', () => {
    const accessories = readJson('data/accessories.json');

    for (const accessory of accessories) {
      const combatEffects = accessory?.combatEffects || {};
      const keys = Object.keys(combatEffects);
      if (keys.length <= 0) continue;

      const combatText = formatAccessoryCombatEffect(accessory);
      expect(combatText, `${accessory.name} should render combat text`).not.toBe('');
      expect(combatText, `${accessory.name} should not fall back to placeholder`).not.toBe(
        'Combat effect',
      );

      for (const key of keys) {
        const rendered = assertKeyRendered(key, combatText, accessory);
        expect(
          rendered,
          `${accessory.name} should render key "${key}" in combat text. got: "${combatText}"`,
        ).toBe(true);
      }
    }
  });
});
