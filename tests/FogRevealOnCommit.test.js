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
import { AbilityController } from '../src/ui/AbilityController.js';
import { HealController } from '../src/ui/HealController.js';
import { seenTileOccupant } from '../src/engine/BattleInformation.js';
import { getRelocationTiles } from '../src/engine/StaffRelocation.js';
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
    _battleSession: 1,
    grid,
    gameData,
    playerUnits: [edric],
    enemyUnits: [brigand],
    npcUnits: [],
    battleParams: {},
    battleState: 'UNIT_MOVING',
    turnManager: {
      currentPhase: 'player',
      unitActed: vi.fn(),
      endPlayerPhase: vi.fn(),
      checkPlayerPhaseComplete: vi.fn(),
    },
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
  scene._isPrologueGateActive = () => false;
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
    scene.finishUnitAction(edric, { skipCanto: true, session: scene._battleSession });
    expect(grid.isVisible(5, 1)).toBe(true);
    expect(grid.everSeenSet.has('5,1')).toBe(true);
    expect(brigand.graphic.visible).toBe(true);
    expect(scene.saved).toEqual([true]);
    expect(scene.turnManager.unitActed).toHaveBeenCalledWith(edric);
  });

  it('completing an action directly (staff, item, talk...) reveals too', async () => {
    const { scene, grid, edric } = setup();
    await moveNextToBrigand(scene, edric);
    completeBattleAction(scene, edric, { session: scene._battleSession });
    expect(grid.isVisible(5, 1)).toBe(true);
    expect(scene.saved).toEqual([true]);
  });

  it('Canto: the fog stays until Canto ends, then lifts with the save', async () => {
    const { scene, grid, edric } = setup();
    edric.skills = ['canto'];
    edric._movementSpent = 4;
    let litAtCanto = null;
    scene.startCantoMove = vi.fn(() => {
      litAtCanto = grid.isVisible(5, 1);
    });
    await moveNextToBrigand(scene, edric);
    scene.finishUnitAction(edric, { session: scene._battleSession });
    expect(scene.startCantoMove).toHaveBeenCalledWith(edric, 1);
    // The turn isn't over: no fog lifted, and no save that would record it.
    expect(litAtCanto).toBe(false);
    expect(scene.saved).toEqual([]);
    // Canto ends (a step, or staying put): its completion lifts the fog before the save.
    completeBattleAction(scene, edric, { session: scene._battleSession });
    expect(grid.isVisible(5, 1)).toBe(true);
    expect(scene.saved).toEqual([true]);
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
    completeResolvedAction(
      scene,
      { kind: 'combat', unitName: 'Ghost' },
      { session: scene._battleSession },
    );
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
    // Edric left from (4,1): his path never lit the brigand's tile...
    expect(grid.isVisible(5, 1)).toBe(false);
    // ...and what only his starting tile saw is fog again (Sera at (0,0) sees 3 steps).
    expect(grid.isVisible(3, 1)).toBe(false);
    expect(grid.isVisible(2, 1)).toBe(true);
    expect(grid.everSeenSet.has('5,1')).toBe(false);
    expect(scene.saved).toEqual([false]);
    expect(scene.turnManager.checkPlayerPhaseComplete).toHaveBeenCalled();
  });
});

