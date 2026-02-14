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
const ACT4_BOSS_INTENT_TEMPLATE_ID = 'act4_boss_intent_bastion';
const ACT3_DARK_CHAMPION_TEMPLATE_ID = 'act3_dark_champion_keep';

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

  it('pickTemplate excludes bossOnly templates unless isBoss is true', () => {
    const templates = {
      rout: [],
      seize: [{ id: 'boss_only', acts: ['act3'], bossOnly: true }],
    };
    expect(pickTemplate('seize', templates, 'act3', { isBoss: false })).toBeNull();
    expect(pickTemplate('seize', templates, 'act3', { isBoss: true })?.id).toBe('boss_only');
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
      expect((template.reinforcements.waves?.length || 0) + (template.reinforcements.scriptedWaves?.length || 0)).toBeGreaterThan(0);
      expect(template.reinforcements.turnOffsetByDifficulty).toBeDefined();
      expect(Array.isArray(template.reinforcements.xpDecay)).toBe(true);
    }
  });

  it('includes scripted-only seize templates for act4 boss intent and act3 dark champion', () => {
    const act4LargeMapSize = data.mapSizes.find((entry) => entry.phase === 'Act 4 (Large)');
    expect(act4LargeMapSize).toBeDefined();
    const act4Cols = Number((act4LargeMapSize?.mapSize || '').split('x')[0]);
    const act4HalfCol = Math.floor(act4Cols / 2);
    const expected = [
      { id: ACT4_BOSS_INTENT_TEMPLATE_ID, act: 'act4' },
      { id: ACT3_DARK_CHAMPION_TEMPLATE_ID, act: 'act3' },
    ];
    for (const entry of expected) {
      const template = data.mapTemplates.seize.find((candidate) => candidate.id === entry.id);
      expect(template).toBeDefined();
      expect(template.acts).toEqual([entry.act]);
      expect(template.bossOnly).toBe(true);
      expect(template.hybridArena).toBeDefined();
      expect(Array.isArray(template.hybridArena?.approachRect)).toBe(true);
      expect(Array.isArray(template.hybridArena?.arenaTiles)).toBe(true);
      expect(template.hybridArena?.anchors).toBeDefined();
      expect(Array.isArray(template.phaseTerrainOverrides)).toBe(true);
      expect(template.phaseTerrainOverrides.length).toBeGreaterThan(0);
      expect(template.reinforcementContractVersion).toBe(1);
      expect(Array.isArray(template.reinforcements.waves)).toBe(true);
      expect(template.reinforcements.waves.length).toBe(0);
      expect(Array.isArray(template.reinforcements.scriptedWaves)).toBe(true);
      expect(template.reinforcements.scriptedWaves.length).toBeGreaterThan(0);
      if (entry.id === ACT4_BOSS_INTENT_TEMPLATE_ID) {
        const hasPlayerHalfSpawnIntent = template.reinforcements.scriptedWaves.some((wave) =>
          Array.isArray(wave?.spawns) && wave.spawns.some((spawn) => Number.isInteger(spawn?.col) && spawn.col < act4HalfCol)
        );
        expect(hasPlayerHalfSpawnIntent).toBe(true);
      }
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
