import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TurnManager } from '../src/engine/TurnManager.js';

function makeUnit(name, faction = 'player') {
  return { name, faction, hasMoved: false, hasActed: false };
}

describe('TurnManager', () => {
  let onPhaseChange, onVictory, onDefeat;

  beforeEach(() => {
    onPhaseChange = vi.fn();
    onVictory = vi.fn();
    onDefeat = vi.fn();
  });

  it('constructor initializes player phase at turn 1', () => {
    const tm = new TurnManager({ onPhaseChange, onVictory, onDefeat });
    expect(tm.currentPhase).toBe('player');
    expect(tm.turnNumber).toBe(1);
  });

  it('startBattle fires onPhaseChange("player", 1)', () => {
    const tm = new TurnManager({ onPhaseChange, onVictory, onDefeat });
    tm.init([makeUnit('Edric')], [makeUnit('Goblin', 'enemy')], [], 'rout');
    tm.startBattle();
    expect(onPhaseChange).toHaveBeenCalledWith('player', 1);
  });

  it('unitActed marks unit and auto-ends phase when all acted', () => {
    const tm = new TurnManager({ onPhaseChange, onVictory, onDefeat });
    const p1 = makeUnit('Edric');
    const p2 = makeUnit('Sera');
    tm.init([p1, p2], [makeUnit('Goblin', 'enemy')], [], 'rout');
    tm.startBattle();
    onPhaseChange.mockClear();

    tm.unitActed(p1);
    expect(onPhaseChange).not.toHaveBeenCalled(); // p2 still hasn't acted

    tm.unitActed(p2);
    expect(onPhaseChange).toHaveBeenCalledWith('enemy', 1);
  });

  it('endPlayerPhase switches to enemy phase', () => {
    const tm = new TurnManager({ onPhaseChange, onVictory, onDefeat });
    tm.init([makeUnit('Edric')], [makeUnit('Goblin', 'enemy')], [], 'rout');
    tm.startBattle();
    onPhaseChange.mockClear();

    tm.endPlayerPhase();
    expect(tm.currentPhase).toBe('enemy');
    expect(onPhaseChange).toHaveBeenCalledWith('enemy', 1);
  });

  it('endEnemyPhase increments turn, resets enemies, switches to player', () => {
    const tm = new TurnManager({ onPhaseChange, onVictory, onDefeat });
    const enemy = makeUnit('Goblin', 'enemy');
    enemy.hasMoved = true;
    enemy.hasActed = true;
    tm.init([makeUnit('Edric')], [enemy], [], 'rout');
    tm.startBattle();
    tm.endPlayerPhase();
    onPhaseChange.mockClear();

    tm.endEnemyPhase();
    expect(tm.turnNumber).toBe(2);
    expect(tm.currentPhase).toBe('player');
    expect(enemy.hasMoved).toBe(false);
    expect(enemy.hasActed).toBe(false);
    expect(onPhaseChange).toHaveBeenCalledWith('player', 2);
  });

  it('getAvailableUnits filters out acted units', () => {
    const tm = new TurnManager({ onPhaseChange, onVictory, onDefeat });
    const p1 = makeUnit('Edric');
    const p2 = makeUnit('Sera');
    p1.hasActed = true;
    tm.init([p1, p2], [], [], 'rout');
    expect(tm.getAvailableUnits('player')).toEqual([p2]);
  });

  describe('external checkBattleEnd callback', () => {
    it('delegates to external callback when provided, returning true short-circuits', () => {
      const checkBattleEnd = vi.fn(() => true);
      const tm = new TurnManager({ onPhaseChange, onVictory, onDefeat, checkBattleEnd });
      tm.init([makeUnit('Edric')], [makeUnit('Goblin', 'enemy')], [], 'rout');
      tm.startBattle();
      onPhaseChange.mockClear();

      tm.endPlayerPhase();
      expect(checkBattleEnd).toHaveBeenCalled();
      // Phase should NOT have changed since checkBattleEnd returned true
      expect(onPhaseChange).not.toHaveBeenCalled();
    });

    it('external callback returning false allows normal phase transition', () => {
      const checkBattleEnd = vi.fn(() => false);
      const tm = new TurnManager({ onPhaseChange, onVictory, onDefeat, checkBattleEnd });
      tm.init([makeUnit('Edric')], [makeUnit('Goblin', 'enemy')], [], 'rout');
      tm.startBattle();
      onPhaseChange.mockClear();

      tm.endPlayerPhase();
      expect(checkBattleEnd).toHaveBeenCalled();
      expect(onPhaseChange).toHaveBeenCalledWith('enemy', 1);
    });

    it('Edric dead via external callback triggers onDefeat', () => {
      // Simulate BattleScene's checkBattleEnd logic
      const playerUnits = [makeUnit('Edric'), makeUnit('Sera')];
      const checkBattleEnd = vi.fn(() => {
        const edricAlive = playerUnits.some((u) => u.name === 'Edric');
        if (!edricAlive) {
          onDefeat();
          return true;
        }
        return false;
      });
      const tm = new TurnManager({ onPhaseChange, onVictory, onDefeat, checkBattleEnd });
      tm.init(playerUnits, [makeUnit('Goblin', 'enemy')], [], 'rout');
      tm.startBattle();

      // Kill Edric
      playerUnits.splice(0, 1);
      tm.endPlayerPhase();
      expect(onDefeat).toHaveBeenCalled();
    });

    it('reinforcement pending via external callback prevents premature victory', () => {
      let reinforcementsPending = true;
      const enemies = [makeUnit('Goblin', 'enemy')];
      const checkBattleEnd = vi.fn(() => {
        if (enemies.length === 0) {
          if (reinforcementsPending) return false; // defer
          onVictory();
          return true;
        }
        return false;
      });
      const tm = new TurnManager({ onPhaseChange, onVictory, onDefeat, checkBattleEnd });
      tm.init([makeUnit('Edric')], enemies, [], 'rout');
      tm.startBattle();

      // Kill enemy while reinforcements pending
      enemies.length = 0;
      tm.endPlayerPhase();
      expect(onVictory).not.toHaveBeenCalled();
    });
  });

  describe('fallback (no external callback)', () => {
    it('playerUnits empty triggers onDefeat', () => {
      const tm = new TurnManager({ onPhaseChange, onVictory, onDefeat });
      tm.init([], [makeUnit('Goblin', 'enemy')], [], 'rout');
      tm.startBattle();

      tm.endPlayerPhase();
      expect(onDefeat).toHaveBeenCalled();
    });

    it('rout + enemies empty triggers onVictory', () => {
      const tm = new TurnManager({ onPhaseChange, onVictory, onDefeat });
      tm.init([makeUnit('Edric')], [], [], 'rout');
      tm.startBattle();

      tm.endPlayerPhase();
      expect(onVictory).toHaveBeenCalled();
    });

    it('seize + enemies empty does NOT trigger victory', () => {
      const tm = new TurnManager({ onPhaseChange, onVictory, onDefeat });
      tm.init([makeUnit('Edric')], [], [], 'seize');
      tm.startBattle();
      onPhaseChange.mockClear();

      tm.endPlayerPhase();
      expect(onVictory).not.toHaveBeenCalled();
      expect(onPhaseChange).toHaveBeenCalledWith('enemy', 1);
    });
  });

  it('full phase cycle: player → enemy → player with turn increment', () => {
    const tm = new TurnManager({ onPhaseChange, onVictory, onDefeat });
    const player = makeUnit('Edric');
    const enemy = makeUnit('Goblin', 'enemy');
    tm.init([player], [enemy], [], 'rout');
    tm.startBattle();

    expect(tm.turnNumber).toBe(1);
    expect(tm.currentPhase).toBe('player');

    tm.endPlayerPhase();
    expect(tm.currentPhase).toBe('enemy');

    tm.endEnemyPhase();
    expect(tm.turnNumber).toBe(2);
    expect(tm.currentPhase).toBe('player');
  });
});
