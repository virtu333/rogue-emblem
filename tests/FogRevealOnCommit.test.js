// Fog of war lifts only when a unit's action is committed on its new tile. A move
// that can still be undone must not reveal anything: not the fog overlay, not an
// enemy sprite, not an attack target (bug: move into fog, look, Back).
import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { Grid } from '../src/engine/Grid.js';
import { completeBattleAction } from '../src/ui/BattleActionCompletion.js';
import { completeResolvedAction } from '../src/ui/BattlePresentationCheckpoint.js';
import { EscapeObjectiveController } from '../src/ui/EscapeObjectiveController.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const PLAIN = gameData.terrain.findIndex((t) => t.name === 'Plain');
const SWORD = gameData.weapons.find((w) => w.name === 'Iron Sword');

function stub() {
  const obj = new Proxy({}, { get: (t, prop) => (prop in t ? t[prop] : () => obj) });
  return obj;
}

function sprite() {
  return {
    visible: false,
    setVisible: vi.fn(function (v) {
      this.visible = v;
    }),
  };
}

// A 12x3 plain strip. Edric (Infantry, vision 3) starts at (0,1); a brigand waits
// at (5,1), five steps away in the fog. From (4,1) he would see it and could strike.
function setup() {
  const map = Array.from({ length: 3 }, () => Array(12).fill(PLAIN));
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
    map,
    true,
  );
  grid.initFogOverlays?.();
  const edric = {
    name: 'Edric',
    faction: 'player',
    col: 0,
    row: 1,
    moveType: 'Infantry',
    currentHP: 20,
    stats: { MOV: 5, HP: 20 },
    weapon: SWORD,
    inventory: [SWORD],
    skills: [],
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
    grid,
    gameData,
    playerUnits: [edric],
    enemyUnits: [brigand],
    npcUnits: [],
    battleParams: { tutorialMode: false },
    battleState: 'UNIT_MOVING',
    turnManager: { currentPhase: 'player', unitActed: vi.fn(), endPlayerPhase: vi.fn() },
    registry: { get: () => null },
  });
  for (const name of [
    'showActionMenu',
    'hideActionMenu',
    'hideForecast',
    'cleanupTradeUI',
    'dimUnit',
    'refreshEndTurnControl',
    'refreshVisibleDangerZone',
    '_clearSelectedWeaponArt',
    '_clearCombatRollSession',
    'commitVisionSnapshotIfPending',
    'updateObjectiveText',
    'removeUnitGraphic',
  ])
    scene[name] = vi.fn();
  scene.isStoryInputLocked = () => false;
  scene._isTutorialStrictGateActive = () => false;
  scene.canForceEndTurn = () => true;
  scene.checkBattleEnd = () => false;
  // The suspend save records whether the brigand's tile was lit when it was taken.
  scene.saved = [];
  scene._captureSuspendCheckpoint = vi.fn(() => scene.saved.push(grid.isVisible(5, 1)));
  grid.updateFogOfWar(scene.playerUnits);
  scene.updateEnemyVisibility();
  return { scene, grid, edric, brigand };
}

/** Walk Edric to (4,1) the way moveUnit does: snapshot, arrive, afterMove. */
async function moveNextToBrigand(scene, edric) {
  scene.preMoveLoc = { col: edric.col, row: edric.row };
  scene._preFogSnapshot = scene.grid.snapshotFogState();
  edric.col = 4;
  edric.hasMoved = true;
  await scene.afterMove(edric);
}

