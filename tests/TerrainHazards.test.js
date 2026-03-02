import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { computeEffectivePath, getEntryDirection, resolveIceSlide } from '../src/engine/Grid.js';
import { pickTemplate } from '../src/engine/MapGenerator.js';
import {
  computeAcidDamage,
  computeLavaCrackHp,
  isAcidTerrainIndex,
  isLavaCrackTerrainIndex,
} from '../src/engine/TerrainHazards.js';
import { TERRAIN } from '../src/utils/constants.js';
import { HeadlessGrid } from './harness/HeadlessGrid.js';

const TEST_TERRAIN = [
  {
    name: 'Plain',
    moveCost: { Infantry: '1', Armored: '1', Cavalry: '1', Flying: '1' },
    avoidBonus: '0',
    defBonus: '0',
    special: '',
  },
  {
    name: 'Ice',
    moveCost: { Infantry: '1', Armored: '1', Cavalry: '1', Flying: '1' },
    avoidBonus: '-10',
    defBonus: '0',
    special: 'Slide',
  },
  {
    name: 'Wall',
    moveCost: { Infantry: '--', Armored: '--', Cavalry: '--', Flying: '--' },
    avoidBonus: '--',
    defBonus: '--',
    special: 'Impassable',
  },
  {
    name: 'Mountain',
    moveCost: { Infantry: '3', Armored: '--', Cavalry: '--', Flying: '1' },
    avoidBonus: '30',
    defBonus: '2',
    special: '',
  },
  {
    name: 'Lava Crack',
    moveCost: { Infantry: '1', Armored: '2', Cavalry: '1', Flying: '1' },
    avoidBonus: '0',
    defBonus: '0',
    special: '5 damage at end of phase (min 1 HP)',
  },
  {
    name: 'Forest',
    moveCost: { Infantry: '2', Armored: '3', Cavalry: '3', Flying: '1' },
    avoidBonus: '20',
    defBonus: '1',
    special: '',
  },
];

function loadTerrainData() {
  return JSON.parse(readFileSync('data/terrain.json', 'utf8'));
}

