import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';

function makeUnit(faction, col = 2, row = 3, overrides = {}) {
  return {
    faction,
    col,
    row,
    stats: { MOV: 5 },
    moveType: 'foot',
    weapon: { range: '1' },
    ...overrides,
  };
}

function createInspectionScene(battleState, units = []) {
  const showMovementRange = vi.fn();
  const showAttackRange = vi.fn();
  return {
    battleState,
    grid: {
      pixelToGrid: vi.fn(() => ({ col: 2, row: 3 })),
      getTerrainAt: vi.fn(() => ({ name: 'Plain' })),
      getMovementRange: vi.fn(() => new Map([['2,3', 0], ['3,3', 1]])),
      getAttackRange: vi.fn(() => [{ col: 4, row: 3 }]),
      showMovementRange,
      showAttackRange,
      clearHighlights: vi.fn(),
      clearAttackHighlights: vi.fn(),
    },
    inspectionPanel: { show: vi.fn() },
    getUnitAt: vi.fn((c, r) => units.find(u => u.col === c && u.row === r) || null),
    buildUnitPositionMap: vi.fn(() => new Map()),
    refreshEndTurnControl: vi.fn(),
    _showInspectionAtPixel: BattleScene.prototype._showInspectionAtPixel,
    _getCostModifier: () => 0,
  };
}

describe('BattleScene inspection range overlays', () => {
  it('shows blue range (0x3366cc, 0.4) for player units in PLAYER_IDLE', () => {
    const player = makeUnit('player');
    const scene = createInspectionScene('PLAYER_IDLE', [player]);

    scene._showInspectionAtPixel(100, 100);

    expect(scene.grid.showMovementRange).toHaveBeenCalledWith(
      expect.any(Map), 2, 3, 0x3366cc, 0.4
    );
    expect(scene.grid.showAttackRange).toHaveBeenCalledTimes(1);
  });

  it('shows red range (0xcc3333, 0.35) for enemy units in PLAYER_IDLE', () => {
    const enemy = makeUnit('enemy');
    const scene = createInspectionScene('PLAYER_IDLE', [enemy]);

    scene._showInspectionAtPixel(100, 100);

    expect(scene.grid.showMovementRange).toHaveBeenCalledWith(
      expect.any(Map), 2, 3, 0xcc3333, 0.35
    );
    expect(scene.grid.showAttackRange).toHaveBeenCalledTimes(1);
  });

  it('does not show range overlays outside PLAYER_IDLE', () => {
    const player = makeUnit('player');
    const scene = createInspectionScene('UNIT_SELECTED', [player]);

    scene._showInspectionAtPixel(100, 100);

    expect(scene.grid.showMovementRange).not.toHaveBeenCalled();
    expect(scene.grid.showAttackRange).not.toHaveBeenCalled();
    // Inspection panel still shown
    expect(scene.inspectionPanel.show).toHaveBeenCalledTimes(1);
  });
});
