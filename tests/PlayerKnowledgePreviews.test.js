// A unit the fog hides must not change anything the player sees before committing.
// Each test builds two worlds the player cannot tell apart (same visible units, same
// fog) that differ only by a hidden unit, and requires the same preview in both.
import { describe, it, expect, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { BattleScene } from '../src/scenes/BattleScene.js';
import { Grid, computeEffectivePath } from '../src/engine/Grid.js';
import { threatSummaryText } from '../src/engine/ThreatForecast.js';
import { createPlayerKnowledge } from '../src/engine/PlayerKnowledge.js';
import { ThreatSightController } from '../src/ui/ThreatSightController.js';
import { InputController } from '../src/ui/InputController.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const T = Object.fromEntries(gameData.terrain.map((t, i) => [t.name, i]));

function mockScene() {
  const stub = new Proxy({}, { get: (t, p) => (p === 'destroy' ? () => {} : () => stub) });
  return {
    cameras: { main: { width: 640, height: 480 } },
    add: { rectangle: () => stub, image: () => stub, text: () => stub, container: () => stub },
    textures: { exists: () => false },
  };
}

/** Rows of '.' plain, 'i' ice, '#' wall; `hidden` = fogged tiles ("col,row"). */
function makeGrid(rows, hidden) {
  const map = rows.map((line) =>
    [...line].map((ch) => (ch === '#' ? T.Wall : ch === 'i' ? T.Ice : T.Plain)),
  );
  const grid = new Grid(mockScene(), map[0].length, map.length, gameData.terrain, map, true);
  grid.isVisible = (col, row) => !hidden.has(`${col},${row}`);
  return grid;
}

const foe = (col, row, extra = {}) => ({
  name: 'Fighter',
  faction: 'enemy',
  col,
  row,
  currentHP: 20,
  mov: 3,
  stats: { MOV: 3, HP: 20 },
  moveType: 'Infantry',
  weapon: { name: 'Iron Axe', type: 'Axe', range: '1' },
  ...extra,
});
const hero = (col, row, extra = {}) => ({
  name: 'Edric',
  faction: 'player',
  col,
  row,
  currentHP: 20,
  mov: 5,
  stats: { MOV: 5, HP: 20 },
  moveType: 'Infantry',
  weapon: { name: 'Iron Sword', type: 'Sword', range: '1' },
  ...extra,
});
const villager = (col, row) => ({ name: 'Villager', faction: 'npc', col, row, currentHP: 10 });
// The one NPC the fog can hide: a waiting recruit is always in view (canInspectUnit).
const caravan = (col, row) => ({ ...villager(col, row), name: 'Merchant', isCaravan: true });

function battle(grid, { enemies = [], players = [], npcs = [] }) {
  const scene = new BattleScene();
  Object.assign(scene, {
    _battleSession: 1,
    grid,
    enemyUnits: enemies,
    playerUnits: players,
    npcUnits: npcs,
    ballistas: [],
    gameData: { skills: [] },
  });
  return scene;
}

const counts = (tiles) =>
  Object.fromEntries(tiles.map((t) => [`${t.col},${t.row}`, t.count]).sort());

/**
 * A 1×10 corridor: a visible Fighter at (8,0) (MOV 3, range 1) and the player at
 * (0,0). (5,0) is fogged in both worlds; the second world hides a Fighter there, on
 * the tile the visible one would stop on to strike (4,0).
 */
function corridorWorlds() {
  const hidden = new Set(['5,0']);
  return [false, true].map((withHidden) => {
    const visible = foe(8, 0);
    const player = hero(0, 0);
    const enemies = withHidden ? [visible, foe(5, 0)] : [visible];
    return {
      scene: battle(makeGrid(['..........'], hidden), { enemies, players: [player] }),
      visible,
      player,
    };
  });
}

describe('PlayerKnowledge', () => {
  it('knows player units, what the fog shows and revealed units, never the rest', () => {
    const grid = makeGrid(['......'], new Set(['3,0', '4,0', '5,0']));
    const player = hero(3, 0); // own units are known even on a fogged tile
    const seen = foe(1, 0);
    const lurker = foe(4, 0);
    const recruit = villager(5, 0);
    const dead = foe(2, 0, { currentHP: 0 });
    const k = createPlayerKnowledge({
      grid,
      units: [player, seen, lurker, recruit, dead],
      revealed: [recruit, null],
    });
    expect(k.units).toEqual([player, seen, recruit]);
    expect([...k.positions().keys()].sort()).toEqual(['1,0', '3,0', '5,0']);
    expect([...k.occupied(player)].sort()).toEqual(['1,0', '5,0']);
    expect(k.isKnown(lurker)).toBe(false);
  });

  it('knows every unit when there is no fog', () => {
    const grid = makeGrid(['...'], new Set(['1,0']));
    grid.fogEnabled = false;
    const k = createPlayerKnowledge({ grid, units: [foe(1, 0)] });
    expect([...k.positions().keys()]).toEqual(['1,0']);
  });

  it('a waiting recruit is known through the fog; a fogged caravan is not', () => {
    const grid = makeGrid(['..........'], new Set(['5,0', '7,0']));
    const recruit = villager(5, 0);
    const scene = battle(grid, { players: [hero(0, 0)], npcs: [recruit, caravan(7, 0)] });
    expect(scene.buildUnitPositionMap().get('5,0')).toEqual({ faction: 'npc' });
    expect(scene.buildUnitPositionMap().has('7,0')).toBe(false);
  });
});

describe('Threat displays ignore hidden units (Danger, pinned, Threat Sight, inspection)', () => {
  it('global Danger is unchanged by a hidden enemy on a visible enemy’s stop', () => {
    const [a, b] = corridorWorlds();
    const danger = counts(a.scene.calculateDangerZone());
    expect(danger['4,0']).toBe(1);
    expect(counts(b.scene.calculateDangerZone())).toEqual(danger);
  });

  it('one enemy’s reach (pinned, planning and idle outlines) is unchanged', () => {
    const [a, b] = corridorWorlds();
    expect(counts(b.scene.calculateDangerZone(b.visible))).toEqual(
      counts(a.scene.calculateDangerZone(a.visible)),
    );
  });

  it('Threat Sight at a destination reads the same', () => {
    const [a, b] = corridorWorlds();
    const text = (w) => threatSummaryText(new ThreatSightController(w.scene).query(w.player, 4, 0));
    expect(text(a)).toBe('1 foe can reach · fog may hide more');
    expect(text(b)).toBe(text(a));
  });

  it('a hidden enemy on an ice lane does not cut a visible enemy’s slide short', () => {
    const hidden = new Set(['4,0']);
    const danger = (withHidden) => {
      // MOV 8 pays the whole lane: entry (8,0) 1, (7,0) free, (6,0)…(1,0) 6, (0,0) 1.
      const visible = foe(9, 0, { mov: 8, stats: { MOV: 8, HP: 20 } });
      const enemies = withHidden ? [visible, foe(4, 0)] : [visible];
      const grid = makeGrid(['.iiiiiiii.', '..........'], hidden);
      return counts(battle(grid, { enemies, players: [hero(0, 1)] }).calculateDangerZone());
    };
    expect(danger(false)['1,0']).toBe(1);
    expect(danger(true)).toEqual(danger(false));
  });

  it('idle inspection of a visible enemy draws the same move and attack tiles', () => {
    const drawn = ({ scene, visible }) => {
      Object.assign(scene, {
        battleState: 'PLAYER_IDLE',
        selectedUnit: null,
        inspectionPanel: { show() {}, hide() {}, visible: false, objects: [] },
        refreshEndTurnControl() {},
      });
      const moves = [];
      let attack = [];
      scene.grid.pixelToGrid = () => ({ col: visible.col, row: visible.row });
      scene.grid.clearAttackHighlights = () => {};
      scene.grid.showMovementRange = (range, uc, ur) => {
        for (const [k, e] of range) if (k !== `${uc},${ur}` && e.stoppable !== false) moves.push(k);
      };
      scene.grid.showAttackRange = (tiles) => {
        attack = tiles.map((t) => `${t.col},${t.row}`);
      };
      const input = new InputController(scene);
      input._idleThreat = { show: vi.fn() };
      input._idleThreatTick = () => {};
      expect(input._showInspectionAtPixel(0, 0)).toBe(true);
      return {
        moves: moves.sort(),
        attack: attack.sort(),
        outline: counts(input._idleThreat.show.mock.calls[0][0]),
      };
    };
    const [a, b] = corridorWorlds();
    const seen = drawn(a);
    expect(seen.moves).toEqual(['5,0', '6,0', '7,0', '9,0']);
    expect(seen.attack).toEqual(['4,0']);
    expect(drawn(b)).toEqual(seen);
  });
});

describe('Player planning ignores hidden units (blue range, path preview)', () => {
  it('a fog-hidden NPC does not shape the blue range', () => {
    const range = (withNpc) => {
      const grid = makeGrid(['..........'], new Set(['5,0']));
      const scene = battle(grid, { players: [hero(0, 0)], npcs: withNpc ? [caravan(5, 0)] : [] });
      return [
        ...grid
          .getMovementRange(0, 0, 8, 'Infantry', scene.buildUnitPositionMap(), 'player')
          .keys(),
      ].sort();
    };
    expect(range(true)).toEqual(range(false));
  });

  /** Plain (0,0) then ice to (5,0); (3,0) is fogged, and hides a Fighter in one world. */
  function iceWorld(withHidden) {
    const grid = makeGrid(['.iiiii'], new Set(['3,0']));
    const unit = hero(0, 0);
    const scene = battle(grid, { enemies: withHidden ? [foe(3, 0)] : [], players: [unit] });
    Object.assign(scene, {
      battleState: 'UNIT_SELECTED',
      selectedUnit: unit,
      _lastPathPreviewKey: null,
    });
    scene.unitPositions = scene.buildUnitPositionMap();
    scene.movementRange = grid.getMovementRange(
      0,
      0,
      5,
      'Infantry',
      scene.unitPositions,
      'player',
      0,
    );
    grid.showPath = vi.fn();
    grid.showSlidePath = vi.fn();
    grid.clearPath = vi.fn();
    return { scene, grid, unit };
  }
  const keys = (tiles) => tiles.map((t) => `${t.col},${t.row}`);
  function preview(withHidden) {
    const { scene, grid } = iceWorld(withHidden);
    new InputController(scene).updatePathPreview(5, 0);
    return {
      path: keys(grid.showPath.mock.calls[0][0]),
      slides: grid.showSlidePath.mock.calls.map((c) => keys(c[0])),
    };
  }

  it('the path and ice-slide preview are the same with or without the hidden enemy', () => {
    const seen = preview(false);
    expect(seen.slides).toEqual([['1,0', '2,0', '3,0', '4,0', '5,0']]);
    expect(preview(true)).toEqual(seen);
  });

  it('the preview draws the path the move plans before its ambush check', () => {
    const { scene, grid, unit } = iceWorld(true);
    new InputController(scene).updatePathPreview(5, 0);
    const path = grid.reconstructIcePath(scene.movementRange, 0, 0, 5, 0);
    const planned = computeEffectivePath(
      path,
      grid.mapLayout,
      grid.terrainData,
      6,
      1,
      'Infantry',
      scene.buildOccupiedSet(unit, { seenOnly: true }),
      0,
    );
    expect(keys(grid.showPath.mock.calls[0][0])).toEqual(keys(planned.effectivePath));
    expect(grid.showSlidePath.mock.calls.map((c) => keys(c[0]))).toEqual(
      planned.slideSegments.map((seg) => keys(seg.slidePath)),
    );
    // Committing still meets the hidden enemy: the move stops before it.
    const cut = scene._ambushCut(unit, planned);
    expect(cut.ambusher).toBe(scene.enemyUnits[0]);
    expect(keys(cut.path)).toEqual(['0,0', '1,0', '2,0']);
  });

  it('a move into a fog-hidden NPC stops before it, as a block rather than an ambush', () => {
    const grid = makeGrid(['......'], new Set(['3,0']));
    const unit = hero(0, 0);
    const npc = caravan(3, 0);
    const scene = battle(grid, { players: [unit], npcs: [npc] });
    const path = [0, 1, 2, 3, 4].map((col) => ({ col, row: 0 }));
    const cut = scene._ambushCut(unit, { effectivePath: path, movementCost: 4, slideSegments: [] });
    expect(cut.ambusher).toBe(npc);
    expect(keys(cut.path)).toEqual(['0,0', '1,0', '2,0']);
    expect(cut.cost).toBe(2);

    const hints = [];
    Object.assign(scene, {
      showMinorHintAt: (x, y, text) => hints.push(text),
      commitVisionSnapshotIfPending() {},
      _captureSuspendCheckpoint() {},
    });
    grid.gridToPixel = () => ({ x: 0, y: 0 });
    scene._resolveAmbush(unit, npc, { canto: true });
    expect(hints).toEqual(['Blocked']);
  });
});
