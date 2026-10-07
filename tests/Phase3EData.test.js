// Phase 3E data (docs/specs/phase3.md "3E. Action skills and Pass"): Great Sacrifice, Goddess
// Dance, Blink Strike and Pass as data, and how a unit comes to have each.
//
// Ways this goes wrong, each caught below:
//   skills     an ability with the wrong kind or limit, a Pass that is not a plain passive, a
//              skill the schema would not accept (a warp strike with no range)
//   learning   Goddess Dance sold as a scroll (a refresh-many from any unit is too strong);
//              a Bard that never learns it, or learns it early; a promoted Dancer from an old
//              save that never gets it; a Trickster from an old save that never gets Pass (or
//              loses it to a full skill list instead of the bench); Pass missing from the class
//              text
//   loot       a scroll that teaches nothing, a scroll in the wrong act, one in Act I or the
//              finale, one that is not Rare 2500
//   accessory  Goddess Dance lendable (it is excluded by id); Pass lent without being listed
//              as a lendable innate; Great Sacrifice or Blink Strike lent by accident
// Expected values come from the spec and the data files, never from the code under test.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { createRecruitUnit, knowsSkill, promoteUnit } from '../src/engine/UnitManager.js';
import { RunManager } from '../src/engine/RunManager.js';
import { ACTION_ABILITY_KINDS } from '../src/engine/ActionAbilitySystem.js';
import { validateAccessorySkillData } from '../src/engine/AccessorySkills.js';
import { MAX_SKILLS } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const skill = (id) => data.skills.find((s) => s.id === id);
const cls = (name) => data.classes.find((c) => c.name === name);
const scroll = (name) => data.weapons.find((w) => w.name === name);

describe('the four skills', () => {
  it('Great Sacrifice: once per battle, 10 HP, allies within 2 tiles', () => {
    expect(skill('great_sacrifice')).toMatchObject({
      name: 'Great Sacrifice',
      trigger: 'action',
      actionAbility: { kind: 'sacrifice_heal', radius: 2, amount: 10, perMapLimit: 1 },
    });
    // Silence blocks it, as it blocks Healing Circle: not marked a bodily act.
    expect(skill('great_sacrifice').actionAbility.usableWhileSilenced).toBeUndefined();
  });

  it('Goddess Dance: once per battle, a refresh; a dance is no spell, so silence does not stop it', () => {
    expect(skill('goddess_dance')).toMatchObject({
      name: 'Goddess Dance',
      trigger: 'action',
      actionAbility: { kind: 'refresh_adjacent', perMapLimit: 1, usableWhileSilenced: true },
    });
  });

  it('Blink Strike: once per battle, Blink’s four tiles', () => {
    expect(skill('blink_strike')).toMatchObject({
      name: 'Blink Strike',
      trigger: 'action',
      actionAbility: { kind: 'warp_strike', range: 4, perMapLimit: 1 },
    });
    // Same reach as Blink itself: the strike is Blink's diamond.
    expect(skill('blink_strike').actionAbility.range).toBe(skill('blink').actionAbility.range);
  });

  it('Pass: a plain passive, innate to the Trickster beside Darting Blow (owner Q3)', () => {
    expect(skill('pass')).toMatchObject({
      name: 'Pass',
      trigger: 'passive',
      classInnate: 'Trickster',
    });
    expect(skill('pass').actionAbility).toBeUndefined();
    expect(skill('darting_blow').classInnate).toBe('Trickster');
  });

  it('every new ability kind is one the engine executes', () => {
    for (const id of ['great_sacrifice', 'goddess_dance', 'blink_strike'])
      expect(ACTION_ABILITY_KINDS.has(skill(id).actionAbility.kind), id).toBe(true);
  });
});

