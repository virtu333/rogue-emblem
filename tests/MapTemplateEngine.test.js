import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import {
  REINFORCEMENT_CONTRACT_VERSION,
  validateMapTemplatesConfig,
} from '../src/engine/MapTemplateEngine.js';

const mapTemplates = JSON.parse(readFileSync('data/mapTemplates.json', 'utf8'));
const terrainData = JSON.parse(readFileSync('data/terrain.json', 'utf8'));
const terrainNames = new Set(terrainData.map((t) => t.name));
const ACT4_HYBRID_BASE_TEMPLATE_ID = 'act4_boss_intent_bastion';

function makeHybridTemplatePatch() {
  return {
    bossOnly: true,
    hybridArena: {
      approachRect: [0, 0, 0.5, 1],
      arenaOrigin: [5, 2],
      arenaTiles: [
        ['Wall', 'Wall', 'Wall'],
        ['Wall', 'Fort', 'Wall'],
      ],
      anchors: {
        throne: [6, 3],
        gate: [5, 2],
      },
    },
    phaseTerrainOverrides: [
      {
        turn: 4,
        setTiles: [
          { anchor: 'gate', terrain: 'Plain' },
          { coord: [7, 3], terrain: 'Forest' },
        ],
      },
    ],
  };
}

describe('MapTemplateEngine', () => {
  it('validates bundled map template config', () => {
    const result = validateMapTemplatesConfig(mapTemplates);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('validates bundled config with real terrain-name cross-checking', () => {
    // Passing terrainNames makes any terrain typo in zones/structures/features/
    // hybridArena/phaseTerrainOverrides fail CI (generateTerrain silently skips
    // unknown zone terrain names at runtime).
    const result = validateMapTemplatesConfig(mapTemplates, { terrainNames });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects an unknown terrain name in a zone when terrainNames provided', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    bad.rout[0].zones[0].terrain = { Plaine: 1 }; // typo of "Plain"
    const result = validateMapTemplatesConfig(bad, { terrainNames });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('references unknown terrain "Plaine"'))).toBe(true);
  });

  it('accepts non-negative integer parBonus', () => {
    const ok = JSON.parse(JSON.stringify(mapTemplates));
    ok.rout[0].parBonus = 2;
    const result = validateMapTemplatesConfig(ok);
    expect(result.valid).toBe(true);
  });

  it('rejects invalid parBonus values', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    bad.rout[0].parBonus = -1;
    let result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.includes('parBonus must be a non-negative integer')),
    ).toBe(true);

    bad.rout[0].parBonus = 1.5;
    result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.includes('parBonus must be a non-negative integer')),
    ).toBe(true);
  });

  it('accepts a positive weight, and passes when weight is absent', () => {
    const ok = JSON.parse(JSON.stringify(mapTemplates));
    ok.rout[0].weight = 2;
    let result = validateMapTemplatesConfig(ok);
    expect(result.valid).toBe(true);

    delete ok.rout[0].weight;
    result = validateMapTemplatesConfig(ok);
    expect(result.valid).toBe(true);
  });

  it('rejects non-positive or non-number weight values', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));

    for (const invalidWeight of [0, -1, NaN, '2']) {
      bad.rout[0].weight = invalidWeight;
      const result = validateMapTemplatesConfig(bad);
      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes('weight'))).toBe(true);
    }
  });

  it('rejects templates that define reinforcement version without reinforcements object', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    delete bad.rout[0].reinforcements;
    bad.rout[0].reinforcementContractVersion = REINFORCEMENT_CONTRACT_VERSION;
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) =>
        error.includes('must define both reinforcementContractVersion and reinforcements'),
      ),
    ).toBe(true);
  });

  it('rejects config when either objective template pool is empty', () => {
    const result = validateMapTemplatesConfig({ rout: [], seize: [] });
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.includes('rout must include at least one template')),
    ).toBe(true);
    expect(
      result.errors.some((error) => error.includes('seize must include at least one template')),
    ).toBe(true);
  });

  it('rejects reinforcement waves with invalid count ranges', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    const template = bad.rout.find((entry) => entry.id === 'frozen_pass');
    template.reinforcements.waves[0].count = [3, 1];
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('count must have 0 < min <= max'))).toBe(
      true,
    );
  });

  it('rejects reinforcement wave edges outside spawnEdges', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    const template = bad.seize.find((entry) => entry.id === 'eruption_point');
    template.reinforcements.waves[0].edges = ['left'];
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.includes('subset of reinforcements.spawnEdges')),
    ).toBe(true);
  });

  it('accepts valid reinforcement turnJitter range', () => {
    const ok = JSON.parse(JSON.stringify(mapTemplates));
    const template = ok.rout.find((entry) => entry.id === 'frozen_pass');
    template.reinforcements.turnJitter = [-2, 3];
    const result = validateMapTemplatesConfig(ok);
    expect(result.valid).toBe(true);
  });

  it('rejects reinforcement turnJitter when minDelta exceeds maxDelta', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    const template = bad.rout.find((entry) => entry.id === 'frozen_pass');
    template.reinforcements.turnJitter = [2, -1];
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.includes('turnJitter must satisfy minDelta <= maxDelta')),
    ).toBe(true);
  });

  it('rejects reinforcement turnJitter when values are non-integers', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    const template = bad.rout.find((entry) => entry.id === 'frozen_pass');
    template.reinforcements.turnJitter = [0.5, 1];
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) =>
        error.includes('turnJitter must be [minDelta,maxDelta] integers'),
      ),
    ).toBe(true);
  });

  it('accepts valid scripted reinforcement waves', () => {
    const ok = JSON.parse(JSON.stringify(mapTemplates));
    const template = ok.seize.find((entry) => entry.id === 'eruption_point');
    template.reinforcements.scriptedWaves = [
      {
        turn: 4,
        spawns: [
          { col: 0, row: 0, className: 'Fighter', level: 8 },
          { col: 1, row: 0, className: 'Archer', level: 8, aiMode: 'guard', affixes: ['armored'] },
        ],
        xpMultiplier: 0.5,
      },
    ];
    const result = validateMapTemplatesConfig(ok);
    expect(result.valid).toBe(true);
  });

  it('accepts scripted-only reinforcement configs with empty procedural waves', () => {
    const ok = JSON.parse(JSON.stringify(mapTemplates));
    const template = ok.seize.find((entry) => entry.id === 'eruption_point');
    template.reinforcements.waves = [];
    template.reinforcements.scriptedWaves = [
      {
        turn: 2,
        spawns: [{ col: 0, row: 0 }],
      },
    ];
    const result = validateMapTemplatesConfig(ok);
    expect(result.valid).toBe(true);
  });

  it('rejects reinforcement configs when both procedural and scripted waves are empty', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    const template = bad.seize.find((entry) => entry.id === 'eruption_point');
    template.reinforcements.waves = [];
    delete template.reinforcements.scriptedWaves;
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) =>
        error.includes('reinforcements.waves must be a non-empty array'),
      ),
    ).toBe(true);
  });

  it('rejects scripted reinforcement waves with invalid spawn coordinates', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    const template = bad.rout.find((entry) => entry.id === 'frozen_pass');
    template.reinforcements.scriptedWaves = [
      {
        turn: 3,
        spawns: [{ col: -1, row: 0 }],
      },
    ];
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) =>
        error.includes('scriptedWaves[0].spawns[0].col must be a non-negative integer'),
      ),
    ).toBe(true);
  });

  it('accepts scripted reinforcement poisonWeapon boolean metadata', () => {
    const ok = JSON.parse(JSON.stringify(mapTemplates));
    const template = ok.rout.find((entry) => entry.id === 'frozen_pass');
    template.reinforcements.scriptedWaves = [
      {
        turn: 3,
        spawns: [{ col: 0, row: 0, poisonWeapon: true }],
      },
    ];
    const result = validateMapTemplatesConfig(ok);
    expect(result.valid).toBe(true);
  });

  it('rejects scripted reinforcement poisonWeapon metadata with non-boolean type', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    const template = bad.rout.find((entry) => entry.id === 'frozen_pass');
    template.reinforcements.scriptedWaves = [
      {
        turn: 3,
        spawns: [{ col: 0, row: 0, poisonWeapon: 'yes' }],
      },
    ];
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) =>
        error.includes('scriptedWaves[0].spawns[0].poisonWeapon must be boolean when provided'),
      ),
    ).toBe(true);
  });

  it('rejects zones missing rect coordinates', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    bad.rout[0].zones[0] = { terrain: { Plain: 100 } };
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) =>
        error.includes('zones[0].rect must be [x1,y1,x2,y2] finite numbers'),
      ),
    ).toBe(true);
  });

  it('rejects zones with invalid rect bounds', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    bad.rout[0].zones[0].rect = [0.5, 0.5, 0.4, 1.2];
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) =>
        error.includes('must satisfy 0 <= x1 < x2 <= 1 and 0 <= y1 < y2 <= 1'),
      ),
    ).toBe(true);
  });

  it('rejects zones with invalid terrain weights', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    bad.rout[0].zones[0].terrain = { Plain: 0 };
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.includes('terrain["Plain"] must be a positive number')),
    ).toBe(true);
  });

  it('accepts valid hybrid arena contract shape', () => {
    const ok = JSON.parse(JSON.stringify(mapTemplates));
    const template = ok.seize.find((entry) => entry.id === ACT4_HYBRID_BASE_TEMPLATE_ID);
    Object.assign(template, makeHybridTemplatePatch());
    const result = validateMapTemplatesConfig(ok);
    expect(result.valid).toBe(true);
  });

  it('rejects hybrid arena templates when bossOnly is not true', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    const template = bad.seize.find((entry) => entry.id === ACT4_HYBRID_BASE_TEMPLATE_ID);
    Object.assign(template, makeHybridTemplatePatch());
    template.bossOnly = false;
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) =>
        error.includes('bossOnly must be true when hybridArena is provided'),
      ),
    ).toBe(true);
  });

  it('rejects hybrid arena contract with ragged arenaTiles rows', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    const template = bad.seize.find((entry) => entry.id === ACT4_HYBRID_BASE_TEMPLATE_ID);
    Object.assign(template, makeHybridTemplatePatch());
    template.hybridArena.arenaTiles = [['Wall', 'Wall'], ['Wall']];
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.includes('hybridArena.arenaTiles must be rectangular')),
    ).toBe(true);
  });

  it('rejects phase terrain overrides referencing unknown anchors', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    const template = bad.seize.find((entry) => entry.id === ACT4_HYBRID_BASE_TEMPLATE_ID);
    Object.assign(template, makeHybridTemplatePatch());
    template.phaseTerrainOverrides[0].setTiles[0] = { anchor: 'unknown', terrain: 'Plain' };
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.includes('references unknown hybridArena anchor')),
    ).toBe(true);
  });

  it('rejects phase terrain overrides with duplicate target tiles', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    const template = bad.seize.find((entry) => entry.id === ACT4_HYBRID_BASE_TEMPLATE_ID);
    Object.assign(template, makeHybridTemplatePatch());
    template.phaseTerrainOverrides[0].setTiles = [
      { coord: [7, 3], terrain: 'Plain' },
      { coord: [7, 3], terrain: 'Forest' },
    ];
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) =>
        error.includes('phaseTerrainOverrides[0].setTiles contains duplicate target tile'),
      ),
    ).toBe(true);
  });

  it('accepts minActByDifficulty as a known reinforcement key', () => {
    const good = JSON.parse(JSON.stringify(mapTemplates));
    // open_field now has minActByDifficulty — should pass validation
    const template = good.rout.find((entry) => entry.id === 'open_field');
    expect(template.reinforcements.minActByDifficulty).toBeDefined();
    const result = validateMapTemplatesConfig(good);
    expect(result.valid).toBe(true);
  });

  it('rejects non-object minActByDifficulty', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    const template = bad.rout.find((entry) => entry.id === 'open_field');
    template.reinforcements.minActByDifficulty = 'hard';
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.includes('minActByDifficulty must be an object')),
    ).toBe(true);
  });

  it('rejects unknown difficulty keys in minActByDifficulty', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    const template = bad.rout.find((entry) => entry.id === 'open_field');
    template.reinforcements.minActByDifficulty = { hrd: 'act3' };
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) =>
        error.includes('minActByDifficulty contains unknown difficulty keys'),
      ),
    ).toBe(true);
  });

  it('rejects invalid act values in minActByDifficulty', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    const template = bad.rout.find((entry) => entry.id === 'open_field');
    template.reinforcements.minActByDifficulty = { hard: 'act5' };
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('must be a valid act'))).toBe(true);
  });

  it('accepts postAct/finalBoss/never act values in minActByDifficulty', () => {
    // Phase 1.3: ACT_GATE_ORDER extended to postAct/finalBoss, and "never" is an
    // explicit opt-out sentinel.
    for (const supportedAct of ['postAct', 'finalBoss', 'never']) {
      const good = JSON.parse(JSON.stringify(mapTemplates));
      const template = good.rout.find((entry) => entry.id === 'open_field');
      template.reinforcements.minActByDifficulty = {
        normal: 'never',
        hard: supportedAct,
        lunatic: supportedAct,
      };
      const result = validateMapTemplatesConfig(good);
      expect(result.valid).toBe(true);
    }
  });

  it('requires all three difficulty keys in minActByDifficulty', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    const template = bad.rout.find((entry) => entry.id === 'open_field');
    // Missing the "normal" key — the silent-gate footgun this rule guards against.
    template.reinforcements.minActByDifficulty = { hard: 'act2', lunatic: 'act2' };
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) =>
        error.includes('minActByDifficulty missing required difficulty key: normal'),
      ),
    ).toBe(true);
  });

  it('reports malformed hybridArena with overrides without throwing', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    const template = bad.seize.find((entry) => entry.id === ACT4_HYBRID_BASE_TEMPLATE_ID);
    template.hybridArena = 123;
    template.phaseTerrainOverrides = [
      {
        turn: 1,
        setTiles: [{ anchor: 'throne', terrain: 'Plain' }],
      },
    ];
    expect(() => validateMapTemplatesConfig(bad)).not.toThrow();
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('hybridArena must be an object'))).toBe(
      true,
    );
  });

  it('rejects template with unknown top-level keys (typo detection)', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    bad.rout[0].structure = [{ type: 'fill', rect: [0, 0, 0.5, 0.5], terrain: 'Floor' }];
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('contains unknown keys'))).toBe(true);
  });

  it('rejects non-object actTurnOffset', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    bad.rout[0].reinforcements.actTurnOffset = 'bad';
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('actTurnOffset must be an object'))).toBe(true);
  });

  it('rejects actTurnOffset with non-integer values', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    bad.rout[0].reinforcements.actTurnOffset = { hard: { act3: 'two' } };
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('must be an integer'))).toBe(true);
  });

  it('rejects non-object extraWavesByDifficulty', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    bad.rout[0].reinforcements.extraWavesByDifficulty = [1, 2];
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('extraWavesByDifficulty must be an object'))).toBe(
      true,
    );
  });

  it('rejects extraWavesByDifficulty with invalid wave shapes', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    bad.rout[0].reinforcements.extraWavesByDifficulty = { lunatic: [{ turn: 'late' }] };
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('extraWavesByDifficulty'))).toBe(true);
  });

  describe('fixedSize validation', () => {
    it('accepts valid fixedSize', () => {
      const good = JSON.parse(JSON.stringify(mapTemplates));
      good.rout[0].fixedSize = [20, 15];
      const result = validateMapTemplatesConfig(good);
      expect(result.errors.filter((e) => e.includes('fixedSize'))).toEqual([]);
    });

    it('rejects non-array fixedSize', () => {
      const bad = JSON.parse(JSON.stringify(mapTemplates));
      bad.rout[0].fixedSize = 'big';
      const result = validateMapTemplatesConfig(bad);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('fixedSize must be [cols, rows]'))).toBe(true);
    });

    it('rejects fixedSize with wrong length', () => {
      const bad = JSON.parse(JSON.stringify(mapTemplates));
      bad.rout[0].fixedSize = [20];
      const result = validateMapTemplatesConfig(bad);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('fixedSize must be [cols, rows]'))).toBe(true);
    });

    it('rejects fixedSize with non-integer values', () => {
      const bad = JSON.parse(JSON.stringify(mapTemplates));
      bad.rout[0].fixedSize = [20.5, 15];
      const result = validateMapTemplatesConfig(bad);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('fixedSize must be [cols, rows]'))).toBe(true);
    });

    it('rejects fixedSize with zero dimension', () => {
      const bad = JSON.parse(JSON.stringify(mapTemplates));
      bad.rout[0].fixedSize = [0, 15];
      const result = validateMapTemplatesConfig(bad);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('fixedSize must be [cols, rows]'))).toBe(true);
    });
  });

  describe('entitySpawn validation', () => {
    it('accepts valid entitySpawn', () => {
      const good = JSON.parse(JSON.stringify(mapTemplates));
      good.rout[0].fixedSize = [20, 15];
      good.rout[0].entitySpawn = [10, 5];
      const result = validateMapTemplatesConfig(good);
      expect(result.errors.filter((e) => e.includes('entitySpawn'))).toEqual([]);
    });

    it('rejects non-array entitySpawn', () => {
      const bad = JSON.parse(JSON.stringify(mapTemplates));
      bad.rout[0].entitySpawn = { col: 5, row: 5 };
      const result = validateMapTemplatesConfig(bad);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('entitySpawn must be [col, row]'))).toBe(true);
    });

    it('rejects entitySpawn with negative coordinates', () => {
      const bad = JSON.parse(JSON.stringify(mapTemplates));
      bad.rout[0].entitySpawn = [-1, 5];
      const result = validateMapTemplatesConfig(bad);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('entitySpawn must be [col, row]'))).toBe(true);
    });

    it('rejects entitySpawn that exceeds fixedSize bounds', () => {
      const bad = JSON.parse(JSON.stringify(mapTemplates));
      bad.rout[0].fixedSize = [10, 10];
      bad.rout[0].entitySpawn = [9, 5]; // 9+3=12 > 10
      const result = validateMapTemplatesConfig(bad);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('3x3 footprint exceeds fixedSize bounds'))).toBe(
        true,
      );
    });

    it('accepts entitySpawn that fits exactly in fixedSize', () => {
      const good = JSON.parse(JSON.stringify(mapTemplates));
      good.rout[0].fixedSize = [10, 10];
      good.rout[0].entitySpawn = [7, 7]; // 7+3=10 == 10
      const result = validateMapTemplatesConfig(good);
      expect(result.errors.filter((e) => e.includes('entitySpawn'))).toEqual([]);
    });

    it('skips bounds check when fixedSize is invalid', () => {
      const bad = JSON.parse(JSON.stringify(mapTemplates));
      bad.rout[0].fixedSize = 'big';
      bad.rout[0].entitySpawn = [5, 5];
      const result = validateMapTemplatesConfig(bad);
      // Should report fixedSize error but not crash on bounds check
      expect(result.errors.some((e) => e.includes('fixedSize must be'))).toBe(true);
      expect(result.errors.some((e) => e.includes('3x3 footprint'))).toBe(false);
    });

    it('requires fixedSize when entitySpawn is present', () => {
      const bad = JSON.parse(JSON.stringify(mapTemplates));
      const template = bad.rout[0];
      delete template.fixedSize;
      template.entitySpawn = [1, 1];
      const result = validateMapTemplatesConfig(bad);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('entitySpawn requires a valid fixedSize'))).toBe(
        true,
      );
    });
  });
});

