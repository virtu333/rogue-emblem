import { describe, it, expect, vi } from 'vitest';
import { AIController } from '../src/engine/AIController.js';
import * as GridModule from '../src/engine/Grid.js';
import { TERRAIN } from '../src/utils/constants.js';

// Minimal grid mock: returns movement range as a Map of "col,row" -> cost
function createMockGrid(moveTiles = []) {
  return {
    cols: 20,
    rows: 20,
    getMoveCost: () => 1,
    getAttackRange: (col, row, weapon) => {
      const range = weapon?.range || '1';
      const [minS, maxS] = String(range).split('-');
      const min = Number(minS);
      const max = Number(maxS || minS);
      const tiles = [];
      for (let dr = -max; dr <= max; dr++) {
        for (let dc = -max; dc <= max; dc++) {
          const dist = Math.abs(dr) + Math.abs(dc);
          if (dist < min || dist > max) continue;
          tiles.push({ col: col + dc, row: row + dr });
        }
      }
      return tiles;
    },
    getMovementRange: () => {
      const map = new Map();
      for (const t of moveTiles) {
        map.set(`${t.col},${t.row}`, t.cost || 1);
      }
      return map;
    },
    findPath: (fromCol, fromRow, toCol, toRow) => {
      // Simple straight-line path for testing
      const path = [{ col: fromCol, row: fromRow }];
      let c = fromCol,
        r = fromRow;
      while (c !== toCol || r !== toRow) {
        if (c < toCol) c++;
        else if (c > toCol) c--;
        if (r < toRow) r++;
        else if (r > toRow) r--;
        path.push({ col: c, row: r });
      }
      return path;
    },
  };
}

function makeEnemy(overrides = {}) {
  return {
    col: 5,
    row: 5,
    mov: 3,
    moveType: 'Infantry',
    faction: 'enemy',
    isBoss: false,
    weapon: { range: '1', type: 'Sword' },
    stats: { HP: 20 },
    currentHP: 20,
    className: 'Fighter',
    ...overrides,
  };
}

function makePlayer(overrides = {}) {
  return {
    col: 2,
    row: 2,
    mov: 3,
    moveType: 'Infantry',
    faction: 'player',
    weapon: { range: '1', type: 'Sword' },
    stats: { HP: 20 },
    currentHP: 20,
    ...overrides,
  };
}

