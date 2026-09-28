import { describe, expect, it } from 'vitest';
import {
  applyCondition,
  getConditions,
  hasCondition,
  isAcidPoisoned,
  processConditionRecovery,
} from '../src/engine/StatusConditionSystem.js';
import { computeAcidDamage, isAcidTerrainIndex } from '../src/engine/TerrainHazards.js';
import { ACID_TERRAIN_TYPES, STATUS_CONDITIONS, TERRAIN } from '../src/utils/constants.js';
import { statusDescriptions, terrainRuleLines } from '../src/engine/BattleInformation.js';
import { terrainHelp } from '../src/ui/helpTopics.js';
import { loadGameData } from './testData.js';

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

describe('acid ground says what Acid does and for how long', () => {
  const data = loadGameData();
  // Independent of the text builder: replay the engine's order. Standing on the
  // ground at the end of a phase applies Acid (processTerrainDamage); each turn
  // start counts conditions down, then an Acid unit takes its tick.
  function acidTicksAfterLeaving() {
    const unit = { name: 'Probe', stats: { HP: 40 } };
    applyCondition(unit, 'acid');
    let ticks = 0;
    for (let turn = 0; turn < 10; turn++) {
      processConditionRecovery([unit], () => 0);
      if (!isAcidPoisoned(unit)) break;
      ticks++;
    }
    return ticks;
  }
  const pct = computeAcidDamage(100); // 100 max HP: the tick in percent
  const acidTerrains = data.terrain.filter((t) => t.hazardStatus);

  it('names the status, its damage and its real number of turns (the playtest read "Acid (2T)")', () => {
    const ticks = acidTicksAfterLeaving();
    expect(ticks).toBeGreaterThan(1);
    expect(acidTerrains.map((t) => t.name)).toEqual(['Acidic Swamp', 'Acidic Bog']);
    for (const terrain of acidTerrains) {
      expect(terrainRuleLines(terrain), terrain.name).toEqual([
        'Ending a turn here causes Acid. Flying units are immune.',
        `Acid: loses ${pct}% of max HP at turn start, for ${ticks} turns. Never below 1 HP.`,
        terrain.special,
      ]);
    }
    expect(terrainRuleLines(acidTerrains[0]).at(-1)).toBe('Infantry and Flying only.');
    expect(terrainRuleLines(acidTerrains[1]).at(-1)).toBe('Slow for all.');
  });

  it("the unit's Acid line uses the same words", () => {
    const unit = { name: 'Probe', stats: { HP: 40 } };
    applyCondition(unit, 'acid');
    processConditionRecovery([unit], () => 0);
    const left = getConditions(unit)[0].turnsRemaining;
    expect(statusDescriptions(unit)).toEqual([
      `Acid · ${left} turns. Loses ${pct}% of max HP at turn start. Never below 1 HP.`,
    ]);
  });

  it('only the ground the engine treats as acid says so, and no terrain note hides a turn count', () => {
    const flagged = data.terrain.flatMap((t, i) => (t.hazardStatus === 'acid' ? [i] : []));
    expect(new Set(flagged)).toEqual(ACID_TERRAIN_TYPES);
    for (const t of data.terrain) {
      expect(t.special, t.name).not.toMatch(/\(\d+T\)|\bAcid\b/);
      expect(terrainRuleLines(t).join(' '), t.name).not.toMatch(/\(\d+T\)/);
    }
    // Other terrain keeps its own note, unchanged.
    expect(terrainRuleLines(data.terrain[TERRAIN.LavaCrack])).toEqual([data.terrain[TERRAIN.LavaCrack].special]); // prettier-ignore
    expect(terrainRuleLines(data.terrain[TERRAIN.Plain])).toEqual([]);
  });

  it('Terrain details (phones) lead with the same lines', () => {
    const [swamp] = acidTerrains;
    expect(terrainHelp(swamp, 'Infantry')[0]).toEqual({ lead: terrainRuleLines(swamp).join(' ') });
  });
});
