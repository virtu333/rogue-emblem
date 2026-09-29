// Team XP ("+N XP All" on a gold reward) levels the whole roster away from the
// battlefield's level-up cards. It used to do so silently: a unit reaching Lv 10
// learned its class skill (or found all five slots full) and nothing said so.
import { describe, expect, it, vi } from 'vitest';

const notices = [];
vi.mock('../src/ui/MobileRewards.js', () => ({
  MobileRewards: class {
    constructor() {
      this.steps = [];
    }
    showNotice(title, lines, onContinue) {
      notices.push({ title, lines, onContinue });
    }
    destroy() {}
    open() {}
    render() {}
    renderSaveFailure() {}
  },
}));

import { awardTeamXp, teamXpLines } from '../src/engine/TeamXp.js';
import { createUnit } from '../src/engine/UnitManager.js';
import { RunManager } from '../src/engine/RunManager.js';
import { prepareBattleRewards } from '../src/engine/PendingBattleRewards.js';
import { PendingRewardController } from '../src/ui/PendingRewardController.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const cls = (name) => data.classes.find((c) => c.name === name);
// The Myrmidon's class skill comes at Lv 10 (data, not the code under test).
const vantage = cls('Myrmidon').learnableSkills.find((e) => e.level === 10).skillId;
const vantageName = data.skills.find((s) => s.id === vantage).name;

function myrmidon(name, level, xp, skills = []) {
  const unit = createUnit(cls('Myrmidon'), level, data.weapons);
  Object.assign(unit, { name, xp, skills: [...skills], faction: 'player' });
  return unit;
}
const five = data.skills
  .filter((s) => s.id !== vantage)
  .slice(0, 5)
  .map((s) => s.id);

describe('awardTeamXp', () => {
  it('names who levelled, what they gained, and the class skill learned', () => {
    const kira = myrmidon('Kira', 9, 90);
    const hpBefore = kira.stats.HP;
    const report = awardTeamXp([kira], 25, data.classes);
    expect(kira.level).toBe(10);
    expect(kira.skills).toContain(vantage);
    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({ fromLevel: 9, toLevel: 10, learned: [vantage], blocked: [] });
    const [line] = teamXpLines(report, data.skills);
    expect(line.startsWith('Kira: Lv 9 → 10')).toBe(true);
    expect(line.endsWith(`Learned ${vantageName}.`)).toBe(true);
    // The gains shown are the gains applied.
    const hpGain = kira.stats.HP - hpBefore;
    expect(line.includes('+1 HP')).toBe(hpGain === 1);
  });

  it('a class skill that finds all five slots full is named, once', () => {
    const rowan = myrmidon('Rowan', 9, 90, five);
    const report = awardTeamXp([rowan], 25, data.classes);
    expect(rowan.skills).toEqual(five);
    expect(rowan.benchedSkills).toEqual([vantage]); // kept, not lost
    expect(report[0].blocked).toEqual([vantage]);
    expect(teamXpLines(report, data.skills)[0]).toContain(
      `${vantageName} is on the bench (all 5 slots are full).`,
    );
    // The next level-up retries it silently, as the battlefield card does.
    rowan.xp = 90;
    const again = awardTeamXp([rowan], 25, data.classes);
    expect(again[0].toLevel).toBe(11);
    expect(again[0].blocked).toEqual([]);
  });

  it('units that neither level nor learn are left out; no XP, no report', () => {
    const idle = myrmidon('Idle', 3, 0);
    expect(awardTeamXp([idle], 25, data.classes)).toEqual([]);
    expect(idle.xp).toBe(25);
    expect(awardTeamXp([myrmidon('Kira', 9, 90)], 0, data.classes)).toEqual([]);
  });
});

describe('claiming a team XP reward from the route map', () => {
  function setup() {
    const localStore = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k) => localStore.get(k) ?? null,
      setItem: (k, v) => localStore.set(k, v),
      removeItem: (k) => localStore.delete(k),
    });
    const runManager = new RunManager(data);
    runManager.startRun();
    const scene = {
      gameData: data,
      runManager,
      registry: { get: (k) => (k === 'activeSlot' ? 1 : null) },
      events: { once() {}, off() {} },
    };
    prepareBattleRewards(runManager, data, { isElite: false, goldEarned: 0 });
    return scene;
  }

  it('says who levelled before moving on, and moves on only after Continue', () => {
    notices.length = 0;
    const s = setup();
    const kira = myrmidon('Kira', 9, 90);
    s.runManager.roster.push(kira);
    s.runManager.pendingBattleReward.choices = [{ type: 'gold', goldAmount: 10, xpAmount: 25 }];
    const onComplete = vi.fn();
    const c = new PendingRewardController(s, { onLeave: vi.fn(), onComplete });
    c.activateReward(0);
    expect(kira.skills).toContain(vantage);
    expect(notices).toHaveLength(1);
    expect(notices[0].title).toBe('Team XP');
    expect(notices[0].lines.some((l) => l.startsWith('Kira: Lv 9 → 10'))).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();
    notices[0].onContinue();
    expect(onComplete).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