describe('moves inside an action (Rescue/Warp, Blink) lift the fog only on commit', () => {
  const RESCUE = gameData.weapons.find((w) => w.name === 'Rescue Staff');

  /** Edric (a Canto caster when asked) moves to (4,1), then relocates Sera to (3,1). */
  async function rescue({ canto }) {
    const { scene, grid, edric } = setup();
    edric.weapon = { ...RESCUE };
    edric.inventory = [edric.weapon];
    edric.proficiencies = [{ type: 'Staff', rank: 'Prof' }];
    edric.stats.MAG = 18; // Rescue's MAG thresholds extend range to the original ally tile.
    if (canto) {
      edric.skills = ['canto'];
      edric._movementSpent = 4;
    }
    const sera = { ...edric, name: 'Sera', col: 0, row: 0, skills: [], graphic: edric.graphic };
    scene.playerUnits.push(sera);
    grid.updateFogOfWar(scene.playerUnits);
    scene.updateEnemyVisibility();
    await moveNextToBrigand(scene, edric);
    let litAtCanto = null;
    scene.startCantoMove = vi.fn(() => {
      litAtCanto = grid.isVisible(5, 1);
    });
    scene.awardScaledXP = vi.fn(() => 20);
    scene._presentScaledXP = vi.fn();
    const heal = new HealController(scene);
    heal.animateRelocate = vi.fn(async () => {});
    heal.restoreCombatWeapon = vi.fn();
    scene.selectedUnit = edric;
    await heal.executeRelocate(edric, sera, { col: 3, row: 1 });
    return { scene, grid, edric, sera, litAtCanto: () => litAtCanto };
  }

  it('Rescue with Canto: the landing reveals nothing until Canto ends, then with the save', async () => {
    const { scene, grid, edric, sera, litAtCanto } = await rescue({ canto: true });
    expect([sera.col, sera.row]).toEqual([3, 1]);
    expect(scene.startCantoMove).toHaveBeenCalledWith(edric, 1);
    expect(litAtCanto()).toBe(false);
    expect(grid.everSeenSet.has('5,1')).toBe(false);
    expect(scene.saved).toEqual([false]);
    completeBattleAction(scene, edric, { session: scene._battleSession });
    expect(grid.isVisible(5, 1)).toBe(true);
    expect(scene.saved).toEqual([false, true]);
  });

  it("Rescue without Canto: the fog lifts with the action's suspend save", async () => {
    const { scene, grid } = await rescue({ canto: false });
    expect(grid.isVisible(5, 1)).toBe(true);
    expect(scene.saved).toEqual([false, true]);
  });

  it('Blink with Canto: nearby fog stays hidden until Canto ends', async () => {
    const { scene, grid, edric } = setup();
    edric.skills = ['blink', 'canto'];
    // Revalidation uses the targeting menu's seen-tile rule.
    grid.visibleSet.add('4,1');
    edric._movementSpent = 1;
    let litAtCanto = null;
    scene.startCantoMove = vi.fn(() => {
      litAtCanto = grid.isVisible(5, 1);
    });
    scene.updateUnitPosition = vi.fn();
    scene._awaitSceneTween = vi.fn(async () => {});
    scene._refreshPostCombatMovementState =
      BattleScene.prototype._refreshPostCombatMovementState.bind(scene);
    const blink = scene.gameData.skills.find((sk) => sk.id === 'blink');
    await new AbilityController(scene).executeBlink(edric, blink, { col: 4, row: 1 });
    expect([edric.col, edric.row]).toEqual([4, 1]);
    expect(scene.startCantoMove).toHaveBeenCalled();
    expect(litAtCanto).toBe(false);
    expect(scene.saved).toEqual([false]);
    completeBattleAction(scene, edric, { session: scene._battleSession });
    expect(grid.isVisible(5, 1)).toBe(true);
    expect(scene.saved).toEqual([false, true]);
  });
});

