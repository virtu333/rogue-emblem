// BiomeSelection.test.js — Tests for biome selection logic and indoor terrain
import { describe, it, expect, beforeEach } from 'vitest';
import {
  rollBiome,
  getTemplateBiome,
  pickTemplate,
  generateBattle,
} from '../src/engine/MapGenerator.js';
import { generateNodeMap, pickTemplateForNode } from '../src/engine/NodeMapGenerator.js';
import { ACT_BIOME_WEIGHTS, ACT_CONFIG, TERRAIN } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

let data;
beforeEach(async () => {
  data = data || loadGameData();
});

describe('Biome Selection', () => {
  describe('rollBiome', () => {
    it('returns grassland for act1 (100% grassland)', () => {
      for (let i = 0; i < 20; i++) {
        expect(rollBiome('act1')).toBe('grassland');
      }
    });

    it('returns only valid biomes for act2', () => {
      const validBiomes = Object.keys(ACT_BIOME_WEIGHTS.act2);
      for (let i = 0; i < 50; i++) {
        const biome = rollBiome('act2');
        expect(validBiomes).toContain(biome);
      }
    });

    it('returns only valid biomes for act4', () => {
      const validBiomes = Object.keys(ACT_BIOME_WEIGHTS.act4);
      for (let i = 0; i < 50; i++) {
        const biome = rollBiome('act4');
        expect(validBiomes).toContain(biome);
      }
    });

    it('returns grassland for unknown act', () => {
      expect(rollBiome('act99')).toBe('grassland');
    });

    it('accepts custom biome weights', () => {
      const custom = { castle: 100 };
      for (let i = 0; i < 20; i++) {
        expect(rollBiome('act1', custom)).toBe('castle');
      }
    });

    it('returns grassland when weights are empty', () => {
      expect(rollBiome('act1', {})).toBe('grassland');
    });

    it('produces castle biome at least once with act2 weights over 100 rolls', () => {
      const results = new Set();
      for (let i = 0; i < 100; i++) {
        results.add(rollBiome('act2'));
      }
      expect(results.has('castle')).toBe(true);
      expect(results.has('grassland')).toBe(true);
    });
  });

  describe('getTemplateBiome', () => {
    it('returns template biome when set', () => {
      expect(getTemplateBiome({ biome: 'castle' })).toBe('castle');
      expect(getTemplateBiome({ biome: 'tundra' })).toBe('tundra');
    });

    it('returns grassland when biome is not set', () => {
      expect(getTemplateBiome({})).toBe('grassland');
      expect(getTemplateBiome({ id: 'open_field' })).toBe('grassland');
    });

    it('returns grassland for null/undefined', () => {
      expect(getTemplateBiome(null)).toBe('grassland');
      expect(getTemplateBiome(undefined)).toBe('grassland');
    });
  });

  describe('pickTemplate with biome filter', () => {
    it('prefers castle templates when biome is castle', () => {
      const results = new Set();
      for (let i = 0; i < 50; i++) {
        const t = pickTemplate('rout', data.mapTemplates, 'act2', { biome: 'castle' });
        results.add(t.id);
      }
      // Should only pick castle rout templates (corridor_siege, castle_ruins)
      for (const id of results) {
        const tmpl =
          data.mapTemplates.rout.find((t) => t.id === id) ||
          data.mapTemplates.seize?.find((t) => t.id === id);
        expect(tmpl).toBeTruthy();
        expect(getTemplateBiome(tmpl)).toBe('castle');
      }
    });

    it('prefers grassland templates when biome is grassland', () => {
      const results = new Set();
      for (let i = 0; i < 50; i++) {
        const t = pickTemplate('rout', data.mapTemplates, 'act2', { biome: 'grassland' });
        results.add(t.id);
      }
      for (const id of results) {
        const tmpl = data.mapTemplates.rout.find((t) => t.id === id);
        expect(tmpl).toBeTruthy();
        expect(getTemplateBiome(tmpl)).toBe('grassland');
      }
    });

    it('falls back to full pool when biome has no matching templates', () => {
      const t = pickTemplate('rout', data.mapTemplates, 'act1', { biome: 'castle' });
      // Act 1 has no castle templates, should fall back to grassland
      expect(t).toBeTruthy();
    });

    it('works without biome option (backward compatible)', () => {
      const t = pickTemplate('rout', data.mapTemplates, 'act1');
      expect(t).toBeTruthy();
    });
  });
});

