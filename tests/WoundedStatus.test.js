// Wounded (playtest 2026-09-28, Wave 4): an anti-heal status from enemy Grievous hits.
// The unit recovers no HP except from a staff: no drain, items, Renewal or forts.
import { describe, expect, it } from 'vitest';
import { healUnit, healUnitFully, setUnitHP } from '../src/engine/UnitHealth.js';
import {
  applyCondition,
  isWounded,
  processConditionRecovery,
} from '../src/engine/StatusConditionSystem.js';
import { applyGrievousStatus, getAttackAffixes } from '../src/engine/AffixSystem.js';
import { statusDescriptions } from '../src/engine/BattleInformation.js';
import { RunManager } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const unit = (hp = 10) => ({ name: 'Kira', faction: 'player', currentHP: hp, stats: { HP: 30 } });

describe('Wounded', () => {
  it('blocks every heal but a staff’s (which sets HP directly)', () => {
    const u = unit(10);
    applyCondition(u, 'wounded', 3, { recoveryChance: 0 });
    expect(isWounded(u)).toBe(true);
    expect(healUnit(u, 10)).toBe(0);
    expect(healUnitFully(u)).toBe(0);
    expect(u.currentHP).toBe(10);
    setUnitHP(u, 20); // the staff path (HealController → resolveHeal → setUnitHP)
    expect(u.currentHP).toBe(20);
    const healthy = unit(10);
    expect(healUnit(healthy, 10)).toBe(10);
  });

  it('Grievous hits inflict it for the target’s next 2 turns, never cut short by luck', () => {
    const foe = { affixes: ['grievous'] };
    const result = getAttackAffixes(foe, data.affixes);
    expect(result).toMatchObject({ inflictStatus: 'wounded', statusTurns: 2 });
    const u = unit();
    expect(applyGrievousStatus(u, result)).toBe(true);
    const lucky = () => 0; // a roll that would end any condition with a recovery chance
    processConditionRecovery([u], lucky); // turn 1 starts
    expect(isWounded(u)).toBe(true);
    processConditionRecovery([u], lucky); // turn 2 starts
    expect(isWounded(u)).toBe(true);
    processConditionRecovery([u], lucky); // turn 3: gone
    expect(isWounded(u)).toBe(false);
  });

  it('is described where the unit is inspected', () => {
    const u = unit();
    applyCondition(u, 'wounded', 2);
    const text = JSON.stringify(statusDescriptions(u));
    expect(text).toContain('Wounded');
    expect(text).toContain('except from a staff');
  });

  it('ends with the battle: the roster never carries it onto the route map', () => {
    const rm = new RunManager(data);
    rm.startRun();
    const survivors = rm.roster.map((u) => ({
      ...u,
      _conditions: [{ id: 'wounded', turnsRemaining: 2 }],
    }));
    rm.completeBattle(survivors, rm.getAvailableNodes()[0]?.id ?? 'n0', 0);
    for (const u of rm.roster) expect(isWounded(u)).toBe(false);
    rm.roster[0].currentHP = 1;
    expect(healUnitFully(rm.roster[0])).toBeGreaterThan(0);
  });
});
