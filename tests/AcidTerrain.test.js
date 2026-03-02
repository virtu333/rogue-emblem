import { describe, expect, it } from 'vitest';
import {
  applyCondition,
  getConditions,
  hasCondition,
  isAcidPoisoned,
  processConditionRecovery,
} from '../src/engine/StatusConditionSystem.js';
import { computeAcidDamage, isAcidTerrainIndex } from '../src/engine/TerrainHazards.js';
import { STATUS_CONDITIONS, TERRAIN } from '../src/utils/constants.js';

describe('Acid terrain and condition', () => {
  it('acid condition defaults to configured duration and can be queried', () => {
    const unit = { name: 'Test', stats: { HP: 40 } };
    applyCondition(unit, 'acid');

    expect(isAcidPoisoned(unit)).toBe(true);
    expect(getConditions(unit)).toEqual([{ id: 'acid', turnsRemaining: 3 }]);
  });

  it('acid recovery is duration-based only (no random early recovery)', () => {
    const unit = { name: 'Test', stats: { HP: 40 } };
    applyCondition(unit, 'acid', 3);

    expect(processConditionRecovery([unit], () => 0)).toEqual([]);
    expect(getConditions(unit)[0].turnsRemaining).toBe(2);

    expect(processConditionRecovery([unit], () => 0)).toEqual([]);
    expect(getConditions(unit)[0].turnsRemaining).toBe(1);

    const events = processConditionRecovery([unit], () => 0);
    expect(events).toHaveLength(1);
    expect(events[0].conditionId).toBe('acid');
    expect(hasCondition(unit, 'acid')).toBe(false);
  });

  it('reapplying acid refreshes duration and does not stack', () => {
    const unit = { name: 'Test', stats: { HP: 40 } };
    applyCondition(unit, 'acid', 1);
    applyCondition(unit, 'acid');

    expect(getConditions(unit)).toHaveLength(1);
    expect(getConditions(unit)[0].turnsRemaining).toBe(3);
  });

  it('acid terrain helpers classify only acidic terrain indices', () => {
    expect(isAcidTerrainIndex(TERRAIN.AcidicSwamp)).toBe(true);
    expect(isAcidTerrainIndex(TERRAIN.AcidicBog)).toBe(true);
    expect(isAcidTerrainIndex(TERRAIN.Swamp)).toBe(false);
    expect(isAcidTerrainIndex(TERRAIN.Bog)).toBe(false);
    expect(isAcidTerrainIndex(TERRAIN.LavaCrack)).toBe(false);
  });

  it('computeAcidDamage uses ceil(5% maxHP), min 1, max 10', () => {
    expect(computeAcidDamage(1)).toBe(1);
    expect(computeAcidDamage(20)).toBe(1);
    expect(computeAcidDamage(40)).toBe(2);
    expect(computeAcidDamage(100)).toBe(5);
    expect(computeAcidDamage(200)).toBe(10);
  });

  it('acid constant shape matches spec', () => {
    expect(STATUS_CONDITIONS.acid).toEqual({
      maxTurns: 3,
      recoveryChance: 0,
      wakesOnDamage: false,
    });
  });
});