describe('Indoor Terrain Data', () => {
  it('terrain.json contains Floor and Pillar', () => {
    const floor = data.terrain.find((t) => t.name === 'Floor');
    const pillar = data.terrain.find((t) => t.name === 'Pillar');
    expect(floor).toBeTruthy();
    expect(pillar).toBeTruthy();
  });

  it('Floor has cost 1 for all move types', () => {
    const floor = data.terrain.find((t) => t.name === 'Floor');
    expect(floor.moveCost.Infantry).toBe('1');
    expect(floor.moveCost.Armored).toBe('1');
    expect(floor.moveCost.Cavalry).toBe('1');
    expect(floor.moveCost.Flying).toBe('1');
  });

  it('Pillar has cost 2 for all move types', () => {
    const pillar = data.terrain.find((t) => t.name === 'Pillar');
    expect(pillar.moveCost.Infantry).toBe('2');
    expect(pillar.moveCost.Armored).toBe('2');
    expect(pillar.moveCost.Cavalry).toBe('2');
    expect(pillar.moveCost.Flying).toBe('2');
  });

  it('Pillar gives 20 avoid and 1 DEF', () => {
    const pillar = data.terrain.find((t) => t.name === 'Pillar');
    expect(pillar.avoidBonus).toBe('20');
    expect(pillar.defBonus).toBe('1');
  });

  it('Floor gives 0 avoid and 0 DEF', () => {
    const floor = data.terrain.find((t) => t.name === 'Floor');
    expect(floor.avoidBonus).toBe('0');
    expect(floor.defBonus).toBe('0');
  });

  it('TERRAIN enum includes Floor and Pillar at correct indices', () => {
    expect(TERRAIN.Floor).toBe(12);
    expect(TERRAIN.Pillar).toBe(13);
  });

  it('terrain.json indices match TERRAIN enum', () => {
    expect(data.terrain[TERRAIN.Floor].name).toBe('Floor');
    expect(data.terrain[TERRAIN.Pillar].name).toBe('Pillar');
  });
});

describe('Castle Map Templates', () => {
  it('corridor_siege exists in rout pool with castle biome', () => {
    const t = data.mapTemplates.rout.find((t) => t.id === 'corridor_siege');
    expect(t).toBeTruthy();
    expect(t.biome).toBe('castle');
    expect(t.acts).toContain('act2');
    expect(t.acts).toContain('act3');
    expect(t.acts).not.toContain('act1');
  });

  it('castle_ruins exists in rout pool with castle biome', () => {
    const t = data.mapTemplates.rout.find((t) => t.id === 'castle_ruins');
    expect(t).toBeTruthy();
    expect(t.biome).toBe('castle');
    expect(t.acts).toContain('act2');
    expect(t.acts).toContain('act3');
  });

  it('great_hall exists in seize pool with castle biome', () => {
    const t = data.mapTemplates.seize.find((t) => t.id === 'great_hall');
    expect(t).toBeTruthy();
    expect(t.biome).toBe('castle');
    expect(t.acts).toContain('act2');
    expect(t.features).toEqual(expect.arrayContaining([{ type: 'Throne', position: 'right' }]));
  });

  it('castle templates use Floor and Pillar terrain', () => {
    const corridor = data.mapTemplates.rout.find((t) => t.id === 'corridor_siege');
    const allTerrain = corridor.zones.flatMap((z) => Object.keys(z.terrain));
    expect(allTerrain).toContain('Floor');
    expect(allTerrain).toContain('Pillar');
  });

  it('castle templates are NOT selected for act1', () => {
    const castleTemplates = data.mapTemplates.rout.filter((t) => t.biome === 'castle');
    for (const t of castleTemplates) {
      expect(t.acts).not.toContain('act1');
    }
  });

  it('castle seize template has valid reinforcement contract', () => {
    const t = data.mapTemplates.seize.find((t) => t.id === 'great_hall');
    expect(t.reinforcementContractVersion).toBe(1);
    expect(t.reinforcements).toBeTruthy();
    expect(t.reinforcements.spawnEdges).toBeTruthy();
    expect(t.reinforcements.waves.length).toBeGreaterThan(0);
  });

  it('castle templates generate valid maps via generateBattle', () => {
    const config = generateBattle(
      { act: 'act2', objective: 'rout', templateId: 'corridor_siege', deployCount: 4, row: 1 },
      data,
    );
    expect(config).toBeTruthy();
    expect(config.mapLayout).toBeTruthy();
    expect(config.biome).toBe('castle');
    // Verify Floor and Pillar terrain indices appear in the map
    const flatTiles = config.mapLayout.flat();
    const floorIndex = data.terrain.findIndex((t) => t.name === 'Floor');
    const pillarIndex = data.terrain.findIndex((t) => t.name === 'Pillar');
    expect(flatTiles).toContain(floorIndex);
    expect(flatTiles).toContain(pillarIndex);
  });
});