describe('Shove and Pull never land in the fog', () => {
  // Edric at (3,1) beside Sera at (4,1); the brigand at (5,1) is in the fog.
  function beside() {
    const { scene, grid, edric, brigand } = setup();
    edric.col = 3;
    edric.skills = ['shove', 'pull'];
    const sera = { ...edric, name: 'Sera', col: 4, row: 1, skills: [] };
    scene.playerUnits.push(sera);
    scene.getUnitAt = (c, r) =>
      [...scene.playerUnits, ...scene.enemyUnits].find((u) => u.col === c && u.row === r) || null;
    return { scene, grid, edric, sera, brigand };
  }

  it('a fogged tile past the ally is not offered for Shove, occupied or not', () => {
    const { scene, grid, edric, brigand } = beside();
    expect(grid.isVisible(5, 1)).toBe(false);
    const hidden = scene.findShoveTargets(edric).map((t) => [t.destCol, t.destRow]);
    brigand.col = 9; // the same fogged tile, now empty: the offer must not change
    const empty = scene.findShoveTargets(edric).map((t) => [t.destCol, t.destRow]);
    expect(hidden).not.toContainEqual([5, 1]);
    expect(empty).toEqual(hidden);
  });

  it('a seen free tile past the ally is offered', () => {
    const { scene, grid, edric, brigand } = beside();
    brigand.col = 9;
    grid.fogEnabled = false;
    expect(scene.findShoveTargets(edric).map((t) => [t.destCol, t.destRow])).toContainEqual([5, 1]);
  });

  it('Pull: the retreat tile must be seen, so a hidden foe behind never shows', () => {
    const { scene, grid, edric, sera, brigand } = beside();
    // Sera at (3,1) beside Edric at (4,1); Pull sends Edric back to (5,1), in the fog.
    sera.col = 3;
    edric.col = 4;
    brigand.col = 5;
    grid.updateFogOfWar([{ ...sera, col: 0 }]); // settled vision: (0,1) sees 3 tiles
    expect(grid.isVisible(5, 1)).toBe(false);
    expect(scene.findPullTargets(edric)).toEqual([]);
    brigand.col = 9;
    expect(scene.findPullTargets(edric)).toEqual([]);
    grid.fogEnabled = false;
    expect(scene.findPullTargets(edric).map((t) => [t.retreatCol, t.retreatRow])).toEqual([[5, 1]]);
  });
});

describe('a hidden enemy never shapes the blue range; running into it is an ambush', () => {
  // The brigand hides at (4,1), one step past Edric's sight from (0,1).
  function ambushSetup() {
    const env = setup();
    const { scene, grid, brigand } = env;
    brigand.col = 4;
    grid.updateFogOfWar(scene.playerUnits);
    scene.updateEnemyVisibility();
    expect(grid.isVisible(4, 1)).toBe(false);
    scene.getUnitAt = (c, r) =>
      [...scene.playerUnits, ...scene.enemyUnits].find((u) => u.col === c && u.row === r) || null;
    scene.updateUnitPosition = vi.fn();
    scene.tweens = { add: ({ onComplete }) => onComplete?.() };
    scene.time = { delayedCall: vi.fn() };
    scene.showMinorHintAt = vi.fn();
    scene.inspectionPanel = { hide: vi.fn() };
    scene.dangerZone = { hide: vi.fn() };
    grid.showMovementRange = vi.fn();
    grid.clearHighlights = vi.fn();
    return env;
  }

  it('the range is the same whether or not the fogged tile holds an enemy', () => {
    const { scene, edric, brigand } = ambushSetup();
    scene.selectUnit(edric);
    const withFoe = [...scene.movementRange.keys()].sort();
    brigand.col = 11;
    scene.selectUnit(edric);
    expect([...scene.movementRange.keys()].sort()).toEqual(withFoe);
    expect(withFoe).toContain('4,1');
    expect(withFoe).toContain('5,1');
  });

  it('a move through it stops before it, reveals it, locks the move in and saves', async () => {
    const { scene, grid, edric, brigand } = ambushSetup();
    scene.selectUnit(edric);
    scene.moveUnit(edric, 5, 1);
    await Promise.resolve();
    expect([edric.col, edric.row]).toEqual([3, 1]);
    expect(edric._movementSpent).toBe(3);
    expect(grid.isVisible(4, 1)).toBe(true);
    expect(brigand.graphic.visible).toBe(true);
    expect(edric._movementCommitted).toBe(true);
    expect(scene.preMoveLoc).toBeNull();
    // The save that records the ambush sees the brigand's tile lit.
    expect(scene.saved.at(-1)).toBe(true);
    // The unit can still act, and Back cannot take the move back.
    expect(scene.showActionMenu).toHaveBeenCalledWith(edric);
    scene.selectUnit = vi.fn();
    scene.undoMove(edric);
    expect([edric.col, edric.row]).toEqual([3, 1]);
    expect(scene.showMinorHintAt).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      'Ambush!',
      expect.anything(),
    );
  });

  it('a move that stays clear of it reveals nothing, as before', async () => {
    const { scene, grid, edric } = ambushSetup();
    scene.selectUnit(edric);
    scene.moveUnit(edric, 3, 1);
    await Promise.resolve();
    expect([edric.col, edric.row]).toEqual([3, 1]);
    expect(grid.isVisible(4, 1)).toBe(false);
    expect(edric._movementCommitted).toBeFalsy();
    expect(scene.saved).toEqual([]);
  });

  it('Canto into it stops short too; the action then completes and saves', () => {
    const { scene, grid, edric, brigand } = ambushSetup();
    scene.selectedUnit = edric;
    edric.hasActed = true;
    scene.startCantoMove(edric, 5);
    expect(scene.cantoRange.has('5,1')).toBe(true);
    scene.handleCantoClick({ col: 5, row: 1 });
    expect([edric.col, edric.row]).toEqual([3, 1]);
    expect(grid.isVisible(brigand.col, brigand.row)).toBe(true);
    expect(scene.saved).toEqual([true]);
    expect(scene.turnManager.unitActed).toHaveBeenCalledWith(edric);
  });
});

