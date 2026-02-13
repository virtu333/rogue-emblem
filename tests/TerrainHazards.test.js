import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { computeEffectivePath, getEntryDirection, resolveIceSlide } from '../src/engine/Grid.js';
import { pickTemplate } from '../src/engine/MapGenerator.js';
import { computeLavaCrackHp, isLavaCrackTerrainIndex } from '../src/engine/TerrainHazards.js';
import { TERRAIN } from '../src/utils/constants.js';

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
];

function loadTerrainData() {
  return JSON.parse(readFileSync('data/terrain.json', 'utf8'));
}

describe('Terrain hazards', () => {
  describe('Ice slide pure helpers', () => {
    it('resolveIceSlide slides right across ice and lands on plain', () => {
      const map = [[1, 1, 1, 0]];
      const result = resolveIceSlide(0, 0, { dc: 1, dr: 0 }, map, TEST_TERRAIN, 4, 1, 'Infantry', new Set());
      expect(result.col).toBe(3);
      expect(result.row).toBe(0);
      expect(result.slidePath).toEqual([{ col: 0, row: 0 }, { col: 1, row: 0 }, { col: 2, row: 0 }, { col: 3, row: 0 }]);
    });

    it('resolveIceSlide stops at map edge and stays on last ice', () => {
      const map = [[1, 1, 1]];
      const result = resolveIceSlide(0, 0, { dc: 1, dr: 0 }, map, TEST_TERRAIN, 3, 1, 'Infantry', new Set());
      expect(result.col).toBe(2);
      expect(result.row).toBe(0);
    });

    it('resolveIceSlide stops before occupied tile', () => {
      const map = [[1, 1, 1, 0]];
      const occupied = new Set(['2,0']);
      const result = resolveIceSlide(0, 0, { dc: 1, dr: 0 }, map, TEST_TERRAIN, 4, 1, 'Infantry', occupied);
      expect(result.col).toBe(1);
      expect(result.row).toBe(0);
    });

    it('resolveIceSlide stops before impassable tile', () => {
      const map = [[1, 1, 2]];
      const result = resolveIceSlide(0, 0, { dc: 1, dr: 0 }, map, TEST_TERRAIN, 3, 1, 'Infantry', new Set());
      expect(result.col).toBe(1);
      expect(result.row).toBe(0);
    });

    it('resolveIceSlide uses moveType passability', () => {
      const map = [[1, 3]];
      const cavalryResult = resolveIceSlide(0, 0, { dc: 1, dr: 0 }, map, TEST_TERRAIN, 2, 1, 'Cavalry', new Set());
      const flyingResult = resolveIceSlide(0, 0, { dc: 1, dr: 0 }, map, TEST_TERRAIN, 2, 1, 'Flying', new Set());
      expect(cavalryResult.col).toBe(0);
      expect(flyingResult.col).toBe(1);
    });

    it('resolveIceSlide supports all cardinal directions', () => {
      const horizontal = [[0, 1, 0]];
      const vertical = [[0], [1], [0]];
      const left = resolveIceSlide(1, 0, { dc: -1, dr: 0 }, horizontal, TEST_TERRAIN, 3, 1, 'Infantry', new Set());
      const right = resolveIceSlide(1, 0, { dc: 1, dr: 0 }, horizontal, TEST_TERRAIN, 3, 1, 'Infantry', new Set());
      const up = resolveIceSlide(0, 1, { dc: 0, dr: -1 }, vertical, TEST_TERRAIN, 1, 3, 'Infantry', new Set());
      const down = resolveIceSlide(0, 1, { dc: 0, dr: 1 }, vertical, TEST_TERRAIN, 1, 3, 'Infantry', new Set());
      expect(left).toMatchObject({ col: 0, row: 0 });
      expect(right).toMatchObject({ col: 2, row: 0 });
      expect(up).toMatchObject({ col: 0, row: 0 });
      expect(down).toMatchObject({ col: 0, row: 2 });
    });

    it('resolveIceSlide on single ice tile lands on adjacent non-ice', () => {
      const map = [[1, 0]];
      const result = resolveIceSlide(0, 0, { dc: 1, dr: 0 }, map, TEST_TERRAIN, 2, 1, 'Infantry', new Set());
      expect(result.col).toBe(1);
      expect(result.row).toBe(0);
    });

    it('getEntryDirection extracts direction from last two path points', () => {
      const dir = getEntryDirection([{ col: 2, row: 3 }, { col: 3, row: 3 }, { col: 3, row: 4 }]);
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

    it('computeEffectivePath stops at nearest prior unoccupied tile when ice entry is occupied', () => {
      const map = [[0, 0, 1, 0]];
      const path = [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
        { col: 3, row: 0 },
      ];
      const occupied = new Set(['1,0', '2,0']);
      const result = computeEffectivePath(path, map, TEST_TERRAIN, 4, 1, 'Infantry', occupied);
      expect(result.slideStartIndex).toBe(-1);
      expect(result.pathEndIndex).toBe(0);
      expect(result.effectivePath).toEqual([{ col: 0, row: 0 }]);
    });

    it('computeEffectivePath leaves flying paths unchanged', () => {
      const map = [[0, 1, 1, 0]];
      const path = [{ col: 0, row: 0 }, { col: 1, row: 0 }, { col: 2, row: 0 }, { col: 3, row: 0 }];
      const result = computeEffectivePath(path, map, TEST_TERRAIN, 4, 1, 'Flying', new Set());
      expect(result.slideStartIndex).toBe(-1);
      expect(result.pathEndIndex).toBe(path.length - 1);
      expect(result.effectivePath).toEqual(path);
    });

    it('computeEffectivePath returns original path when no ice exists', () => {
      const map = [[0, 0, 0]];
      const path = [{ col: 0, row: 0 }, { col: 1, row: 0 }, { col: 2, row: 0 }];
      const result = computeEffectivePath(path, map, TEST_TERRAIN, 3, 1, 'Infantry', new Set());
      expect(result.slideStartIndex).toBe(-1);
      expect(result.pathEndIndex).toBe(path.length - 1);
      expect(result.effectivePath).toEqual(path);
    });
  });

  describe('Lava crack damage helpers', () => {
    it('terrain data has Lava Crack move costs and special text', () => {
      const terrainData = loadTerrainData();
      const lava = terrainData.find(t => t.name === 'Lava Crack');
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
        rout: [
          { id: 'global_template' },
        ],
        seize: [],
      };
      expect(pickTemplate('rout', templates, 'act1').id).toBe('global_template');
      expect(pickTemplate('rout', templates, 'act4').id).toBe('global_template');
    });
  });

  describe('Data integrity', () => {
    it('avoid bonus parses as negative for Ice', () => {
      const terrainData = loadTerrainData();
      const ice = terrainData.find(t => t.name === 'Ice');
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
