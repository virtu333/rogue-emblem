// FogOfWar.test.js — Fog of war vision range, constants, node generation
import { describe, it, expect } from 'vitest';
import { VISION_RANGES, FOG_CHANCE_BY_ACT } from '../src/utils/constants.js';
import { Grid } from '../src/engine/Grid.js';
import { generateNodeMap } from '../src/engine/NodeMapGenerator.js';

// Minimal mock scene for Grid (no Phaser rendering)
function makeMockScene() {
  return {
    cameras: { main: { width: 640, height: 480 } },
    add: {
      rectangle: () => ({
        setDepth: function() { return this; },
        setAlpha: function() { return this; },
        setFillStyle: function() { return this; },
        setOrigin: function() { return this; },
        setSize: function() { return this; },
        setPosition: function() { return this; },
        setVisible: function() { return this; },
        setStrokeStyle: function() { return this; },
        setInteractive: function() { return this; },
        destroy: function() {},
      }),
      image: () => ({
        setDisplaySize: function() { return this; },
        setDepth: function() { return this; },
        destroy: function() {},
      }),
      text: () => ({
        setOrigin: function() { return this; },
        setDepth: function() { return this; },
        destroy: function() {},
      }),
    },
    textures: { exists: () => false },
  };
}

function makeTestGrid(cols, rows, fogEnabled = false) {
  const terrain = [{ name: 'Plain', moveCost: { Infantry: '1' }, avoidBonus: 0, defBonus: 0 }];
  const mapLayout = Array.from({ length: rows }, () => Array(cols).fill(0));
  return new Grid(makeMockScene(), cols, rows, terrain, mapLayout, fogEnabled);
}

