// Canto confirm (playtest Sep 2026): a Canto move is not settled by the tap. The unit
// stands on its new tile in CANTO_CONFIRM; Wait ends its turn there, Back returns it
// to where the Canto began. Until Wait, nothing may be committed: no fog lifted, no
// village, no save, no phase progress, no history beat.
import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { createUnit } from '../src/engine/UnitManager.js';
import { RunManager } from '../src/engine/RunManager.js';
import {
  captureResolvedAction,
  completeResolvedAction,
} from '../src/ui/BattlePresentationCheckpoint.js';
import { Grid } from '../src/engine/Grid.js';
import { openMenuCommand } from '../src/ui/battleMenuModel.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const terrainIndex = (name) => gameData.terrain.findIndex((t) => t.name === name);
const PLAIN = terrainIndex('Plain');
const FOREST = terrainIndex('Forest');
const SWORD = gameData.weapons.find((w) => w.name === 'Iron Sword');

function stub() {
  const obj = new Proxy({}, { get: (t, prop) => (prop in t ? t[prop] : () => obj) });
  return obj;
}

const sprite = () => ({
  visible: false,
  setVisible: vi.fn(function (v) {
    this.visible = v;
  }),
});

/**
 * A 12x3 strip with fog. Edric (Infantry with Canto, vision 3) starts the Canto at
 * (0,1) with `remaining` movement left; a brigand waits hidden at (5,1).
 */
function setup({ remaining = 4, map = null } = {}) {
  const layout = map || Array.from({ length: 3 }, () => Array(12).fill(PLAIN));
  const scene = new BattleScene();
  const grid = new Grid(
    {
      cameras: { main: { width: 640, height: 480 } },
      add: { rectangle: stub, image: stub, text: stub, container: stub },
      textures: { exists: () => false },
    },
    12,
    3,
    gameData.terrain,
    layout,
    true,
  );
  grid.initFogOverlays?.();
  const edric = {
    name: 'Edric',
    battleEntityId: 'edric-1',
    faction: 'player',
    col: 0,
    row: 1,
    moveType: 'Infantry',
    currentHP: 20,
    hasActed: true,
    stats: { MOV: 5, HP: 20 },
    mov: 5,
    _movementSpent: 5 - remaining,
    weapon: SWORD,
    inventory: [SWORD],
    skills: ['canto'],
    graphic: { clearTint: vi.fn(), setTint: vi.fn(), setAlpha: vi.fn() },
  };
  const brigand = {
    name: 'Brigand',
    faction: 'enemy',
    col: 5,
    row: 1,
    currentHP: 20,
    stats: { HP: 20 },
    graphic: sprite(),
  };
  Object.assign(scene, {
    _battleSession: 1,
    grid,
    gameData,
    playerUnits: [edric],
    enemyUnits: [brigand],
    npcUnits: [],
    battleParams: {},
    battleState: 'UNIT_MOVING',
    selectedUnit: edric,
    runManager: { battleInProgress: true },
    turnManager: { currentPhase: 'player', unitActed: vi.fn(), endPlayerPhase: vi.fn() },
    registry: { get: () => null },
    scene: { isActive: () => true },
    time: { delayedCall: vi.fn(() => ({})) },
    tweens: {
      add: vi.fn((cfg) => {
        cfg.onComplete?.();
        return {};
      }),
    },
    _villageController: { handleUnitActionEnd: vi.fn(), getWaitNote: () => null },
  });
  for (const name of [
    'updateUnitPosition',
    '_drawActionMenuRows',
    'refreshEndTurnControl',
    'dimUnit',
    'hideForecast',
    'cleanupTradeUI',
    '_clearSelectedWeaponArt',
    '_clearCombatRollSession',
    'commitVisionSnapshotIfPending',
    'updateObjectiveText',
    'refreshVisibleDangerZone',
    '_hideMenuTooltip',
    '_hideWeaponDetailTooltip',
  ])
    scene[name] = vi.fn();
  scene.isStoryInputLocked = () => false;
  scene._isPrologueGateActive = () => false;
  scene.checkBattleEnd = () => false;
  // The suspend save records whether the brigand's tile was lit when it was taken.
  scene.saved = [];
  scene._captureSuspendCheckpoint = vi.fn(() => scene.saved.push(grid.isVisible(5, 1)));
  grid.updateFogOfWar(scene.playerUnits);
  scene.updateEnemyVisibility();
  scene.updateEnemyVisibility = vi.fn(BattleScene.prototype.updateEnemyVisibility);
  // The Canto begins the way finishUnitAction starts it.
  scene.startCantoMove(edric, remaining);
  return { scene, grid, edric, brigand };
}