describe('previews after an uncommitted move name only what the player sees', () => {
  it('Ensnare is not offered for a foe hidden in the fog; once seen, it is', async () => {
    const { scene, edric } = setup();
    edric.skills = ['ensnare'];
    await moveNextToBrigand(scene, edric);
    const abilities = new AbilityController(scene);
    const ensnare = () => abilities._getAbilityEntries(edric).find((e) => e.skill.id === 'ensnare');
    expect(ensnare().hasTargets).toBe(false);
    completeBattleAction(scene, edric, { session: scene._battleSession });
    expect(ensnare().hasTargets).toBe(true);
  });

  it('Smite is not offered for a foe hidden in the fog, nor its tile named; once seen, it is', async () => {
    const { scene, edric } = setup();
    edric.skills = ['smite'];
    await moveNextToBrigand(scene, edric);
    const abilities = new AbilityController(scene);
    const smite = () => abilities._getAbilityEntries(edric).find((e) => e.skill.id === 'smite');
    expect(smite().hasTargets).toBe(false);
    completeBattleAction(scene, edric, { session: scene._battleSession });
    // Seen now: the brigand at (5,1) goes two tiles east to (7,1).
    expect(smite().hasTargets).toBe(true);
    const found = abilities._targeting().find(edric, smite().skill);
    expect(found.map((t) => [t.unit.name, t.destCol, t.destRow])).toEqual([['Brigand', 7, 1]]);
  });

  it('Blink never offers a fogged tile, so a hidden foe cannot show by its absence', async () => {
    const { scene, grid, edric } = setup();
    edric.skills = ['blink'];
    await moveNextToBrigand(scene, edric);
    const abilities = new AbilityController(scene);
    const blink = scene.gameData.skills.find((sk) => sk.id === 'blink');
    abilities.startBlinkTileSelection(edric, blink);
    expect(scene.abilityTiles.length).toBeGreaterThan(0);
    expect(scene.abilityTiles.every((t) => grid.isVisible(t.col, t.row))).toBe(true);
    expect(scene.abilityTiles).not.toContainEqual({ col: 5, row: 1 });
    expect(scene.abilityTiles).not.toContainEqual({ col: 6, row: 1 });
  });

  it('Rescue/Warp destinations: fogged tiles count as taken; seen free tiles are offered', () => {
    const { scene, grid, brigand } = setup();
    const at = (col, row) => scene.getUnitAt(col, row);
    // Around (4,1): (3,1) is seen from (0,1); (5,1) holds the hidden brigand.
    const tiles = getRelocationTiles(grid, seenTileOccupant(grid, at), 4, 1, 1, 'Infantry');
    expect(tiles).toContainEqual({ col: 3, row: 1 });
    expect(tiles.some((t) => !grid.isVisible(t.col, t.row))).toBe(false);
    // Without fog the rule is only "free": the brigand's tile stays out, the rest is in.
    grid.fogEnabled = false;
    const open = getRelocationTiles(grid, seenTileOccupant(grid, at), 4, 1, 1, 'Infantry');
    expect(open).not.toContainEqual({ col: brigand.col, row: brigand.row });
    expect(open).toContainEqual({ col: 4, row: 0 });
  });
});
