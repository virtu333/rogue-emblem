import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { TurnManager } from '../src/engine/TurnManager.js';
import { completeResolvedAction } from '../src/ui/BattlePresentationCheckpoint.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';

function setup({ survivorActed = true } = {}) {
  const scene = journeyBattleScene({ battleInProgress: null }, {});
  const survivor = {
    name: 'Commander',
    faction: 'player',
    isCommander: true,
    currentHP: 20,
    stats: { HP: 20 },
    hasActed: survivorActed,
    col: 0,
    row: 0,
  };
  // Combat removed this actor after a lethal counter. Its resolved-action
  // continuation can still be saved, and finishUnitAction still receives it.
  const fallen = {
    name: 'Counter victim',
    faction: 'player',
    currentHP: 0,
    stats: { HP: 20, MOV: 5 },
    skills: [],
    hasActed: false,
  };
  scene.playerUnits.push(survivor);
  scene.enemyUnits.push({ name: 'Counter attacker', currentHP: 10 });
  scene.turnManager = new TurnManager({
    checkBattleEnd: () => false,
    onVictory: () => {},
    onDefeat: () => {},
    onPhaseChange: (phase) => {
      scene.battleState = phase === 'enemy' ? 'ENEMY_PHASE' : 'PLAYER_IDLE';
    },
    onRejectedTransition: (transition) => {
      throw new Error(`Rejected ${transition.action}`);
    },
  });
  scene.turnManager.init(scene.playerUnits, scene.enemyUnits, []);
  scene.turnManager.startBattle();
  const saves = [];
  scene._captureSuspendCheckpoint = () => {
    saves.push({
      phase: scene.turnManager.currentPhase,
      players: scene.playerUnits.map((unit) => ({ name: unit.name, acted: unit.hasActed })),
    });
  };
  return { scene, survivor, fallen, saves };
}

describe('action completion with a real TurnManager', () => {
  it('advances after the last attacker falls to a counter and every survivor already acted', () => {
    const { scene, fallen, saves } = setup();
    scene.finishUnitAction(fallen, { skipCanto: true });
    expect(scene.turnManager.currentPhase).toBe('enemy');
    expect(scene.battleState).toBe('ENEMY_PHASE');
    expect(saves).toEqual([{ phase: 'player', players: [{ name: 'Commander', acted: true }] }]);
  });

  it('keeps the phase playable if another survivor still has an action', () => {
    const { scene, fallen } = setup({ survivorActed: false });
    scene.finishUnitAction(fallen, { skipCanto: true });
    expect(scene.turnManager.currentPhase).toBe('player');
    expect(scene.battleState).toBe('PLAYER_IDLE');
  });

  it.each(['combat', 'finish'])('advances a resumed %s when its actor is already gone', (kind) => {
    const { scene, fallen, saves } = setup();
    completeResolvedAction(scene, { kind, unitName: fallen.name });
    expect(scene.turnManager.currentPhase).toBe('enemy');
    expect(scene.battleState).toBe('ENEMY_PHASE');
    expect(saves).toEqual([{ phase: 'player', players: [{ name: 'Commander', acted: true }] }]);
  });

  it('advances the Gambit continuation when its caster has already fallen', () => {
    const { scene, fallen } = setup();
    completeResolvedAction(scene, {
      kind: 'combat',
      unitName: fallen.name,
      gambitTriggered: true,
    });
    expect(scene.turnManager.currentPhase).toBe('enemy');
  });

  it('never offers Canto to a 0-HP actor awaiting removal and advances the living army', () => {
    const { scene, fallen } = setup();
    fallen.skills = ['canto'];
    scene.playerUnits.push(fallen);
    scene.startCantoMove = () => {
      scene.battleState = 'CANTO_MOVING';
    };
    completeResolvedAction(scene, { kind: 'combat', unitName: fallen.name });
    expect(fallen.hasActed).toBe(false);
    expect(scene.turnManager.currentPhase).toBe('enemy');
    expect(scene.battleState).toBe('ENEMY_PHASE');
  });

  it('looks up the resumed actor after battle-end cleanup removes a fallen Canto unit', () => {
    const { scene, fallen } = setup();
    fallen.skills = ['canto'];
    scene.playerUnits.push(fallen);
    scene.startCantoMove = () => {
      scene.battleState = 'CANTO_MOVING';
    };
    scene.checkBattleEnd = () => {
      const index = scene.playerUnits.indexOf(fallen);
      if (index !== -1) scene.playerUnits.splice(index, 1);
      return false;
    };
    completeResolvedAction(scene, { kind: 'combat', unitName: fallen.name });
    expect(scene.playerUnits.map((unit) => unit.name)).toEqual(['Commander']);
    expect(scene.turnManager.currentPhase).toBe('enemy');
    expect(scene.battleState).toBe('ENEMY_PHASE');
  });

  it('keeps a living Gambit caster available after refreshing the army', () => {
    const { scene, survivor } = setup();
    completeResolvedAction(scene, {
      kind: 'combat',
      unitName: survivor.name,
      gambitTriggered: true,
    });
    expect(survivor.hasActed).toBe(false);
    expect(survivor._gambitUsedThisTurn).toBe(true);
    expect(scene.turnManager.currentPhase).toBe('player');
    expect(scene.battleState).toBe('PLAYER_IDLE');
  });
});