describe('schema', () => {
  const validate = new Ajv({ allErrors: true }).compile(
    JSON.parse(readFileSync(path.join(path.resolve('schemas'), 'skills.schema.json'), 'utf-8')),
  );
  const one = (actionAbility) => [
    { id: 'x', name: 'X', description: 'x', trigger: 'action', actionAbility },
  ];

  it('accepts the shipped skills', () => {
    expect(validate(data.skills), JSON.stringify(validate.errors)).toBe(true);
  });

  it('holds each new kind to its own fields', () => {
    expect(validate(one({ kind: 'sacrifice_heal', radius: 2, amount: 10, perMapLimit: 1 }))).toBe(
      true,
    );
    expect(validate(one({ kind: 'sacrifice_heal', amount: 10, perMapLimit: 1 }))).toBe(false);
    expect(validate(one({ kind: 'sacrifice_heal', radius: 2, perMapLimit: 1 }))).toBe(false);
    expect(validate(one({ kind: 'sacrifice_heal', radius: 2, amount: 10 }))).toBe(false);
    expect(validate(one({ kind: 'refresh_adjacent', perMapLimit: 1 }))).toBe(true);
    expect(validate(one({ kind: 'refresh_adjacent' }))).toBe(false);
    expect(validate(one({ kind: 'warp_strike', range: 4, perMapLimit: 1 }))).toBe(true);
    expect(validate(one({ kind: 'warp_strike', perMapLimit: 1 }))).toBe(false);
    expect(validate(one({ kind: 'warp_strike', range: 4 }))).toBe(false);
    expect(validate(one({ kind: 'warp_leap', range: 4, perMapLimit: 1 }))).toBe(false);
  });
});

describe('scrolls', () => {
  const taught = { 'Great Sacrifice Scroll': 'great_sacrifice', 'Blink Strike Scroll': 'blink_strike', 'Pass Scroll': 'pass' }; // prettier-ignore

  it.each(Object.entries(taught))('%s teaches %s, Rare, 2500', (name, skillId) => {
    expect(scroll(name)).toMatchObject({
      type: 'Scroll',
      tier: 'Rare',
      skillId,
      price: 2500,
      special: `Teaches ${skill(skillId).name}`,
    });
    expect(scroll(name).lore.length).toBeGreaterThan(20);
  });

  it('Goddess Dance has no scroll: the Bard learns it, nobody buys it', () => {
    expect(data.weapons.filter((w) => w.skillId === 'goddess_dance')).toEqual([]);
    const pooled = Object.values(data.lootTables).flatMap((table) => table?.skillScroll || []);
    expect(pooled.filter((name) => /goddess/i.test(name))).toEqual([]);
  });

  it('sit in the Act II–IV pools the spec names, and never in Act I or the finale', () => {
    const pool = (act) => data.lootTables[act].skillScroll;
    expect(pool('act1')).toEqual([]);
    expect(pool('finalBoss')).toEqual([]);
    // Pass is the modest one (Act II on); the other two are strong and wait for Act III.
    expect(pool('act2')).toContain('Pass Scroll');
    expect(pool('act2')).not.toContain('Great Sacrifice Scroll');
    expect(pool('act2')).not.toContain('Blink Strike Scroll');
    for (const act of ['act3', 'act4'])
      for (const name of Object.keys(taught)) expect(pool(act), `${act} ${name}`).toContain(name);
  });

  it('every scroll in a pool is a real scroll, listed once', () => {
    for (const act of ['act2', 'act3', 'act4']) {
      const pool = data.lootTables[act].skillScroll;
      expect(new Set(pool).size, act).toBe(pool.length);
      for (const name of pool) expect(scroll(name)?.type, name).toBe('Scroll');
    }
  });
});

