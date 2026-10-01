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

  it('rejects wrong-phase and repeated phase ends without resetting enemies or invoking battle-end callbacks', () => {
    const checkBattleEnd = vi.fn(() => false);
    const tm = new TurnManager({ onPhaseChange, onVictory, onDefeat, checkBattleEnd });
    const enemy = makeUnit('Goblin', 'enemy');
    tm.init([makeUnit('Edric')], [enemy], [], 'rout');
    enemy.hasMoved = enemy.hasActed = true;
    expect(tm.endEnemyPhase()).toBe(false);
    expect(tm.turnNumber).toBe(1);
    expect(enemy.hasMoved).toBe(true);
    expect(checkBattleEnd).not.toHaveBeenCalled();
    expect(tm.endPlayerPhase()).toBe(true);
    expect(tm.endPlayerPhase()).toBe(false);
    expect(tm.endEnemyPhase()).toBe(true);
    expect(tm.endEnemyPhase()).toBe(false);
    expect(tm.turnNumber).toBe(2);
    expect(onPhaseChange.mock.calls).toEqual([
      ['enemy', 1],
      ['player', 2],
    ]);
    expect(checkBattleEnd).toHaveBeenCalledTimes(2);
  });

  it('ignores stale or removed units before marking or changing phase', () => {
    const tm = new TurnManager({ onPhaseChange, onVictory, onDefeat });
    const player = makeUnit('Edric');
    const removed = makeUnit('Gone');
    tm.init([player], [makeUnit('Goblin', 'enemy')], []);
    expect(tm.unitActed(removed)).toBe(false);
    expect(tm.unitActed(null)).toBe(false);
    expect(removed.hasActed).toBe(false);
    expect(tm.unitActed(player)).toBe(true);
    player.hasActed = false;
    expect(tm.unitActed(player)).toBe(false);
    expect(player.hasActed).toBe(false);
    expect(onPhaseChange.mock.calls).toEqual([['enemy', 1]]);
  });

  it('reports rejected transitions through an injected diagnostic without gameplay callbacks', () => {
    const onRejectedTransition = vi.fn();
    const tm = new TurnManager({ onPhaseChange, onVictory, onDefeat, onRejectedTransition });
    tm.init([makeUnit('Edric')], [makeUnit('Goblin', 'enemy')], []);
    expect(tm.endEnemyPhase()).toBe(false);
    expect(tm.unitActed(makeUnit('Removed'))).toBe(false);
    expect(onRejectedTransition.mock.calls).toEqual([
      [{ action: 'endEnemyPhase', phase: 'player', turn: 1 }],
      [{ action: 'unitActed', phase: 'player', turn: 1 }],
    ]);
    expect(onPhaseChange).not.toHaveBeenCalled();
    expect(onVictory).not.toHaveBeenCalled();
    expect(onDefeat).not.toHaveBeenCalled();
  });

  it('checks remaining units after Escape without accepting a removed actor', () => {
    const tm = new TurnManager({ onPhaseChange, onVictory, onDefeat });
    const escaped = makeUnit('Escaped');
    const staying = makeUnit('Edric');
    tm.init([escaped, staying], [makeUnit('Goblin', 'enemy')], [], 'escape');
    tm.playerUnits.splice(0, 1);
    expect(tm.checkPlayerPhaseComplete()).toBe(false);
    staying.hasActed = true;
    expect(tm.checkPlayerPhaseComplete()).toBe(true);
    expect(escaped.hasActed).toBe(false);
    expect(tm.currentPhase).toBe('enemy');
  });

  it('does not repeat victory/defeat or mutate units once battle end is detected', () => {
    const player = makeUnit('Edric');
    const tm = new TurnManager({ onPhaseChange, onVictory, onDefeat });
    tm.init([player], [], [], 'rout');
    expect(tm.endPlayerPhase()).toBe(false);
    expect(tm.endPlayerPhase()).toBe(false);
    expect(tm.unitActed(player)).toBe(false);
    expect(tm.checkPlayerPhaseComplete()).toBe(false);
    expect(player.hasActed).toBe(false);
    expect(onVictory).toHaveBeenCalledTimes(1);
    expect(onPhaseChange).not.toHaveBeenCalled();
  });

  it('allows a phase end after a reversible scene Vision decision is resolved', () => {
    const checkBattleEnd = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const tm = new TurnManager({ onPhaseChange, onVictory, onDefeat, checkBattleEnd });
    tm.init([makeUnit('Edric')], [makeUnit('Goblin', 'enemy')], [], 'rout');
    expect(tm.endPlayerPhase()).toBe(false);
    expect(tm.currentPhase).toBe('player');
    expect(tm.endPlayerPhase()).toBe(true);
    expect(tm.currentPhase).toBe('enemy');
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

  it('unitActed handles null entries in playerUnits without crashing', () => {
    const tm = new TurnManager({ onPhaseChange, onVictory, onDefeat });
    const p1 = makeUnit('Edric');
    tm.init([p1], [makeUnit('Goblin', 'enemy')], [], 'rout');
    tm.startBattle();
    onPhaseChange.mockClear();

    // Inject a null entry to simulate removal edge case
    tm.playerUnits.push(null);

    // Should not throw; should still transition when all real units have acted
    expect(() => tm.unitActed(p1)).not.toThrow();
    expect(onPhaseChange).toHaveBeenCalledWith('enemy', 1);
  });
});
