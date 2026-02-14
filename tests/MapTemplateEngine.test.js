import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import {
  REINFORCEMENT_CONTRACT_VERSION,
  validateMapTemplatesConfig,
} from '../src/engine/MapTemplateEngine.js';

const mapTemplates = JSON.parse(readFileSync('data/mapTemplates.json', 'utf8'));
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

  it('rejects templates that define reinforcement version without reinforcements object', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    bad.rout[0].reinforcementContractVersion = REINFORCEMENT_CONTRACT_VERSION;
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('must define both reinforcementContractVersion and reinforcements'))).toBe(true);
  });

  it('rejects config when either objective template pool is empty', () => {
    const result = validateMapTemplatesConfig({ rout: [], seize: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('rout must include at least one template'))).toBe(true);
    expect(result.errors.some((error) => error.includes('seize must include at least one template'))).toBe(true);
  });

  it('rejects reinforcement waves with invalid count ranges', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    const template = bad.rout.find((entry) => entry.id === 'frozen_pass');
    template.reinforcements.waves[0].count = [3, 1];
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('count must have 0 < min <= max'))).toBe(true);
  });

  it('rejects reinforcement wave edges outside spawnEdges', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    const template = bad.seize.find((entry) => entry.id === 'eruption_point');
    template.reinforcements.waves[0].edges = ['left'];
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('subset of reinforcements.spawnEdges'))).toBe(true);
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
    expect(result.errors.some((error) => error.includes('turnJitter must satisfy minDelta <= maxDelta'))).toBe(true);
  });

  it('rejects reinforcement turnJitter when values are non-integers', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    const template = bad.rout.find((entry) => entry.id === 'frozen_pass');
    template.reinforcements.turnJitter = [0.5, 1];
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('turnJitter must be [minDelta,maxDelta] integers'))).toBe(true);
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
    expect(result.errors.some((error) => error.includes('reinforcements.waves must be a non-empty array'))).toBe(true);
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
    expect(result.errors.some((error) => error.includes('scriptedWaves[0].spawns[0].col must be a non-negative integer'))).toBe(true);
  });

  it('rejects zones missing rect coordinates', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    bad.rout[0].zones[0] = { terrain: { Plain: 100 } };
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('zones[0].rect must be [x1,y1,x2,y2] finite numbers'))).toBe(true);
  });

  it('rejects zones with invalid rect bounds', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    bad.rout[0].zones[0].rect = [0.5, 0.5, 0.4, 1.2];
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('must satisfy 0 <= x1 < x2 <= 1 and 0 <= y1 < y2 <= 1'))).toBe(true);
  });

  it('rejects zones with invalid terrain weights', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    bad.rout[0].zones[0].terrain = { Plain: 0 };
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('terrain["Plain"] must be a positive number'))).toBe(true);
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
    expect(result.errors.some((error) => error.includes('bossOnly must be true when hybridArena is provided'))).toBe(true);
  });

  it('rejects hybrid arena contract with ragged arenaTiles rows', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    const template = bad.seize.find((entry) => entry.id === ACT4_HYBRID_BASE_TEMPLATE_ID);
    Object.assign(template, makeHybridTemplatePatch());
    template.hybridArena.arenaTiles = [
      ['Wall', 'Wall'],
      ['Wall'],
    ];
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('hybridArena.arenaTiles must be rectangular'))).toBe(true);
  });

  it('rejects phase terrain overrides referencing unknown anchors', () => {
    const bad = JSON.parse(JSON.stringify(mapTemplates));
    const template = bad.seize.find((entry) => entry.id === ACT4_HYBRID_BASE_TEMPLATE_ID);
    Object.assign(template, makeHybridTemplatePatch());
    template.phaseTerrainOverrides[0].setTiles[0] = { anchor: 'unknown', terrain: 'Plain' };
    const result = validateMapTemplatesConfig(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('references unknown hybridArena anchor'))).toBe(true);
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
    expect(result.errors.some((error) => error.includes('phaseTerrainOverrides[0].setTiles contains duplicate target tile'))).toBe(true);
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
    expect(result.errors.some((error) => error.includes('hybridArena must be an object'))).toBe(true);
  });
});