describe('Biome Regression — template reachability', () => {
  it('act3_dark_champion_keep has castle biome (not mountains)', () => {
    const t = data.mapTemplates.seize.find((t) => t.id === 'act3_dark_champion_keep');
    expect(t).toBeTruthy();
    expect(t.biome).toBe('castle');
  });

  it('act3 boss seize can select act3_dark_champion_keep', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const t = pickTemplate('seize', data.mapTemplates, 'act3', { biome: 'castle', isBoss: true });
      seen.add(t.id);
    }
    expect(seen.has('act3_dark_champion_keep')).toBe(true);
  });

  it('great_hall acts does NOT include finalBoss', () => {
    const t = data.mapTemplates.seize.find((t) => t.id === 'great_hall');
    expect(t).toBeTruthy();
    expect(t.acts).not.toContain('finalBoss');
  });

  it('ambush nodes get castle-biome templates at approximate act2 biome weight (integration)', () => {
    // Run generateNodeMap with 100% ambush chance for act2 (36% castle weight).
    // Assert that castle ambush rate tracks biome weighting, not template-count weighting.
    const castleRoutIds = new Set(
      data.mapTemplates.rout.filter((t) => t.biome === 'castle').map((t) => t.id),
    );
    const act2RoutPool = data.mapTemplates.rout.filter(
      (t) => !Array.isArray(t.acts) || t.acts.includes('act2'),
    );
    const unweightedCastleRate =
      act2RoutPool.filter((t) => getTemplateBiome(t) === 'castle').length / act2RoutPool.length;
    const expectedCastleRate =
      ACT_BIOME_WEIGHTS.act2.castle /
      Object.values(ACT_BIOME_WEIGHTS.act2).reduce((sum, weight) => sum + weight, 0);
    let totalAmbushes = 0;
    let castleAmbushes = 0;

    for (let i = 0; i < 400; i++) {
      const map = generateNodeMap('act2', ACT_CONFIG.act2, data.mapTemplates, {
        villageAmbushChance: 1,
      });
      for (const node of map.nodes) {
        if (!node.isAmbush) continue;
        totalAmbushes++;
        if (node.templateId && castleRoutIds.has(node.templateId)) {
          castleAmbushes++;
        }
        // Every ambush should have a rout template from the act2 pool
        if (node.templateId) {
          const tmpl = data.mapTemplates.rout.find((t) => t.id === node.templateId);
          expect(
            tmpl,
            `ambush templateId ${node.templateId} should exist in rout pool`,
          ).toBeTruthy();
        }
      }
    }

    expect(totalAmbushes).toBeGreaterThan(0);
    const castleRate = castleAmbushes / totalAmbushes;
    // Maintain this test as a weighting regression guard: for act2 rout templates,
    // unweighted castle selection is currently ~28.6% (2/7), while weighted target is 36%.
    expect(unweightedCastleRate).toBeLessThan(expectedCastleRate);
    expect(castleRate).toBeGreaterThan(unweightedCastleRate + 0.03);
    expect(castleRate).toBeGreaterThan(expectedCastleRate - 0.05);
    expect(castleRate).toBeLessThan(expectedCastleRate + 0.08);
  });

  it('finalBoss ruins is structurally exempt from village ambushes', () => {
    let totalRuins = 0;
    for (let i = 0; i < 50; i++) {
      const map = generateNodeMap('finalBoss', ACT_CONFIG.finalBoss, data.mapTemplates, {
        villageAmbushChance: 1,
      });
      const ruinsNodes = map.nodes.filter((n) => n.type === 'ruins');
      totalRuins += ruinsNodes.length;
      for (const ruins of ruinsNodes) {
        expect(ruins.isAmbush).toBeFalsy();
      }
    }
    expect(totalRuins).toBeGreaterThan(0);
  });
});

