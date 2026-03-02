import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';

function makeUnit(overrides = {}) {
  return {
    col: 1,
    row: 1,
    faction: 'player',
    moveType: 'Infantry',
    mov: 5,
    currentHP: 20,
    hasMoved: false,
    hasActed: false,
    weapon: { range: '1' },
    inventory: [],
    consumables: [],
    skills: [],
    stats: { HP: 20, MOV: 5 },
    graphic: { clearTint: vi.fn(), setTint: vi.fn(), setAlpha: vi.fn() },
    label: null,
    hpBar: {
      bg: { setPosition: vi.fn() },
      fill: { setPosition: vi.fn(), setSize: vi.fn(), setFillStyle: vi.fn() },
    },
    affixPips: [],
    ...overrides,
  };
}

function makeScene() {
  const scene = new BattleScene();
  const unit = makeUnit();
  scene.scene = { isActive: () => true };
  scene.grid = {
    cols: 4,
    rows: 4,
    mapLayout: [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    terrainData: [{ name: 'Plains', moveCost: { Infantry: 1 } }],
    fogEnabled: true,
    findPath: vi.fn(() => [
      { col: 1, row: 1 },
      { col: 2, row: 1 },
    ]),
    reconstructIcePath: vi.fn(() => null),
    getMoveCost: vi.fn(() => 1),
    snapshotFogState: vi.fn(() => new Set(['1,1'])),
    restoreFogState: vi.fn(),
    updateFogOfWar: vi.fn(),
    gridToPixel: vi.fn((col, row) => ({ x: col * 16, y: row * 16 })),
    clearHighlights: vi.fn(),
    clearAttackHighlights: vi.fn(),
    clearPath: vi.fn(),
  };
  scene.time = { delayedCall: vi.fn((_ms, _cb) => ({})) };
  scene.tweens = {
    add: vi.fn((cfg) => {
      if (typeof cfg?.onComplete === 'function') cfg.onComplete();
      return {};
    }),
  };
  scene.playerUnits = [unit];
  scene.enemyUnits = [];
  scene.npcUnits = [];
  scene.selectedUnit = unit;
  scene.preMoveLoc = null;
  scene._preFogSnapshot = null;
  scene.cantoRange = null;
  scene.battleState = 'UNIT_SELECTED';
  scene.movementRange = new Map([['2,1', { cost: 1, parent: '1,1' }]]);
  scene.unitPositions = new Map();
  scene.turnManager = { unitActed: vi.fn() };
  scene.updateEnemyVisibility = vi.fn();
  scene.updateUnitPosition = vi.fn();
  scene.afterMove = vi.fn(async () => {
    scene.battleState = 'UNIT_ACTION_MENU';
  });
  scene.selectUnit = vi.fn(function selectUnit(u) {
    this.selectedUnit = u;
    this.battleState = 'UNIT_SELECTED';
    this.movementRange = new Map();
    this.unitPositions = new Map();
  });
  scene.deselectUnit = vi.fn(function deselectUnit() {
    this.selectedUnit = null;
    this.battleState = 'PLAYER_IDLE';
  });
  scene.dimUnit = vi.fn();

  return { scene, unit };
}

describe('BattleScene movement recovery', () => {
  let warnSpy;
  let errorSpy;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('arms normal-move fallback before tween setup and recovers when tweens.add throws', () => {
    const { scene, unit } = makeScene();
    scene.tweens.add = vi.fn(() => {
      throw new Error('tween boom');
    });

    BattleScene.prototype.moveUnit.call(scene, unit, 2, 1);

    expect(scene.time.delayedCall).toHaveBeenCalledTimes(1);
    expect(scene.battleState).toBe('UNIT_SELECTED');
    expect(scene.selectedUnit).toBe(unit);
    expect(unit.col).toBe(1);
    expect(unit.row).toBe(1);
    expect(scene.grid.restoreFogState).toHaveBeenCalledTimes(1);
    expect(scene.selectUnit).toHaveBeenCalledWith(unit);
  });

  it('rolls back normal move even if updateUnitPosition throws during finalize and rollback', () => {
    const { scene, unit } = makeScene();
    unit._movementSpent = 3;
    scene.updateUnitPosition = vi.fn(() => {
      throw new Error('graphic destroyed');
    });

    BattleScene.prototype.moveUnit.call(scene, unit, 2, 1);

    expect(scene.afterMove).not.toHaveBeenCalled();
    expect(scene.battleState).toBe('UNIT_SELECTED');
    expect(scene.selectedUnit).toBe(unit);
    expect(unit.col).toBe(1);
    expect(unit.row).toBe(1);
    expect(unit._movementSpent).toBe(3);
    expect(scene.grid.restoreFogState).toHaveBeenCalledTimes(1);
    expect(scene.selectUnit).toHaveBeenCalledWith(unit);
  });

  it('recovers and rolls back when afterMove rejects', async () => {
    const { scene, unit } = makeScene();
    scene.afterMove = vi.fn(() => Promise.reject(new Error('afterMove failed')));

    BattleScene.prototype.moveUnit.call(scene, unit, 2, 1);
    await Promise.resolve();
    await Promise.resolve();

    expect(scene.battleState).toBe('UNIT_SELECTED');
    expect(scene.selectedUnit).toBe(unit);
    expect(unit.col).toBe(1);
    expect(unit.row).toBe(1);
    expect(scene.grid.restoreFogState).toHaveBeenCalledTimes(1);
    expect(scene.selectUnit).toHaveBeenCalledWith(unit);
  });

  it('recovers Canto flow when tweens.add throws and ends action safely', () => {
    const { scene, unit } = makeScene();
    scene.battleState = 'CANTO_MOVING';
    scene.cantoRange = new Map([['2,1', { cost: 1, parent: '1,1' }]]);
    unit.hasActed = true;
    scene.tweens.add = vi.fn(() => {
      throw new Error('canto tween boom');
    });

    BattleScene.prototype.handleCantoClick.call(scene, { col: 2, row: 1 });

    expect(scene.time.delayedCall).toHaveBeenCalledTimes(1);
    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(scene.selectedUnit).toBeNull();
    expect(scene.turnManager.unitActed).toHaveBeenCalledWith(unit);
  });

  it('recovers Canto finalize when updateUnitPosition throws and still exits UNIT_MOVING', () => {
    const { scene, unit } = makeScene();
    scene.battleState = 'CANTO_MOVING';
    scene.cantoRange = new Map([['2,1', { cost: 1, parent: '1,1' }]]);
    unit.hasActed = true;
    scene.updateUnitPosition = vi.fn(() => {
      throw new Error('canto finalize visual sync failed');
    });

    BattleScene.prototype.handleCantoClick.call(scene, { col: 2, row: 1 });

    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(scene.selectedUnit).toBeNull();
    expect(scene.turnManager.unitActed).toHaveBeenCalledWith(unit);
    expect(unit.col).toBe(2);
    expect(unit.row).toBe(1);
  });

  it('deselects safely when moveUnit findPath is null/short', () => {
    const { scene, unit } = makeScene();
    scene.grid.findPath = vi.fn(() => null);

    BattleScene.prototype.moveUnit.call(scene, unit, 2, 1);

    expect(scene.deselectUnit).toHaveBeenCalledTimes(1);
    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(scene.selectedUnit).toBeNull();
    expect(scene.time.delayedCall).not.toHaveBeenCalled();
  });

  it('deselects safely when moveUnit findPath throws before UNIT_MOVING', () => {
    const { scene, unit } = makeScene();
    unit._movementSpent = 4;
    scene.grid.findPath = vi.fn(() => {
      throw new Error('path init boom');
    });

    BattleScene.prototype.moveUnit.call(scene, unit, 2, 1);

    expect(scene.deselectUnit).toHaveBeenCalledTimes(1);
    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(scene.selectedUnit).toBeNull();
    expect(unit._movementSpent).toBe(4);
    expect(scene.time.delayedCall).not.toHaveBeenCalled();
  });

  it('deselects safely when findPath returns null/short path', () => {
    const { scene, unit } = makeScene();
    // Mock findPath to return a 1-element array, which triggers the
    // path.length < 2 guard in moveUnit (BattleScene.js:4538) before
    // computeEffectivePath is ever reached.
    scene.grid.findPath = vi.fn(() => [{ col: 1, row: 1 }]);

    BattleScene.prototype.moveUnit.call(scene, unit, 2, 1);

    expect(scene.deselectUnit).toHaveBeenCalledTimes(1);
    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(scene.selectedUnit).toBeNull();
    expect(scene.time.delayedCall).not.toHaveBeenCalled();
  });

  it('deselects safely when effective path setup throws before UNIT_MOVING', () => {
    const { scene, unit } = makeScene();
    unit._movementSpent = 5;
    scene.buildOccupiedSet = vi.fn(() => {
      throw new Error('occupied set boom');
    });

    BattleScene.prototype.moveUnit.call(scene, unit, 2, 1);

    expect(scene.deselectUnit).toHaveBeenCalledTimes(1);
    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(scene.selectedUnit).toBeNull();
    expect(unit._movementSpent).toBe(5);
    expect(scene.time.delayedCall).not.toHaveBeenCalled();
  });

  it('recovers if fog snapshot throws after entering UNIT_MOVING', () => {
    const { scene, unit } = makeScene();
    unit._movementSpent = 2;
    scene.grid.snapshotFogState = vi.fn(() => {
      throw new Error('snapshot failed');
    });

    BattleScene.prototype.moveUnit.call(scene, unit, 2, 1);

    expect(scene.battleState).toBe('UNIT_SELECTED');
    expect(scene.selectedUnit).toBe(unit);
    expect(unit.col).toBe(1);
    expect(unit.row).toBe(1);
    expect(unit._movementSpent).toBe(2);
  });

  it('keeps Canto active when canto pathfinding returns null/short path', () => {
    const { scene, unit } = makeScene();
    scene.battleState = 'CANTO_MOVING';
    scene.cantoRange = new Map([['2,1', { cost: 1, parent: '1,1' }]]);
    unit.hasActed = true;
    scene.grid.findPath = vi.fn(() => null);

    BattleScene.prototype.handleCantoClick.call(scene, { col: 2, row: 1 });

    expect(scene.battleState).toBe('CANTO_MOVING');
    expect(scene.selectedUnit).toBe(unit);
    expect(scene.turnManager.unitActed).not.toHaveBeenCalled();
    expect(scene.grid.clearHighlights).not.toHaveBeenCalled();
  });

  it('retries once for canto pre-init throw, then fails closed on repeated throw', () => {
    const { scene, unit } = makeScene();
    scene.battleState = 'CANTO_MOVING';
    scene.cantoRange = new Map([['2,1', { cost: 1, parent: '1,1' }]]);
    unit.hasActed = true;
    scene.grid.findPath = vi.fn(() => {
      throw new Error('canto pre-init boom');
    });

    BattleScene.prototype.handleCantoClick.call(scene, { col: 2, row: 1 });
    expect(scene.battleState).toBe('CANTO_MOVING');
    expect(scene.selectedUnit).toBe(unit);
    expect(scene.turnManager.unitActed).not.toHaveBeenCalled();
    expect(scene.grid.clearHighlights).not.toHaveBeenCalled();

    BattleScene.prototype.handleCantoClick.call(scene, { col: 2, row: 1 });
    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(scene.selectedUnit).toBeNull();
    expect(scene.turnManager.unitActed).toHaveBeenCalledWith(unit);
  });

  it('still allows click-own-tile canto skip after a retryable pre-init throw', () => {
    const { scene, unit } = makeScene();
    scene.battleState = 'CANTO_MOVING';
    scene.cantoRange = new Map([['2,1', { cost: 1, parent: '1,1' }]]);
    unit.hasActed = true;
    scene.grid.findPath = vi.fn(() => {
      throw new Error('canto pre-init boom');
    });

    BattleScene.prototype.handleCantoClick.call(scene, { col: 2, row: 1 });
    expect(scene.battleState).toBe('CANTO_MOVING');
    expect(scene.turnManager.unitActed).not.toHaveBeenCalled();

    BattleScene.prototype.handleCantoClick.call(scene, { col: unit.col, row: unit.row });
    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(scene.selectedUnit).toBeNull();
    expect(scene.turnManager.unitActed).toHaveBeenCalledWith(unit);
  });

  it('Fix 4: handleCantoClick rejects stoppable:false tiles', () => {
    const { scene, unit } = makeScene();
    scene.battleState = 'CANTO_MOVING';
    // Tile 2,1 is reachable but stoppable:false (ally-occupied)
    scene.cantoRange = new Map([
      ['2,1', { cost: 1, parent: '1,1', stoppable: false }],
      ['3,1', { cost: 2, parent: '2,1' }],
    ]);
    unit.hasActed = true;

    BattleScene.prototype.handleCantoClick.call(scene, { col: 2, row: 1 });

    // Should return early — no path computation, state unchanged
    expect(scene.battleState).toBe('CANTO_MOVING');
    expect(scene.grid.findPath).not.toHaveBeenCalled();
    expect(scene.grid.reconstructIcePath).not.toHaveBeenCalled();
    expect(scene.turnManager.unitActed).not.toHaveBeenCalled();
  });

  it('Fix 6: calculateDangerZone excludes stoppable:false tiles', () => {
    const scene = new BattleScene();
    const enemy = makeUnit({
      col: 0,
      row: 0,
      faction: 'enemy',
      moveType: 'Infantry',
      mov: 3,
      weapon: { range: '1' },
      stats: { MOV: 3 },
    });
    scene.playerUnits = [];
    scene.enemyUnits = [enemy];
    scene.npcUnits = [];
    scene.grid = {
      cols: 4,
      rows: 1,
      fogEnabled: false,
      isVisible: () => true,
      getMovementRange: vi.fn(
        () =>
          new Map([
            ['0,0', { cost: 0, parent: null }],
            ['1,0', { cost: 1, parent: '0,0', stoppable: false }], // ally-occupied
            ['2,0', { cost: 2, parent: '1,0' }],
          ]),
      ),
      getAttackRange: vi.fn((col, row) => {
        // Return adjacent tiles as attack range
        const tiles = [];
        if (col > 0) tiles.push({ col: col - 1, row });
        if (col < 3) tiles.push({ col: col + 1, row });
        return tiles;
      }),
    };
    scene._getCostModifier = vi.fn(() => 0);
    scene.buildUnitPositionMap = BattleScene.prototype.buildUnitPositionMap;
    scene.unitPositions = new Map();

    const result = BattleScene.prototype.calculateDangerZone.call(scene);
    const keys = new Set(result.map((t) => `${t.col},${t.row}`));

    // From (0,0): can attack (1,0). From (2,0): can attack (1,0) and (3,0).
    // (1,0) is stoppable:false so should NOT contribute attack tiles.
    expect(keys.has('1,0')).toBe(true); // attacked from (0,0) and (2,0)
    expect(keys.has('3,0')).toBe(true); // attacked from (2,0)
    // If stoppable:false were NOT filtered, (1,0) would contribute attacks to (0,0) and (2,0).
    // (0,0) is already in moveRange so wouldn't appear in attack overlay.
    // The key assertion: (1,0) itself doesn't contribute attack tiles.
    // Verify that getAttackRange was NOT called for (1,0)
    const callArgs = scene.grid.getAttackRange.mock.calls.map((c) => `${c[0]},${c[1]}`);
    expect(callArgs).not.toContain('1,0');
  });

  it('calculateDangerZone includes enemy ballista threat tiles', () => {
    const scene = new BattleScene();
    scene.playerUnits = [];
    scene.enemyUnits = [];
    scene.npcUnits = [];
    scene.ballistas = [{ col: 10, row: 10, owner: 'enemy', captured: false }];
    scene.grid = {
      cols: 30,
      rows: 30,
      fogEnabled: false,
      isVisible: () => true,
    };

    const result = BattleScene.prototype.calculateDangerZone.call(scene);
    const keys = new Set(result.map((t) => `${t.col},${t.row}`));

    expect(result.length).toBe(60);
    expect(keys.has('10,10')).toBe(false);
    expect(keys.has('15,10')).toBe(true);
    expect(keys.has('10,15')).toBe(true);
    expect(keys.has('5,10')).toBe(true);
    expect(keys.has('10,5')).toBe(true);
  });

  it('calculateDangerZone excludes captured/player-owned ballista tiles', () => {
    const scene = new BattleScene();
    scene.playerUnits = [];
    scene.enemyUnits = [];
    scene.npcUnits = [];
    scene.ballistas = [{ col: 10, row: 10, owner: 'player', captured: true }];
    scene.grid = {
      cols: 30,
      rows: 30,
      fogEnabled: false,
      isVisible: () => true,
    };

    const result = BattleScene.prototype.calculateDangerZone.call(scene);
    expect(result).toEqual([]);
  });

  it('calculateDangerZone excludes fog-hidden enemy ballistas', () => {
    const scene = new BattleScene();
    scene.playerUnits = [];
    scene.enemyUnits = [];
    scene.npcUnits = [];
    scene.ballistas = [{ col: 10, row: 10, owner: 'enemy', captured: false }];
    scene.grid = {
      cols: 30,
      rows: 30,
      fogEnabled: true,
      isVisible: () => false,
    };

    const result = BattleScene.prototype.calculateDangerZone.call(scene);
    expect(result).toEqual([]);
  });

  it('refreshes visible danger zone immediately when capturing a ballista', () => {
    const scene = new BattleScene();
    const unit = makeUnit({
      col: 5,
      row: 5,
      faction: 'player',
      weapon: null,
      inventory: [],
      consumables: [],
      skills: [],
    });

    scene.playerUnits = [unit];
    scene.enemyUnits = [];
    scene.npcUnits = [];
    scene.ballistas = [{ col: 5, row: 5, owner: 'enemy', captured: false }];
    scene.grid = {
      cols: 20,
      rows: 20,
      gridToPixel: vi.fn(() => ({ x: 80, y: 80 })),
    };
    scene.cameras = { main: { width: 800, height: 600 } };
    scene.isMobileInput = false;
    scene.add = {
      rectangle: vi.fn(() => ({
        setDepth: vi.fn().mockReturnThis(),
        setStrokeStyle: vi.fn().mockReturnThis(),
        destroy: vi.fn(),
      })),
    };
    scene._clampMenuPosition = vi.fn((x, y) => ({ x, y }));
    scene._pinToScreen = vi.fn();
    scene._makeMenuTextButton = vi.fn((_x, _y, label, _style, _color, onClick) => ({
      label,
      onClick,
      destroy: vi.fn(),
    }));
    scene.findAttackTargets = vi.fn(() => []);
    scene.getUsableStaves = vi.fn(() => []);
    scene.findHealTargets = vi.fn(() => []);
    scene._hasUsableWeaponArtTargets = vi.fn(() => false);
    scene.getUsableReclassConsumables = vi.fn(() => []);
    scene.findShoveTargets = vi.fn(() => []);
    scene.findPullTargets = vi.fn(() => []);
    scene.findTradeTargets = vi.fn(() => []);
    scene.findSwapTargets = vi.fn(() => []);
    scene.findDanceTargets = vi.fn(() => []);
    scene.findBreakTargets = vi.fn(() => []);
    scene.hideActionMenu = vi.fn();
    scene.commitVisionSnapshotIfPending = vi.fn();
    scene.finishUnitAction = vi.fn();
    scene.registry = { get: vi.fn(() => null) };
    scene.gameData = { classes: [], lords: [] };
    scene.battleConfig = { objective: 'rout' };
    scene.runManager = null;

    scene.dangerZone = { visible: true, show: vi.fn() };
    scene.dangerZoneCache = [{ col: 99, row: 99 }];
    scene.dangerZoneStale = false;
    scene.calculateDangerZone = vi.fn(() => [{ col: 4, row: 5 }]);

    BattleScene.prototype.showActionMenu.call(scene, unit);

    const captureCall = scene._makeMenuTextButton.mock.calls.find((call) => call[2] === 'Capture');
    expect(captureCall).toBeTruthy();

    const onCapture = captureCall[5];
    onCapture();

    expect(scene.ballistas[0].owner).toBe('player');
    expect(scene.ballistas[0].captured).toBe(true);
    expect(scene.calculateDangerZone).toHaveBeenCalledTimes(1);
    expect(scene.dangerZone.show).toHaveBeenCalledWith([{ col: 4, row: 5 }]);
    expect(scene.dangerZoneStale).toBe(false);
  });

  it('calculateDangerZone uses ENTITY_PRIMARY_ATTACK_RANGE for Entity enemies', () => {
    const scene = new BattleScene();
    // Entity at (3,3) — 3x3 body covers (3,3) to (5,5)
    const entity = makeUnit({
      col: 3,
      row: 3,
      faction: 'enemy',
      isEntity: true,
      inventory: [{ name: 'Eldritch Grasp', type: 'Sword', might: 15, range: '1-4' }],
      weapon: { name: 'Eldritch Grasp', type: 'Sword', might: 15, range: '1-4' },
    });
    scene.playerUnits = [];
    scene.enemyUnits = [entity];
    scene.npcUnits = [];
    scene.grid = {
      cols: 10,
      rows: 10,
      fogEnabled: false,
      isVisible: () => true,
      getMovementRange: vi.fn(() => new Map()),
      getAttackRange: vi.fn((col, row, weapon) => {
        // Return tiles at Manhattan distance 1-N from (col,row) based on weapon.range
        const tiles = [];
        const maxR = parseInt(weapon.range.split('-')[1] || weapon.range);
        for (let dc = -maxR; dc <= maxR; dc++) {
          for (let dr = -maxR; dr <= maxR; dr++) {
            const dist = Math.abs(dc) + Math.abs(dr);
            if (dist >= 1 && dist <= maxR && col + dc >= 0 && row + dr >= 0) {
              tiles.push({ col: col + dc, row: row + dr });
            }
          }
        }
        return tiles;
      }),
    };
    scene._getCostModifier = vi.fn(() => 0);
    scene.buildUnitPositionMap = BattleScene.prototype.buildUnitPositionMap;
    scene.unitPositions = new Map();

    const result = BattleScene.prototype.calculateDangerZone.call(scene);
    const keys = new Set(result.map((t) => `${t.col},${t.row}`));

    // Entity body: (3,3)-(5,5). ENTITY_PRIMARY_ATTACK_RANGE = 2.
    // Max threatened distance from any body tile = 2.
    // So (1,3) is 2 away from body tile (3,3) — should be IN.
    expect(keys.has('1,3')).toBe(true);
    // (0,3) is 3 away from body tile (3,3) — should NOT be in (range capped at 2).
    expect(keys.has('0,3')).toBe(false);

    // getAttackRange called with range '1-2', NOT '1-4'
    for (const call of scene.grid.getAttackRange.mock.calls) {
      expect(call[2].range).toBe('1-2');
    }

    // getMovementRange should NOT be called for Entity
    expect(scene.grid.getMovementRange).not.toHaveBeenCalled();
  });

  it('filters dead and removing units out of buildUnitPositionMap', () => {
    const scene = new BattleScene();
    scene.playerUnits = [
      makeUnit({ col: 1, row: 1, faction: 'player', currentHP: 20 }),
      makeUnit({ col: 2, row: 2, faction: 'player', currentHP: 0 }),
    ];
    scene.enemyUnits = [
      makeUnit({ col: 3, row: 1, faction: 'enemy', currentHP: 15, _removing: true }),
      makeUnit({ col: 0, row: 0, faction: 'enemy', currentHP: 15 }),
    ];
    scene.npcUnits = [null];

    const positions = BattleScene.prototype.buildUnitPositionMap.call(scene, 'player');

    expect(positions.has('1,1')).toBe(true);
    expect(positions.has('0,0')).toBe(true);
    expect(positions.has('2,2')).toBe(false);
    expect(positions.has('3,1')).toBe(false);
  });
});
