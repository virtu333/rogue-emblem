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
import { postCombatEffects, runPostCombatEffectsSync } from '../src/engine/PostCombatEffects.js';
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

describe('Grievous through the post-combat effects (scene and harness alike)', () => {
  const strike = (attackerSide, miss = false) => ({ type: 'strike', attackerSide, miss });
  const world = { affixes: data.affixes, alliesOf: () => [], hostilesOf: () => [] };
  const fight = (events) => {
    const foe = {
      name: 'Brute',
      faction: 'enemy',
      affixes: ['grievous'],
      currentHP: 20,
      stats: { HP: 20 },
    };
    const hero = unit(10);
    const beats = [
      ...postCombatEffects({ attacker: foe, defender: hero, result: { events } }, world),
    ];
    return { hero, beats };
  };

  it('a landed hit leaves the defender Wounded and says so', () => {
    const { hero, beats } = fight([strike('attacker')]);
    expect(isWounded(hero)).toBe(true);
    expect(beats).toContainEqual({ kind: 'status', unit: hero, status: 'wounded' });
    expect(beats).toContainEqual({ kind: 'hint', unit: hero, text: 'Wounded', tone: 'bad' });
  });

  it('a miss, or only the defender landing, wounds no one', () => {
    for (const events of [[strike('attacker', true)], [strike('defender')]]) {
      const { hero, beats } = fight(events);
      expect(isWounded(hero)).toBe(false);
      expect(beats.some((b) => b.kind === 'status')).toBe(false);
    }
  });
});
