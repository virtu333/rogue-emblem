import { describe, it, expect, vi } from 'vitest';
import { AIController } from '../src/engine/AIController.js';

describe('AI Wall-Breaking', () => {
  const mockTerrain = [
    { name: 'Plain', moveCost: { Infantry: '1' }, avoidBonus: 0, defBonus: 0 },
    { name: 'Wall', moveCost: { Infantry: '--' }, avoidBonus: 0, defBonus: 0 },
  ];

  function createMockGrid(moveTiles = [], wallTiles = []) {
    return {
      cols: 10, rows: 10,
      getTerrainAt: (c, r) => {
        const isWall = wallTiles.some(w => w.col === c && w.row === r);
        return isWall ? mockTerrain[1] : mockTerrain[0];
      },
      isTemporaryTerrainAt: (c, r) => wallTiles.some(w => w.col === c && w.row === r),
      getMoveCost: () => 1,
      getAttackRange: (col, row, weapon) => [{ col, row }], 
      getMovementRange: () => {
        const map = new Map();
        for (const t of moveTiles) {
          map.set(`${t.col},${t.row}`, { cost: t.cost || 1 });
        }
        return map;
      },
      findPath: (fc, fr, tc, tr) => {
        // Destination is a wall? No path.
        if (wallTiles.some(w => w.col === tc && w.row === tr)) return null;
        
        // Simple linear block check for these tests:
        // if a wall is between (fc, fr) and (tc, tr) on the same axis, return null.
        const blocked = wallTiles.some(w => {
          if (fr === tr && w.row === fr) {
            return w.col > Math.min(fc, tc) && w.col < Math.max(fc, tc);
          }
          if (fc === tc && w.col === fc) {
            return w.row > Math.min(fr, tr) && w.row < Math.max(fr, tr);
          }
          return false;
        });

        if (blocked) return null;
        
        // Return a 3-node path to ensure pathAwareTile (intermediate node) logic is exercised
        const midCol = Math.floor((fc + tc) / 2);
        const midRow = Math.floor((fr + tr) / 2);
        
        // If start === end, mid is same as start/end. 
        // We need 3 nodes for pathAware to pick path[i] where i >= 1.
        // Let's just return a forced mid node if dist > 0.
        if (fc === tc && fr === tr) return [{ col: fc, row: fr }];
        
        return [{ col: fc, row: fr }, { col: midCol, row: midRow }, { col: tc, row: tr }];
      }
    };
  }

  it('enemy moves to and breaks adjacent wall when blocked', () => {
    const enemy = { col: 1, row: 1, mov: 3, moveType: 'Infantry', faction: 'enemy', weapon: { range: '1' } };
    const player = { col: 3, row: 1, stats: { HP: 20 }, currentHP: 20, col: 3, row: 1 };
    const wall = { col: 2, row: 1 };
    
    // Only current tile is reachable because of wall
    const grid = createMockGrid([{ col: 1, row: 1 }], [wall]);
    const ai = new AIController(grid, {});
    
    const decision = ai._decideAction(enemy, [enemy], [player], []);
    
    expect(decision.reason).toBe('break_wall');
    expect(decision.breakTile).toEqual({ col: 2, row: 1 });
  });

  it('enemy moves adjacent to wall if not already adjacent', () => {
    const enemy = { col: 0, row: 1, mov: 3, moveType: 'Infantry', faction: 'enemy', weapon: { range: '1' } };
    const player = { col: 3, row: 1, stats: { HP: 20 }, currentHP: 20, col: 3, row: 1 };
    const wall = { col: 2, row: 1 };
    
    // Can reach (1,1) but not (3,1)
    const grid = createMockGrid([
      { col: 0, row: 1 }, { col: 1, row: 1 }
    ], [wall]);
    const ai = new AIController(grid, {});
    
    const decision = ai._decideAction(enemy, [enemy], [player], []);
    
    expect(decision.reason).toBe('move_to_break');
    expect(decision.detail.destination).toEqual({ col: 1, row: 1 });
    expect(decision.detail.wallPos).toEqual({ col: 2, row: 1 });
  });

  it('enemy ignores walls if a valid pathAwareTile exists', () => {
    const enemy = { col: 0, row: 0, mov: 3, moveType: 'Infantry', faction: 'enemy', weapon: { range: '1' } };
    const player = { col: 4, row: 0, stats: { HP: 20 }, currentHP: 20, col: 4, row: 0 };
    // A wall is nearby but NOT blocking the path to the player
    const wall = { col: 0, row: 1 };
    
    const grid = createMockGrid([
      { col: 0, row: 0 }, { col: 1, row: 0 }, { col: 2, row: 0 }
    ], [wall]);
    const ai = new AIController(grid, {});
    
    const decision = ai._decideAction(enemy, [enemy], [player], []);
    
    // Should choose pathAware pursuit, not move_to_break
    expect(decision.reason).toBe('chase_path_aware');
    expect(decision.detail.destination).toEqual({ col: 2, row: 0 }); // Mid-point of (0,0) and (4,0)
  });

  it('enemy only breaks temporary terrain named Wall', () => {
    const enemy = { col: 1, row: 1, mov: 3, moveType: 'Infantry', faction: 'enemy', weapon: { range: '1' } };
    const player = { col: 3, row: 1, stats: { HP: 20 }, currentHP: 20, col: 3, row: 1 };
    // A temporary terrain that is NOT a Wall
    const nonWall = { col: 2, row: 1 };
    
    const grid = {
      cols: 10, rows: 10,
      getTerrainAt: () => ({ name: 'Smoke' }), // NOT a Wall
      isTemporaryTerrainAt: () => true,
      getMovementRange: () => new Map([['1,1', { cost: 1 }]]),
      findPath: () => null // Blocked
    };
    const ai = new AIController(grid, {});
    
    const decision = ai._decideAction(enemy, [enemy], [player], []);
    
    // Should NOT break Smoke, should instead fall back to greedy/no move
    expect(decision.reason).not.toBe('break_wall');
    expect(decision.reason).not.toBe('move_to_break');
  });
});
