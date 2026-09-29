// An act-scoped stat blessing or cost ("+2 STR to all units in Act 1", "-1 DEF to all
// units in Act 1") is taken back at the act's end. It used to be taken back from the
// whole roster, so a recruit who joined during the act (and never had it) lost 2 STR,
// or gained 1 DEF, for the rest of the run.
import { describe, expect, it } from 'vitest';
import { RunManager, loadRun } from '../src/engine/RunManager.js';
import { createUnit } from '../src/engine/UnitManager.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

function runWith(effects) {
  const rm = new RunManager(data);
  rm.startRun();
  rm.activeBlessings = [{ id: 'coin_of_fate', rolledCost: { label: 'test', effects } }];
  rm._runStartBlessingsApplied = false;
  rm.applyRunStartBlessingEffects();
  return rm;
}
function recruit(rm, name) {
  const unit = createUnit(
    data.classes.find((c) => c.name === 'Fighter'),
    4,
    data.weapons,
    {
      name,
    },
  );
  unit.faction = 'player';
  unit.baseStats = { ...unit.stats }; // before joining
  rm.grantRecruitBlessingConsumables(unit); // every join path calls it
  rm.roster.push(unit);
  return unit;
}

describe('act-scoped stat blessings and costs', () => {
  it('a recruit who joins mid-act takes the delta and gives it back at the act’s end', () => {
    const rm = runWith([
      { type: 'act_stat_delta_all_units', params: { act: 'act1', stat: 'STR', value: 2 } },
    ]);
    const lord = rm.roster[0];
    const lordStr = lord.stats.STR; // already +2
    const kira = recruit(rm, 'Kira');
    const kiraBase = kira.baseStats.STR;
    expect(kira.stats.STR).toBe(kiraBase + 2);
    rm.advanceAct();
    expect(lord.stats.STR).toBe(lordStr - 2);
    expect(kira.stats.STR).toBe(kiraBase);
  });

  it('a cost (-1 DEF in Act 1) never leaves a later recruit with +1 DEF', () => {
    const rm = runWith([
      { type: 'act_stat_delta_all_units', params: { act: 'act1', stat: 'DEF', value: -1 } },
    ]);
    const kira = recruit(rm, 'Kira');
    expect(kira.stats.DEF).toBe(kira.baseStats.DEF - 1);
    rm.advanceAct();
    expect(kira.stats.DEF).toBe(kira.baseStats.DEF); // its own DEF, never above it
    // Joining after the act: no delta at all.
    const late = recruit(rm, 'Late');
    const lateDef = late.stats.DEF;
    rm.advanceAct();
    expect(late.stats.DEF).toBe(lateDef);
  });

  it('holders survive a save and reload; a second join call is a no-op', () => {
    const rm = runWith([
      { type: 'act_stat_delta_all_units', params: { act: 'act1', stat: 'STR', value: 2 } },
    ]);
    const kira = recruit(rm, 'Kira');
    const str = kira.stats.STR;
    rm.grantRecruitBlessingConsumables(kira);
    expect(kira.stats.STR).toBe(str);
    const restored = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    const again = restored.roster.find((u) => u.name === 'Kira');
    restored.advanceAct();
    expect(again.stats.STR).toBe(str - 2);
  });
});