describe('AIController', () => {
  describe('Boss Throne AI (C1)', () => {
    it('boss stays within 1 tile of throne over simulated turns', () => {
      const thronePos = { col: 8, row: 4 };
      // Movement tiles around throne
      const moveTiles = [
        { col: 7, row: 4 },
        { col: 9, row: 4 },
        { col: 8, row: 3 },
        { col: 8, row: 5 },
        { col: 7, row: 3 },
        { col: 9, row: 5 },
        { col: 6, row: 4 },
        { col: 10, row: 4 }, // 2 tiles away
      ];
      const grid = createMockGrid(moveTiles);
      const ai = new AIController(grid, {}, { objective: 'seize', thronePos });

      const boss = makeEnemy({ col: 8, row: 4, isBoss: true });
      const player = makePlayer({ col: 0, row: 0 }); // far away

      for (let turn = 0; turn < 10; turn++) {
        const decision = ai._decideAction(boss, [boss], [player], []);
        if (decision.path && decision.path.length >= 2) {
          const dest = decision.path[decision.path.length - 1];
          boss.col = dest.col;
          boss.row = dest.row;
        }
        const dist = Math.abs(boss.col - thronePos.col) + Math.abs(boss.row - thronePos.row);
        expect(dist).toBeLessThanOrEqual(1);
      }
    });

    it('boss attacks when target in range near throne', () => {
      const thronePos = { col: 8, row: 4 };
      const moveTiles = [
        { col: 7, row: 4 },
        { col: 9, row: 4 },
        { col: 8, row: 3 },
        { col: 8, row: 5 },
      ];
      const grid = createMockGrid(moveTiles);
      const ai = new AIController(grid, {}, { objective: 'seize', thronePos });

      const boss = makeEnemy({ col: 8, row: 4, isBoss: true });
      // Player adjacent to throne
      const player = makePlayer({ col: 7, row: 4 });

      const decision = ai._decideAction(boss, [boss], [player], []);
      expect(decision.target).not.toBeNull();
      expect(decision.target.col).toBe(7);
    });

    it('boss chases normally on rout maps', () => {
      const moveTiles = [
        { col: 4, row: 5 },
        { col: 3, row: 5 },
        { col: 6, row: 5 },
        { col: 5, row: 4 },
        { col: 5, row: 6 },
      ];
      const grid = createMockGrid(moveTiles);
      const ai = new AIController(grid, {}, { objective: 'rout' });

      const boss = makeEnemy({ col: 5, row: 5, isBoss: true });
      const player = makePlayer({ col: 0, row: 5 });

      const decision = ai._decideAction(boss, [boss], [player], []);
      // Boss should move toward player (col < 5)
      if (decision.path && decision.path.length >= 2) {
        const dest = decision.path[decision.path.length - 1];
        expect(dest.col).toBeLessThan(5);
      }
    });

    it('boss does not chase when no targets near throne on seize', () => {
      const thronePos = { col: 8, row: 4 };
      const moveTiles = [
        { col: 7, row: 4 },
        { col: 9, row: 4 },
        { col: 8, row: 3 },
        { col: 8, row: 5 },
      ];
      const grid = createMockGrid(moveTiles);
      const ai = new AIController(grid, {}, { objective: 'seize', thronePos });

      const boss = makeEnemy({ col: 8, row: 4, isBoss: true });
      const player = makePlayer({ col: 0, row: 0 }); // very far

      const decision = ai._decideAction(boss, [boss], [player], []);
      // Boss should stay put (no chase on seize)
      expect(decision.path).toBeNull();
      expect(decision.target).toBeNull();
    });

    it('boss can chase off-throne on seize when aggressive mode is enabled', () => {
      const thronePos = { col: 8, row: 4 };
      const moveTiles = [
        { col: 7, row: 4 },
        { col: 6, row: 4 },
        { col: 5, row: 4 },
        { col: 8, row: 3 },
        { col: 8, row: 5 },
      ];
      const grid = createMockGrid(moveTiles);
      const ai = new AIController(grid, {}, { objective: 'seize', thronePos });
      ai.setAggressiveMode(true);

      const boss = makeEnemy({ col: 8, row: 4, isBoss: true });
      const player = makePlayer({ col: 0, row: 4 }); // far and off-throne direction

      const decision = ai._decideAction(boss, [boss], [player], []);
      expect(decision.reason).not.toBe('boss_hold_throne');
      expect(decision.path).not.toBeNull();
      if (decision.path && decision.path.length >= 2) {
        const dest = decision.path[decision.path.length - 1];
        expect(dest.col).toBeLessThan(8);
      }
    });
  });

  describe('Guard AI (C2)', () => {
    it('guard does not move when players are far away', () => {
      const moveTiles = [
        { col: 4, row: 5 },
        { col: 6, row: 5 },
        { col: 5, row: 4 },
        { col: 5, row: 6 },
      ];
      const grid = createMockGrid(moveTiles);
      const ai = new AIController(grid, {}, { objective: 'rout' });

      const guard = makeEnemy({ col: 5, row: 5, aiMode: 'guard' });
      const player = makePlayer({ col: 0, row: 0 }); // distance > 3

      const decision = ai._decideAction(guard, [guard], [player], []);
      expect(decision.path).toBeNull();
      expect(decision.target).toBeNull();
      expect(decision.reason).toBe('guard_hold');
      expect(guard.aiMode).toBe('guard'); // still guarding
    });

    it('guard triggers when player enters 3-tile range', () => {
      const moveTiles = [
        { col: 4, row: 5 },
        { col: 6, row: 5 },
        { col: 5, row: 4 },
        { col: 5, row: 6 },
      ];
      const grid = createMockGrid(moveTiles);
      const ai = new AIController(grid, {}, { objective: 'rout' });

      const guard = makeEnemy({ col: 5, row: 5, aiMode: 'guard' });
      const player = makePlayer({ col: 5, row: 3 }); // distance = 2, within 3

      const decision = ai._decideAction(guard, [guard], [player], []);
      expect(guard.aiMode).toBe('chase'); // permanently switched
    });

    it('guard triggers at exactly 3-tile range', () => {
      const moveTiles = [
        { col: 4, row: 5 },
        { col: 6, row: 5 },
        { col: 5, row: 4 },
        { col: 5, row: 6 },
      ];
      const grid = createMockGrid(moveTiles);
      const ai = new AIController(grid, {}, { objective: 'rout' });

      const guard = makeEnemy({ col: 5, row: 5, aiMode: 'guard' });
      const player = makePlayer({ col: 5, row: 2 }); // distance = 3

      ai._decideAction(guard, [guard], [player], []);
      expect(guard.aiMode).toBe('chase');
    });

    it('guard does NOT trigger at 4-tile range', () => {
      const moveTiles = [
        { col: 4, row: 5 },
        { col: 6, row: 5 },
      ];
      const grid = createMockGrid(moveTiles);
      const ai = new AIController(grid, {}, { objective: 'rout' });

      const guard = makeEnemy({ col: 5, row: 5, aiMode: 'guard' });
      const player = makePlayer({ col: 5, row: 1 }); // distance = 4

      ai._decideAction(guard, [guard], [player], []);
      expect(guard.aiMode).toBe('guard'); // still guarding
    });

    it('guard switches permanently to chase after trigger', () => {
      const moveTiles = [
        { col: 4, row: 5 },
        { col: 6, row: 5 },
        { col: 5, row: 4 },
        { col: 5, row: 6 },
        { col: 3, row: 5 },
      ];
      const grid = createMockGrid(moveTiles);
      const ai = new AIController(grid, {}, { objective: 'rout' });

      const guard = makeEnemy({ col: 5, row: 5, aiMode: 'guard' });
      const player = makePlayer({ col: 5, row: 3 }); // triggers guard

      // First turn: triggers
      ai._decideAction(guard, [guard], [player], []);
      expect(guard.aiMode).toBe('chase');

      // Move player far away — guard should still chase (permanent switch)
      player.col = 0;
      player.row = 0;
      const decision = ai._decideAction(guard, [guard], [player], []);
      expect(guard.aiMode).toBe('chase'); // still chase, not reverted
      // Should attempt to move toward player
      if (decision.path && decision.path.length >= 2) {
        const dest = decision.path[decision.path.length - 1];
        const dist = Math.abs(dest.col - 0) + Math.abs(dest.row - 0);
        expect(dist).toBeLessThan(Math.abs(5 - 0) + Math.abs(5 - 0)); // moved closer
      }
    });

    it('no deadlock: guard can act after triggering', () => {
      // Guard with no adjacent move tiles (surrounded) — still shouldn't crash
      const grid = createMockGrid([]); // no movement options
      const ai = new AIController(grid, {}, { objective: 'rout' });

      const guard = makeEnemy({ col: 5, row: 5, aiMode: 'guard' });
      const player = makePlayer({ col: 5, row: 4 }); // triggers guard

      const decision = ai._decideAction(guard, [guard], [player], []);
      expect(guard.aiMode).toBe('chase');
      // Even with no movement, should return a valid decision (attack if in range or stay)
      expect(decision).toBeDefined();
      // The enemy is at (5,5), player at (5,4) — distance 1, weapon range 1 -> should attack
      expect(decision.target).not.toBeNull();
    });
  });

  describe('Aggressive anti-turtle mode', () => {
    it('aggressive mode makes guard units chase even when players are far', () => {
      const moveTiles = [
        { col: 4, row: 5 },
        { col: 3, row: 5 },
        { col: 6, row: 5 },
      ];
      const grid = createMockGrid(moveTiles);
      grid.mapLayout = Array.from({ length: 12 }, () => Array(12).fill(0));
      const ai = new AIController(grid, {}, { objective: 'rout' });
      ai.setAggressiveMode(true);

      const guard = makeEnemy({ col: 5, row: 5, aiMode: 'guard' });
      const player = makePlayer({ col: 0, row: 0 }); // far away
      const decision = ai._decideAction(guard, [guard], [player], []);

      expect(guard.aiMode).toBe('guard');
      expect(decision.path).not.toBeNull();
    });

    it('aggressive mode prioritizes fort occupants as attack targets', () => {
      const moveTiles = [{ col: 5, row: 5 }];
      const grid = createMockGrid(moveTiles);
      grid.mapLayout = Array.from({ length: 12 }, () => Array(12).fill(0));
      grid.mapLayout[5][4] = 3; // Fort
      const ai = new AIController(grid, {}, { objective: 'rout' });
      ai.setAggressiveMode(true);

      const enemy = makeEnemy({ col: 5, row: 5 });
      const fortTarget = makePlayer({ col: 4, row: 5, currentHP: 18 });
      const plainTarget = makePlayer({ col: 6, row: 5, currentHP: 4 });
      const decision = ai._decideAction(enemy, [enemy], [fortTarget, plainTarget], []);

      expect(decision.target).not.toBeNull();
      expect(decision.target.col).toBe(4);
      expect(decision.target.row).toBe(5);
    });
  });

  describe('Default chase behavior preserved', () => {
    it('chases along path even when all immediate moves increase Manhattan distance', () => {
      const grid = createMockGrid([
        { col: 4, row: 5 },
        { col: 6, row: 5 },
      ]);
      grid.getAttackRange = () => [
        { col: 4, row: 1 },
        { col: 6, row: 1 },
      ];
      grid.findPath = (fromCol, fromRow, toCol, toRow) => {
        if (fromCol === 5 && fromRow === 5 && toCol === 4 && toRow === 5) {
          return [
            { col: 5, row: 5 },
            { col: 4, row: 5 },
          ];
        }
        if (fromCol === 5 && fromRow === 5 && toCol === 6 && toRow === 5) {
          return [
            { col: 5, row: 5 },
            { col: 6, row: 5 },
          ];
        }
        if (fromCol === 5 && fromRow === 5 && toCol === 4 && toRow === 1) {
          return [
            { col: 5, row: 5 },
            { col: 4, row: 5 },
            { col: 4, row: 4 },
            { col: 4, row: 3 },
            { col: 4, row: 2 },
            { col: 4, row: 1 },
          ];
        }
        if (fromCol === 5 && fromRow === 5 && toCol === 6 && toRow === 1) {
          return [
            { col: 5, row: 5 },
            { col: 6, row: 5 },
            { col: 6, row: 4 },
            { col: 6, row: 3 },
            { col: 6, row: 2 },
            { col: 6, row: 1 },
          ];
        }
        return null;
      };
      const ai = new AIController(grid, {}, { objective: 'rout' });

      const enemy = makeEnemy({ col: 5, row: 5, weapon: { range: '1', type: 'Sword' } });
      const player = makePlayer({ col: 5, row: 1 }); // both side-steps increase Manhattan distance

      const decision = ai._decideAction(enemy, [enemy], [player], []);
      expect(decision.path).not.toBeNull();
      expect(decision.reason).toBe('chase_path_aware');
      const dest = decision.path[decision.path.length - 1];
      expect(dest.col).toBe(4);
      expect(dest.row).toBe(5);
    });

    it('normal enemy (no aiMode) chases normally', () => {
      const moveTiles = [
        { col: 4, row: 5 },
        { col: 6, row: 5 },
        { col: 5, row: 4 },
        { col: 5, row: 6 },
      ];
      const grid = createMockGrid(moveTiles);
      const ai = new AIController(grid, {}, { objective: 'rout' });

      const enemy = makeEnemy({ col: 5, row: 5 }); // no aiMode
      const player = makePlayer({ col: 0, row: 5 });

      const decision = ai._decideAction(enemy, [enemy], [player], []);
      // Should move toward player
      if (decision.path && decision.path.length >= 2) {
        expect(decision.reason).toBe('chase_path_aware');
        const dest = decision.path[decision.path.length - 1];
        expect(dest.col).toBeLessThan(5);
      }
    });

    it('enemy with aiMode chase behaves like normal enemy', () => {
      const moveTiles = [
        { col: 4, row: 5 },
        { col: 6, row: 5 },
        { col: 5, row: 4 },
        { col: 5, row: 6 },
      ];
      const grid = createMockGrid(moveTiles);
      const ai = new AIController(grid, {}, { objective: 'rout' });

      const enemy = makeEnemy({ col: 5, row: 5, aiMode: 'chase' });
      const player = makePlayer({ col: 0, row: 5 });

      const decision = ai._decideAction(enemy, [enemy], [player], []);
      if (decision.path && decision.path.length >= 2) {
        const dest = decision.path[decision.path.length - 1];
        expect(dest.col).toBeLessThan(5);
      }
    });

    it('uses recovery fallback after repeated no-reachable-move streaks', () => {
      let unlocked = false;
      const grid = createMockGrid([
        { col: 4, row: 5 },
        { col: 6, row: 5 },
      ]);
      grid.getAttackRange = () => [{ col: 9, row: 9 }]; // Force path-aware miss
      grid.findPath = (fromCol, fromRow, toCol, toRow) => {
        if (!unlocked) return null;
        if (fromCol === 5 && fromRow === 5 && toCol === 4 && toRow === 2) {
          return [
            { col: 5, row: 5 },
            { col: 4, row: 5 },
            { col: 4, row: 4 },
            { col: 4, row: 3 },
            { col: 4, row: 2 },
          ];
        }
        if (fromCol === 5 && fromRow === 5 && toCol === 4 && toRow === 5) {
          return [
            { col: 5, row: 5 },
            { col: 4, row: 5 },
          ];
        }
        return null;
      };
      const ai = new AIController(grid, {}, { objective: 'rout' });
      const enemy = makeEnemy({ col: 5, row: 5, weapon: { range: '1', type: 'Sword' } });
      const player = makePlayer({ col: 5, row: 1 });

      const decision1 = ai._decideAction(enemy, [enemy], [player], []);
      expect(decision1.reason).toBe('no_reachable_move');
      expect(decision1.detail.noMoveStreak).toBe(1);

      const decision2 = ai._decideAction(enemy, [enemy], [player], []);
      expect(decision2.reason).toBe('no_reachable_move');
      expect(decision2.detail.noMoveStreak).toBe(2);

      unlocked = true;
      const decision3 = ai._decideAction(enemy, [enemy], [player], []);
      expect(decision3.reason).toBe('chase_recovery_fallback');
      expect(decision3.path).not.toBeNull();
      const dest = decision3.path[decision3.path.length - 1];
      expect(dest.col).toBe(4);
      expect(dest.row).toBe(5);
      expect(enemy._aiNoMoveStreak).toBe(0);
    });
  });

  describe('Affix AI overrides', () => {
    it('berserker override targets the lowest HP unit', () => {
      const moveTiles = [{ col: 5, row: 5 }];
      const grid = createMockGrid(moveTiles);
      const gameData = {
        affixes: {
          affixes: [{ id: 'berserker', aiOverride: 'target_lowest_hp' }],
        },
      };
      const ai = new AIController(grid, gameData, { objective: 'rout' });
      const enemy = makeEnemy({ col: 5, row: 5, affixes: ['berserker'] });
      const highHp = makePlayer({ col: 4, row: 5, currentHP: 18 });
      const lowHp = makePlayer({ col: 6, row: 5, currentHP: 3 });

      const decision = ai._decideAction(enemy, [enemy], [highHp, lowHp], []);
      expect(decision.target).not.toBeNull();
      expect(decision.target.col).toBe(6);
      expect(decision.target.row).toBe(5);
    });
  });

  describe('Ice slide-aware planning', () => {
    it('does not choose attack_in_range when slide-adjusted destination is out of range', () => {
      const grid = createMockGrid([{ col: 1, row: 0 }]);
      grid.cols = 5;
      grid.rows = 2;
      grid.mapLayout = [
        [0, 1, 1, 1, 0],
        [0, 0, 0, 0, 0],
      ];
      grid.terrainData = [
        {
          name: 'Plain',
          moveCost: { Infantry: '1', Armored: '1', Cavalry: '1', Flying: '1' },
        },
        {
          name: 'Ice',
          moveCost: { Infantry: '1', Armored: '1', Cavalry: '1', Flying: '1' },
        },
      ];

      const ai = new AIController(grid, {}, { objective: 'rout' });
      const enemy = makeEnemy({
        col: 0,
        row: 0,
        mov: 1,
        weapon: { range: '1', type: 'Sword' },
      });
      const player = makePlayer({ col: 1, row: 1 });

      const decision = ai._decideAction(enemy, [enemy], [player], []);
      expect(decision.reason).not.toBe('attack_in_range');
      expect(decision.target).toBeNull();
    });
  });

  describe('H4 — A* ice sliding validation in _findPathWithIceFallback', () => {
    function createIceGrid() {
      const terrainData = [
        { name: 'Plain', moveCost: { Infantry: '1', Armored: '1', Cavalry: '1', Flying: '1' } },
        { name: 'Ice', moveCost: { Infantry: '1', Armored: '1', Cavalry: '1', Flying: '1' } },
      ];
      return {
        cols: 6,
        rows: 3,
        terrainData,
        mapLayout: [
          [0, 1, 1, 0, 0, 0], // row 0: plain, ice, ice, plain, ...
          [0, 0, 0, 0, 0, 0], // row 1: all plain
          [0, 0, 0, 0, 0, 0], // row 2: all plain
        ],
        getMoveCost: (col, row, moveType) => {
          const idx = terrainData[0]; // Everything costs 1
          return 1;
        },
        getAttackRange: (col, row, weapon) => {
          const range = weapon?.range || '1';
          const [minS, maxS] = String(range).split('-');
          const min = Number(minS);
          const max = Number(maxS || minS);
          const tiles = [];
          for (let dr = -max; dr <= max; dr++) {
            for (let dc = -max; dc <= max; dc++) {
              const dist = Math.abs(dr) + Math.abs(dc);
              if (dist < min || dist > max) continue;
              tiles.push({ col: col + dc, row: row + dr });
            }
          }
          return tiles;
        },
        getMovementRange: (col, row, mov) => {
          const map = new Map();
          for (let dr = -mov; dr <= mov; dr++) {
            for (let dc = -mov; dc <= mov; dc++) {
              if (Math.abs(dr) + Math.abs(dc) > mov) continue;
              const c = col + dc;
              const r = row + dr;
              if (c >= 0 && c < 6 && r >= 0 && r < 3) {
                map.set(`${c},${r}`, Math.abs(dr) + Math.abs(dc));
              }
            }
          }
          return map;
        },
        findPath: (fromCol, fromRow, toCol, toRow) => {
          // Simple straight-line path
          const path = [{ col: fromCol, row: fromRow }];
          let c = fromCol,
            r = fromRow;
          while (c !== toCol || r !== toRow) {
            if (c < toCol) c++;
            else if (c > toCol) c--;
            if (r < toRow) r++;
            else if (r > toRow) r--;
            path.push({ col: c, row: r });
          }
          return path;
        },
        reconstructIcePath: (range, fromCol, fromRow, toCol, toRow) => {
          // Simple fallback: return path if destination in range
          const key = `${toCol},${toRow}`;
          if (!range.has(key)) return null;
          return [
            { col: fromCol, row: fromRow },
            { col: toCol, row: toRow },
          ];
        },
      };
    }

    it('no ice on path returns A* path directly', () => {
      const grid = createIceGrid();
      const ai = new AIController(grid, {}, { objective: 'rout' });
      const enemy = makeEnemy({ col: 0, row: 1, mov: 3 });
      // Path from (0,1) to (2,1) is all plain (row 1)
      const path = ai._findPathWithIceFallback(enemy, 2, 1, null);
      expect(path).not.toBeNull();
      expect(path[path.length - 1]).toEqual({ col: 2, row: 1 });
    });

    it('Flying units bypass ice validation entirely', () => {
      const grid = createIceGrid();
      const ai = new AIController(grid, {}, { objective: 'rout' });
      const enemy = makeEnemy({ col: 0, row: 0, mov: 3, moveType: 'Flying' });
      // Path crosses ice at (1,0) and (2,0) but Flying is immune
      const path = ai._findPathWithIceFallback(enemy, 3, 0, null);
      expect(path).not.toBeNull();
      expect(path[path.length - 1]).toEqual({ col: 3, row: 0 });
    });

    it('_pathCrossesIce detects ice tiles in path', () => {
      const grid = createIceGrid();
      const ai = new AIController(grid, {}, { objective: 'rout' });
      const pathWithIce = [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
      ];
      expect(ai._pathCrossesIce(pathWithIce, 'Infantry')).toBe(true);
    });

    it('_pathCrossesIce returns false for all-plain path', () => {
      const grid = createIceGrid();
      const ai = new AIController(grid, {}, { objective: 'rout' });
      const plainPath = [
        { col: 0, row: 1 },
        { col: 1, row: 1 },
        { col: 2, row: 1 },
      ];
      expect(ai._pathCrossesIce(plainPath, 'Infantry')).toBe(false);
    });

    it('_pathCrossesIce returns false for Flying moveType', () => {
      const grid = createIceGrid();
      const ai = new AIController(grid, {}, { objective: 'rout' });
      const pathWithIce = [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
      ];
      expect(ai._pathCrossesIce(pathWithIce, 'Flying')).toBe(false);
    });

    it('A* crosses ice, effective landing diverts → falls back to Dijkstra', () => {
      const grid = createIceGrid();
      const ai = new AIController(grid, {}, { objective: 'rout' });
      const enemy = makeEnemy({ col: 0, row: 0, mov: 5 });

      // Mock computeEffectivePath to simulate ice diverting landing to (5,0) instead of goal (3,0)
      const spy = vi.spyOn(GridModule, 'computeEffectivePath').mockReturnValueOnce({
        effectivePath: [
          { col: 0, row: 0 },
          { col: 1, row: 0 },
          { col: 5, row: 0 },
        ],
        slideSegments: [],
      });

      const path = ai._findPathWithIceFallback(enemy, 3, 0, null);
      expect(spy).toHaveBeenCalled();
      // Should have fallen back to Dijkstra reconstructIcePath — returns 2-step path
      expect(path).not.toBeNull();
      expect(path[path.length - 1]).toEqual({ col: 3, row: 0 });
      expect(path.length).toBe(2); // reconstructIcePath returns [start, goal]

      spy.mockRestore();
    });

    it('A* crosses ice, effective landing matches goal → A* path accepted', () => {
      const grid = createIceGrid();
      const ai = new AIController(grid, {}, { objective: 'rout' });
      const enemy = makeEnemy({ col: 0, row: 0, mov: 5 });

      // Mock computeEffectivePath so effective landing matches the goal at (3,0)
      const spy = vi.spyOn(GridModule, 'computeEffectivePath').mockReturnValueOnce({
        effectivePath: [
          { col: 0, row: 0 },
          { col: 1, row: 0 },
          { col: 2, row: 0 },
          { col: 3, row: 0 },
        ],
        slideSegments: [],
      });

      const path = ai._findPathWithIceFallback(enemy, 3, 0, null);
      expect(spy).toHaveBeenCalled();
      // A* path should be returned directly (not the 2-step Dijkstra stub)
      expect(path).not.toBeNull();
      expect(path[path.length - 1]).toEqual({ col: 3, row: 0 });
      expect(path.length).toBeGreaterThan(2); // A* multi-step path, not 2-step Dijkstra

      spy.mockRestore();
    });
  });

  describe('Post-move retarget fallback', () => {
    it('retargets to an in-range unit when planned target is no longer in range after move', async () => {
      const ai = new AIController(createMockGrid(), {}, { objective: 'rout' });
      const enemy = makeEnemy({ col: 0, row: 0, weapon: { range: '1', type: 'Sword' } });
      const plannedTarget = makePlayer({ name: 'Planned', col: 1, row: 0, currentHP: 20 });
      const fallbackTarget = makePlayer({ name: 'Fallback', col: 3, row: 1, currentHP: 20 });
      const attacks = [];
      let unitDoneCalled = false;

      ai._decideAction = () => ({
        path: [
          { col: 0, row: 0 },
          { col: 1, row: 0 },
        ],
        target: plannedTarget,
        reason: 'attack_in_range',
      });

      await ai._processOneEnemy(enemy, [enemy], [plannedTarget, fallbackTarget], [], {
        onDecision: () => {},
        onMoveUnit: async () => {
          enemy.col = 3;
          enemy.row = 0;
        },
        onAttack: async (_enemy, target) => attacks.push(target.name),
        onUnitDone: () => {
          unitDoneCalled = true;
        },
      });

      expect(attacks).toEqual(['Fallback']);
      expect(unitDoneCalled).toBe(true);
    });

    it('does not attack when planned target is invalid and no fallback target is in range', async () => {
      const ai = new AIController(createMockGrid(), {}, { objective: 'rout' });
      const enemy = makeEnemy({ col: 0, row: 0, weapon: { range: '1', type: 'Sword' } });
      const plannedTarget = makePlayer({ name: 'Planned', col: 1, row: 0, currentHP: 20 });
      const farTarget = makePlayer({ name: 'Far', col: 0, row: 5, currentHP: 20 });
      const attacks = [];
      let unitDoneCalled = false;

      ai._decideAction = () => ({
        path: [
          { col: 0, row: 0 },
          { col: 1, row: 0 },
        ],
        target: plannedTarget,
        reason: 'attack_in_range',
      });

      await ai._processOneEnemy(enemy, [enemy], [plannedTarget, farTarget], [], {
        onDecision: () => {},
        onMoveUnit: async () => {
          enemy.col = 4;
          enemy.row = 0;
        },
        onAttack: async (_enemy, target) => attacks.push(target.name),
        onUnitDone: () => {
          unitDoneCalled = true;
        },
      });

      expect(attacks).toEqual([]);
      expect(unitDoneCalled).toBe(true);
    });
  });

  describe('Occupancy filtering', () => {
    it('dead unit (currentHP 0) does not block enemy movement', () => {
      const moveTiles = [{ col: 4, row: 5 }];
      const grid = createMockGrid(moveTiles);
      const ai = new AIController(grid, {}, { objective: 'rout' });

      const enemy = makeEnemy({ col: 5, row: 5 });
      const deadPlayer = makePlayer({ col: 4, row: 5, currentHP: 0 });
      const livePlayer = makePlayer({ col: 3, row: 5 });

      const decision = ai._decideAction(enemy, [enemy], [deadPlayer, livePlayer], []);
      // Enemy should be able to move to (4,5) since the dead player doesn't block
      expect(decision.path).toBeDefined();
      expect(decision.path.length).toBeGreaterThanOrEqual(2);
      const dest = decision.path[decision.path.length - 1];
      expect(dest.col).toBe(4);
      expect(dest.row).toBe(5);
    });

    it('removing unit (_removing true) does not block enemy movement', () => {
      const moveTiles = [{ col: 4, row: 5 }];
      const grid = createMockGrid(moveTiles);
      const ai = new AIController(grid, {}, { objective: 'rout' });

      const enemy = makeEnemy({ col: 5, row: 5 });
      const removingPlayer = makePlayer({ col: 4, row: 5, _removing: true });
      const livePlayer = makePlayer({ col: 3, row: 5 });

      const decision = ai._decideAction(enemy, [enemy], [removingPlayer, livePlayer], []);
      // Enemy should be able to move to (4,5) since the removing player doesn't block
      expect(decision.path).toBeDefined();
      expect(decision.path.length).toBeGreaterThanOrEqual(2);
      const dest = decision.path[decision.path.length - 1];
      expect(dest.col).toBe(4);
      expect(dest.row).toBe(5);
    });
  });

  describe('Constructor options', () => {
    it('defaults to rout with no thronePos', () => {
      const ai = new AIController(createMockGrid(), {});
      expect(ai.objective).toBe('rout');
      expect(ai.thronePos).toBeNull();
    });

    it('accepts objective and thronePos', () => {
      const tp = { col: 8, row: 4 };
      const ai = new AIController(createMockGrid(), {}, { objective: 'seize', thronePos: tp });
      expect(ai.objective).toBe('seize');
      expect(ai.thronePos).toEqual(tp);
    });
  });

  describe('Entity weapon selection', () => {
    it('picks Tome over Sword vs high-DEF/low-RES target', () => {
      const grid = createMockGrid([]);
      const ai = new AIController(grid, {}, { objective: 'rout' });

      const entity = {
        isEntity: true,
        col: 5,
        row: 5,
        stats: { HP: 120, STR: 24, MAG: 22, DEF: 22, RES: 20 },
        currentHP: 120,
        faction: 'enemy',
        inventory: [
          { name: 'Eldritch Grasp', type: 'Sword', might: 15, range: '1-4' },
          { name: 'Twisting Vortex', type: 'Tome', might: 14, range: '1-4' },
        ],
        weapon: null,
      };
      entity.weapon = entity.inventory[0];

      // Target with high DEF, low RES — magic should deal more damage
      const target = makePlayer({
        col: 6,
        row: 5,
        stats: { HP: 30, STR: 10, MAG: 5, DEF: 30, RES: 5 },
        currentHP: 30,
      });

      const decision = ai._decideEntityAction(entity, [target], []);
      // Should pick Twisting Vortex (Tome): MAG(22)+14-RES(5)=31 vs STR(24)+15-DEF(30)=9
      expect(entity.weapon.name).toBe('Twisting Vortex');
      expect(decision.target).not.toBeNull();
    });

    it('picks Sword over Tome vs high-RES/low-DEF target', () => {
      const grid = createMockGrid([]);
      const ai = new AIController(grid, {}, { objective: 'rout' });

      const entity = {
        isEntity: true,
        col: 5,
        row: 5,
        stats: { HP: 120, STR: 24, MAG: 22, DEF: 22, RES: 20 },
        currentHP: 120,
        faction: 'enemy',
        inventory: [
          { name: 'Eldritch Grasp', type: 'Sword', might: 15, range: '1-4' },
          { name: 'Twisting Vortex', type: 'Tome', might: 14, range: '1-4' },
        ],
        weapon: null,
      };
      entity.weapon = entity.inventory[0];

      // Target with low DEF, high RES — physical should deal more damage
      const target = makePlayer({
        col: 6,
        row: 5,
        stats: { HP: 30, STR: 10, MAG: 5, DEF: 5, RES: 30 },
        currentHP: 30,
      });

      const decision = ai._decideEntityAction(entity, [target], []);
      // Should pick Eldritch Grasp (Sword): STR(24)+15-DEF(5)=34 vs MAG(22)+14-RES(30)=6
      expect(entity.weapon.name).toBe('Eldritch Grasp');
      expect(decision.target).not.toBeNull();
    });
  });

  describe('Status staff targeting', () => {
    it('enemy with status staff targets player in range', () => {
      const player = makePlayer({ col: 7, row: 5, isLord: true });
      const moveTiles = [
        { col: 5, row: 5 },
        { col: 6, row: 5 },
        { col: 4, row: 5 },
        { col: 5, row: 4 },
        { col: 5, row: 6 },
      ];
      const enemy = makeEnemy({
        col: 5,
        row: 5,
        className: 'Mage',
        statusStaff: {
          name: 'Sleep Staff',
          type: 'Staff',
          statusEffect: 'sleep',
          range: '3-5',
          uses: 1,
          hit: 40,
          _usesSpent: 0,
        },
      });
      const grid = createMockGrid(moveTiles);
      const occupancy = {};
      const ai = new AIController(grid, occupancy);

      const decision = ai._decideAction(enemy, [], [player]);
      // Staff range 3-5: tiles (4,5), (5,4), (5,6) are all dist 3 from player at (7,5).
      expect(decision).toBeDefined();
      expect(decision.statusStaffTarget).toBeDefined();
      expect(decision.reason).toBe('status_staff');
    });

    it('skips already-afflicted targets', () => {
      const { applyCondition } = require('../src/engine/StatusConditionSystem.js');
      const player = makePlayer({ col: 7, row: 5 });
      applyCondition(player, 'sleep', 3);

      const moveTiles = [
        { col: 5, row: 5 },
        { col: 6, row: 5 },
      ];
      const enemy = makeEnemy({
        col: 5,
        row: 5,
        className: 'Mage',
        statusStaff: {
          name: 'Sleep Staff',
          type: 'Staff',
          statusEffect: 'sleep',
          range: '3-5',
          uses: 1,
          hit: 40,
          _usesSpent: 0,
        },
      });
      const grid = createMockGrid(moveTiles);
      const ai = new AIController(grid, {});

      const decision = ai._decideAction(enemy, [], [player]);
      // Already sleeping — should not pick status staff
      expect(decision.statusStaffTarget).toBeUndefined();
    });

    it('skips status-immune targets (Warding Charm)', () => {
      const player = makePlayer({
        col: 7,
        row: 5,
        accessory: { name: 'Warding Charm', combatEffects: { statusImmunity: true } },
      });

      const moveTiles = [
        { col: 5, row: 5 },
        { col: 6, row: 5 },
      ];
      const enemy = makeEnemy({
        col: 5,
        row: 5,
        className: 'Mage',
        statusStaff: {
          name: 'Sleep Staff',
          type: 'Staff',
          statusEffect: 'sleep',
          range: '3-5',
          uses: 1,
          hit: 40,
          _usesSpent: 0,
        },
      });
      const grid = createMockGrid(moveTiles);
      const ai = new AIController(grid, {});

      const decision = ai._decideAction(enemy, [], [player]);
      // Immune — don't waste a limited staff use
      expect(decision.statusStaffTarget).toBeUndefined();
    });

    it('falls through to normal attack when staff uses exhausted', () => {
      const player = makePlayer({ col: 6, row: 5 });
      const moveTiles = [
        { col: 5, row: 5 },
        { col: 6, row: 5 },
      ];
      const enemy = makeEnemy({
        col: 5,
        row: 5,
        className: 'Mage',
        statusStaff: {
          name: 'Sleep Staff',
          type: 'Staff',
          statusEffect: 'sleep',
          range: '3-5',
          uses: 1,
          hit: 40,
          _usesSpent: 1, // exhausted
        },
      });
      const grid = createMockGrid(moveTiles);
      const ai = new AIController(grid, {});

      const decision = ai._decideAction(enemy, [enemy], [player], []);
      // Should not pick status staff since uses exhausted; should fall back to normal attack
      expect(decision.statusStaffTarget).toBeUndefined();
      expect(decision.target).toBeDefined();
      expect(decision.reason).toBe('attack_in_range');
    });

    it('does not cast a status staff while silenced', () => {
      const { applyCondition } = require('../src/engine/StatusConditionSystem.js');
      const player = makePlayer({ col: 7, row: 5, isLord: true });
      const moveTiles = [
        { col: 5, row: 5 },
        { col: 6, row: 5 },
        { col: 4, row: 5 },
      ];
      const enemy = makeEnemy({
        col: 5,
        row: 5,
        className: 'Mage',
        statusStaff: {
          name: 'Sleep Staff',
          type: 'Staff',
          statusEffect: 'sleep',
          range: '3-5',
          uses: 1,
          hit: 40,
          _usesSpent: 0,
        },
      });
      applyCondition(enemy, 'silence', 3);
      const grid = createMockGrid(moveTiles);
      const ai = new AIController(grid, {});

      const decision = ai._decideAction(enemy, [], [player]);
      // Silence blocks staves — same rule the player is held to
      expect(decision.statusStaffTarget).toBeUndefined();
      expect(decision.reason).not.toBe('status_staff');
      // ...but does NOT block the physical attack fall-through (no freeze):
      // from (6,5) the sword reaches the player at (7,5).
      expect(decision.reason).toBe('attack_in_range');
      expect(decision.target).toBeDefined();
    });

    it('casts again once silence expires', () => {
      const player = makePlayer({ col: 7, row: 5, isLord: true });
      const moveTiles = [
        { col: 5, row: 5 },
        { col: 6, row: 5 },
        { col: 4, row: 5 },
      ];
      const enemy = makeEnemy({
        col: 5,
        row: 5,
        className: 'Mage',
        statusStaff: {
          name: 'Sleep Staff',
          type: 'Staff',
          statusEffect: 'sleep',
          range: '3-5',
          uses: 1,
          hit: 40,
          _usesSpent: 0,
        },
        _conditions: [], // silence already recovered
      });
      const grid = createMockGrid(moveTiles);
      const ai = new AIController(grid, {});

      const decision = ai._decideAction(enemy, [], [player]);
      expect(decision.reason).toBe('status_staff');
      expect(decision.statusStaffTarget).toBeDefined();
    });
  });

  describe('weapon-swap optimization', () => {
    it('swaps to higher-damage weapon when attacking', () => {
      const moveTiles = [
        { col: 5, row: 4 },
        { col: 5, row: 5 },
        { col: 4, row: 5 },
        { col: 6, row: 5 },
        { col: 5, row: 6 },
      ];
      const axe = { name: 'Iron Axe', type: 'Axe', range: '1', might: 8 };
      const sword = { name: 'Iron Sword', type: 'Sword', range: '1', might: 5 };
      const enemy = makeEnemy({
        col: 5,
        row: 5,
        weapon: sword,
        inventory: [sword, axe],
        stats: { HP: 20, STR: 10, MAG: 0, SKL: 5, SPD: 5, DEF: 5, RES: 5, LCK: 3 },
      });
      const player = makePlayer({
        col: 5,
        row: 4,
        stats: { HP: 20, STR: 10, MAG: 0, SKL: 5, SPD: 5, DEF: 5, RES: 5, LCK: 3 },
      });
      const grid = createMockGrid(moveTiles);
      const ai = new AIController(grid, {});
      const decision = ai._decideAction(enemy, [enemy], [player], []);
      expect(decision.reason).toBe('attack_in_range');
      // Should swap to axe (might 8 > sword might 5)
      expect(enemy.weapon.name).toBe('Iron Axe');
    });

    it('does not swap for single-weapon enemies', () => {
      const moveTiles = [
        { col: 5, row: 4 },
        { col: 5, row: 5 },
      ];
      const sword = { name: 'Iron Sword', type: 'Sword', range: '1', might: 5 };
      const enemy = makeEnemy({
        col: 5,
        row: 5,
        weapon: sword,
        inventory: [sword],
        stats: { HP: 20, STR: 10, MAG: 0, SKL: 5, SPD: 5, DEF: 5, RES: 5, LCK: 3 },
      });
      const player = makePlayer({
        col: 5,
        row: 4,
        stats: { HP: 20, STR: 10, MAG: 0, SKL: 5, SPD: 5, DEF: 5, RES: 5, LCK: 3 },
      });
      const grid = createMockGrid(moveTiles);
      const ai = new AIController(grid, {});
      const decision = ai._decideAction(enemy, [enemy], [player], []);
      expect(decision.reason).toBe('attack_in_range');
      expect(enemy.weapon.name).toBe('Iron Sword');
    });

    it('does not swap to out-of-range weapon', () => {
      const moveTiles = [
        { col: 5, row: 4 },
        { col: 5, row: 5 },
        { col: 5, row: 3 },
      ];
      const sword = { name: 'Iron Sword', type: 'Sword', range: '1', might: 5 };
      const bow = { name: 'Iron Bow', type: 'Bow', range: '2', might: 6 };
      const enemy = makeEnemy({
        col: 5,
        row: 5,
        weapon: sword,
        inventory: [sword, bow],
        stats: { HP: 20, STR: 10, MAG: 0, SKL: 5, SPD: 5, DEF: 5, RES: 5, LCK: 3 },
      });
      // Player at distance 1 — bow (range 2) can't reach
      const player = makePlayer({
        col: 5,
        row: 4,
        stats: { HP: 20, STR: 10, MAG: 0, SKL: 5, SPD: 5, DEF: 5, RES: 5, LCK: 3 },
      });
      const grid = createMockGrid(moveTiles);
      const ai = new AIController(grid, {});
      const decision = ai._decideAction(enemy, [enemy], [player], []);
      expect(decision.reason).toBe('attack_in_range');
      // Should keep sword since bow can't reach at distance 1
      expect(enemy.weapon.name).toBe('Iron Sword');
    });

    it('swaps to weapon-triangle advantaged weapon with equal might', () => {
      const moveTiles = [
        { col: 5, row: 4 },
        { col: 5, row: 5 },
      ];
      // Enemy has Sword(5) + Lance(5), target has Sword equipped
      // Lance beats Sword → should swap to Lance despite equal might
      const sword = { name: 'Iron Sword', type: 'Sword', range: '1', might: 5 };
      const lance = { name: 'Iron Lance', type: 'Lance', range: '1', might: 5 };
      const enemy = makeEnemy({
        col: 5,
        row: 5,
        weapon: sword,
        inventory: [sword, lance],
        stats: { HP: 20, STR: 10, MAG: 0, SKL: 5, SPD: 5, DEF: 5, RES: 5, LCK: 3 },
      });
      const player = makePlayer({
        col: 5,
        row: 4,
        weapon: { name: 'Iron Sword', type: 'Sword', range: '1', might: 5 },
        stats: { HP: 20, STR: 10, MAG: 0, SKL: 5, SPD: 5, DEF: 5, RES: 5, LCK: 3 },
      });
      const grid = createMockGrid(moveTiles);
      const ai = new AIController(grid, {});
      ai._decideAction(enemy, [enemy], [player], []);
      expect(enemy.weapon.name).toBe('Iron Lance');
    });

    it('raw might can beat triangle disadvantage when gap is large enough', () => {
      const moveTiles = [
        { col: 5, row: 4 },
        { col: 5, row: 5 },
      ];
      // Enemy has Lance(5) + Axe(8), target has Sword equipped.
      // Lance has triangle advantage (+1), Axe has disadvantage (-1).
      // Effective scores: Lance=6, Axe=7, so Axe should still be selected.
      const lance = { name: 'Iron Lance', type: 'Lance', range: '1', might: 5 };
      const axe = { name: 'Iron Axe', type: 'Axe', range: '1', might: 8 };
      const enemy = makeEnemy({
        col: 5,
        row: 5,
        weapon: lance,
        inventory: [lance, axe],
        stats: { HP: 20, STR: 10, MAG: 0, SKL: 5, SPD: 5, DEF: 5, RES: 5, LCK: 3 },
      });
      const player = makePlayer({
        col: 5,
        row: 4,
        weapon: { name: 'Iron Sword', type: 'Sword', range: '1', might: 5 },
        stats: { HP: 20, STR: 10, MAG: 0, SKL: 5, SPD: 5, DEF: 5, RES: 5, LCK: 3 },
      });
      const grid = createMockGrid(moveTiles);
      const ai = new AIController(grid, {});
      ai._decideAction(enemy, [enemy], [player], []);
      // Axe wins despite triangle disadvantage due higher raw might.
      expect(enemy.weapon.name).toBe('Iron Axe');
    });
    it('skips weapon-swap for entity enemies', () => {
      const moveTiles = [
        { col: 5, row: 4 },
        { col: 5, row: 5 },
      ];
      const sword = { name: 'Iron Sword', type: 'Sword', range: '1', might: 5 };
      const axe = { name: 'Iron Axe', type: 'Axe', range: '1', might: 8 };
      const enemy = makeEnemy({
        col: 5,
        row: 5,
        weapon: sword,
        inventory: [sword, axe],
        isEntity: true, // entity marker
        stats: { HP: 20, STR: 10, MAG: 0, SKL: 5, SPD: 5, DEF: 5, RES: 5, LCK: 3 },
      });
      const player = makePlayer({
        col: 5,
        row: 4,
        stats: { HP: 20, STR: 10, MAG: 0, SKL: 5, SPD: 5, DEF: 5, RES: 5, LCK: 3 },
      });
      const grid = createMockGrid(moveTiles);
      const ai = new AIController(grid, {});
      const decision = ai._decideAction(enemy, [enemy], [player], []);
      expect(decision.reason).toBe('attack_in_range');
      // Entity should not get weapon-swapped
      expect(enemy.weapon.name).toBe('Iron Sword');
    });
  });

  describe('Breath weapon scoring (isMagical)', () => {
    it('entity path uses MAG for Breath weapons', () => {
      // Stats chosen so Sword wins under old broken STR logic, Breath wins under correct MAG logic
      // Old (broken): Breath = STR(5)+3−DEF(4) = 4; Sword = STR(5)+7−DEF(4) = 8 → Sword wins
      // New (correct): Breath = MAG(14)+3−RES(4) = 13; Sword = STR(5)+7−DEF(4) = 8 → Breath wins
      const breath = { name: 'Fire Breath', range: '1', type: 'Breath', might: 3 };
      const sword = { name: 'Iron Sword', range: '1', type: 'Sword', might: 7 };
      const entity = makeEnemy({
        col: 5,
        row: 5,
        isEntity: true,
        weapon: sword,
        inventory: [sword, breath],
        stats: { HP: 40, STR: 5, MAG: 14, SKL: 5, SPD: 5, DEF: 8, RES: 3, LCK: 3 },
      });
      const player = makePlayer({
        col: 5,
        row: 4,
        stats: { HP: 20, STR: 8, MAG: 5, SKL: 5, SPD: 5, DEF: 4, RES: 4, LCK: 3 },
      });
      const grid = createMockGrid([]);
      const ai = new AIController(grid, {});

      // _decideEntityAction picks best weapon using isMagical scoring
      const decision = ai._decideEntityAction(entity, [player], []);
      expect(decision.target).toBe(player);
      // Breath: MAG(14) + might(3) - RES(4) = 13
      // Sword:  STR(5)  + might(7) - DEF(4) = 8
      // Entity should swap to Breath
      expect(entity.weapon).toBe(breath);
    });

    it('general weapon-swap path uses MAG for Breath weapons', () => {
      // Stats chosen so Sword wins under old broken STR logic, Breath wins under correct MAG logic
      // Old (broken): Breath = STR(5)+3−DEF(4) = 4; Sword = STR(5)+7−DEF(4) = 8 → Sword wins
      // New (correct): Breath = MAG(14)+3−RES(4) = 13; Sword = STR(5)+7−DEF(4) = 8 → Breath wins
      const breath = { name: 'Fire Breath', range: '1', type: 'Breath', might: 3 };
      const sword = { name: 'Iron Sword', range: '1', type: 'Sword', might: 7 };
      const enemy = makeEnemy({
        col: 5,
        row: 5,
        isEntity: false,
        weapon: sword,
        inventory: [sword, breath],
        stats: { HP: 30, STR: 5, MAG: 14, SKL: 5, SPD: 5, DEF: 5, RES: 3, LCK: 3 },
      });
      const player = makePlayer({
        col: 5,
        row: 4,
        stats: { HP: 20, STR: 8, MAG: 5, SKL: 5, SPD: 5, DEF: 4, RES: 4, LCK: 3 },
      });
      // Player is adjacent (distance 1) — enemy is already in attack range
      const moveTiles = [{ col: 5, row: 5, cost: 0 }];
      const grid = createMockGrid(moveTiles);
      const ai = new AIController(grid, {});
      const decision = ai._decideAction(enemy, [enemy], [player], []);
      expect(decision.target).toBe(player);
      // Breath: MAG(14) + might(3) - RES(4) = 13
      // Sword:  STR(5)  + might(7) - DEF(4) = 8
      // Should swap to Breath
      expect(enemy.weapon).toBe(breath);
    });
  });

  describe('acidic terrain avoidance', () => {
    it('filters candidate moves using predicted finalTile toxicity', () => {
      const moveTiles = [
        { col: 6, row: 5 },
        { col: 4, row: 5 },
      ];
      const grid = createMockGrid(moveTiles);
      grid.mapLayout = Array.from({ length: 12 }, () => Array(12).fill(TERRAIN.Plain));
      grid.mapLayout[5][5] = TERRAIN.AcidicBog; // current tile is toxic, should be filtered out
      grid.mapLayout[9][9] = TERRAIN.AcidicBog; // projected final tile for east move is toxic
      const ai = new AIController(grid, {}, { objective: 'rout' });

      ai._predictFinalTileFromPath = (_enemy, tile) => {
        if (tile.col === 6 && tile.row === 5) return { finalTile: { col: 9, row: 9 } };
        if (tile.col === 4 && tile.row === 5) return { finalTile: { col: 8, row: 8 } };
        return { finalTile: { col: tile.col, row: tile.row } };
      };

      const enemy = makeEnemy({ col: 5, row: 5 });
      const player = makePlayer({ col: 10, row: 5 });
      const decision = ai._decideAction(enemy, [enemy], [player], []);

      expect(decision.path).not.toBeNull();
      const dest = decision.path[decision.path.length - 1];
      expect(dest.col).toBe(4);
      expect(dest.row).toBe(5);
    });
  });
});
