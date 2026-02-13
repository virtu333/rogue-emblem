import { describe, it, expect } from 'vitest';
import { AIController } from '../src/engine/AIController.js';

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
      expect(decision.reason).toBe('guard_hold');
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

  describe('Aggressive anti-turtle mode', () => {
    it('aggressive mode makes guard units chase even when players are far', () => {
      const moveTiles = [
        { col: 4, row: 5 }, { col: 3, row: 5 }, { col: 6, row: 5 },
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
        expect(decision.reason).toBe('chase_path_aware');
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

  describe('Post-move retarget fallback', () => {
    it('retargets to an in-range unit when planned target is no longer in range after move', async () => {
      const ai = new AIController(createMockGrid(), {}, { objective: 'rout' });
      const enemy = makeEnemy({ col: 0, row: 0, weapon: { range: '1', type: 'Sword' } });
      const plannedTarget = makePlayer({ name: 'Planned', col: 1, row: 0, currentHP: 20 });
      const fallbackTarget = makePlayer({ name: 'Fallback', col: 3, row: 1, currentHP: 20 });
      const attacks = [];
      let unitDoneCalled = false;

      ai._decideAction = () => ({
        path: [{ col: 0, row: 0 }, { col: 1, row: 0 }],
        target: plannedTarget,
        reason: 'attack_in_range',
      });

      await ai._processOneEnemy(
        enemy,
        [enemy],
        [plannedTarget, fallbackTarget],
        [],
        {
          onDecision: () => {},
          onMoveUnit: async () => {
            enemy.col = 3;
            enemy.row = 0;
          },
          onAttack: async (_enemy, target) => attacks.push(target.name),
          onUnitDone: () => {
            unitDoneCalled = true;
          },
        }
      );

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
        path: [{ col: 0, row: 0 }, { col: 1, row: 0 }],
        target: plannedTarget,
        reason: 'attack_in_range',
      });

      await ai._processOneEnemy(
        enemy,
        [enemy],
        [plannedTarget, farTarget],
        [],
        {
          onDecision: () => {},
          onMoveUnit: async () => {
            enemy.col = 4;
            enemy.row = 0;
          },
          onAttack: async (_enemy, target) => attacks.push(target.name),
          onUnitDone: () => {
            unitDoneCalled = true;
          },
        }
      );

      expect(attacks).toEqual([]);
      expect(unitDoneCalled).toBe(true);
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
