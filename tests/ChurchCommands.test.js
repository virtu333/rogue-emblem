import { beforeEach, describe, expect, it } from 'vitest';
import { RunManager, getReviveCost } from '../src/engine/RunManager.js';
import { createUnit, createLordUnit, resolvePromotionTargets } from '../src/engine/UnitManager.js';
import {
  churchPromotionBlock,
  promoteAtChurch,
  churchReviveBlock,
  reviveAtChurch,
} from '../src/engine/ChurchCommands.js';
import { CHURCH_PROMOTE_COST, MAX_SKILLS } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const nodeId = 'church-test';
let run, unit;
const recruit = (name = 'Fighter') =>
  createUnit(
    data.classes.find((c) => c.name === name),
    10,
    data.weapons,
    {
      name: `Test ${name}`,
    },
  );
const targetFor = (u = unit) => resolvePromotionTargets(u, data.classes, data.lords)?.[0];
const snapshot = () =>
  JSON.stringify({
    gold: run.gold,
    roster: run.roster,
    fallen: run.fallenUnits,
    tracker: run._churchPromotionTracker,
  });
beforeEach(() => {
  run = new RunManager(data);
  run.gold = 10000;
  unit = recruit();
  run.roster = [unit];
});

describe('church promotion transactions', () => {
  it('promotes once, charges once, and preserves supplies without requiring a seal', () => {
    unit.consumables = [{ name: 'Master Seal', type: 'Consumable', effect: 'promote', uses: 1 }];
    const supplies = structuredClone(unit.consumables);
    const target = targetFor();
    expect(promoteAtChurch(run, unit, nodeId, target, data).ok).toBe(true);
    expect(unit.className).toBe(target.name);
    expect(unit.tier).toBe('promoted');
    expect(unit.level).toBe(1);
    expect(unit.consumables).toEqual(supplies);
    expect(run.gold).toBe(10000 - CHURCH_PROMOTE_COST);
    expect(run.getChurchPromotionCount(nodeId)).toBe(1);
    const after = snapshot();
    expect(promoteAtChurch(run, unit, nodeId, target, data).ok).toBe(false);
    expect(snapshot()).toBe(after);
  });

  it('rejects a stale roster identity and invalid class before spending', () => {
    const before = snapshot();
    expect(promoteAtChurch(run, structuredClone(unit), nodeId, targetFor(), data).ok).toBe(false);
    expect(promoteAtChurch(run, unit, nodeId, { name: 'Mage' }, data).ok).toBe(false);
    expect(snapshot()).toBe(before);
  });

  it('uses canonical class bonuses even when a selected class object is tampered with', () => {
    const target = targetFor();
    const beforeHP = unit.stats.HP;
    expect(
      promoteAtChurch(run, unit, nodeId, { ...target, promotionBonuses: { HP: 999 } }, data).ok,
    ).toBe(true);
    expect(unit.stats.HP).toBe(beforeHP + target.promotionBonuses.HP);
  });

  it('uses the lord personal promotion bonuses instead of the generic class bonuses', () => {
    const lord = data.lords.find((l) => l.name === 'Edric');
    unit = createLordUnit(
      lord,
      data.classes.find((c) => c.name === lord.class),
      data.weapons,
    );
    unit.level = 10;
    run.roster = [unit];
    const before = { ...unit.stats };
    expect(promoteAtChurch(run, unit, nodeId, targetFor(), data).ok).toBe(true);
    for (const [stat, bonus] of Object.entries(lord.promotionBonuses))
      expect(unit.stats[stat]).toBe(before[stat] + bonus);
  });

  it('blocks the Dancer with only a disabled target without gold or count changes', () => {
    unit = recruit('Dancer');
    run.roster = [unit];
    const before = snapshot();
    expect(churchPromotionBlock(run, unit, nodeId, data)).toBe('No available promotion class.');
    expect(promoteAtChurch(run, unit, nodeId, { name: 'Bard' }, data).ok).toBe(false);
    expect(snapshot()).toBe(before);
  });

  it('rechecks gold and difficulty limit immediately before applying', () => {
    const target = targetFor();
    run.gold = CHURCH_PROMOTE_COST - 1;
    let before = snapshot();
    expect(promoteAtChurch(run, unit, nodeId, target, data).reason).toBe('Not enough gold.');
    expect(snapshot()).toBe(before);
    run.gold = CHURCH_PROMOTE_COST;
    run.difficultyModifiers = { churchPromotionLimit: 2 };
    run.setChurchPromotionCount(nodeId, 2);
    before = snapshot();
    expect(promoteAtChurch(run, unit, nodeId, target, data).reason).toBe(
      'Promotion limit reached.',
    );
    expect(snapshot()).toBe(before);
    expect(churchPromotionBlock(run, unit, 'different-church', data)).toBe('');
  });

  it('reports dropped class innate skills using readable names at the skill cap', () => {
    unit.skills = Array.from({ length: MAX_SKILLS }, (_, i) => `existing-${i}`);
    const target = resolvePromotionTargets(unit, data.classes, data.lords).find(
      (c) => c.name === 'Warrior',
    );
    const innate = data.skills.find((skill) => skill.classInnate === 'Warrior');
    const result = promoteAtChurch(run, unit, nodeId, target, data);
    expect(result.ok).toBe(true);
    expect(result.message).toContain(innate.name);
    expect(unit.skills).toHaveLength(MAX_SKILLS);
    expect(unit.skills).not.toContain(innate.id);
  });
});

describe('church revival transactions', () => {
  beforeEach(() => {
    run.roster = [];
    unit.currentHP = 0;
    unit.inventory = [];
    unit.weapon = null;
    run.fallenUnits = [unit];
  });

  it('revives at 1 HP once with the current scaled cost and leaves convoy gear untouched', () => {
    run.convoy = [structuredClone(data.weapons.find((w) => w.name === 'Iron Axe'))];
    const convoy = structuredClone(run.convoy),
      cost = getReviveCost(unit);
    expect(reviveAtChurch(run, unit).ok).toBe(true);
    expect(run.gold).toBe(10000 - cost);
    expect(run.roster).toContain(unit);
    expect(run.fallenUnits).not.toContain(unit);
    expect(unit.currentHP).toBe(1);
    expect(unit.inventory).toEqual([]);
    expect(run.convoy).toEqual(convoy);
    expect(run.hasShownDialogue('revive_convoy_hint')).toBe(true);
    const after = snapshot();
    expect(reviveAtChurch(run, unit).ok).toBe(false);
    expect(snapshot()).toBe(after);
  });

  it('rejects a same-name stale object before passing to the name-based revive API', () => {
    const before = snapshot();
    expect(reviveAtChurch(run, structuredClone(unit)).ok).toBe(false);
    expect(snapshot()).toBe(before);
  });

  it('does not charge or remove the fallen unit when roster fills after selection', () => {
    run.roster = Array.from({ length: run.getRosterCap() }, (_, i) => ({
      ...recruit(),
      name: `Recruit ${i}`,
    }));
    const before = snapshot();
    expect(churchReviveBlock(run, unit)).toBe('Roster full.');
    expect(reviveAtChurch(run, unit).ok).toBe(false);
    expect(snapshot()).toBe(before);
  });

  it('rechecks the promoted cost and latest gold at application time', () => {
    unit.tier = 'promoted';
    run.gold = getReviveCost(unit) - 1;
    const before = snapshot();
    expect(reviveAtChurch(run, unit).reason).toBe('Not enough gold.');
    expect(snapshot()).toBe(before);
  });
});
