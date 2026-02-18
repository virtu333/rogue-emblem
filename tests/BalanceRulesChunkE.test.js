import { describe, expect, it, vi } from 'vitest';

import { createLordUnit, createUnit, promoteUnit, calculateCombatXP } from '../src/engine/UnitManager.js';
import { LOOT_GOLD_TEAM_XP } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

describe('Chunk E balance and rules guards', () => {
  it('gold+xp loot reward grants a fixed 25 XP across acts', () => {
    for (const [act, xp] of Object.entries(LOOT_GOLD_TEAM_XP)) {
      expect(xp, `act ${act}`).toBe(25);
    }
  });

  it('cavalier and paladin movement are each reduced by one versus prior baseline', () => {
    const cavalier = data.classes.find((cls) => cls.name === 'Cavalier');
    const paladin = data.classes.find((cls) => cls.name === 'Paladin');
    expect(cavalier).toBeTruthy();
    expect(paladin).toBeTruthy();

    const unit = createUnit(cavalier, 1, data.weapons);
    expect(unit.stats.MOV).toBe(5);
    promoteUnit(unit, paladin, paladin.promotionBonuses, data.skills);
    expect(unit.stats.MOV).toBe(6);
  });

  it('flying unit movement is reduced by one while keeping +1 promotion movement', () => {
    const pegasus = data.classes.find((cls) => cls.name === 'Pegasus Knight');
    const wyvern = data.classes.find((cls) => cls.name === 'Wyvern Rider');
    const skyLancer = data.classes.find((cls) => cls.name === 'Sky Lancer');
    const falcon = data.classes.find((cls) => cls.name === 'Falcon Knight');
    expect(pegasus).toBeTruthy();
    expect(wyvern).toBeTruthy();
    expect(skyLancer).toBeTruthy();
    expect(falcon).toBeTruthy();

    expect(pegasus.baseStats.MOV).toBe(4);
    expect(wyvern.baseStats.MOV).toBe(4);
    expect(skyLancer.baseStats.MOV).toBe(4);

    const unit = createUnit(pegasus, 1, data.weapons);
    expect(unit.stats.MOV).toBe(4);
    promoteUnit(unit, falcon, falcon.promotionBonuses, data.skills);
    expect(unit.stats.MOV).toBe(5);
  });

  it('edric growth pipeline is class roll plus personal growths', () => {
    const edric = data.lords.find((lord) => lord.name === 'Edric');
    const edricClass = data.classes.find((cls) => cls.name === edric.class);
    expect(edric).toBeTruthy();
    expect(edricClass).toBeTruthy();

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const unit = createLordUnit(edric, edricClass, data.weapons);
      for (const [stat, personal] of Object.entries(edric.personalGrowths || {})) {
        const minClassGrowth = Number(String(edricClass.growthRanges?.[stat] || '0-0').split('-')[0]);
        expect(unit.growths[stat]).toBe(minClassGrowth + Number(personal || 0));
      }
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('boss flag does not change combat XP by itself', () => {
    const attacker = { level: 8, tier: 'base', stats: {} };
    const normalDefender = { level: 8, tier: 'base', isBoss: false, stats: {} };
    const bossDefender = { level: 8, tier: 'base', isBoss: true, stats: {} };

    expect(calculateCombatXP(attacker, normalDefender, false))
      .toBe(calculateCombatXP(attacker, bossDefender, false));
    expect(calculateCombatXP(attacker, normalDefender, true))
      .toBe(calculateCombatXP(attacker, bossDefender, true));
  });
});