describe('Fog of War', () => {
  describe('VISION_RANGES constants', () => {
    it('defines vision for all move types', () => {
      expect(VISION_RANGES.Infantry).toBe(3);
      expect(VISION_RANGES.Armored).toBe(3);
      expect(VISION_RANGES.Cavalry).toBe(4);
      expect(VISION_RANGES.Flying).toBe(5);
    });

    it('FOG_CHANCE_BY_ACT scales fog frequency per act', () => {
      expect(FOG_CHANCE_BY_ACT.act1).toBe(0.10);
      expect(FOG_CHANCE_BY_ACT.act2).toBe(0.25);
      expect(FOG_CHANCE_BY_ACT.act3).toBe(0.35);
      expect(FOG_CHANCE_BY_ACT.act4).toBe(0.45);
      expect(FOG_CHANCE_BY_ACT.finalBoss).toBe(0);
    });
  });

  describe('Grid.getVisionRange', () => {
    it('returns correct tiles within Manhattan distance', () => {
      const grid = makeTestGrid(10, 10);
      const visible = grid.getVisionRange(5, 5, 2);
      // Manhattan distance 2 from (5,5): should have 13 tiles (diamond shape)
      expect(visible.size).toBe(13);
      // Center
      expect(visible.has('5,5')).toBe(true);
      // Distance 1
      expect(visible.has('5,4')).toBe(true);
      expect(visible.has('5,6')).toBe(true);
      expect(visible.has('4,5')).toBe(true);
      expect(visible.has('6,5')).toBe(true);
      // Distance 2
      expect(visible.has('5,3')).toBe(true);
      expect(visible.has('3,5')).toBe(true);
      expect(visible.has('7,5')).toBe(true);
      expect(visible.has('5,7')).toBe(true);
      // Diagonal distance 2
      expect(visible.has('4,4')).toBe(true);
      expect(visible.has('6,6')).toBe(true);
      // Distance 3 should NOT be included
      expect(visible.has('5,2')).toBe(false);
      expect(visible.has('8,5')).toBe(false);
    });

    it('respects grid boundaries', () => {
      const grid = makeTestGrid(5, 5);
      const visible = grid.getVisionRange(0, 0, 3);
      // Should not contain negative coordinates
      for (const key of visible) {
        const [col, row] = key.split(',').map(Number);
        expect(col).toBeGreaterThanOrEqual(0);
        expect(row).toBeGreaterThanOrEqual(0);
        expect(col).toBeLessThan(5);
        expect(row).toBeLessThan(5);
      }
      // Should contain valid tiles within range
      expect(visible.has('0,0')).toBe(true);
      expect(visible.has('1,0')).toBe(true);
      expect(visible.has('0,1')).toBe(true);
      expect(visible.has('3,0')).toBe(true);
      expect(visible.has('0,3')).toBe(true);
      // Out of range
      expect(visible.has('4,0')).toBe(false); // dist 4
    });

    it('range 0 returns only the origin tile', () => {
      const grid = makeTestGrid(10, 10);
      const visible = grid.getVisionRange(3, 3, 0);
      expect(visible.size).toBe(1);
      expect(visible.has('3,3')).toBe(true);
    });
  });

  describe('Grid.isVisible', () => {
    it('returns true for all tiles when fog is disabled', () => {
      const grid = makeTestGrid(5, 5, false);
      expect(grid.isVisible(0, 0)).toBe(true);
      expect(grid.isVisible(4, 4)).toBe(true);
    });

    it('returns false for unseen tiles when fog is enabled', () => {
      const grid = makeTestGrid(10, 10, true);
      // Before updateFogOfWar, visibleSet is empty
      expect(grid.isVisible(5, 5)).toBe(false);
    });

    it('returns true for tiles within player vision after update', () => {
      const grid = makeTestGrid(10, 10, true);
      const playerUnits = [{ col: 5, row: 5, moveType: 'Infantry' }];
      grid.updateFogOfWar(playerUnits);
      // Infantry vision = 3
      expect(grid.isVisible(5, 5)).toBe(true);
      expect(grid.isVisible(5, 3)).toBe(true); // dist 2
      expect(grid.isVisible(5, 2)).toBe(true); // dist 3
      expect(grid.isVisible(5, 1)).toBe(false); // dist 4
    });

    it('unions vision from multiple units', () => {
      const grid = makeTestGrid(10, 10, true);
      const playerUnits = [
        { col: 1, row: 1, moveType: 'Infantry' },
        { col: 8, row: 8, moveType: 'Infantry' },
      ];
      grid.updateFogOfWar(playerUnits);
      // Both unit positions should be visible
      expect(grid.isVisible(1, 1)).toBe(true);
      expect(grid.isVisible(8, 8)).toBe(true);
      // Middle should not be visible (too far from both)
      expect(grid.isVisible(5, 5)).toBe(false);
    });

    it('uses move type specific vision ranges', () => {
      const grid = makeTestGrid(12, 12, true);
      const playerUnits = [{ col: 6, row: 6, moveType: 'Flying' }];
      grid.updateFogOfWar(playerUnits);
      // Flying vision = 5
      expect(grid.isVisible(6, 1)).toBe(true); // dist 5
      expect(grid.isVisible(6, 0)).toBe(false); // dist 6
    });
  });

  describe('NodeMapGenerator fog assignment', () => {
    it('some battle nodes get fogEnabled flag', () => {
      // Generate many maps and check that some nodes have fogEnabled
      let fogCount = 0;
      let battleCount = 0;
      for (let i = 0; i < 50; i++) {
        const nodeMap = generateNodeMap('act1', { name: 'Test', rows: 5 });
        for (const node of nodeMap.nodes) {
          if (node.type === 'battle') {
            battleCount++;
            if (node.fogEnabled) fogCount++;
          }
        }
      }
      // With 10% chance in act1, we should see some fog nodes over 50 maps
      expect(fogCount).toBeGreaterThan(0);
      // But not all
      expect(fogCount).toBeLessThan(battleCount);
    });

    it('boss nodes never have fogEnabled', () => {
      for (let i = 0; i < 20; i++) {
        const nodeMap = generateNodeMap('act1', { name: 'Test', rows: 5 });
        for (const node of nodeMap.nodes) {
          if (node.type === 'boss') {
            expect(node.fogEnabled).toBeFalsy();
          }
        }
      }
    });
  });
});
