import { describe, expect, it } from 'vitest';
import {
  ACT_CONFIG,
  DEPLOY_LIMITS,
  ENEMY_COUNT_OFFSET,
  FOG_CHANCE_BY_ACT,
  LOOT_GOLD_TEAM_XP,
  SHOP_FORGE_LIMITS,
} from '../src/utils/constants.js';
import { MUSIC, getMusicKey } from '../src/utils/musicConfig.js';
import { pickTemplate } from '../src/engine/MapGenerator.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

describe('Act4 progression guards', () => {
  it('act-indexed runtime tables include act4 and finalBoss entries', () => {
    const tables = [
      DEPLOY_LIMITS,
      ENEMY_COUNT_OFFSET,
      ACT_CONFIG,
      FOG_CHANCE_BY_ACT,
      LOOT_GOLD_TEAM_XP,
      SHOP_FORGE_LIMITS,
    ];
    for (const table of tables) {
      expect(table.act4).toBeDefined();
      expect(table.finalBoss).toBeDefined();
    }
  });

  it('data tables include act4 + finalBoss where progression expects them', () => {
    expect(data.turnBonus.baseBonusGold.act4).toBeDefined();
    expect(data.turnBonus.baseBonusGold.finalBoss).toBeDefined();
    expect(data.enemies.pools.act4).toBeDefined();
    expect(data.enemies.pools.finalBoss).toBeDefined();
    expect(data.enemies.bosses.act4).toBeDefined();
    expect(data.enemies.bosses.finalBoss).toBeDefined();
  });

  it('difficulty mode act sequences keep normal/lunatic unchanged and add act4 to hard', () => {
    expect(data.difficulty.modes.normal.actsIncluded).toEqual(['act1', 'act2', 'act3', 'finalBoss']);
    expect(data.difficulty.modes.hard.actsIncluded).toEqual(['act1', 'act2', 'act3', 'act4', 'finalBoss']);
    expect(data.difficulty.modes.lunatic.actsIncluded).toEqual(['act1', 'act2', 'act3', 'finalBoss']);
  });

  it('pickTemplate selects act4-only templates when act4 is requested, then falls back when needed', () => {
    const templates = {
      rout: [
        { id: 'act1_only', acts: ['act1'] },
        { id: 'act4_only', acts: ['act4'] },
      ],
      seize: [],
    };
    expect(pickTemplate('rout', templates, 'act4').id).toBe('act4_only');
    expect(pickTemplate('rout', { rout: [{ id: 'act4_only', acts: ['act4'] }], seize: [] }, 'act1').id)
      .toBe('act4_only');
  });

  it('act4 templates that define reinforcements use contract v1 with required fields', () => {
    const act4Templates = [
      ...data.mapTemplates.rout.filter((template) => Array.isArray(template.acts) && template.acts.includes('act4')),
      ...data.mapTemplates.seize.filter((template) => Array.isArray(template.acts) && template.acts.includes('act4')),
    ];
    const withReinforcements = act4Templates.filter((template) => template.reinforcements);
    expect(withReinforcements.length).toBeGreaterThan(0);
    for (const template of withReinforcements) {
      expect(template.reinforcementContractVersion).toBe(1);
      expect(Array.isArray(template.reinforcements.spawnEdges)).toBe(true);
      expect(Array.isArray(template.reinforcements.waves)).toBe(true);
      expect(template.reinforcements.waves.length).toBeGreaterThan(0);
      expect(template.reinforcements.turnOffsetByDifficulty).toBeDefined();
      expect(Array.isArray(template.reinforcements.xpDecay)).toBe(true);
    }
  });

  it('music lookup has safe fallback when act4 key is missing in a purpose table', () => {
    const original = MUSIC.battle.act4;
    delete MUSIC.battle.act4;
    try {
      const key = getMusicKey('battle', 'act4');
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
    } finally {
      MUSIC.battle.act4 = original;
    }
  });

  it('music lookup returns a valid fallback for unknown act ids', () => {
    const key = getMusicKey('battle', 'unknown_act');
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });
});