const beatTypes = (scene) => (scene._historyBeats || []).map((b) => b.type);

/** Tap a Canto tile, then land in the confirm. */
function cantoTo(scene, col, row = 1) {
  scene.handleCantoClick({ col, row });
}

describe('Canto confirm', () => {
  it('a Canto tap moves the unit and waits for confirmation, settling nothing', () => {
    const { scene, grid, edric, brigand } = setup();
    expect(scene.battleState).toBe('CANTO_MOVING');
    cantoTo(scene, 4);

    expect(scene.battleState).toBe('CANTO_CONFIRM');
    expect(scene.selectedUnit).toBe(edric);
    expect([edric.col, edric.row]).toEqual([4, 1]);
    // Nothing is committed: the phase, the save, the village, the fog, the history.
    expect(scene.turnManager.unitActed).not.toHaveBeenCalled();
    expect(scene._captureSuspendCheckpoint).not.toHaveBeenCalled();
    expect(scene._villageController.handleUnitActionEnd).not.toHaveBeenCalled();
    expect(scene.dimUnit).not.toHaveBeenCalled();
    expect(grid.isVisible(5, 1)).toBe(false);
    expect(brigand.graphic.visible).toBe(false);
    expect(scene.updateEnemyVisibility).not.toHaveBeenCalled();
    expect(beatTypes(scene)).toEqual([]);
    // The one command on offer is Wait.
    const wait = openMenuCommand(scene, 'wait');
    expect(wait?.label).toBe('Wait');
    expect(scene._actionMenuPublished.items.map((i) => i.id)).toEqual(['wait']);
  });

  it('a stale Wait callback after Back cannot settle a later Canto choice', () => {
    const { scene } = setup();
    cantoTo(scene, 3);
    const stale = openMenuCommand(scene, 'wait');
    scene.undoCantoMove();
    stale.onActivate();
    expect(scene.battleState).toBe('CANTO_MOVING');
    cantoTo(scene, 2);
    stale.onActivate();
    expect(scene.battleState).toBe('CANTO_CONFIRM');
    expect(scene.turnManager.unitActed).not.toHaveBeenCalled();
    openMenuCommand(scene, 'wait').onActivate();
    stale.onActivate();
    expect(scene.turnManager.unitActed).toHaveBeenCalledTimes(1);
  });

  it('Wait completes exactly once at the new tile, with one moved beat', () => {
    const { scene, grid, edric, brigand } = setup();
    cantoTo(scene, 4);
    // The published menu item is what the rail / keyboard activate; it needs a live menu.
    scene.actionMenu = [];
    scene._registerActionMenu(
      [
        {
          id: 'wait',
          label: 'Wait',
          status: null,
          description: null,
          note: null,
          item: null,
          disabled: false,
          color: null,
          invoke: () => scene.confirmCantoMove(),
        },
      ],
      { state: 'CANTO_CONFIRM' },
    );
    openMenuCommand(scene, 'wait').onActivate();

    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(scene.selectedUnit).toBeNull();
    expect(scene._cantoPending).toBeNull();
    expect([edric.col, edric.row]).toEqual([4, 1]);
    expect(edric.hasActed).toBe(true);
    expect(scene.turnManager.unitActed).toHaveBeenCalledTimes(1);
    expect(scene.turnManager.unitActed).toHaveBeenCalledWith(edric);
    expect(scene._villageController.handleUnitActionEnd).toHaveBeenCalledTimes(1);
    expect(scene._villageController.handleUnitActionEnd).toHaveBeenCalledWith(edric);
    expect(scene.dimUnit).toHaveBeenCalledTimes(1);
    // The fog lifted from the new tile before the one save.
    expect(grid.isVisible(5, 1)).toBe(true);
    expect(brigand.graphic.visible).toBe(true);
    expect(scene.saved).toEqual([true]);
    // The walk is history: one moved beat (and no stand-in 'waited').
    expect(beatTypes(scene)).toEqual(['moved']);
    expect(scene._historyBeats[0].path.at(0)).toEqual({ col: 0, row: 1 });
    expect(scene._historyBeats[0].path.at(-1)).toEqual({ col: 4, row: 1 });
  });

  it('a second confirm after completing does nothing', () => {
    const { scene } = setup();
    cantoTo(scene, 4);
    scene.confirmCantoMove();
    scene.confirmCantoMove();
    expect(scene.turnManager.unitActed).toHaveBeenCalledTimes(1);
    expect(scene._captureSuspendCheckpoint).toHaveBeenCalledTimes(1);
  });

  it('Back returns the unit to where Canto began with the same budget, recording nothing', () => {
    const { scene, grid, edric } = setup({ remaining: 4 });
    const rangeBefore = [...scene.cantoRange.keys()].sort();
    cantoTo(scene, 3);
    expect(scene.battleState).toBe('CANTO_CONFIRM');

    scene.handleCancel();

    expect(scene.battleState).toBe('CANTO_MOVING');
    expect(scene.selectedUnit).toBe(edric);
    expect([edric.col, edric.row]).toEqual([0, 1]);
    expect(edric.hasActed).toBe(true);
    expect(scene._cantoPending).toBeNull();
    expect(scene._cantoRemaining).toBe(4);
    // The same range as before: nothing was spent by the undone step.
    expect([...scene.cantoRange.keys()].sort()).toEqual(rangeBefore);
    expect(scene.cantoRange.has('4,1')).toBe(true);
    expect(scene.cantoRange.has('5,1')).toBe(false);
    expect(scene.turnManager.unitActed).not.toHaveBeenCalled();
    expect(scene._captureSuspendCheckpoint).not.toHaveBeenCalled();
    expect(scene._villageController.handleUnitActionEnd).not.toHaveBeenCalled();
    expect(grid.isVisible(5, 1)).toBe(false);
    expect(beatTypes(scene)).toEqual([]);
    // And the unit can still Canto after the undo, ending in the confirm again.
    cantoTo(scene, 4);
    expect(scene.battleState).toBe('CANTO_CONFIRM');
    scene.confirmCantoMove();
    expect(beatTypes(scene)).toEqual(['moved']);
    expect(scene.turnManager.unitActed).toHaveBeenCalledTimes(1);
  });

  it('Back through requestCancel undoes too', () => {
    const { scene, edric } = setup();
    scene.canRequestCancel = () => true;
    cantoTo(scene, 3);
    scene.requestCancel();
    expect(scene.battleState).toBe('CANTO_MOVING');
    expect([edric.col, edric.row]).toEqual([0, 1]);
  });

  it("tapping the unit's own tile confirms", () => {
    const { scene, edric } = setup();
    cantoTo(scene, 4);
    scene.handleCantoConfirmClick({ col: 4, row: 1 });
    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect([edric.col, edric.row]).toEqual([4, 1]);
    expect(scene.turnManager.unitActed).toHaveBeenCalledTimes(1);
    expect(beatTypes(scene)).toEqual(['moved']);
  });

  it('tapping another tile of the original range moves there and asks again', () => {
    const { scene, edric } = setup();
    cantoTo(scene, 4);
    scene.handleCantoConfirmClick({ col: 2, row: 1 });

    expect(scene.battleState).toBe('CANTO_CONFIRM');
    expect([edric.col, edric.row]).toEqual([2, 1]);
    expect(scene.turnManager.unitActed).not.toHaveBeenCalled();
    expect(beatTypes(scene)).toEqual([]);
    scene.confirmCantoMove();
    // Only the walk to the final tile is history, from where the Canto began.
    expect(beatTypes(scene)).toEqual(['moved']);
    expect(scene._historyBeats[0].path.at(0)).toEqual({ col: 0, row: 1 });
    expect(scene._historyBeats[0].path.at(-1)).toEqual({ col: 2, row: 1 });
    expect(scene.turnManager.unitActed).toHaveBeenCalledTimes(1);
  });

  it('a range tile is measured from the origin, not from the tile the unit stands on', () => {
    // From (0,1) with 4 movement, (0,1)+4 = (4,1) is in range; from (4,1) it would not be.
    const { scene, edric } = setup({ remaining: 4 });
    cantoTo(scene, 4);
    scene.handleCantoConfirmClick({ col: 1, row: 1 });
    expect([edric.col, edric.row]).toEqual([1, 1]);
    scene.handleCantoConfirmClick({ col: 4, row: 1 });
    expect([edric.col, edric.row]).toEqual([4, 1]);
    expect(scene.battleState).toBe('CANTO_CONFIRM');
  });

  it('tapping the origin tile returns to the choice without settling', () => {
    const { scene, edric } = setup();
    cantoTo(scene, 3);
    scene.handleCantoConfirmClick({ col: 0, row: 1 });
    expect(scene.battleState).toBe('CANTO_MOVING');
    expect([edric.col, edric.row]).toEqual([0, 1]);
    expect(scene.turnManager.unitActed).not.toHaveBeenCalled();
    expect(beatTypes(scene)).toEqual([]);
  });

  it('a tap outside the original range does nothing', () => {
    const { scene, edric } = setup({ remaining: 4 });
    cantoTo(scene, 4);
    scene.handleCantoConfirmClick({ col: 9, row: 1 });
    expect(scene.battleState).toBe('CANTO_CONFIRM');
    expect([edric.col, edric.row]).toEqual([4, 1]);
    expect(scene.turnManager.unitActed).not.toHaveBeenCalled();
  });

  it('a move stopped by a hidden foe completes at once (the sight is locked in)', () => {
    const { scene, grid, edric, brigand } = setup({ remaining: 6 });
    scene.showMinorHintAt = vi.fn();
    scene._resolveAmbush = vi.fn(BattleScene.prototype._resolveAmbush);
    cantoTo(scene, 6);

    // Stopped short of the brigand at (5,1); no confirm step.
    expect([edric.col, edric.row]).toEqual([4, 1]);
    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(scene._resolveAmbush).toHaveBeenCalledTimes(1);
    expect(scene.turnManager.unitActed).toHaveBeenCalledTimes(1);
    expect(scene._captureSuspendCheckpoint).toHaveBeenCalledTimes(1);
    expect(grid.isVisible(5, 1)).toBe(true);
    expect(brigand.graphic.visible).toBe(true);
    expect(beatTypes(scene)).toContain('moved');
    expect(beatTypes(scene).filter((t) => t === 'moved')).toHaveLength(1);
  });

  it('End Turn during the confirm settles the unit where it stands, once', () => {
    const { scene, grid, edric } = setup();
    cantoTo(scene, 4);
    scene.forceEndTurn();

    expect(edric.hasActed).toBe(true);
    expect([edric.col, edric.row]).toEqual([4, 1]);
    expect(scene.selectedUnit).toBeNull();
    expect(scene._cantoPending).toBeNull();
    expect(scene.turnManager.unitActed).toHaveBeenCalledTimes(1);
    expect(scene.turnManager.unitActed).toHaveBeenCalledWith(edric);
    expect(scene.turnManager.endPlayerPhase).not.toHaveBeenCalled();
    expect(scene._villageController.handleUnitActionEnd).toHaveBeenCalledTimes(1);
    expect(grid.isVisible(5, 1)).toBe(true);
    expect(scene.saved).toEqual([true]);
    expect(beatTypes(scene)).toEqual(['moved']);
  });

  it('the W key / mobile Menu (the wait action) confirms in CANTO_CONFIRM', () => {
    // The scene's `wait` input action is an inline closure; the confirm it reaches is
    // confirmCantoMove, which only acts in CANTO_CONFIRM.
    const { scene, edric } = setup();
    scene.confirmCantoMove(); // still CANTO_MOVING: ignored
    expect(scene.turnManager.unitActed).not.toHaveBeenCalled();
    cantoTo(scene, 4);
    scene.confirmCantoMove();
    expect(scene.turnManager.unitActed).toHaveBeenCalledTimes(1);
    expect(edric.hasActed).toBe(true);
  });

  it('Canto range is charged terrain: Infantry forest costs 2 (terrain.json)', () => {
    // (1,1) is forest, cost 2 for Infantry. With 3 movement left: (2,1) costs 2+1 = 3 (in),
    // (3,1) costs 2+1+1 = 4 (out); the plain tile behind the forest is not a free step.
    const map = Array.from({ length: 3 }, () => Array(12).fill(PLAIN));
    map[1][1] = FOREST;
    const { scene } = setup({ remaining: 3, map });
    expect(scene.cantoRange.has('1,1')).toBe(true);
    expect(scene.cantoRange.has('2,1')).toBe(true);
    expect(scene.cantoRange.has('3,1')).toBe(false);
  });

  it('completes every Canto above through the real path, never the error recovery', () => {
    // A finalize error would still end the turn (via failCantoMove), hiding a bug behind
    // green outcomes; the flows above must not log one.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { scene } = setup();
    cantoTo(scene, 4);
    scene.handleCantoConfirmClick({ col: 2, row: 1 });
    scene.handleCancel();
    cantoTo(scene, 3);
    scene.confirmCantoMove();
    expect(errors).not.toHaveBeenCalled();
    expect(warns).not.toHaveBeenCalled();
    expect(scene.turnManager.unitActed).toHaveBeenCalledTimes(1);
    errors.mockRestore();
    warns.mockRestore();
  });
});

