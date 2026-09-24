import { describe, it, expect } from 'vitest';
import { revivalCatchUpPlan, applyRevivalCatchUp } from '../src/engine/RevivalCatchUp.js';
import { RunManager } from '../src/engine/RunManager.js';
import { reviveAtChurch } from '../src/engine/ChurchCommands.js';
import { createUnit } from '../src/engine/UnitManager.js';
import { XP_STAT_NAMES } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';
const data = loadGameData();
const ally = (level, tier = 'base') => ({ level, tier, currentHP: 20 });
const fallen = () => ({
  name: 'Ally',
  className: 'Mage',
  tier: 'base',
  level: 2,
  xp: 35,
  currentHP: 0,
  stats: { ...Object.fromEntries(XP_STAT_NAMES.map((s) => [s, 5])), HP: 20, MOV: 5 },
  growths: { ...Object.fromEntries(XP_STAT_NAMES.map((s) => [s, 60])), HP: 100, SPD: 5 },
  skills: [],
});
describe('revival catch-up', () => {
  it('averages only living allies, never downlevels, and preserves promotion gates', () => {
    expect(
      revivalCatchUpPlan(fallen(), [ally(8), ally(11), { ...ally(20), currentHP: 0 }]).targetLevel,
    ).toBe(9);
    expect(revivalCatchUpPlan({ ...fallen(), level: 15 }, [ally(3)]).levels).toBe(0);
    expect(revivalCatchUpPlan(fallen(), [ally(20, 'promoted')]).targetLevel).toBe(20);
    expect(
      revivalCatchUpPlan({ ...fallen(), tier: 'promoted' }, [ally(5, 'promoted'), ally(19)])
        .targetLevel,
    ).toBe(6);
    expect(revivalCatchUpPlan(fallen(), []).levels).toBe(0);
  });
  it('subtracts ten percentage points only for missed levels and preserves future growths, XP and MOV', () => {
    const u = fallen(),
      growths = u.growths;
    applyRevivalCatchUp(u, [ally(5)], [], () => 0.52);
    expect(u.level).toBe(5);
    expect(u.stats.HP).toBe(23);
    expect(u.stats.STR).toBe(5); // 60 - 10 = 50%, not 60 * .9 = 54% or normal 60%.
    expect(u.stats.SPD).toBe(5);
    expect(u.stats.MOV).toBe(5);
    expect(u.growths).toBe(growths);
    expect(u.growths.STR).toBe(60);
    expect(u.xp).toBe(35);
  });
  it('keeps the normal no-empty-level rule and awards crossed skill milestones', () => {
    const u = fallen();
    const result = applyRevivalCatchUp(
      u,
      [ally(5)],
      [{ name: 'Mage', learnableSkills: [{ level: 4, skillId: 'test_skill' }] }],
      () => 0.999,
    );
    expect(u.stats.HP).toBe(23);
    expect(u.skills).toContain('test_skill');
    expect(result.learnedSkills).toEqual(['test_skill']);
  });
  it('production revive charges once, returns at 1 HP, is deterministic, and round-trips catch-up stats', () => {
    const run = new RunManager(data);
    run.startRun();
    run.runSeed = 42;
    run.gold = 10000;
    run.roster = [run.roster[0]];
    run.roster[0].level = 10;
    const living = structuredClone(run.roster);
    const u = createUnit(
      data.classes.find((c) => c.name === 'Mage'),
      2,
      data.weapons,
      { name: 'Fallen Mage' },
    );
    u.currentHP = 0;
    run.fallenUnits = [u];
    const initial = structuredClone(u),
      growths = structuredClone(u.growths);
    expect(reviveAtChurch(run, u).ok).toBe(true);
    expect(u.level).toBe(10);
    expect(u.currentHP).toBe(1);
    expect(u.growths).toEqual(growths);
    const gold = run.gold;
    expect(reviveAtChurch(run, u).ok).toBe(false);
    expect(run.gold).toBe(gold);
    const again = new RunManager(data);
    again.runSeed = 42;
    again.gold = 10000;
    again.roster = living;
    again.fallenUnits = [initial];
    expect(reviveAtChurch(again, initial).ok).toBe(true);
    expect(initial.stats).toEqual(u.stats);
    const restored = RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), data);
    const revived = restored.roster.find((a) => a.name === u.name);
    expect(revived.level).toBe(10);
    expect(revived.stats).toEqual(u.stats);
    expect(revived.growths).toEqual(growths);
  });
  it.each([false, true])('reports catch-up skills at church (at cap: %s)', (atCap) => {
    const gameData = structuredClone(data);
    gameData.classes.find((c) => c.name === 'Mage').learnableSkills = [
      { level: 4, skillId: 'catchup_test' },
    ];
    gameData.skills.push({ id: 'catchup_test', name: 'Catch-up Skill' });
    const run = new RunManager(gameData);
    run.startRun();
    run.gold = 10000;
    run.roster[0].level = 10;
    run.roster = [run.roster[0]];
    const u = createUnit(
      gameData.classes.find((c) => c.name === 'Mage'),
      2,
      gameData.weapons,
      { name: 'Lost Mage' },
    );
    u.currentHP = 0;
    u.skills = atCap ? ['a', 'b', 'c', 'd', 'e'] : [];
    run.fallenUnits = [u];
    const result = reviveAtChurch(run, u);
    expect(result.ok).toBe(true);
    expect(result.message).toContain(
      atCap ? 'could not learn Catch-up Skill' : 'Learned: Catch-up Skill',
    );
  });
});
