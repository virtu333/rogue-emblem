// Structures.test.js — Tests for castle map structure overlays
import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyStructures,
  getFallbackPassable,
  generateBattle,
} from '../src/engine/MapGenerator.js';
import { validateMapTemplatesConfig } from '../src/engine/MapTemplateEngine.js';
import { TERRAIN } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

let data;
beforeEach(async () => {
  data = data || loadGameData();
});

// Helper: create a blank map filled with a terrain index
function makeMap(cols, rows, fill = TERRAIN.Plain) {
  const map = [];
  for (let r = 0; r < rows; r++) {
    map[r] = new Array(cols).fill(fill);
  }
  return map;
}

describe('getFallbackPassable', () => {
  it('returns Floor for castle biome', () => {
    expect(getFallbackPassable('castle')).toBe(TERRAIN.Floor);
  });

  it('returns Plain for grassland biome', () => {
    expect(getFallbackPassable('grassland')).toBe(TERRAIN.Plain);
  });

  it('returns Plain for null/undefined biome', () => {
    expect(getFallbackPassable(null)).toBe(TERRAIN.Plain);
    expect(getFallbackPassable(undefined)).toBe(TERRAIN.Plain);
  });

  it('returns Plain for unknown biome', () => {
    expect(getFallbackPassable('tundra')).toBe(TERRAIN.Plain);
    expect(getFallbackPassable('volcano')).toBe(TERRAIN.Plain);
    expect(getFallbackPassable('swamp')).toBe(TERRAIN.Plain);
  });
});