// "Canto ignores terrain" (playtest) is not a range bug: the range is the real Grid's,
// and the budget is what the unit had left, MOV as its move range read it.
describe('Canto budget and terrain (real Grid)', () => {
  function cavalrySetup({ mov = 8, statMov = 7, spent = 0, map }) {
    const { scene, edric } = setup({ map });
    Object.assign(edric, {
      moveType: 'Cavalry',
      mov,
      stats: { ...edric.stats, MOV: statMov },
      _movementSpent: spent,
      hasActed: false,
      col: 0,
      row: 1,
    });
    scene.hideActionMenu = vi.fn();
    scene.startCantoMove = vi.fn(BattleScene.prototype.startCantoMove);
    scene.cantoRange = null;
    scene.battleState = 'UNIT_ACTION_MENU';
    return { scene, edric };
  }

  it('finishUnitAction hands Canto unit.mov minus movement spent, not stats.MOV', () => {
    const { scene, edric } = cavalrySetup({ mov: 8, statMov: 7, spent: 3 });
    scene.finishUnitAction(edric, { session: scene._battleSession });
    // 8 - 3 = 5 (stats.MOV would have given 4).
    expect(scene.startCantoMove).toHaveBeenCalledTimes(1);
    expect(scene.startCantoMove).toHaveBeenCalledWith(edric, 5);
    expect(scene.battleState).toBe('CANTO_MOVING');
    expect(scene.turnManager.unitActed).not.toHaveBeenCalled();
  });

  it('falls back to stats.MOV when the unit carries no mov', () => {
    const { scene, edric } = cavalrySetup({ mov: null, statMov: 7, spent: 2 });
    scene.finishUnitAction(edric, { session: scene._battleSession });
    expect(scene.startCantoMove).toHaveBeenCalledWith(edric, 5);
  });

  it('a unit that spent its whole move gets no Canto and completes', () => {
    const { scene, edric } = cavalrySetup({ mov: 8, statMov: 7, spent: 8 });
    scene.finishUnitAction(edric, { session: scene._battleSession });
    expect(scene.startCantoMove).not.toHaveBeenCalled();
    expect(scene.turnManager.unitActed).toHaveBeenCalledWith(edric);
  });

  it('a Cavalry Canto range respects forest (cost 3) and plain (cost 1)', () => {
    // 8 MOV, 6 spent: 2 left. Forest at (1,1) costs Cavalry 3, so it is out of range, and
    // so is everything only reachable through it; a plain path round it (row 0/2) costs more.
    const map = Array.from({ length: 3 }, () => Array(12).fill(PLAIN));
    map[1][1] = FOREST;
    const { scene, edric } = cavalrySetup({ mov: 8, statMov: 8, spent: 6, map });
    scene.finishUnitAction(edric, { session: scene._battleSession });
    const range = scene.cantoRange;
    expect(scene.startCantoMove).toHaveBeenCalledWith(edric, 2);
    expect(range.has('1,1')).toBe(false); // forest: 3 > 2
    expect(range.has('2,1')).toBe(false); // behind it: cannot be reached in 2 either way
    expect(range.has('0,0')).toBe(true); // one plain step
    expect(range.has('1,0')).toBe(true); // two plain steps
    expect(range.has('0,2')).toBe(true);
    expect(range.has('2,0')).toBe(false); // three plain steps
  });

  it('with 3 left the same Cavalry can enter the forest but goes no further through it', () => {
    const map = Array.from({ length: 3 }, () => Array(12).fill(PLAIN));
    map[1][1] = FOREST;
    const { scene, edric } = cavalrySetup({ mov: 8, statMov: 8, spent: 5, map });
    scene.finishUnitAction(edric, { session: scene._battleSession });
    expect(scene.cantoRange.has('1,1')).toBe(true);
    expect(scene.cantoRange.get('1,1').cost).toBe(3);
    expect(scene.cantoRange.has('2,1')).toBe(false);
  });
});