describe('fog lifts only once an action is committed', () => {
  it('starts with the brigand hidden in fog', () => {
    const { grid, brigand } = setup();
    expect(grid.isVisible(5, 1)).toBe(false);
    expect(brigand.graphic.visible).toBe(false);
  });

  it('a move reveals nothing: no fog lifted, no sprite, no attack target', async () => {
    const { scene, grid, edric, brigand } = setup();
    const everSeen = new Set(grid.everSeenSet);
    await moveNextToBrigand(scene, edric);
    expect(scene.showActionMenu).toHaveBeenCalledWith(edric);
    expect(grid.isVisible(5, 1)).toBe(false);
    expect(grid.isVisible(4, 1)).toBe(false);
    expect(new Set(grid.everSeenSet)).toEqual(everSeen);
    expect(brigand.graphic.visible).toBe(false);
    expect(scene.findAttackTargets(edric, { weapon: SWORD })).toEqual([]);
  });

  it('backing out of the move leaves no trace', async () => {
    const { scene, grid, edric, brigand } = setup();
    const everSeen = new Set(grid.everSeenSet);
    scene.selectUnit = vi.fn();
    scene.updateUnitPosition = vi.fn();
    await moveNextToBrigand(scene, edric);
    scene.undoMove(edric);
    expect([edric.col, edric.row]).toEqual([0, 1]);
    expect(grid.isVisible(5, 1)).toBe(false);
    expect(new Set(grid.everSeenSet)).toEqual(everSeen);
    expect(brigand.graphic.setVisible).not.toHaveBeenCalledWith(true);
  });

  it('Wait on the new tile lifts the fog before the suspend save', async () => {
    const { scene, grid, edric, brigand } = setup();
    await moveNextToBrigand(scene, edric);
    scene.finishUnitAction(edric, { skipCanto: true });
    expect(grid.isVisible(5, 1)).toBe(true);
    expect(grid.everSeenSet.has('5,1')).toBe(true);
    expect(brigand.graphic.visible).toBe(true);
    expect(scene.saved).toEqual([true]);
    expect(scene.turnManager.unitActed).toHaveBeenCalledWith(edric);
  });

  it('completing an action directly (staff, item, talk...) reveals too', async () => {
    const { scene, grid, edric } = setup();
    await moveNextToBrigand(scene, edric);
    completeBattleAction(scene, edric);
    expect(grid.isVisible(5, 1)).toBe(true);
    expect(scene.saved).toEqual([true]);
  });

  it('Canto: the acting tile is revealed before the Canto range is drawn', async () => {
    const { scene, grid, edric } = setup();
    edric.skills = ['canto'];
    edric._movementSpent = 4;
    let litAtCanto = null;
    scene.startCantoMove = vi.fn(() => {
      litAtCanto = grid.isVisible(5, 1);
    });
    await moveNextToBrigand(scene, edric);
    scene.finishUnitAction(edric);
    expect(scene.startCantoMove).toHaveBeenCalledWith(edric, 1);
    expect(litAtCanto).toBe(true);
  });

  it('End Turn with a moved unit that never acted reveals before the enemy phase', async () => {
    const { scene, grid, edric } = setup();
    let litAtPhaseEnd = null;
    scene.turnManager.endPlayerPhase = vi.fn(() => {
      litAtPhaseEnd = grid.isVisible(5, 1);
    });
    await moveNextToBrigand(scene, edric);
    scene.battleState = 'UNIT_ACTION_MENU';
    scene.forceEndTurn();
    expect(litAtPhaseEnd).toBe(true);
    expect(scene.saved).toEqual([true]);
  });

  it('an action whose unit is gone (fell in combat) still settles vision before the save', () => {
    const { scene, grid, edric } = setup();
    // Another ally stands at (4,1); the fog there has not been refreshed yet.
    scene.playerUnits.push({ ...edric, name: 'Sera', col: 4, row: 1 });
    expect(grid.isVisible(5, 1)).toBe(false);
    completeResolvedAction(scene, { kind: 'combat', unitName: 'Ghost' });
    expect(scene.saved).toEqual([true]);
  });

  it('Escape: vision comes from those still on the field, before the save', async () => {
    const { scene, grid, edric } = setup();
    const sera = { ...edric, name: 'Sera', col: 0, row: 0 };
    scene.playerUnits.push(sera);
    await moveNextToBrigand(scene, edric);
    const escape = new EscapeObjectiveController(scene);
    escape.getEvacGold = () => 0;
    escape._showEscapeFloat = () => {};
    escape.executeEscape(edric);
    expect(scene.playerUnits).toEqual([sera]);
    // Edric left from (4,1): his path never lit the brigand's tile.
    expect(grid.isVisible(5, 1)).toBe(false);
    expect(grid.everSeenSet.has('5,1')).toBe(false);
    expect(scene.saved).toEqual([false]);
    expect(scene.turnManager.unitActed).toHaveBeenCalledWith(edric);
  });
});