describe('applyStructures', () => {
  const terrain = [
    { name: 'Plain' },
    { name: 'Forest' },
    { name: 'Mountain' },
    { name: 'Fort' },
    { name: 'Throne' },
    { name: 'Wall' },
    { name: 'Water' },
    { name: 'Bridge' },
    { name: 'Sand' },
    { name: 'Village' },
    { name: 'Ice' },
    { name: 'Lava Crack' },
    { name: 'Floor' },
    { name: 'Pillar' },
  ];

  it('no-ops for null/undefined/empty structures', () => {
    const map = makeMap(10, 8);
    const before = JSON.stringify(map);
    applyStructures(map, null, 10, 8, terrain);
    expect(JSON.stringify(map)).toBe(before);
    applyStructures(map, undefined, 10, 8, terrain);
    expect(JSON.stringify(map)).toBe(before);
    applyStructures(map, [], 10, 8, terrain);
    expect(JSON.stringify(map)).toBe(before);
  });

  describe('fill', () => {
    it('fills rect with specified terrain', () => {
      const map = makeMap(10, 10);
      applyStructures(
        map,
        [{ type: 'fill', rect: [0.2, 0.2, 0.6, 0.6], terrain: 'Floor' }],
        10,
        10,
        terrain,
      );
      // Check center tiles are Floor (index 12)
      expect(map[3][3]).toBe(TERRAIN.Floor);
      expect(map[5][5]).toBe(TERRAIN.Floor);
      // Check outside tiles untouched
      expect(map[0][0]).toBe(TERRAIN.Plain);
      expect(map[9][9]).toBe(TERRAIN.Plain);
    });
  });

  describe('room', () => {
    it('places Wall perimeter and Floor interior', () => {
      const map = makeMap(10, 10, TERRAIN.Floor);
      applyStructures(map, [{ type: 'room', rect: [0.2, 0.2, 0.8, 0.8] }], 10, 10, terrain);
      // Perimeter = Wall (index 5)
      expect(map[2][2]).toBe(TERRAIN.Wall);
      expect(map[2][7]).toBe(TERRAIN.Wall);
      expect(map[7][2]).toBe(TERRAIN.Wall);
      expect(map[7][7]).toBe(TERRAIN.Wall);
      // Interior = Floor (index 12)
      expect(map[4][4]).toBe(TERRAIN.Floor);
      expect(map[5][5]).toBe(TERRAIN.Floor);
    });

    it('respects custom wallTerrain and interior', () => {
      const map = makeMap(10, 10);
      applyStructures(
        map,
        [{ type: 'room', rect: [0.1, 0.1, 0.5, 0.5], wallTerrain: 'Pillar', interior: 'Fort' }],
        10,
        10,
        terrain,
      );
      // Perimeter = Pillar (13)
      expect(map[1][1]).toBe(TERRAIN.Pillar);
      // Interior = Fort (3)
      expect(map[3][3]).toBe(TERRAIN.Fort);
    });
  });

  describe('wall_line', () => {
    it('fills rect with Wall by default', () => {
      const map = makeMap(10, 10, TERRAIN.Floor);
      applyStructures(map, [{ type: 'wall_line', rect: [0.1, 0.1, 0.9, 0.2] }], 10, 10, terrain);
      // First row of rect should be Wall
      expect(map[1][1]).toBe(TERRAIN.Wall);
      expect(map[1][8]).toBe(TERRAIN.Wall);
    });

    it('uses custom terrain when specified', () => {
      const map = makeMap(10, 10, TERRAIN.Floor);
      applyStructures(
        map,
        [{ type: 'wall_line', rect: [0.1, 0.1, 0.9, 0.2], terrain: 'Pillar' }],
        10,
        10,
        terrain,
      );
      expect(map[1][1]).toBe(TERRAIN.Pillar);
    });
  });

  describe('pillar_grid', () => {
    it('places pillars at spacing intervals, floor elsewhere', () => {
      const map = makeMap(10, 10);
      applyStructures(
        map,
        [{ type: 'pillar_grid', rect: [0, 0, 0.6, 0.6], spacing: 2 }],
        10,
        10,
        terrain,
      );
      // (0,0) → Pillar (local 0%2=0 && 0%2=0)
      expect(map[0][0]).toBe(TERRAIN.Pillar);
      // (0,1) → Floor (local 0%2=0 && 1%2=1)
      expect(map[0][1]).toBe(TERRAIN.Floor);
      // (1,0) → Floor (local 1%2=1)
      expect(map[1][0]).toBe(TERRAIN.Floor);
      // (2,2) → Pillar (local 2%2=0 && 2%2=0)
      expect(map[2][2]).toBe(TERRAIN.Pillar);
    });
  });

  describe('pillar_line', () => {
    it('places pillars along longer axis at spacing', () => {
      const map = makeMap(10, 10);
      // Horizontal line (wider than tall): rect [0, 0, 1, 0.1] → 10 wide, 1 tall
      applyStructures(
        map,
        [{ type: 'pillar_line', rect: [0, 0, 1, 0.2], spacing: 3 }],
        10,
        10,
        terrain,
      );
      // Horizontal → step along columns: col 0=Pillar, 1=Floor, 2=Floor, 3=Pillar, ...
      expect(map[0][0]).toBe(TERRAIN.Pillar);
      expect(map[0][1]).toBe(TERRAIN.Floor);
      expect(map[0][2]).toBe(TERRAIN.Floor);
      expect(map[0][3]).toBe(TERRAIN.Pillar);
    });

    it('places pillars along rows when height >= width', () => {
      const map = makeMap(10, 10);
      // Vertical line (taller than wide)
      applyStructures(
        map,
        [{ type: 'pillar_line', rect: [0, 0, 0.1, 1], spacing: 2 }],
        10,
        10,
        terrain,
      );
      // Vertical → step along rows: row 0=Pillar, 1=Floor, 2=Pillar, ...
      expect(map[0][0]).toBe(TERRAIN.Pillar);
      expect(map[1][0]).toBe(TERRAIN.Floor);
      expect(map[2][0]).toBe(TERRAIN.Pillar);
    });
  });

  describe('ordering', () => {
    it('later structures overwrite earlier ones', () => {
      const map = makeMap(10, 10);
      applyStructures(
        map,
        [
          { type: 'fill', rect: [0, 0, 1, 1], terrain: 'Wall' },
          { type: 'fill', rect: [0.3, 0.3, 0.7, 0.7], terrain: 'Floor' },
        ],
        10,
        10,
        terrain,
      );
      // Outer region = Wall
      expect(map[0][0]).toBe(TERRAIN.Wall);
      // Inner region = Floor (overwrote Wall)
      expect(map[4][4]).toBe(TERRAIN.Floor);
    });
  });

  describe('scaling', () => {
    it('same normalized rect scales to different map sizes', () => {
      const map8 = makeMap(8, 8);
      const map16 = makeMap(16, 16);
      const struct = [{ type: 'fill', rect: [0.5, 0.5, 1, 1], terrain: 'Wall' }];
      applyStructures(map8, struct, 8, 8, terrain);
      applyStructures(map16, struct, 16, 16, terrain);
      // 8x8: cols 4-7, rows 4-7 should be Wall
      expect(map8[4][4]).toBe(TERRAIN.Wall);
      expect(map8[3][3]).toBe(TERRAIN.Plain);
      // 16x16: cols 8-15, rows 8-15 should be Wall
      expect(map16[8][8]).toBe(TERRAIN.Wall);
      expect(map16[7][7]).toBe(TERRAIN.Plain);
    });
  });

  describe('error handling', () => {
    it('throws on unknown terrain name (fail-fast for typos)', () => {
      const map = makeMap(10, 10);
      expect(() => {
        applyStructures(
          map,
          [{ type: 'fill', rect: [0, 0, 1, 1], terrain: 'Flor' }],
          10,
          10,
          terrain,
        );
      }).toThrow('Unknown terrain name in structure: "Flor"');
    });

    it('throws on typo in room wallTerrain', () => {
      const map = makeMap(10, 10);
      expect(() => {
        applyStructures(
          map,
          [{ type: 'room', rect: [0, 0, 0.5, 0.5], wallTerrain: 'Wal' }],
          10,
          10,
          terrain,
        );
      }).toThrow('Unknown terrain name in structure: "Wal"');
    });

    it('skips structures with invalid rect (no crash)', () => {
      const map = makeMap(10, 10);
      const before = JSON.stringify(map);
      applyStructures(
        map,
        [{ type: 'fill', rect: [2, 2, 3, 3], terrain: 'Floor' }],
        10,
        10,
        terrain,
      );
      // rect [2,2,3,3] is outside 0-1 normalized range, resolveNormalizedRectBounds returns null → skip
      expect(JSON.stringify(map)).toBe(before);
    });
  });
});