describe('ACT_BIOME_WEIGHTS', () => {
  it('act1 is 100% grassland', () => {
    expect(ACT_BIOME_WEIGHTS.act1).toEqual({ grassland: 100 });
  });

  it('act2 includes castle biome', () => {
    expect(ACT_BIOME_WEIGHTS.act2.castle).toBeGreaterThan(0);
    expect(ACT_BIOME_WEIGHTS.act2.grassland).toBeGreaterThan(0);
  });

  it('act3 includes castle biome with higher weight than grassland', () => {
    expect(ACT_BIOME_WEIGHTS.act3.castle).toBeGreaterThan(0);
    expect(ACT_BIOME_WEIGHTS.act3.grassland).toBeGreaterThan(0);
    expect(ACT_BIOME_WEIGHTS.act3.castle).toBeGreaterThan(ACT_BIOME_WEIGHTS.act3.grassland);
  });

  it('finalBoss is 100% void biome', () => {
    expect(ACT_BIOME_WEIGHTS.finalBoss).toEqual({ void: 100 });
  });

  it('all acts in ACT_BIOME_WEIGHTS have positive total weight', () => {
    for (const [, weights] of Object.entries(ACT_BIOME_WEIGHTS)) {
      const total = Object.values(weights).reduce((s, w) => s + w, 0);
      expect(total).toBeGreaterThan(0);
    }
  });

  it('castle-biome templates use only indoor terrain (no outdoor grass/forest/mountain)', () => {
    const outdoorTerrain = new Set(['Plain', 'Forest', 'Mountain', 'Sand', 'Ice']);
    const allTemplates = [...(data.mapTemplates.rout || []), ...(data.mapTemplates.seize || [])];
    const castleTemplates = allTemplates.filter((t) => t.biome === 'castle');
    expect(castleTemplates.length).toBeGreaterThan(0);
    for (const tmpl of castleTemplates) {
      for (const zone of tmpl.zones || []) {
        const terrainKeys = Object.keys(zone.terrain || {});
        const offending = terrainKeys.filter((t) => outdoorTerrain.has(t));
        expect(offending, `${tmpl.id} zone has outdoor terrain: ${offending}`).toEqual([]);
      }
      if (tmpl.hybridArena?.arenaTiles) {
        for (const row of tmpl.hybridArena.arenaTiles) {
          for (const tile of row) {
            expect(
              outdoorTerrain.has(tile),
              `${tmpl.id} hybridArena has outdoor terrain: ${tile}`,
            ).toBe(false);
          }
        }
      }
    }
  });
});

describe('Template fallback act-gating regression (M2)', () => {
  it('pickTemplate fallback respects act-gating when biome+boss filter yields nothing', () => {
    const templates = {
      rout: [
        { id: 'act2_castle', acts: ['act2'], biome: 'castle', bossOnly: true },
        { id: 'act1_grass', acts: ['act1'] },
      ],
      seize: [],
    };
    // Request act1, biome castle, non-boss → biome+boss filter empty,
    // fallback should still respect act filter → only act1_grass
    const result = pickTemplate('rout', templates, 'act1', { biome: 'castle', isBoss: false });
    expect(result).toBeTruthy();
    expect(result.id).toBe('act1_grass');
  });

  it('pickTemplate fallback never selects wrong-act template', () => {
    const templates = {
      rout: [{ id: 'act3_only', acts: ['act3'], bossOnly: true }],
      seize: [],
    };
    // Request act1, non-boss → act filter removes act3_only, fallback pool also empty
    const result = pickTemplate('rout', templates, 'act1', { isBoss: false });
    expect(result).toBeNull();
  });

  it('pickTemplateForNode fallback respects act-gating when biome+boss filter yields nothing', () => {
    const templates = {
      rout: [
        { id: 'act2_castle', acts: ['act2'], biome: 'castle', bossOnly: true },
        { id: 'act1_grass', acts: ['act1'] },
      ],
      seize: [],
    };
    const result = pickTemplateForNode('rout', templates, 'act1', false, 'castle');
    expect(result).toBeTruthy();
    expect(result.id).toBe('act1_grass');
  });

  it('pickTemplateForNode fallback never selects wrong-act template', () => {
    const templates = {
      rout: [{ id: 'act3_only', acts: ['act3'], bossOnly: true }],
      seize: [],
    };
    const result = pickTemplateForNode('rout', templates, 'act1', false, null);
    expect(result).toBeNull();
  });

  it('pickTemplateForNode objective-missing fallback returns null when no act-matched rout exists', () => {
    const templates = {
      rout: [{ id: 'act3_only', acts: ['act3'] }],
    };
    const result = pickTemplateForNode('seize', templates, 'act1', false, null);
    expect(result).toBeNull();
  });

  it('pickTemplateForNode objective-missing fallback prefers act-matched rout templates', () => {
    const templates = {
      rout: [
        { id: 'act3_rout', acts: ['act3'] },
        { id: 'act1_rout', acts: ['act1'] },
      ],
    };
    // Request seize (missing pool) for act1 → falls back to rout, act-filtered
    const result = pickTemplateForNode('seize', templates, 'act1', false, null);
    expect(result).toBeTruthy();
    expect(result.id).toBe('act1_rout');
  });
});