describe('MapTemplateEngine — Phase 2.4 validation gaps', () => {
  const findTemplate = (config, objective, id) =>
    config[objective].find((entry) => entry.id === id);

  describe('features + seize throne rule', () => {
    it('rejects a seize template missing its Throne feature', () => {
      const bad = JSON.parse(JSON.stringify(mapTemplates));
      const template = findTemplate(bad, 'seize', 'castle_assault');
      template.features = template.features.filter((f) => f.type !== 'Throne');
      const result = validateMapTemplatesConfig(bad);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.includes('seize template must include exactly one Throne feature (found 0)'),
        ),
      ).toBe(true);
    });

    it('rejects a seize template with two Throne features', () => {
      const bad = JSON.parse(JSON.stringify(mapTemplates));
      const template = findTemplate(bad, 'seize', 'great_hall');
      template.features.push({ type: 'Throne', position: 'center' });
      const result = validateMapTemplatesConfig(bad);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('found 2'))).toBe(true);
    });

    it('rejects an unknown feature type', () => {
      const bad = JSON.parse(JSON.stringify(mapTemplates));
      const template = findTemplate(bad, 'seize', 'great_hall');
      template.features.push({ type: 'Catapult', position: 'center' });
      const result = validateMapTemplatesConfig(bad);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('.type must be one of'))).toBe(true);
    });

    it('rejects an unknown feature position', () => {
      const bad = JSON.parse(JSON.stringify(mapTemplates));
      const template = findTemplate(bad, 'seize', 'great_hall');
      template.features[0].position = 'nowhere';
      const result = validateMapTemplatesConfig(bad);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('.position must be one of'))).toBe(true);
    });
  });

  describe('enemyWeights', () => {
    it('accepts all known weight keys including flying', () => {
      const ok = JSON.parse(JSON.stringify(mapTemplates));
      ok.rout[0].enemyWeights = {
        infantry: 1,
        cavalry: 1,
        archer: 1,
        mage: 1,
        knight: 1,
        armored: 1,
        lance: 1,
        flying: 1.5,
      };
      const result = validateMapTemplatesConfig(ok);
      expect(result.valid).toBe(true);
    });

    it('rejects an unknown enemyWeights key', () => {
      const bad = JSON.parse(JSON.stringify(mapTemplates));
      bad.rout[0].enemyWeights = { dragon: 2 };
      const result = validateMapTemplatesConfig(bad);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.includes('enemyWeights contains unknown key "dragon"')),
      ).toBe(true);
    });

    it('rejects a negative enemyWeights value', () => {
      const bad = JSON.parse(JSON.stringify(mapTemplates));
      bad.rout[0].enemyWeights = { flying: -1 };
      const result = validateMapTemplatesConfig(bad);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('must be a finite number >= 0'))).toBe(true);
    });
  });

  describe('anchors', () => {
    it('rejects an unknown anchor position', () => {
      const bad = JSON.parse(JSON.stringify(mapTemplates));
      findTemplate(bad, 'rout', 'chokepoint').anchors[0].position = 'middle';
      const result = validateMapTemplatesConfig(bad);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('.position must be one of'))).toBe(true);
    });

    it('rejects an unknown anchor unit', () => {
      const bad = JSON.parse(JSON.stringify(mapTemplates));
      findTemplate(bad, 'rout', 'chokepoint').anchors[0].unit = 'super_boss';
      const result = validateMapTemplatesConfig(bad);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('.unit must be one of'))).toBe(true);
    });

    it('rejects a non-positive anchor count', () => {
      const bad = JSON.parse(JSON.stringify(mapTemplates));
      findTemplate(bad, 'rout', 'chokepoint').anchors[0].count = 0;
      const result = validateMapTemplatesConfig(bad);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('.count must be a positive integer'))).toBe(true);
    });
  });

  describe('minBridges / minBridgesByAct', () => {
    it('rejects a non-positive minBridges', () => {
      const bad = JSON.parse(JSON.stringify(mapTemplates));
      findTemplate(bad, 'rout', 'river_crossing').minBridges = 0;
      const result = validateMapTemplatesConfig(bad);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('minBridges must be a positive integer'))).toBe(
        true,
      );
    });

    it('rejects a minBridgesByAct range with min > max', () => {
      const bad = JSON.parse(JSON.stringify(mapTemplates));
      findTemplate(bad, 'rout', 'river_crossing').minBridgesByAct.act2 = [4, 2];
      const result = validateMapTemplatesConfig(bad);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('min <= max'))).toBe(true);
    });

    it('accepts a minBridgesByAct scalar and range', () => {
      const ok = JSON.parse(JSON.stringify(mapTemplates));
      findTemplate(ok, 'rout', 'river_crossing').minBridgesByAct = { act2: 3, act3: [2, 4] };
      const result = validateMapTemplatesConfig(ok);
      expect(result.valid).toBe(true);
    });
  });

  describe('fogChance', () => {
    it('rejects fogChance above 1', () => {
      const bad = JSON.parse(JSON.stringify(mapTemplates));
      bad.rout[0].fogChance = 1.5;
      const result = validateMapTemplatesConfig(bad);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.includes('fogChance must be a finite number in [0,1]')),
      ).toBe(true);
    });

    it('rejects a negative fogChance', () => {
      const bad = JSON.parse(JSON.stringify(mapTemplates));
      bad.rout[0].fogChance = -0.1;
      const result = validateMapTemplatesConfig(bad);
      expect(result.valid).toBe(false);
    });
  });

  describe('scripted-wave coordinates vs fixedSize', () => {
    it('rejects a scripted-wave spawn outside fixedSize bounds', () => {
      const bad = JSON.parse(JSON.stringify(mapTemplates));
      const template = bad.rout[0];
      template.fixedSize = [10, 8];
      template.reinforcementContractVersion = REINFORCEMENT_CONTRACT_VERSION;
      template.reinforcements = {
        spawnEdges: ['right'],
        waves: [{ turn: 2, count: [1, 1] }],
        difficultyScaling: true,
        turnOffsetByDifficulty: { normal: 0, hard: 0, lunatic: 0 },
        xpDecay: [1],
        scriptedWaves: [{ turn: 1, spawns: [{ col: 99, row: 2 }] }],
      };
      const result = validateMapTemplatesConfig(bad);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('is out of fixedSize width'))).toBe(true);
    });
  });
});