describe('Structure integration with generateBattle', () => {
  it('corridor_siege produces deterministic wall structures in center', () => {
    const config = generateBattle(
      { act: 'act2', objective: 'rout', templateId: 'corridor_siege', deployCount: 4, row: 1 },
      data,
    );
    expect(config.biome).toBe('castle');
    const { mapLayout, cols } = config;

    // Central area should have Wall in top/bottom bands (not random scatter)
    // Top band: roughly rows 0-1 in the center (cols ~3-10 for 14-col map)
    // Top-band wall should exist in center columns
    const topBandHasWall = mapLayout[0]?.slice(3, cols - 3).some((t) => t === TERRAIN.Wall);
    expect(topBandHasWall).toBe(true);
    // Central corridor (rows 3-6) should be mostly Floor
    const corridorFloorCount =
      mapLayout[4]?.slice(3, cols - 3).filter((t) => t === TERRAIN.Floor).length || 0;
    expect(corridorFloorCount).toBeGreaterThan(0);
  });

  it('castle templates still produce valid playable maps', () => {
    const castleTemplateIds = [
      'corridor_siege',
      'castle_ruins',
      'great_hall',
      'act3_dark_champion_keep',
    ];
    const acts = ['act2', 'act2', 'act2', 'act3'];
    const objectives = ['rout', 'rout', 'seize', 'seize'];

    for (let i = 0; i < castleTemplateIds.length; i++) {
      const config = generateBattle(
        {
          act: acts[i],
          objective: objectives[i],
          templateId: castleTemplateIds[i],
          deployCount: 4,
          row: 1,
          isBoss: castleTemplateIds[i] === 'act3_dark_champion_keep',
        },
        data,
      );
      expect(config, `${castleTemplateIds[i]} should generate`).toBeTruthy();
      expect(config.playerSpawns.length).toBeGreaterThan(0);
      expect(config.enemySpawns.length).toBeGreaterThan(0);
      expect(config.biome).toBe('castle');
    }
  });

  it('spawn zones retain tactical variety (Fort/Pillar not all-Floor)', () => {
    // Run corridor_siege multiple times, check player spawn zone isn't all Floor
    let hasNonFloor = false;
    for (let i = 0; i < 20; i++) {
      const config = generateBattle(
        { act: 'act2', objective: 'rout', templateId: 'corridor_siege', deployCount: 4, row: 1 },
        data,
      );
      // Player spawn zone: x 0-0.25 of map width
      const spawnEndCol = Math.ceil(config.cols * 0.25);
      for (let r = 0; r < config.rows; r++) {
        for (let c = 0; c < spawnEndCol; c++) {
          const t = config.mapLayout[r][c];
          if (t !== TERRAIN.Floor && t !== TERRAIN.Wall) {
            hasNonFloor = true;
          }
        }
      }
      if (hasNonFloor) break;
    }
    expect(hasNonFloor).toBe(true);
  });

  it('great_hall enemy spawn zone has Fort variety (not all Floor)', () => {
    let hasFort = false;
    for (let i = 0; i < 20; i++) {
      const config = generateBattle(
        { act: 'act2', objective: 'seize', templateId: 'great_hall', deployCount: 4, row: 1 },
        data,
      );
      // Enemy spawn zone: x 0.55-0.9, y 0.2-0.8
      const startCol = Math.floor(config.cols * 0.55);
      const endCol = Math.floor(config.cols * 0.9);
      const startRow = Math.floor(config.rows * 0.2);
      const endRow = Math.ceil(config.rows * 0.8);
      for (let r = startRow; r < endRow; r++) {
        for (let c = startCol; c < endCol; c++) {
          if (config.mapLayout[r][c] === TERRAIN.Fort) {
            hasFort = true;
          }
        }
      }
      if (hasFort) break;
    }
    expect(hasFort).toBe(true);
  });

  it('act3_dark_champion_keep enemy spawn zone has Fort variety (not all Floor)', () => {
    let hasFort = false;
    for (let i = 0; i < 20; i++) {
      const config = generateBattle(
        {
          act: 'act3',
          objective: 'seize',
          templateId: 'act3_dark_champion_keep',
          deployCount: 6,
          row: 1,
          isBoss: true,
        },
        data,
      );
      // Enemy spawn zone: x 0.62-0.95, y 0.2-0.8
      const startCol = Math.floor(config.cols * 0.62);
      const endCol = Math.floor(config.cols * 0.95);
      const startRow = Math.floor(config.rows * 0.2);
      const endRow = Math.ceil(config.rows * 0.8);
      for (let r = startRow; r < endRow; r++) {
        for (let c = startCol; c < endCol; c++) {
          if (config.mapLayout[r][c] === TERRAIN.Fort) {
            hasFort = true;
          }
        }
      }
      if (hasFort) break;
    }
    expect(hasFort).toBe(true);
  });
});

