// Skills and abilities fill separate slots (owner, 2026-10-11): up to MAX_SKILLS skills and,
// apart from them, MAX_ABILITIES abilities (`trigger: "action"`: Shove, Pull, Dance, Steal,
// Blink, Blink Strike...). One `unit.skills` list holds both; the cap is counted per kind.
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import { createUnit, learnSkill } from '../src/engine/UnitManager.js';
import {
  equipSkill,
  equipSkillBlock,
  settleSlotOverflow,
  swapCandidatesFor,
} from '../src/engine/SkillLoadout.js';
import {
  ABILITY_SLOT,
  SKILL_SLOT,
  benchSlotOverflow,
  isAbilitySkill,
  setSingleSlotPoolForSims,
  slotCountsOf,
  slotKindOf,
} from '../src/engine/SkillSlots.js';
import { teachRosterScroll } from '../src/engine/RosterTransfers.js';
import { MAX_ABILITIES, MAX_SKILLS } from '../src/utils/constants.js';

const data = loadGameData();
const cls = (name) => data.classes.find((c) => c.name === name);
const FIVE = ['sol', 'luna', 'astra', 'vantage', 'wrath'];
const player = (className, name, level = 1) => {
  const unit = createUnit(cls(className), level, data.weapons, { name });
  unit.faction = 'player';
  return unit;
};

describe('which skills are abilities', () => {
  it('every action skill and only those, read from the data', () => {
    // Listed by hand from skills.json (the trigger is the rule; this pins the outcome).
    const abilities = [
      'shove',
      'pull',
      'dance',
      'blink',
      'rally_cry_skill',
      'healing_circle',
      'ensnare',
      'smite',
      'transfuse',
      'great_sacrifice',
      'goddess_dance',
      'blink_strike',
      'steal',
    ];
    for (const id of abilities) expect(isAbilitySkill(id), id).toBe(true);
    const counted = data.skills.filter((s) => isAbilitySkill(s.id)).map((s) => s.id);
    expect(new Set(counted)).toEqual(new Set(abilities));
    for (const id of [...FIVE, 'pass', 'canto', 'charisma', 'not_a_skill'])
      expect(slotKindOf(id), id).toBe(SKILL_SLOT);
  });
});

describe('learning', () => {
  it('five full skill slots leave the ability slots open, and the reverse', () => {
    const unit = player('Fighter', 'Kira');
    unit.skills = [...FIVE];
    expect(learnSkill(unit, 'shove')).toEqual({ learned: true, skillId: 'shove' });
    expect(learnSkill(unit, 'pull').learned).toBe(true);
    expect(learnSkill(unit, 'blink').learned).toBe(true);
    expect(slotCountsOf(unit)).toEqual({ skills: MAX_SKILLS, abilities: MAX_ABILITIES });
    // Each pool is full now: a fourth ability and a sixth skill both wait on the bench.
    expect(learnSkill(unit, 'smite')).toMatchObject({ learned: false, benched: true, reason: 'at_cap' }); // prettier-ignore
    expect(learnSkill(unit, 'pavise')).toMatchObject({ learned: false, benched: true });
    expect(unit.benchedSkills).toEqual(['smite', 'pavise']);
    expect(unit.skills).toHaveLength(MAX_SKILLS + MAX_ABILITIES);
  });

  it('a scroll of an ability equips into a free ability slot beside five skills', () => {
    const run = new RunManager(data);
    run.startRun();
    const unit = player('Mage', 'Ilse');
    unit.skills = [...FIVE];
    run.roster.push(unit);
    const scroll = data.weapons.find((w) => w.skillId === 'blink_strike');
    run.scrolls = [...(run.scrolls || []), { ...scroll }];
    const result = teachRosterScroll(run, unit, run.scrolls.at(-1), data.skills);
    expect(result.ok).toBe(true);
    expect(result.benched).toBeFalsy();
    expect(unit.skills).toContain('blink_strike');
  });

  it('a Thief’s Steal fills an ability slot, not one of the five', () => {
    const unit = player('Thief', 'Wren');
    unit.skills = ['steal', ...FIVE];
    expect(slotCountsOf(unit)).toEqual({ skills: MAX_SKILLS, abilities: 1 });
    expect(learnSkill(unit, 'blink').learned).toBe(true);
  });
});