describe('how a unit comes to have them', () => {
  const makeUnit = (baseName, level = 10) => {
    const unit = createRecruitUnit({ name: 'Test', level }, cls(baseName), data.weapons, null, null, null, data.classes, { skillsData: data.skills }); // prettier-ignore
    unit.faction = 'player';
    return unit;
  };
  const migrated = (unit) => {
    const run = new RunManager(data);
    run.roster = [unit];
    RunManager.migrateClassInnateSkills(run);
    RunManager.migrateClassLearnableSkills(run);
    return unit;
  };

  it('the Bard learns Goddess Dance at level 5 (the class data, not a scroll)', () => {
    expect(cls('Bard').learnableSkills).toEqual([{ skillId: 'goddess_dance', level: 5 }]);
    // No other class teaches it.
    const teachers = data.classes.filter((c) =>
      (c.learnableSkills || []).some((e) => e.skillId === 'goddess_dance'),
    );
    expect(teachers.map((c) => c.name)).toEqual(['Bard']);
  });

  it('a Dancer promoted to Bard has Dance, and learns Goddess Dance on reaching Bard level 5', () => {
    const dancer = makeUnit('Dancer');
    promoteUnit(dancer, cls('Bard'), cls('Bard').promotionBonuses, data.skills);
    expect(dancer.className).toBe('Bard');
    expect(knowsSkill(dancer, 'dance')).toBe(true);
    expect(knowsSkill(dancer, 'goddess_dance')).toBe(false);
    dancer.level = 4;
    migrated(dancer);
    expect(knowsSkill(dancer, 'goddess_dance')).toBe(false);
    dancer.level = 5;
    migrated(dancer);
    expect(dancer.skills).toContain('goddess_dance');
  });

  it('a promoted Dancer from an old save gets it on load; at the skill cap it waits on the bench', () => {
    const bard = makeUnit('Dancer');
    promoteUnit(bard, cls('Bard'), cls('Bard').promotionBonuses, data.skills);
    bard.level = 7;
    expect(knowsSkill(bard, 'goddess_dance')).toBe(false);
    migrated(bard);
    expect(bard.skills).toContain('goddess_dance');

    const full = makeUnit('Dancer');
    promoteUnit(full, cls('Bard'), cls('Bard').promotionBonuses, data.skills);
    full.level = 7;
    full.skills = Array.from({ length: MAX_SKILLS }, (_, i) => `held-${i}`);
    migrated(full);
    expect(full.skills).not.toContain('goddess_dance');
    expect(full.benchedSkills).toContain('goddess_dance');
  });

  it('a Trickster has Pass and Darting Blow on promotion', () => {
    const thief = makeUnit('Thief');
    promoteUnit(thief, cls('Trickster'), cls('Trickster').promotionBonuses, data.skills);
    expect(thief.className).toBe('Trickster');
    expect(thief.skills).toEqual(expect.arrayContaining(['darting_blow', 'pass']));
  });

  it('a Trickster from an old save gains Pass on load; at the cap it is benched, never lost', () => {
    const old = makeUnit('Thief');
    promoteUnit(old, cls('Trickster'), cls('Trickster').promotionBonuses, data.skills);
    old.skills = old.skills.filter((id) => id !== 'pass');
    expect(knowsSkill(old, 'pass')).toBe(false);
    migrated(old);
    expect(old.skills).toContain('pass');

    const crowded = makeUnit('Thief');
    promoteUnit(crowded, cls('Trickster'), cls('Trickster').promotionBonuses, data.skills);
    crowded.skills = ['darting_blow', ...Array.from({ length: MAX_SKILLS - 1 }, (_, i) => `held-${i}`)]; // prettier-ignore
    crowded.benchedSkills = [];
    migrated(crowded);
    expect(crowded.skills).not.toContain('pass');
    expect(crowded.benchedSkills).toContain('pass');
  });

  it('an Assassin (the other Thief promotion) does not get Pass', () => {
    const thief = makeUnit('Thief');
    promoteUnit(thief, cls('Assassin'), cls('Assassin').promotionBonuses, data.skills);
    expect(knowsSkill(thief, 'pass')).toBe(false);
  });

  it('the class text names Pass', () => {
    expect(cls('Trickster').roleChange).toMatch(/Pass/);
    expect(cls('Trickster').description).toMatch(/Pass/);
    expect(cls('Bard').roleChange).toMatch(/Goddess Dance/);
  });
});

describe('accessories', () => {
  const config = data.lootTables.accessorySkills;
  const pooled = Object.values(config.poolByAct).flat();

  it('Goddess Dance is never lent (excluded by id) and sits in no pool', () => {
    expect(config.neverBound).toContain('goddess_dance');
    expect(pooled).not.toContain('goddess_dance');
  });

  it('Pass may be lent in Act IV, as a named lendable innate; the other two are not lent', () => {
    expect(config.poolByAct.act4).toContain('pass');
    for (const act of ['act1', 'act2', 'act3']) expect(config.poolByAct[act]).not.toContain('pass');
    expect(config.lentInnates).toContain('pass');
    expect(pooled).not.toContain('great_sacrifice');
    expect(pooled).not.toContain('blink_strike');
  });

  it('the accessory-skill data still validates', () => {
    expect(validateAccessorySkillData(data)).toEqual([]);
  });
});