describe('Biome-aware carving regression', () => {
  it('carvePath uses Floor for castle biome (not Plain)', () => {
    // Generate a castle map — all carved tiles should be Floor/Bridge, never Plain
    const config = generateBattle(
      { act: 'act2', objective: 'rout', templateId: 'corridor_siege', deployCount: 4, row: 1 },
      data,
    );
    expect(config.biome).toBe('castle');
    // Verify no Plain tiles in the map (castle maps should use Floor as fallback)
    const flatTiles = config.mapLayout.flat();
    // Castle maps may still have Plain via data-defined zones, but the castle zones
    // use only Floor/Wall/Pillar/Fort — so Plain should not appear
    const plainCount = flatTiles.filter((t) => t === TERRAIN.Plain).length;
    expect(plainCount).toBe(0);
  });

  it('capTerrainCount uses Floor for castle biome', () => {
    // Run multiple castle maps and check fort count is capped
    for (let i = 0; i < 10; i++) {
      const config = generateBattle(
        { act: 'act2', objective: 'seize', templateId: 'great_hall', deployCount: 4, row: 1 },
        data,
      );
      const fortCount = config.mapLayout.flat().filter((t) => t === TERRAIN.Fort).length;
      expect(fortCount).toBeLessThanOrEqual(4); // MAX_FORTS = 4
    }
  });
});

