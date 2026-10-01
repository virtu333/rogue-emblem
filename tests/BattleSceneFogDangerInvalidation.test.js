import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { completeBattleAction } from '../src/ui/BattleActionCompletion.js';

describe('BattleScene fog danger invalidation', () => {
  it('recomputes danger once a committed action reveals an enemy in fog, not on the move', async () => {
    const scene = new BattleScene();
    let enemyVisible = false;

    const unit = { col: 1, row: 1, faction: 'player' };
    const enemy = {
      col: 2,
      row: 2,
      faction: 'enemy',
      mov: 1,
      moveType: 'Infantry',
      weapon: { range: '1' },
    };

    scene.playerUnits = [unit];
    scene.enemyUnits = [enemy];
    scene.npcUnits = [];
    scene.grid = {
      fogEnabled: true,
      updateFogOfWar: vi.fn(() => {
        enemyVisible = true;
      }),
      isVisible: vi.fn(() => enemyVisible),
      getMovementRange: vi.fn(() => new Map([['2,2', true]])),
      getAttackRange: vi.fn(() => [
        { col: 3, row: 3, count: 1, damageThreat: true, statusThreat: false },
      ]),
    };
    scene.buildUnitPositionMap = vi.fn(() => new Map());
    scene.battleParams = { tutorialMode: false };
    scene.showActionMenu = vi.fn(() => {
      scene.battleState = 'UNIT_ACTION_MENU';
    });
    scene.dangerZone = { toggle: vi.fn() };
    scene.dangerZoneCache = [{ col: 0, row: 0 }];
    scene.dangerZoneStale = false;
    scene.battleState = 'PLAYER_IDLE';
    scene.isStoryInputLocked = () => false;

    await BattleScene.prototype.afterMove.call(scene, unit);

    // The move alone can still be undone: fog and danger stay as they were.
    expect(scene.grid.updateFogOfWar).not.toHaveBeenCalled();
    expect(scene.dangerZoneStale).toBe(false);
    expect(scene.showActionMenu).toHaveBeenCalledWith(unit);
    expect(scene.battleState).toBe('UNIT_ACTION_MENU');

    // Wait on the new tile: the fog lifts and the cached danger is dropped.
    scene.dimUnit = vi.fn();
    scene.turnManager = { unitActed: vi.fn() };
    completeBattleAction(scene, unit, { session: scene._battleSession });
    expect(scene.grid.updateFogOfWar).toHaveBeenCalledWith(scene.playerUnits);
    expect(scene.dangerZoneStale).toBe(true);
    expect(scene.battleState).toBe('PLAYER_IDLE');

    BattleScene.prototype._onDangerClick.call(scene);

    expect(scene.dangerZone.toggle).toHaveBeenCalledWith([
      { col: 3, row: 3, count: 1, damageThreat: true, statusThreat: false },
    ]);
    expect(scene.dangerZoneStale).toBe(false);
  });
});