describe('Danger during Canto', () => {
  for (const confirm of [false, true]) {
    it(`toggle/pin preserves Canto and fog before ${confirm ? 'Wait' : 'moving'}`, () => {
      const { scene, edric, grid } = setup();
      if (confirm) cantoTo(scene, 3);
      let visible = false;
      scene.dangerZone = {
        get visible() {
          return visible;
        },
        toggle: vi.fn(() => {
          visible = !visible;
        }),
        show: vi.fn(() => {
          visible = true;
        }),
      };
      scene.calculateDangerZone = vi.fn(() => [{ col: 1, row: 1 }]);
      const pending = scene._cantoPending;
      const before = {
        state: scene.battleState,
        col: edric.col,
        row: edric.row,
        range: scene.cantoRange,
      };
      const rng = vi.spyOn(Math, 'random');
      scene._onDangerClick();
      expect(visible).toBe(true);
      scene._onDangerClick();
      expect(visible).toBe(false);
      scene.togglePersistentDanger();
      expect(scene.keepDangerVisible).toBe(true);
      expect({
        state: scene.battleState,
        col: edric.col,
        row: edric.row,
        range: scene.cantoRange,
      }).toEqual(before);
      expect(scene._cantoPending).toBe(pending);
      expect(grid.isVisible(5, 1)).toBe(false);
      expect(rng).not.toHaveBeenCalled();
      rng.mockRestore();
      if (confirm) scene.undoCantoMove();
      expect(scene.keepDangerVisible).toBe(true);
      cantoTo(scene, 2);
      scene.confirmCantoMove();
      expect(scene.keepDangerVisible).toBe(true);
      expect(scene.turnManager.unitActed).toHaveBeenCalledTimes(1);
    });
  }
  it('routes legacy Canto controls separately from target selection', () => {
    const { scene } = setup();
    scene.isMobileInput = true;
    scene.game = { events: { emit: vi.fn() } };
    for (const [state, context] of [
      ['CANTO_MOVING', 'battle_canto'],
      ['CANTO_CONFIRM', 'battle_canto'],
      ['SELECTING_TARGET', 'battle_target'],
      ['SELECTING_HEAL_TARGET', 'battle_target'],
      ['UNIT_ACTION_MENU', 'battle_action'],
    ]) {
      scene.battleState = state;
      scene._emitMobileContext();
      expect(scene.game.events.emit).toHaveBeenLastCalledWith('mobile:setContext', { context });
    }
  });
  it('suppresses Danger during target selection, forecast, story and tutorial gates', () => {
    const { scene } = setup();
    scene.dangerZone = { toggle: vi.fn(), show: vi.fn() };
    scene.calculateDangerZone = vi.fn();
    for (const state of ['SELECTING_TARGET', 'SELECTING_HEAL_TARGET', 'SHOWING_FORECAST']) {
      scene.battleState = state;
      scene._onDangerClick();
      scene.togglePersistentDanger();
    }
    scene.battleState = 'CANTO_CONFIRM';
    scene.isStoryInputLocked = () => true;
    scene._onDangerClick();
    scene.isStoryInputLocked = () => false;
    scene._isPrologueGateActive = () => true;
    scene.togglePersistentDanger();
    expect(scene.calculateDangerZone).not.toHaveBeenCalled();
    expect(scene.dangerZone.toggle).not.toHaveBeenCalled();
    expect(scene.dangerZone.show).not.toHaveBeenCalled();
  });
});

