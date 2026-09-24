// A confirmed player attack is checkpointed before its rolls; resume replays
// that exact attack. These cover when the intent is recorded and when a
// stored intent is still valid to replay.

import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: { Scene: class {} },
}));
vi.mock('../src/ui/HintDisplay.js', () => ({
  showImportantHint: vi.fn(async () => {}),
  showMinorHint: vi.fn(),
  showContextualHint: vi.fn(),
}));

import { BattleScene } from '../src/scenes/BattleScene.js';

function makeScene(overrides = {}) {
  const scene = Object.create(BattleScene.prototype);
  Object.assign(scene, {
    runManager: { battleInProgress: { checkpoint: null } },
    battleParams: {},
    turnManager: { currentPhase: 'player', turnNumber: 3 },
    playerUnits: [
      { name: 'Edric', battleEntityId: 'u1', faction: 'player', currentHP: 20, hasActed: false },
    ],
    enemyUnits: [{ name: 'Brigand', battleEntityId: 'u2', faction: 'enemy', currentHP: 18 }],
    npcUnits: [],
    _captureSuspendCheckpoint: vi.fn(),
    refreshEndTurnControl: vi.fn(),
    executeCombat: vi.fn(async () => {}),
    _scheduleSafeDelayedAsync: vi.fn(),
    ...overrides,
  });
  return scene;
}

describe('BattleScene._commitCombatIntent', () => {
  it('records the attack (with its selected art) and saves it without advancing RNG', () => {
    const scene = makeScene({
      _selectedWeaponArt: { unitName: 'Edric', artId: 'sword_slash', weaponIndex: 1 },
    });
    scene._commitCombatIntent(scene.playerUnits[0], scene.enemyUnits[0]);
    expect(scene._pendingCommittedAction).toEqual({
      kind: 'attack',
      unitId: 'u1',
      unitName: 'Edric',
      targetId: 'u2',
      weaponArt: { artId: 'sword_slash', weaponIndex: 1 },
    });
    expect(scene._captureSuspendCheckpoint).toHaveBeenCalledWith({ commitIntent: true });
  });

  it('ignores an art selected for a different unit', () => {
    const scene = makeScene({
      _selectedWeaponArt: { unitName: 'Sera', artId: 'x', weaponIndex: 0 },
    });
    scene._commitCombatIntent(scene.playerUnits[0], scene.enemyUnits[0]);
    expect(scene._pendingCommittedAction.weaponArt).toBeNull();
  });

  it.each([
    ['outside a saved run battle', { runManager: null }],
    ['in the tutorial', { battleParams: { tutorialMode: true } }],
    ['during the enemy phase', { turnManager: { currentPhase: 'enemy', turnNumber: 3 } }],
  ])('records nothing %s', (_label, overrides) => {
    const scene = makeScene(overrides);
    scene._commitCombatIntent(scene.playerUnits[0], scene.enemyUnits[0]);
    expect(scene._pendingCommittedAction).toBeNull();
    expect(scene._captureSuspendCheckpoint).not.toHaveBeenCalled();
  });
});

describe('BattleScene.resumeCommittedAttack', () => {
  const intent = {
    kind: 'attack',
    unitId: 'u1',
    unitName: 'Edric',
    targetId: 'u2',
    weaponArt: { artId: 'sword_slash', weaponIndex: 1 },
  };

  it('locks input, restores the art selection and schedules the same attack', async () => {
    const scene = makeScene();
    expect(scene.resumeCommittedAttack(intent)).toBe(true);
    expect(scene.battleState).toBe('COMBAT_RESOLVING');
    expect(scene.selectedUnit).toBe(scene.playerUnits[0]);
    expect(scene._selectedWeaponArt).toEqual({
      unitName: 'Edric',
      artId: 'sword_slash',
      weaponIndex: 1,
    });
    const [, label, run] = scene._scheduleSafeDelayedAsync.mock.calls[0];
    expect(label).toBe('resume_committed_attack');
    await run();
    expect(scene.executeCombat).toHaveBeenCalledWith(scene.playerUnits[0], scene.enemyUnits[0]);
  });

  it.each([
    ['the attacker is gone', (s) => (s.playerUnits = [])],
    ['the target is gone', (s) => (s.enemyUnits = [])],
    ['the attacker already acted', (s) => (s.playerUnits[0].hasActed = true)],
    ['the target is already defeated', (s) => (s.enemyUnits[0].currentHP = 0)],
  ])('declines (normal resume runs) when %s', (_label, mutate) => {
    const scene = makeScene({ _pendingCommittedAction: intent });
    mutate(scene);
    expect(scene.resumeCommittedAttack(intent)).toBe(false);
    expect(scene._pendingCommittedAction).toBeNull();
    expect(scene._scheduleSafeDelayedAsync).not.toHaveBeenCalled();
  });
});
