// A committed move that runs into a unit the fog hid shows that unit (Grid.revealContact), even
// when the cut leaves the mover past its vision. The case (outside review, Oct 2026): a Pass unit
// whose repriced route it can no longer pay for backs off over occupied tiles to where it began,
// four tiles from the hidden foe with a vision of three. Ways this goes wrong:
//   - the move commits (no undo) but the foe that stopped it stays hidden: "Ambush!" over fog,
//     nothing to inspect, nothing to plan around;
//   - the reveal lasts only until the next fog update (another unit's action), or is lost by a
//     suspend and resume, or outlives the player phase (the foes move: an old contact would
//     show a tile nobody sees);
//   - the reveal leaks into a preview before the commit.
// Expected values are worked out by hand on the corridor below.
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { Grid, computeEffectivePath } from '../src/engine/Grid.js';
import { canInspectUnit } from '../src/engine/BattleInformation.js';
import { captureBattleState } from '../src/ui/BattleCheckpointAdapter.js';
import { applyGridFogState } from '../src/ui/fogState.js';
import { playerKnowledgeOf } from '../src/ui/battleKnowledge.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const T = Object.fromEntries(data.terrain.map((t, i) => [t.name, i]));

function mockScene() {
  const stub = new Proxy({}, { get: (t, p) => (p === 'destroy' ? () => {} : () => stub) });
  return {
    cameras: { main: { width: 640, height: 480 } },
    add: { rectangle: () => stub, image: () => stub, text: () => stub, container: () => stub },
    textures: { exists: () => false },
  };
}

const unit = (faction, name, col, extra = {}) => ({
  name,
  faction,
  col,
  row: 0,
  currentHP: 20,
  mov: 4,
  stats: { MOV: 4, HP: 20 },
  moveType: 'Infantry',
  weapon: { name: 'Iron Lance', type: 'Lance', range: '1' },
  skills: [],
  ...extra,
});

/**
 *   col:    0        1     2     3     4           5
 *   unit:   Knight   foe   foe   foe   hidden foe  -
 *   tile:   plain    plain plain plain ICE         plain
 * The Knight (Armored, vision 3, MOV 4) has Pass. Seen, the route to 5 costs 3 steps + the ice
 * entry, then slides free onto 5: 4. At execution the hidden foe stands on the ice entry: Pass
 * walks through it as a plain step and the slide starts one tile on, so 5 is a paid step: 5 > 4.
 * Every tile back to 0 holds a foe, so the move ends where it began, at cost 0.
 */
function corridor({ hidden = true } = {}) {
  const map = [[T.Plain, T.Plain, T.Plain, T.Plain, T.Ice, T.Plain]];
  const grid = new Grid(mockScene(), 6, 1, data.terrain, map, true);
  const knight = unit('player', 'Knight', 0, { moveType: 'Armored', skills: ['pass'] });
  const seen = [1, 2, 3].map((col) => unit('enemy', `Fighter ${col}`, col));
  const lurker = unit('enemy', 'Lurker', 4);
  const scene = new BattleScene();
  Object.assign(scene, {
    _battleSession: 1,
    grid,
    playerUnits: [knight],
    enemyUnits: hidden ? [...seen, lurker] : seen,
    npcUnits: [],
    ballistas: [],
    gameData: { skills: data.skills, terrain: data.terrain },
    // Presentation and the save are not under test here.
    updateEnemyVisibility: () => {},
    _captureSuspendCheckpoint: () => true,
    showMinorHintAt: () => {},
  });
  grid.updateFogOfWar(scene.playerUnits);
  const route = [0, 1, 2, 3, 4, 5].map((col) => ({ col, row: 0 }));
  const planned = computeEffectivePath(route, grid.mapLayout, grid.terrainData, 6, 1, 'Armored', scene.buildOccupiedSet(knight, { seenOnly: true }), 0); // prettier-ignore
  return { scene, grid, knight, lurker, planned };
}