describe('Structure precedence', () => {
  it('hybridArena overrides structures (zones → structures → hybrid → features)', () => {
    // act3_dark_champion_keep has both structures and hybridArena
    const config = generateBattle(
      {
        act: 'act3',
        objective: 'seize',
        templateId: 'act3_dark_champion_keep',
        deployCount: 6,
        row: 1,
        isBoss: true,
      },
      data,
    );
    expect(config.biome).toBe('castle');
    // hybridArena should have painted its tiles (Fort in arena)
    const { hybridArena } = data.mapTemplates.seize.find((t) => t.id === 'act3_dark_champion_keep');
    if (hybridArena?.arenaTiles) {
      const [originCol, originRow] = hybridArena.arenaOrigin;
      for (let r = 0; r < hybridArena.arenaTiles.length; r++) {
        for (let c = 0; c < hybridArena.arenaTiles[r].length; c++) {
          const expectedName = hybridArena.arenaTiles[r][c];
          const expectedIdx = data.terrain.findIndex((t) => t.name === expectedName);
          const actualIdx = config.mapLayout[originRow + r]?.[originCol + c];
          expect(
            actualIdx,
            `arena tile (${originRow + r},${originCol + c}) should be ${expectedName}`,
          ).toBe(expectedIdx);
        }
      }
    }
  });

  it('features (Throne) override structures', () => {
    const config = generateBattle(
      { act: 'act2', objective: 'seize', templateId: 'great_hall', deployCount: 4, row: 1 },
      data,
    );
    expect(config.thronePos).toBeTruthy();
    const throneIdx = data.terrain.findIndex((t) => t.name === 'Throne');
    const { col, row } = config.thronePos;
    expect(config.mapLayout[row][col]).toBe(throneIdx);
  });
});