describe('the pre-split rule, for a paired sim (sim:descent --slots single)', () => {
  it('counts abilities in the five skill slots while on, and is off by default', () => {
    const unit = player('Thief', 'Wren');
    unit.skills = ['steal', 'sol', 'luna', 'astra', 'vantage'];
    // Today's rule: Steal is an ability, so a fifth skill still fits.
    expect(learnSkill(unit, 'wrath').learned).toBe(true);
    const before = player('Thief', 'Wren');
    before.skills = ['steal', 'sol', 'luna', 'astra', 'vantage'];
    setSingleSlotPoolForSims(true);
    try {
      expect(slotKindOf('steal')).toBe(SKILL_SLOT);
      expect(learnSkill(before, 'wrath')).toMatchObject({ learned: false, benched: true });
      expect(before.skills).toHaveLength(MAX_SKILLS);
    } finally {
      setSingleSlotPoolForSims(false);
    }
    expect(slotKindOf('steal')).toBe(ABILITY_SLOT);
  });
});

describe('swapping', () => {
  it('a full pool makes room only by benching one of its own kind', () => {
    const unit = player('Fighter', 'Kira');
    unit.skills = [...FIVE, 'shove', 'pull', 'blink'];
    unit.benchedSkills = ['smite', 'pavise'];
    expect(equipSkillBlock(unit, 'smite', null, data)).toMatch(/All 3 ability slots are full/);
    expect(equipSkillBlock(unit, 'smite', 'sol', data)).toMatch(/bench an ability/);
    expect(equipSkillBlock(unit, 'pavise', 'shove', data)).toMatch(/bench a skill/);
    expect(swapCandidatesFor(unit, 'smite', data)).toEqual(['shove', 'pull', 'blink']);
    expect(swapCandidatesFor(unit, 'pavise', data)).toEqual(FIVE);
    expect(equipSkill(unit, 'smite', 'pull', data)).toBe('');
    expect(unit.skills).toEqual([...FIVE, 'shove', 'smite', 'blink']);
    expect(unit.benchedSkills).toEqual(['pavise', 'pull']);
  });
});

describe('saves from before the split', () => {
  it('more abilities than slots: the overflow goes to the bench once, locked ones kept', () => {
    const unit = player('Thief', 'Wren');
    // Old saves allowed five of any kind; Steal (the class's) last in the list.
    unit.skills = ['shove', 'pull', 'blink', 'smite', 'steal'];
    unit.benchedSkills = [];
    expect(settleSlotOverflow(unit, data)).toEqual(['blink', 'smite']);
    expect(unit.skills).toEqual(['shove', 'pull', 'steal']);
    expect(unit.benchedSkills).toEqual(['blink', 'smite']);
    expect(unit.benchedUnseen).toEqual(['blink', 'smite']);
    expect(settleSlotOverflow(unit, data)).toEqual([]); // settled: nothing more moves
  });

  it('a loaded run settles every roster unit; one within both caps is untouched', () => {
    const run = new RunManager(data);
    run.startRun();
    const crowded = player('Fighter', 'Kira');
    crowded.skills = ['sol', 'shove', 'pull', 'blink', 'smite'];
    const fine = player('Fighter', 'Bram');
    fine.skills = ['sol', 'shove'];
    run.roster.push(crowded, fine);
    const restored = RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), data);
    const kira = restored.roster.find((u) => u.name === 'Kira');
    expect(kira.skills).toEqual(['sol', 'shove', 'pull', 'blink']);
    expect(kira.benchedSkills).toEqual(['smite']);
    const bram = restored.roster.find((u) => u.name === 'Bram');
    expect(bram.skills).toEqual(['sol', 'shove']);
    expect(bram.benchedSkills ?? []).toEqual([]);
  });

  it('enemies are never benched', () => {
    const foe = { faction: 'enemy', skills: ['shove', 'pull', 'blink', 'smite'] };
    expect(benchSlotOverflow(foe)).toEqual([]);
    expect(foe.skills).toHaveLength(4);
  });

  it('the kinds are counted by the data the caller passes', () => {
    expect(slotKindOf('shove', [{ id: 'shove', trigger: 'passive' }])).toBe(SKILL_SLOT);
    expect(slotKindOf('sol', [{ id: 'sol', trigger: 'action' }])).toBe(ABILITY_SLOT);
  });
});