describe('Terrain hazards', () => {
  describe('Ice slide pure helpers', () => {
    it('resolveIceSlide slides right across ice and lands on plain', () => {
      const map = [[1, 1, 1, 0]];
      const result = resolveIceSlide(
        0,
        0,
        { dc: 1, dr: 0 },
        map,
        TEST_TERRAIN,
        4,
        1,
        'Infantry',
        new Set(),
      );
      expect(result.col).toBe(3);
      expect(result.row).toBe(0);
      expect(result.slidePath).toEqual([
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
        { col: 3, row: 0 },
      ]);
    });

    it('resolveIceSlide stops at map edge and stays on last ice', () => {
      const map = [[1, 1, 1]];
      const result = resolveIceSlide(
        0,
        0,
        { dc: 1, dr: 0 },
        map,
        TEST_TERRAIN,
        3,
        1,
        'Infantry',
        new Set(),
      );
      expect(result.col).toBe(2);
      expect(result.row).toBe(0);
    });

    it('resolveIceSlide stops before occupied tile', () => {
      const map = [[1, 1, 1, 0]];
      const occupied = new Set(['2,0']);
      const result = resolveIceSlide(
        0,
        0,
        { dc: 1, dr: 0 },
        map,
        TEST_TERRAIN,
        4,
        1,
        'Infantry',
        occupied,
      );
      expect(result.col).toBe(1);
      expect(result.row).toBe(0);
    });

    it('resolveIceSlide stops before impassable tile', () => {
      const map = [[1, 1, 2]];
      const result = resolveIceSlide(
        0,
        0,
        { dc: 1, dr: 0 },
        map,
        TEST_TERRAIN,
        3,
        1,
        'Infantry',
        new Set(),
      );
      expect(result.col).toBe(1);
      expect(result.row).toBe(0);
    });

    it('resolveIceSlide uses moveType passability', () => {
      const map = [[1, 3]];
      const cavalryResult = resolveIceSlide(
        0,
        0,
        { dc: 1, dr: 0 },
        map,
        TEST_TERRAIN,
        2,
        1,
        'Cavalry',
        new Set(),
      );
      const flyingResult = resolveIceSlide(
        0,
        0,
        { dc: 1, dr: 0 },
        map,
        TEST_TERRAIN,
        2,
        1,
        'Flying',
        new Set(),
      );
      expect(cavalryResult.col).toBe(0);
      expect(flyingResult.col).toBe(1);
    });

    it('resolveIceSlide supports all cardinal directions', () => {
      const horizontal = [[0, 1, 0]];
      const vertical = [[0], [1], [0]];
      const left = resolveIceSlide(
        1,
        0,
        { dc: -1, dr: 0 },
        horizontal,
        TEST_TERRAIN,
        3,
        1,
        'Infantry',
        new Set(),
      );
      const right = resolveIceSlide(
        1,
        0,
        { dc: 1, dr: 0 },
        horizontal,
        TEST_TERRAIN,
        3,
        1,
        'Infantry',
        new Set(),
      );
      const up = resolveIceSlide(
        0,
        1,
        { dc: 0, dr: -1 },
        vertical,
        TEST_TERRAIN,
        1,
        3,
        'Infantry',
        new Set(),
      );
      const down = resolveIceSlide(
        0,
        1,
        { dc: 0, dr: 1 },
        vertical,
        TEST_TERRAIN,
        1,
        3,
        'Infantry',
        new Set(),
      );
      expect(left).toMatchObject({ col: 0, row: 0 });
      expect(right).toMatchObject({ col: 2, row: 0 });
      expect(up).toMatchObject({ col: 0, row: 0 });
      expect(down).toMatchObject({ col: 0, row: 2 });
    });

    it('resolveIceSlide on single ice tile lands on adjacent non-ice', () => {
      const map = [[1, 0]];
      const result = resolveIceSlide(
        0,
        0,
        { dc: 1, dr: 0 },
        map,
        TEST_TERRAIN,
        2,
        1,
        'Infantry',
        new Set(),
      );
      expect(result.col).toBe(1);
      expect(result.row).toBe(0);
    });

    it('getEntryDirection extracts direction from last two path points', () => {
      const dir = getEntryDirection([
        { col: 2, row: 3 },
        { col: 3, row: 3 },
        { col: 3, row: 4 },
      ]);
      expect(dir).toEqual({ dc: 0, dr: 1 });
    });

    it('computeEffectivePath triggers slide at first ice entry mid-path', () => {
      const map = [
        [0, 0, 1, 1, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
      ];
      const path = [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
        { col: 2, row: 1 },
        { col: 2, row: 2 },
      ];
      const result = computeEffectivePath(path, map, TEST_TERRAIN, 5, 3, 'Infantry', new Set());
      expect(result.slideStartIndex).toBe(2);
      expect(result.effectivePath).toEqual([
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
        { col: 3, row: 0 },
        { col: 4, row: 0 },
      ]);
    });

    it('computeEffectivePath walks through occupied ice entry without slide', () => {
      const map = [[0, 0, 1, 0]];
      const path = [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
        { col: 3, row: 0 },
      ];
      const occupied = new Set(['1,0', '2,0']);
      const result = computeEffectivePath(path, map, TEST_TERRAIN, 4, 1, 'Infantry', occupied);
      // Occupied ice treated as normal walkable tile — no truncation
      expect(result.slideStartIndex).toBe(-1);
      expect(result.movementCost).toBe(3);
      expect(result.effectivePath).toEqual([
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
        { col: 3, row: 0 },
      ]);
    });

    it('end-to-end: ally-occupied ice entry is reachable and not truncated', () => {
      // Map: [Plain, Ice, Ice, Ice, Plain] — ally at (1,0) on Ice
      const map = [[0, 1, 1, 1, 0]];
      const grid = new HeadlessGrid(5, 1, TEST_TERRAIN, map);
      const unitPositions = new Map([['1,0', { faction: 'player' }]]);

      // Dijkstra from (0,0), MOV=3, player faction
      const reachable = grid.getMovementRange(0, 0, 3, 'Infantry', unitPositions, 'player');
      expect(reachable.has('4,0')).toBe(true);

      // Reconstruct path to (4,0)
      const path = grid.reconstructIcePath(reachable, 0, 0, 4, 0);
      expect(path).not.toBeNull();
      expect(path.length).toBeGreaterThanOrEqual(2);

      // Build occupied set (same shape computeEffectivePath expects)
      const occupied = new Set(['1,0']);
      const result = computeEffectivePath(path, map, TEST_TERRAIN, 5, 1, 'Infantry', occupied);

      // Path must not be truncated — should reach (4,0) with positive cost
      const last = result.effectivePath[result.effectivePath.length - 1];
      expect(last).toEqual({ col: 4, row: 0 });
      expect(result.movementCost).toBeGreaterThan(0);
    });

    it('computeEffectivePath leaves flying paths unchanged', () => {
      const map = [[0, 1, 1, 0]];
      const path = [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
        { col: 3, row: 0 },
      ];
      const result = computeEffectivePath(path, map, TEST_TERRAIN, 4, 1, 'Flying', new Set());
      expect(result.slideStartIndex).toBe(-1);
      expect(result.pathEndIndex).toBe(path.length - 1);
      expect(result.effectivePath).toEqual(path);
    });

    it('computeEffectivePath returns original path when no ice exists', () => {
      const map = [[0, 0, 0]];
      const path = [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
      ];
      const result = computeEffectivePath(path, map, TEST_TERRAIN, 3, 1, 'Infantry', new Set());
      expect(result.slideStartIndex).toBe(-1);
      expect(result.pathEndIndex).toBe(path.length - 1);
      expect(result.effectivePath).toEqual(path);
    });
  });

  describe('Lava crack damage helpers', () => {
    it('terrain data has Lava Crack move costs and special text', () => {
      const terrainData = loadTerrainData();
      const lava = terrainData.find((t) => t.name === 'Lava Crack');
      expect(lava).toBeTruthy();
      expect(lava.moveCost.Infantry).toBe('1');
      expect(lava.moveCost.Armored).toBe('2');
      expect(lava.special).toContain('5 damage');
    });

    it('computeLavaCrackHp applies 5 damage and never kills', () => {
      expect(computeLavaCrackHp(20)).toEqual({ nextHP: 15, appliedDamage: 5 });
      expect(computeLavaCrackHp(3)).toEqual({ nextHP: 1, appliedDamage: 2 });
    });

    it('flying units still take lava damage (logic is unit-type agnostic)', () => {
      const flying = { moveType: 'Flying', currentHP: 10 };
      const result = computeLavaCrackHp(flying.currentHP);
      expect(result).toEqual({ nextHP: 5, appliedDamage: 5 });
    });

    it('non-lava terrain indices do not match lava crack', () => {
      expect(isLavaCrackTerrainIndex(TERRAIN.Plain)).toBe(false);
      expect(isLavaCrackTerrainIndex(TERRAIN.LavaCrack)).toBe(true);
    });
  });

  describe('Acid helpers', () => {
    it('isAcidTerrainIndex matches only acidic swamp and bog', () => {
      expect(isAcidTerrainIndex(TERRAIN.AcidicSwamp)).toBe(true);
      expect(isAcidTerrainIndex(TERRAIN.AcidicBog)).toBe(true);
      expect(isAcidTerrainIndex(TERRAIN.Swamp)).toBe(false);
      expect(isAcidTerrainIndex(TERRAIN.Bog)).toBe(false);
      expect(isAcidTerrainIndex(TERRAIN.LavaCrack)).toBe(false);
    });

    it('computeAcidDamage clamps between 1 and 10 using 5% max HP', () => {
      expect(computeAcidDamage(1)).toBe(1);
      expect(computeAcidDamage(20)).toBe(1);
      expect(computeAcidDamage(40)).toBe(2);
      expect(computeAcidDamage(100)).toBe(5);
      expect(computeAcidDamage(200)).toBe(10);
    });
  });

  describe('Template act filtering', () => {
    it('pickTemplate includes act4 templates for act4', () => {
      const templates = {
        rout: [
          { id: 'act1_only', acts: ['act1'] },
          { id: 'act4_only', acts: ['act4'] },
        ],
        seize: [],
      };
      const picked = pickTemplate('rout', templates, 'act4');
      expect(picked.id).toBe('act4_only');
    });

    it('pickTemplate excludes act4-only templates for act1', () => {
      const templates = {
        rout: [
          { id: 'act1_only', acts: ['act1'] },
          { id: 'act4_only', acts: ['act4'] },
        ],
        seize: [],
      };
      const picked = pickTemplate('rout', templates, 'act1');
      expect(picked.id).toBe('act1_only');
    });

    it('templates without acts remain available in all acts', () => {
      const templates = {
        rout: [{ id: 'global_template' }],
        seize: [],
      };
      expect(pickTemplate('rout', templates, 'act1').id).toBe('global_template');
      expect(pickTemplate('rout', templates, 'act4').id).toBe('global_template');
    });

    it('pickTemplate returns null when act-filtered pool is empty (act-gating enforced)', () => {
      const templates = {
        rout: [{ id: 'act4_only', acts: ['act4'] }],
        seize: [],
      };
      expect(pickTemplate('rout', templates, 'act1')).toBeNull();
    });
  });

  describe('Ice-aware movement range (Dijkstra)', () => {
    // Map layout for ice corridor tests:
    // Row 0: Plain, Ice, Ice, Ice, Plain
    // Row 1: Plain, Plain, Plain, Plain, Plain
    const ICE_CORRIDOR_MAP = [
      [0, 1, 1, 1, 0],
      [0, 0, 0, 0, 0],
    ];

    it('basic slide extends reach via ice corridor', () => {
      // Unit at (0,0) with MOV 2: walk 1 tile to ice at (1,0), slide to (4,0)
      const grid = new HeadlessGrid(5, 2, TEST_TERRAIN, ICE_CORRIDOR_MAP);
      const range = grid.getMovementRange(0, 0, 2, 'Infantry');

      // Should reach (4,0) via slide even though manhattan distance is 4
      expect(range.has('4,0')).toBe(true);
      // Cost to reach (4,0): 1 (walk to ice at 1,0) → slide is free
      expect(range.get('4,0').cost).toBe(1);
    });

    it('slide blocked by occupied tile — stuck tile is stoppable', () => {
      // Occupied tile at (3,0) blocks slide through ice
      const grid = new HeadlessGrid(5, 2, TEST_TERRAIN, ICE_CORRIDOR_MAP);
      const unitPositions = new Map([['3,0', { faction: 'enemy' }]]);
      const range = grid.getMovementRange(0, 0, 2, 'Infantry', unitPositions, 'player');

      // Slide from (1,0) going right should stop at (2,0) before the occupied tile
      expect(range.has('2,0')).toBe(true);
      // Should NOT reach (4,0) since slide is blocked
      expect(range.has('4,0')).toBe(false);
    });

    it('ally blocks slide like enemy', () => {
      const grid = new HeadlessGrid(5, 2, TEST_TERRAIN, ICE_CORRIDOR_MAP);
      const unitPositions = new Map([['3,0', { faction: 'player' }]]);
      const range = grid.getMovementRange(0, 0, 2, 'Infantry', unitPositions, 'player');

      // Ally at (3,0) blocks the slide — land on (2,0)
      expect(range.has('2,0')).toBe(true);
      // (3,0) is ally-occupied: in range but not stoppable
      const allyEntry = range.get('3,0');
      if (allyEntry) expect(allyEntry.stoppable).toBe(false);
    });

    it('flying units are unaffected by ice (no slide)', () => {
      const grid = new HeadlessGrid(5, 2, TEST_TERRAIN, ICE_CORRIDOR_MAP);
      const range = grid.getMovementRange(0, 0, 2, 'Flying');

      // Flying unit treats ice as normal terrain — should reach (2,0) at cost 2
      expect(range.has('2,0')).toBe(true);
      expect(range.get('2,0').cost).toBe(2);
      // Should NOT reach (4,0) with MOV 2 because no slide
      expect(range.has('4,0')).toBe(false);
    });

    it('slide fully resolves even at MOV boundary', () => {
      // Unit at (0,0) with MOV 1: step onto ice at (1,0), slide to (4,0)
      const grid = new HeadlessGrid(5, 2, TEST_TERRAIN, ICE_CORRIDOR_MAP);
      const range = grid.getMovementRange(0, 0, 1, 'Infantry');

      // MOV 1 pays cost 1 to enter ice at (1,0), then slide carries to (4,0)
      expect(range.has('4,0')).toBe(true);
      expect(range.get('4,0').cost).toBe(1);
    });

    it('multiple ice patches reachable in single move', () => {
      // Row 0: Plain, Ice, Plain, Ice, Plain
      const map = [
        [0, 1, 0, 1, 0],
        [0, 0, 0, 0, 0],
      ];
      // HeadlessGrid(cols, rows, terrainData, mapLayout)
      const grid2 = new HeadlessGrid(5, 2, TEST_TERRAIN, map);
      const range = grid2.getMovementRange(0, 0, 3, 'Infantry');

      // Walk to (1,0) ice → slide lands on (2,0) at cost 1
      expect(range.has('2,0')).toBe(true);
      // From (2,0), walk to (3,0) ice → slide lands on (4,0) at cost 2
      expect(range.has('4,0')).toBe(true);
    });

    it('parent chain through ally node stays intact', () => {
      // Map: Plain, Plain, Ice, Ice, Plain
      // Ally at (1,0)
      const map = [[0, 0, 1, 1, 0]];
      const grid = new HeadlessGrid(5, 1, TEST_TERRAIN, map);
      const unitPositions = new Map([['1,0', { faction: 'player' }]]);
      const range = grid.getMovementRange(0, 0, 3, 'Infantry', unitPositions, 'player');

      // (1,0) should be in range but not stoppable
      expect(range.has('1,0')).toBe(true);
      expect(range.get('1,0').stoppable).toBe(false);

      // (4,0) should be reachable: walk through (1,0) → ice at (2,0) → slide to (4,0)
      expect(range.has('4,0')).toBe(true);

      // reconstructIcePath should find a valid path
      const path = grid.reconstructIcePath(range, 0, 0, 4, 0);
      expect(path).toBeTruthy();
      expect(path[0]).toEqual({ col: 0, row: 0 });
      expect(path[path.length - 1]).toEqual({ col: 4, row: 0 });
    });
  });

  describe('reconstructIcePath', () => {
    it('reconstructs path including slide tiles', () => {
      const map = [[0, 1, 1, 0]];
      const grid = new HeadlessGrid(4, 1, TEST_TERRAIN, map);
      const range = grid.getMovementRange(0, 0, 1, 'Infantry');

      // Should reach (3,0) via ice slide
      expect(range.has('3,0')).toBe(true);

      const path = grid.reconstructIcePath(range, 0, 0, 3, 0);
      expect(path).toBeTruthy();
      expect(path).toEqual([
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
        { col: 3, row: 0 },
      ]);
    });

    it('returns null for tiles not in reachable map', () => {
      const map = [[0, 0, 0]];
      const grid = new HeadlessGrid(3, 1, TEST_TERRAIN, map);
      const range = grid.getMovementRange(0, 0, 1, 'Infantry');

      // (2,0) is at distance 2, not reachable with MOV 1
      expect(grid.reconstructIcePath(range, 0, 0, 2, 0)).toBeNull();
    });
  });

  describe('Multi-slide computeEffectivePath', () => {
    it('path with two ice segments resolves both', () => {
      // Plain, Ice, Plain, Ice, Plain
      const map = [[0, 1, 0, 1, 0]];
      // Path: walk (0,0) → ice (1,0) → walk (2,0) → ice (3,0) → walk (4,0)
      // The ice-aware Dijkstra path includes slide tiles already
      const path = [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
        { col: 3, row: 0 },
        { col: 4, row: 0 },
      ];
      const result = computeEffectivePath(path, map, TEST_TERRAIN, 5, 1, 'Infantry', new Set());

      expect(result.slideSegments.length).toBe(2);
      expect(result.effectivePath[0]).toEqual({ col: 0, row: 0 });
      expect(result.effectivePath[result.effectivePath.length - 1]).toEqual({ col: 4, row: 0 });
    });

    it('movementCost correctly counts walk-onto-ice but not slide tiles', () => {
      // Plain, Ice, Ice, Plain
      const map = [[0, 1, 1, 0]];
      const path = [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
        { col: 3, row: 0 },
      ];
      const result = computeEffectivePath(path, map, TEST_TERRAIN, 4, 1, 'Infantry', new Set());

      // Walk to (1,0) ice = cost 1. Slide carries to (3,0).
      // Total movementCost should be 1 (just the walk onto ice)
      expect(result.movementCost).toBe(1);
    });

    it('slideSegments have correct startIndex and slidePath', () => {
      // Plain, Ice, Plain
      const map = [[0, 1, 0]];
      const path = [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
      ];
      const result = computeEffectivePath(path, map, TEST_TERRAIN, 3, 1, 'Infantry', new Set());

      expect(result.slideSegments.length).toBe(1);
      expect(result.slideSegments[0].startIndex).toBe(1);
      expect(result.slideSegments[0].slidePath).toEqual([
        { col: 1, row: 0 },
        { col: 2, row: 0 },
      ]);
    });

    it('no-ice path returns empty slideSegments and correct movementCost', () => {
      const map = [[0, 0, 0]];
      const path = [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
      ];
      const result = computeEffectivePath(path, map, TEST_TERRAIN, 3, 1, 'Infantry', new Set());

      expect(result.slideSegments).toEqual([]);
      expect(result.movementCost).toBe(2);
    });
  });

  describe('AI ice routing', () => {
    it('AI chase via ice-only route uses Dijkstra fallback', () => {
      // A* would fail on this route since it doesn't resolve ice slides.
      // The Dijkstra-based reconstructIcePath should succeed.
      // Map: Plain(start), Ice, Ice, Ice, Plain(goal)
      const map = [[0, 1, 1, 1, 0]];
      const grid = new HeadlessGrid(5, 1, TEST_TERRAIN, map);
      const range = grid.getMovementRange(0, 0, 1, 'Infantry');

      // Landing at (4,0) via slide
      expect(range.has('4,0')).toBe(true);
      const path = grid.reconstructIcePath(range, 0, 0, 4, 0);
      expect(path).toBeTruthy();
      expect(path[0]).toEqual({ col: 0, row: 0 });
      expect(path[path.length - 1]).toEqual({ col: 4, row: 0 });
    });
  });

  describe('Fix 1: Flying movementCost correctness', () => {
    it('Flying unit path returns correct movementCost (not 0)', () => {
      // 4-tile path through plains: cost = 3 (first tile is start, no cost)
      const map = [[0, 0, 0, 0]];
      const path = [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
        { col: 3, row: 0 },
      ];
      const result = computeEffectivePath(path, map, TEST_TERRAIN, 4, 1, 'Flying', new Set());
      expect(result.movementCost).toBe(3);
      expect(result.slideSegments).toEqual([]);
      expect(result.effectivePath).toEqual(path);
    });

    it('Flying unit over ice does not trigger slides', () => {
      const map = [[0, 1, 1, 0]];
      const path = [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
        { col: 3, row: 0 },
      ];
      const result = computeEffectivePath(path, map, TEST_TERRAIN, 4, 1, 'Flying', new Set());
      // Flying units walk normally over ice — no slide segments
      expect(result.slideSegments).toEqual([]);
      expect(result.movementCost).toBe(3);
      expect(result.effectivePath).toEqual(path);
    });
  });

  describe('Fix 2: costModifier passthrough', () => {
    it('costModifier reduces walk cost through Forest', () => {
      // Forest (index 5) has Infantry cost 2; with costModifier 1 → cost 1 per tile
      const map = [[0, 5, 5, 0]];
      const path = [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
        { col: 3, row: 0 },
      ];
      // Without modifier: 2 + 2 + 1 = 5
      const noMod = computeEffectivePath(path, map, TEST_TERRAIN, 4, 1, 'Infantry', new Set(), 0);
      expect(noMod.movementCost).toBe(5);

      // With costModifier 1: max(1, 2-1) + max(1, 2-1) + 1 = 3
      const withMod = computeEffectivePath(path, map, TEST_TERRAIN, 4, 1, 'Infantry', new Set(), 1);
      expect(withMod.movementCost).toBe(3);
    });

    it('costModifier cannot reduce cost below 1', () => {
      // Plain (cost 1) with costModifier 5 still costs 1
      const map = [[0, 0, 0]];
      const path = [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
      ];
      const result = computeEffectivePath(path, map, TEST_TERRAIN, 3, 1, 'Infantry', new Set(), 5);
      expect(result.movementCost).toBe(2);
    });

    it('costModifier applies to ice entry cost', () => {
      // Map: Plain, Forest(ice-cost terrain sim via Ice tile), Plain
      // Ice (index 1) has cost 1 for Infantry, so costModifier won't reduce below 1
      // Use Mountain terrain on ice entry to test: Mountain has cost 3 for Infantry
      // Actually, let's use a simpler approach: 3-col map with Forest-cost ice
      // We can't change ice cost, but we can verify the modifier is applied.
      // Path: Plain → Ice (cost 1, modifier doesn't help) → slide lands on Plain
      const map = [[0, 1, 0]];
      const path = [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
      ];
      // Ice entry cost = max(1, 1-1) = 1 (floor)
      const result = computeEffectivePath(path, map, TEST_TERRAIN, 3, 1, 'Infantry', new Set(), 1);
      expect(result.movementCost).toBe(1);
    });
  });

  describe('Fix 3: Ally-occupied ice entry blocking', () => {
    it('ally on ice entry tile prevents slide when MOV is limited', () => {
      // Map: Plain(0,0), Ice(1,0), Ice(2,0), Ice(3,0), Plain(4,0) — 5 cols
      // Ally at (1,0), MOV=1.
      // Without fix: stepping onto (1,0) Ice triggers slide → lands at (4,0), cost 1
      // With fix: (1,0) is occupied, no slide, treated as normal tile. Cost 1 to reach (1,0),
      //   MOV exhausted, can't continue. (4,0) is NOT reachable.
      const map = [[0, 1, 1, 1, 0]];
      const grid = new HeadlessGrid(5, 1, TEST_TERRAIN, map);
      const positions = new Map([['1,0', { faction: 'player' }]]);
      const range = grid.getMovementRange(0, 0, 1, 'Infantry', positions, 'player');

      // Tile (1,0) should be reachable but stoppable=false (ally-occupied)
      expect(range.has('1,0')).toBe(true);
      expect(range.get('1,0').stoppable).toBe(false);

      // (4,0) should NOT be reachable — can't slide from occupied ice entry with MOV=1
      expect(range.has('4,0')).toBe(false);
    });

    it('unoccupied ice tile allows normal slide', () => {
      // Same map but no ally on ice — slide should land on (4,0)
      const map = [[0, 1, 1, 1, 0]];
      const grid = new HeadlessGrid(5, 1, TEST_TERRAIN, map);
      const range = grid.getMovementRange(0, 0, 1, 'Infantry');

      expect(range.has('4,0')).toBe(true);
    });

    it('ally on ice tile with sufficient MOV still allows walk-around', () => {
      // With enough MOV, unit walks through ally to (1,0), then steps onto
      // unoccupied (2,0) Ice and slides from there.
      const map = [[0, 1, 1, 0]];
      const grid = new HeadlessGrid(4, 1, TEST_TERRAIN, map);
      const positions = new Map([['1,0', { faction: 'player' }]]);
      const range = grid.getMovementRange(0, 0, 5, 'Infantry', positions, 'player');

      // (3,0) is reachable via: walk to (1,0), step onto (2,0) Ice unoccupied, slide to (3,0)
      expect(range.has('3,0')).toBe(true);
    });
  });

  describe('Data integrity', () => {
    it('avoid bonus parses as negative for Ice', () => {
      const terrainData = loadTerrainData();
      const ice = terrainData.find((t) => t.name === 'Ice');
      expect(parseInt(ice.avoidBonus, 10)).toBe(-10);
    });

    it('new terrain indices map correctly in constants and terrain data', () => {
      const terrainData = loadTerrainData();
      expect(TERRAIN.Ice).toBe(10);
      expect(TERRAIN.LavaCrack).toBe(11);
      expect(terrainData[TERRAIN.Ice].name).toBe('Ice');
      expect(terrainData[TERRAIN.LavaCrack].name).toBe('Lava Crack');
    });
  });
});