describe('Structure validation in MapTemplateEngine', () => {
  it('valid structures pass validation', () => {
    const result = validateMapTemplatesConfig(data.mapTemplates);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects non-array structures', () => {
    const config = {
      rout: [
        { id: 'test', zones: [{ rect: [0, 0, 1, 1], terrain: { Plain: 100 } }], structures: 'bad' },
      ],
      seize: [{ id: 'test2', zones: [{ rect: [0, 0, 1, 1], terrain: { Plain: 100 } }] }],
    };
    const result = validateMapTemplatesConfig(config);
    expect(result.errors.some((e) => e.includes('must be an array'))).toBe(true);
  });

  it('rejects unknown structure type', () => {
    const config = {
      rout: [
        {
          id: 'test',
          zones: [{ rect: [0, 0, 1, 1], terrain: { Plain: 100 } }],
          structures: [{ type: 'moat', rect: [0, 0, 0.5, 0.5] }],
        },
      ],
      seize: [{ id: 'test2', zones: [{ rect: [0, 0, 1, 1], terrain: { Plain: 100 } }] }],
    };
    const result = validateMapTemplatesConfig(config);
    expect(result.errors.some((e) => e.includes('type must be one of'))).toBe(true);
  });

  it('rejects invalid rect in structure', () => {
    const config = {
      rout: [
        {
          id: 'test',
          zones: [{ rect: [0, 0, 1, 1], terrain: { Plain: 100 } }],
          structures: [{ type: 'fill', rect: [0.5, 0.5, 0.3, 0.3], terrain: 'Floor' }],
        },
      ],
      seize: [{ id: 'test2', zones: [{ rect: [0, 0, 1, 1], terrain: { Plain: 100 } }] }],
    };
    const result = validateMapTemplatesConfig(config);
    expect(result.errors.some((e) => e.includes('rect must satisfy'))).toBe(true);
  });

  it('rejects fill without terrain', () => {
    const config = {
      rout: [
        {
          id: 'test',
          zones: [{ rect: [0, 0, 1, 1], terrain: { Plain: 100 } }],
          structures: [{ type: 'fill', rect: [0, 0, 0.5, 0.5] }],
        },
      ],
      seize: [{ id: 'test2', zones: [{ rect: [0, 0, 1, 1], terrain: { Plain: 100 } }] }],
    };
    const result = validateMapTemplatesConfig(config);
    expect(
      result.errors.some((e) => e.includes('terrain must be a non-empty string for fill')),
    ).toBe(true);
  });

  it('rejects template-level typo key (e.g. "structure" instead of "structures")', () => {
    const config = {
      rout: [
        {
          id: 'test',
          zones: [{ rect: [0, 0, 1, 1], terrain: { Plain: 100 } }],
          structure: [{ type: 'fill', rect: [0, 0, 0.5, 0.5], terrain: 'Floor' }],
        },
      ],
      seize: [{ id: 'test2', zones: [{ rect: [0, 0, 1, 1], terrain: { Plain: 100 } }] }],
    };
    const result = validateMapTemplatesConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('contains unknown keys'))).toBe(true);
  });

  it('rejects structure with typo key (e.g. "terrian" on fill)', () => {
    const config = {
      rout: [
        {
          id: 'test',
          zones: [{ rect: [0, 0, 1, 1], terrain: { Plain: 100 } }],
          structures: [
            { type: 'fill', rect: [0, 0, 0.5, 0.5], terrain: 'Floor', terrian: 'Floor' },
          ],
        },
      ],
      seize: [{ id: 'test2', zones: [{ rect: [0, 0, 1, 1], terrain: { Plain: 100 } }] }],
    };
    const result = validateMapTemplatesConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown keys for type'))).toBe(true);
  });

  it('rejects pillar_grid with non-integer spacing', () => {
    const config = {
      rout: [
        {
          id: 'test',
          zones: [{ rect: [0, 0, 1, 1], terrain: { Plain: 100 } }],
          structures: [{ type: 'pillar_grid', rect: [0, 0, 0.5, 0.5], spacing: 1.5 }],
        },
      ],
      seize: [{ id: 'test2', zones: [{ rect: [0, 0, 1, 1], terrain: { Plain: 100 } }] }],
    };
    const result = validateMapTemplatesConfig(config);
    expect(result.errors.some((e) => e.includes('spacing must be a positive integer'))).toBe(true);
  });

  it('accepts structures with only required fields', () => {
    const config = {
      rout: [
        {
          id: 'test',
          zones: [{ rect: [0, 0, 1, 1], terrain: { Plain: 100 } }],
          structures: [
            { type: 'fill', rect: [0, 0, 0.5, 0.5], terrain: 'Floor' },
            { type: 'room', rect: [0, 0, 0.5, 0.5] },
            { type: 'wall_line', rect: [0, 0, 0.5, 0.1] },
            { type: 'pillar_grid', rect: [0, 0, 0.5, 0.5] },
            { type: 'pillar_line', rect: [0, 0, 0.5, 0.1] },
          ],
        },
      ],
      seize: [{ id: 'test2', zones: [{ rect: [0, 0, 1, 1], terrain: { Plain: 100 } }] }],
      escape: [
        {
          id: 'test3',
          zones: [{ rect: [0, 0, 1, 1], terrain: { Plain: 100 } }],
          escapeZone: { rect: [0.9, 0.3, 1, 0.7] },
        },
      ],
    };
    const result = validateMapTemplatesConfig(config);
    expect(result.errors).toEqual([]);
  });
});