describe('a move cut by a hidden unit shows that unit, whatever the distance', () => {
  it('the setup: the Knight sees 0-3; the plan to 5 costs 4 and is the same with or without the hidden foe', () => {
    const { grid, lurker, planned } = corridor();
    expect([0, 1, 2, 3].every((col) => grid.isVisible(col, 0))).toBe(true);
    expect(grid.isVisible(4, 0)).toBe(false);
    expect(canInspectUnit(grid, lurker)).toBe(false);
    expect(planned.movementCost).toBe(4);
    expect(planned.effectivePath.map((t) => t.col)).toEqual([0, 1, 2, 3, 4, 5]);
    const without = corridor({ hidden: false }).planned;
    expect(without).toEqual(planned);
  });

  it('at execution the move backs all the way off, commits at cost 0, and the foe on the ice is shown', () => {
    const { scene, grid, knight, lurker, planned } = corridor();
    const cut = scene._ambushCut(knight, planned, { allowance: 4 });
    expect(cut.ambusher).toBe(lurker);
    expect(cut.path.map((t) => t.col)).toEqual([0]);
    expect(cut.cost).toBe(0);

    scene.preMoveLoc = { col: 0, row: 0 };
    scene._resolveAmbush(knight, cut.ambusher);
    // Committed: no undo.
    expect(knight._movementCommitted).toBe(true);
    expect(scene.preMoveLoc).toBeNull();
    // Shown, though four tiles from a vision of three: inspectable and known to the previews.
    expect(grid.isVisible(4, 0)).toBe(true);
    expect(canInspectUnit(grid, lurker)).toBe(true);
    expect(playerKnowledgeOf(scene).isKnown(lurker)).toBe(true);
    // Only the contact: the empty tile past it stays fogged.
    expect(grid.isVisible(5, 0)).toBe(false);
  });

  it('the contact holds through the next fog update and a suspend and resume', () => {
    const { scene, grid, knight, lurker, planned } = corridor();
    scene._resolveAmbush(knight, scene._ambushCut(knight, planned, { allowance: 4 }).ambusher);

    // Another unit's action settles the fog again.
    grid.updateFogOfWar(scene.playerUnits);
    expect(canInspectUnit(grid, lurker)).toBe(true);

    // The checkpoint carries it (validated in BattleStateSnapshot.test.js); a fresh grid
    // restored from it still shows the foe, and keeps showing it after the next settle.
    const state = captureBattleState(scene, { rngSeed: 7 });
    expect(state.fog.contacts).toEqual(['4,0']);
    const resumed = corridor({ hidden: false }).grid;
    applyGridFogState(resumed, state.fog);
    expect(resumed.isVisible(4, 0)).toBe(true);
    resumed.updateFogOfWar([knight]);
    expect(resumed.isVisible(4, 0)).toBe(true);
    // A checkpoint saved before contacts existed restores none.
    const old = corridor({ hidden: false }).grid;
    applyGridFogState(old, { visible: state.fog.visible, everSeen: state.fog.everSeen });
    old.updateFogOfWar([knight]);
    expect(old.isVisible(4, 0)).toBe(false);
  });

  it('the enemy phase ends it: the foes move, so the tile goes back to fog', () => {
    const { scene, grid, knight, lurker, planned } = corridor();
    scene._resolveAmbush(knight, scene._ambushCut(knight, planned, { allowance: 4 }).ambusher);
    expect(canInspectUnit(grid, lurker)).toBe(true);
    Object.assign(scene, {
      turnManager: { currentPhase: 'enemy', turnNumber: 1 },
      _scheduleSafeDelayedAsync: () => null,
      updateAntiTurtlePressure: () => {},
      refreshEndTurnControl: () => {},
      showPhaseBanner: () => {},
      keepDangerVisible: true,
    });
    scene.onPhaseChange('enemy', 1);
    expect(grid.contactSet.size).toBe(0);
    expect(grid.isVisible(4, 0)).toBe(false);
    expect(canInspectUnit(grid, lurker)).toBe(false);
    // It stays in the fog's memory (seen before), as any tile once seen.
    expect(grid.everSeenSet.has('4,0')).toBe(true);
  });
});