// Real run checkpoint and JSON restore, at the two distinct rollback boundaries.
function withPersistence(scene, edric) {
  for (const unit of [...scene.playerUnits, ...scene.enemyUnits]) {
    const original = { ...unit };
    const full = createUnit(
      gameData.classes.find(
        (c) => c.name === (unit.faction === 'player' ? 'Mercenary' : 'Fighter'),
      ),
      1,
      gameData.weapons,
      { name: unit.name },
    );
    Object.assign(unit, full, original, { stats: { ...full.stats, ...original.stats } });
  }
  edric.battleEntityId = 'u1';
  scene.runManager = new RunManager(gameData);
  scene.runManager.startRun({ runSeed: 42, applyBlessingsAtStart: false });
  scene.runManager.beginBattleInProgress('act1_test');
  scene.reseedBattleRng = vi.fn();
  scene._persistBattleRunState = () => ({ ok: true });
  scene._captureSuspendCheckpoint = BattleScene.prototype._captureSuspendCheckpoint.bind(scene);
  for (const name of [
    'commitVisionSnapshotIfPending',
    '_clearCombatRollSession',
    '_clearSelectedWeaponArt',
    'updateObjectiveText',
    'updateVisionHud',
    'updateHPBar',
  ])
    scene[name] = vi.fn();
  scene.showBriefBanner = async () => {};
  scene.addUnitGraphic = (unit) => {
    unit.graphic = { clearTint: vi.fn(), setTint: vi.fn(), setAlpha: vi.fn(), setVisible: vi.fn() };
  };
}
function restoreSavedScene(scene) {
  const saved = JSON.parse(JSON.stringify(scene.runManager.toJSON()));
  scene.runManager = RunManager.fromJSON(saved, gameData);
  const cp = scene.runManager.battleInProgress.checkpoint;
  scene.playerUnits = [];
  scene.enemyUnits = [];
  scene.npcUnits = [];
  scene.selectedUnit = null;
  scene._cantoPending = null;
  scene.cantoRange = null;
  const controller = new BattleSuspendController(scene);
  controller.applyUnits(cp);
  controller.finalizeResume(cp);
  return cp;
}
describe('Canto confirm checkpoint rollback', () => {
  it('after combat restores its resolved HP/uses at the origin, then offers Canto again', () => {
    const { scene, edric, grid } = setup({ remaining: 3 });
    withPersistence(scene, edric);
    edric.currentHP = 17;
    edric.weapon = { ...SWORD, uses: 8, uid: 'test-sword' };
    edric.inventory = [edric.weapon];
    const continuation = { kind: 'combat', unitId: 'u1', unitName: edric.name };
    captureResolvedAction(scene, continuation, { session: scene._battleSession });
    completeResolvedAction(scene, continuation, { session: scene._battleSession });
    cantoTo(scene, 3);
    expect(scene.battleState).toBe('CANTO_CONFIRM');
    const cp = restoreSavedScene(scene);
    const restored = scene.playerUnits[0];
    expect(cp.pendingActionCompletion.kind).toBe('combat');
    expect(scene.battleState).toBe('CANTO_MOVING');
    expect([restored.col, restored.row, restored.currentHP, restored.weapon.uses]).toEqual([
      0, 1, 17, 8,
    ]);
    expect(restored.weapon).toBe(restored.inventory[0]);
    expect(scene._cantoRemaining).toBe(3);
    expect(scene._cantoPending).toBeNull();
    expect(grid.isVisible(5, 1)).toBe(false);
  });
  it('after a consumable restores its settled HP and uses at the origin, then offers Canto again', async () => {
    const { scene, edric, grid } = setup({ remaining: 3 });
    withPersistence(scene, edric);
    edric.hasActed = false;
    edric.currentHP = 8;
    const item = { name: 'Vulnerary', effect: 'heal', value: 10, uses: 3 };
    edric.consumables = [item];
    scene.battleState = 'PLAYER_IDLE';
    scene._captureSuspendCheckpoint({ session: scene._battleSession });
    await scene.useConsumable(edric, item);
    expect([edric.currentHP, item.uses, scene.battleState]).toEqual([18, 2, 'CANTO_MOVING']);
    cantoTo(scene, 3);
    expect(scene.battleState).toBe('CANTO_CONFIRM');
    const cp = restoreSavedScene(scene);
    expect(cp.pendingActionCompletion).toEqual({
      kind: 'finish',
      unitId: 'u1',
      unitName: edric.name,
      skipCanto: false,
    });
    expect(scene.battleState).toBe('CANTO_MOVING');
    expect(scene._cantoRemaining).toBe(3);
    expect(scene._cantoPending).toBeNull();
    const restored = scene.playerUnits[0];
    expect([restored.col, restored.row, restored.currentHP, restored.consumables[0].uses]).toEqual([
      0, 1, 18, 2,
    ]);
    expect(restored.hasActed).toBe(true);
    expect(grid.isVisible(5, 1)).toBe(false);
  });
});
