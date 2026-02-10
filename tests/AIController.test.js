import { describe, it, expect } from 'vitest';
import { AIController } from '../src/engine/AIController.js';

// Minimal grid mock: returns movement range as a Map of "col,row" -> cost
function createMockGrid(moveTiles = []) {
  return {
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
      let c = fromCol, r = fromRow;
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
    col: 5, row: 5, mov: 3, moveType: 'Infantry', faction: 'enemy',
    isBoss: false, weapon: { range: '1', type: 'Sword' },
    stats: { HP: 20 }, currentHP: 20, className: 'Fighter',
    ...overrides,
  };
}

function makePlayer(overrides = {}) {
  return {
    col: 2, row: 2, mov: 3, moveType: 'Infantry', faction: 'player',
    weapon: { range: '1', type: 'Sword' }, stats: { HP: 20 }, currentHP: 20,
    ...overrides,
  };
}

describe('AIController', () => {
  describe('Boss Throne AI (C1)', () => {
    it('boss stays within 1 tile of throne over simulated turns', () => {
      const thronePos = { col: 8, row: 4 };
      // Movement tiles around throne
      const moveTiles = [
        { col: 7, row: 4 }, { col: 9, row: 4 },
        { col: 8, row: 3 }, { col: 8, row: 5 },
        { col: 7, row: 3 }, { col: 9, row: 5 },
        { col: 6, row: 4 }, { col: 10, row: 4 }, // 2 tiles away
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
        { col: 7, row: 4 }, { col: 9, row: 4 },
        { col: 8, row: 3 }, { col: 8, row: 5 },
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
        { col: 4, row: 5 }, { col: 3, row: 5 },
        { col: 6, row: 5 }, { col: 5, row: 4 }, { col: 5, row: 6 },
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
        { col: 7, row: 4 }, { col: 9, row: 4 },
        { col: 8, row: 3 }, { col: 8, row: 5 },
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
  });

  describe('Guard AI (C2)', () => {
    it('guard does not move when players are far away', () => {
      const moveTiles = [
        { col: 4, row: 5 }, { col: 6, row: 5 },
        { col: 5, row: 4 }, { col: 5, row: 6 },
      ];
      const grid = createMockGrid(moveTiles);
      const ai = new AIController(grid, {}, { objective: 'rout' });

      const guard = makeEnemy({ col: 5, row: 5, aiMode: 'guard' });
      const player = makePlayer({ col: 0, row: 0 }); // distance > 3

      const decision = ai._decideAction(guard, [guard], [player], []);
      expect(decision.path).toBeNull();
      expect(decision.target).toBeNull();
      expect(guard.aiMode).toBe('guard'); // still guarding
    });

    it('guard triggers when player enters 3-tile range', () => {
      const moveTiles = [
        { col: 4, row: 5 }, { col: 6, row: 5 },
        { col: 5, row: 4 }, { col: 5, row: 6 },
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
        { col: 4, row: 5 }, { col: 6, row: 5 },
        { col: 5, row: 4 }, { col: 5, row: 6 },
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
        { col: 4, row: 5 }, { col: 6, row: 5 },
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
        { col: 4, row: 5 }, { col: 6, row: 5 },
        { col: 5, row: 4 }, { col: 5, row: 6 },
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

  describe('Default chase behavior preserved', () => {
    it('normal enemy (no aiMode) chases normally', () => {
      const moveTiles = [
        { col: 4, row: 5 }, { col: 6, row: 5 },
        { col: 5, row: 4 }, { col: 5, row: 6 },
      ];
      const grid = createMockGrid(moveTiles);
      const ai = new AIController(grid, {}, { objective: 'rout' });

      const enemy = makeEnemy({ col: 5, row: 5 }); // no aiMode
      const player = makePlayer({ col: 0, row: 5 });

      const decision = ai._decideAction(enemy, [enemy], [player], []);
      // Should move toward player
      if (decision.path && decision.path.length >= 2) {
        const dest = decision.path[decision.path.length - 1];
        expect(dest.col).toBeLessThan(5);
      }
    });

    it('enemy with aiMode chase behaves like normal enemy', () => {
      const moveTiles = [
        { col: 4, row: 5 }, { col: 6, row: 5 },
        { col: 5, row: 4 }, { col: 5, row: 6 },
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
});