describe('Structure/spawn zone overlap guard (geometry)', () => {
  // Uses the same floor/ceil math as resolveNormalizedRectBounds in MapGenerator.js
  // to verify that no structure rect overlaps any spawn zone at real map sizes.
  function resolveRange(lo, hi, size) {
    return { start: Math.floor(lo * size), end: Math.ceil(hi * size) };
  }

  function rangesOverlap(a, b) {
    return a.start < b.end && b.start < a.end;
  }

  // wall_lines are intentional border architecture — they paint impassable Wall
  // and may cross spawn boundaries by design. Only check variety-wiping types.
  const CHECKED_TYPES = new Set(['fill', 'room', 'pillar_grid', 'pillar_line']);

  function assertNoOverlap(templateId, structures, spawnZones, colsRowsPairs) {
    for (const [cols, rows] of colsRowsPairs) {
      for (const struct of structures.filter((s) => CHECKED_TYPES.has(s.type))) {
        const sx = resolveRange(struct.rect[0], struct.rect[2], cols);
        const sy = resolveRange(struct.rect[1], struct.rect[3], rows);
        for (const zone of spawnZones) {
          const zx = resolveRange(zone.rect[0], zone.rect[2], cols);
          const zy = resolveRange(zone.rect[1], zone.rect[3], rows);
          if (rangesOverlap(sx, zx) && rangesOverlap(sy, zy)) {
            throw new Error(
              `${templateId} struct ${struct.type} [${struct.rect}] overlaps ` +
                `${zone.role} spawn [${zone.rect}] at ${cols}x${rows}: ` +
                `x[${sx.start},${sx.end}) ∩ [${zx.start},${zx.end}), ` +
                `y[${sy.start},${sy.end}) ∩ [${zy.start},${zy.end})`,
            );
          }
        }
      }
    }
  }

  // Extract spawn zones and structures from live data
  function getTemplateData(objective, id) {
    const pool = objective === 'rout' ? data.mapTemplates.rout : data.mapTemplates.seize;
    const t = pool.find((t) => t.id === id);
    const spawns = t.zones.filter((z) => z.role === 'playerSpawn' || z.role === 'enemySpawn');
    return { structures: t.structures || [], spawns, acts: t.acts || [] };
  }

  // Derive all valid [cols, rows] pairs from mapSizes for the given template acts.
  // Mirrors prefixMap in MapGenerator.pickMapSize — keep in sync if acts change.
  const ACT_PREFIX = {
    act1: 'Act 1',
    act2: 'Act 2',
    act3: 'Act 3',
    act4: 'Act 4',
    postAct: 'Post-Act',
    finalBoss: 'Final Boss',
  };

  function getSizesForTemplate(acts) {
    const seen = new Set();
    const sizes = [];
    for (const act of acts) {
      const prefix = ACT_PREFIX[act];
      if (!prefix) continue;
      for (const entry of data.mapSizes) {
        if (entry.phase.startsWith(prefix) && !seen.has(entry.mapSize)) {
          seen.add(entry.mapSize);
          sizes.push(entry.mapSize.split('x').map(Number));
        }
      }
    }
    return sizes;
  }

  it('corridor_siege: no structure overlaps spawn zones', () => {
    const { structures, spawns, acts } = getTemplateData('rout', 'corridor_siege');
    const sizes = getSizesForTemplate(acts);
    expect(sizes.length).toBeGreaterThan(0);
    assertNoOverlap('corridor_siege', structures, spawns, sizes);
  });

  it('castle_ruins: no structure overlaps spawn zones', () => {
    const { structures, spawns, acts } = getTemplateData('rout', 'castle_ruins');
    const sizes = getSizesForTemplate(acts);
    expect(sizes.length).toBeGreaterThan(0);
    assertNoOverlap('castle_ruins', structures, spawns, sizes);
  });

  it('great_hall: no structure overlaps spawn zones', () => {
    const { structures, spawns, acts } = getTemplateData('seize', 'great_hall');
    const sizes = getSizesForTemplate(acts);
    expect(sizes.length).toBeGreaterThan(0);
    assertNoOverlap('great_hall', structures, spawns, sizes);
  });

  it('act3_dark_champion_keep: no structure overlaps spawn zones', () => {
    const { structures, spawns, acts } = getTemplateData('seize', 'act3_dark_champion_keep');
    const sizes = getSizesForTemplate(acts);
    expect(sizes.length).toBeGreaterThan(0);
    assertNoOverlap('act3_dark_champion_keep', structures, spawns, sizes);
  });
});
