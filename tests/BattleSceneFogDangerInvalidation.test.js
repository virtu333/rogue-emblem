import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';

describe('BattleScene fog danger invalidation', () => {
  it('recomputes danger after movement reveals an enemy in fog', async () => {
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
      updateFogOfWar: vi.fn(() => { enemyVisible = true; }),
      isVisible: vi.fn(() => enemyVisible),
      getMovementRange: vi.fn(() => new Map([['2,2', true]])),
      getAttackRange: vi.fn(() => [{ col: 3, row: 3 }]),
    };
    scene.buildUnitPositionMap = vi.fn(() => new Map());
    scene.battleParams = { tutorialMode: false };
    scene.showActionMenu = vi.fn();
    scene.dangerZone = { toggle: vi.fn() };
    scene.dangerZoneCache = [{ col: 0, row: 0 }];
    scene.dangerZoneStale = false;
    scene.battleState = 'PLAYER_IDLE';
    scene.isStoryInputLocked = () => false;

    await BattleScene.prototype.afterMove.call(scene, unit);

    expect(scene.grid.updateFogOfWar).toHaveBeenCalledWith(scene.playerUnits);
    expect(scene.dangerZoneStale).toBe(true);

    BattleScene.prototype._onDangerClick.call(scene);

    expect(scene.dangerZone.toggle).toHaveBeenCalledWith([{ col: 3, row: 3 }]);
    expect(scene.dangerZoneStale).toBe(false);
  });
});
