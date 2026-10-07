// Pass (docs/specs/phase3.md 3E): a passive that lets a unit move THROUGH enemy units but
// never stop on one. The rule lives in Grid.js (computeMovementRange / computePath, shared by
// the scene's Grid and the headless harness's); the previews read what the player knows; the
// committed move meets a hidden foe only where the unit would have to stand.
//
// Ways this goes wrong, each caught below:
//   range      the tiles past a foe are missing (Pass does nothing), or the foe's own tile is
//              offered as a place to stop; an NPC ally is walked through; a wall is; the
//              cost of the detour is wrong; a unit without Pass changes at all
//   path       findPath and the range disagree (the preview draws a route the move cannot walk)
//   ice        an occupied tile fails to end a slide; a foe on the entry tile starts one
//   preview    a hidden unit shapes the range the player sees (fog leak), or the preview and
//              the move disagree on a seen board
//   execution  a hidden foe on the way stops a Pass unit (it should not); one on the last tile
//              does not back the walk off; a hidden NPC stops being a block
//   enemies    the AI gains Pass, or a player's Pass changes an enemy's range or threat
//   model      a lent Pass does not work or show like a known one
//   harness    the headless battle's movement ignores it
// Expected values are worked out by hand on small corridors, never by re-running the code.
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { readFileSync } from 'node:fs';
import { BattleScene } from '../src/scenes/BattleScene.js';
import {
  Grid,
  computeEffectivePath,
  computeMovementRange,
  passesThrough,
} from '../src/engine/Grid.js';
import { ambushStop } from '../src/engine/FogAmbush.js';
import { createPlayerKnowledge } from '../src/engine/PlayerKnowledge.js';
import { hasPass, movementOptionsFor, passesHiddenUnit } from '../src/engine/PassMovement.js';
import { effectiveSkills } from '../src/engine/EffectiveSkills.js';
import { enemyThreatTiles, unitReach } from '../src/engine/ThreatForecast.js';
import { InputController } from '../src/ui/InputController.js';
import { HeadlessGrid } from './harness/HeadlessGrid.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const T = Object.fromEntries(data.terrain.map((t, i) => [t.name, i]));
const PASS = { pass: true };

function mockScene() {
  const stub = new Proxy({}, { get: (t, p) => (p === 'destroy' ? () => {} : () => stub) });
  return {
    cameras: { main: { width: 640, height: 480 } },
    add: { rectangle: () => stub, image: () => stub, text: () => stub, container: () => stub },
    textures: { exists: () => false },
  };
}

/** Rows of '.' plain, 'i' ice, '#' wall; `hidden` = fogged tiles ("col,row"). */
function makeGrid(rows, hidden = new Set(), { fog = true } = {}) {
  const map = rows.map((line) =>
    [...line].map((ch) => (ch === '#' ? T.Wall : ch === 'i' ? T.Ice : T.Plain)),
  );
  const grid = new Grid(mockScene(), map[0].length, map.length, data.terrain, map, fog);
  grid.isVisible = (col, row) => !hidden.has(`${col},${row}`);
  return grid;
}

const unit = (faction, name, col, row, extra = {}) => ({
  name,
  faction,
  col,
  row,
  currentHP: 20,
  mov: 5,
  stats: { MOV: 5, HP: 20 },
  moveType: 'Infantry',
  weapon: { name: 'Iron Sword', type: 'Sword', range: '1' },
  skills: [],
  ...extra,
});
const hero = (col, row, extra = {}) => unit('player', 'Trickster', col, row, extra);
const foe = (col, row, extra = {}) => unit('enemy', 'Fighter', col, row, extra);
const npc = (col, row, extra = {}) => unit('npc', 'Villager', col, row, extra);

const positionsOf = (...units) =>
  new Map(units.map((u) => [`${u.col},${u.row}`, { faction: u.faction }]));
const stoppable = (range) =>
  [...range.entries()]
    .filter(([, entry]) => entry.stoppable !== false)
    .map(([key]) => key)
    .sort();
const passed = (range) =>
  [...range.entries()]
    .filter(([, entry]) => entry.stoppable === false)
    .map(([key]) => key)
    .sort();
const keysOf = (path) => path.map((t) => `${t.col},${t.row}`);

describe('the range', () => {
  // A 1-wide corridor: the hero at 0, a foe at 2, MOV 4.
  const corridor = () => makeGrid(['........']);
  const range = (grid, mover, others, options = null) =>
    grid.getMovementRange(
      mover.col,
      mover.row,
      4,
      mover.moveType,
      positionsOf(mover, ...others),
      mover.faction,
      0,
      options,
    );

  it('without Pass a foe is a wall: only the tiles before it are reachable', () => {
    const me = hero(0, 0);
    expect(stoppable(range(corridor(), me, [foe(2, 0)]))).toEqual(['0,0', '1,0']);
  });

  it('with Pass the tiles past the foe are reachable (4 MOV: out to column 4), never the foe’s own', () => {
    const me = hero(0, 0);
    const r = range(corridor(), me, [foe(2, 0)], PASS);
    expect(stoppable(r)).toEqual(['0,0', '1,0', '3,0', '4,0']);
    expect(passed(r)).toEqual(['2,0']);
    // The foe's tile is walked through at its own cost: column 3 is 3 steps, column 4 is 4.
    expect([r.get('3,0').cost, r.get('4,0').cost]).toEqual([3, 4]);
  });

  it('a wall still blocks, and a foe on the far side of it is out of reach', () => {
    const me = hero(0, 0);
    const grid = makeGrid(['.#.....']);
    expect(stoppable(range(grid, me, [foe(2, 0)], PASS))).toEqual(['0,0']);
  });

  it('walks around instead when the way round is shorter, and through when it is not', () => {
    // 3 rows: the foe at (1,1); the hero at (0,1) wants (2,1). Round the foe is 4 steps
    // (up, right, right, down); through it is 2.
    const grid = makeGrid(['...', '...', '...']);
    const me = hero(0, 1);
    const r = grid.getMovementRange(0, 1, 2, 'Infantry', positionsOf(me, foe(1, 1)), 'player', 0, PASS); // prettier-ignore
    expect(r.get('2,1').cost).toBe(2);
    const without = grid.getMovementRange(0, 1, 2, 'Infantry', positionsOf(me, foe(1, 1)), 'player', 0); // prettier-ignore
    expect(without.has('2,1')).toBe(false);
  });

  it('an NPC ally is not walked through: Pass is about enemy units', () => {
    const me = hero(0, 0);
    expect(stoppable(range(corridor(), me, [npc(2, 0)], PASS))).toEqual(['0,0', '1,0']);
    expect(passesThrough({ faction: 'npc' }, 'player')).toBe(false);
  });

  it('an ally’s tile is still passed but never stopped on (as before)', () => {
    const me = hero(0, 0);
    const ally = unit('player', 'Ally', 2, 0);
    const r = range(corridor(), me, [ally], PASS);
    expect(stoppable(r)).toEqual(['0,0', '1,0', '3,0', '4,0']);
    expect(range(corridor(), me, [ally]).get('2,0').stoppable).toBe(false);
  });

  it('a unit without Pass is untouched: the same map, entry by entry', () => {
    const me = hero(0, 0);
    const others = [foe(2, 0), foe(3, 0), unit('player', 'Ally', 1, 0)];
    const grid = makeGrid(['......', '......']);
    const plain = range(grid, me, others);
    const explicitOff = range(grid, me, others, { pass: false });
    const noOptions = range(grid, me, others, {});
    expect(explicitOff).toEqual(plain);
    expect(noOptions).toEqual(plain);
  });

  it('one flag, one rule: findPath mirrors the range', () => {
    const grid = corridor();
    const me = hero(0, 0);
    const positions = positionsOf(me, foe(2, 0));
    expect(grid.findPath(0, 0, 4, 0, 'Infantry', positions, 'player', 0)).toBeNull();
    const path = grid.findPath(0, 0, 4, 0, 'Infantry', positions, 'player', 0, PASS);
    expect(keysOf(path)).toEqual(['0,0', '1,0', '2,0', '3,0', '4,0']);
    // The range's own path to the same tile is the same route.
    const r = range(grid, me, [foe(2, 0)], PASS);
    expect(keysOf(grid.reconstructIcePath(r, 0, 0, 4, 0))).toEqual(keysOf(path));
  });

  it('the headless grid is the same code: same range, same path', () => {
    const rows = ['.....', '.....'];
    const scene = makeGrid(rows);
    const headless = new HeadlessGrid(5, 2, data.terrain, scene.mapLayout, false);
    const me = hero(0, 0);
    const positions = positionsOf(me, foe(2, 0), foe(1, 1));
    const a = scene.getMovementRange(0, 0, 4, 'Infantry', positions, 'player', 0, PASS);
    const b = headless.getMovementRange(0, 0, 4, 'Infantry', positions, 'player', 0, PASS);
    expect(b).toEqual(a);
    expect(headless.findPath(0, 0, 4, 0, 'Infantry', positions, 'player', 0, PASS)).toEqual(
      scene.findPath(0, 0, 4, 0, 'Infantry', positions, 'player', 0, PASS),
    );
    expect(headless.findPath(0, 0, 4, 0, 'Infantry', positions, 'player', 0)).toBeNull();
  });
});

describe('ice: an occupied tile still ends a slide', () => {
  // Row: 0 start, 1 plain, 2-4 ice, 5-6 plain. Moving east.
  const grid = () => makeGrid(['..iii..']);

  it('a foe in the slide’s way stops it before that tile', () => {
    const me = hero(0, 0);
    const blocker = foe(4, 0);
    const r = grid().getMovementRange(0, 0, 4, 'Infantry', positionsOf(me, blocker), 'player', 0, PASS); // prettier-ignore
    // Entering the ice at column 2 slides east: column 3 is free, column 4 holds the foe,
    // so the unit comes to rest on column 3.
    expect(r.has('3,0')).toBe(true);
    expect(r.get('3,0').stoppable).not.toBe(false);
    expect(r.get('3,0').slidePath.map((t) => t.col)).toEqual([2, 3]);
    // The foe's own tile is passed, never stopped on, and nothing is slid onto it.
    expect(r.get('4,0')?.stoppable ?? false).toBe(false);
  });

  it('a foe on the ice entry tile is walked through as an ordinary tile: no slide starts from it', () => {
    const me = hero(0, 0);
    const blocker = foe(2, 0);
    const r = grid().getMovementRange(0, 0, 4, 'Infantry', positionsOf(me, blocker), 'player', 0, PASS); // prettier-ignore
    expect(r.get('2,0').stoppable).toBe(false);
    expect(r.get('2,0').slidePath).toBeUndefined();
  });

  it('computeEffectivePath treats an occupied ice entry the same way (no slide)', () => {
    const g = grid();
    const path = [0, 1, 2].map((col) => ({ col, row: 0 }));
    const effective = computeEffectivePath(path, g.mapLayout, g.terrainData, 7, 1, 'Infantry', new Set(['2,0']), 0); // prettier-ignore
    expect(effective.slideSegments).toEqual([]);
    expect(keysOf(effective.effectivePath).slice(0, 3)).toEqual(['0,0', '1,0', '2,0']);
  });
});

describe('previews read what the player knows', () => {
  // A 1×9 corridor. The player's Pass unit at 0; a foe in the fog at (3,0) that is, in the
  // second world, really there. The tile is fogged in both: the player cannot tell them apart.
  const worlds = () =>
    [false, true].map((withHidden) => {
      const me = hero(0, 0, { skills: ['pass'] });
      const hidden = foe(3, 0);
      const grid = makeGrid(['.........'], new Set(['3,0']));
      const scene = new BattleScene();
      Object.assign(scene, {
        _battleSession: 1,
        grid,
        playerUnits: [me],
        enemyUnits: withHidden ? [hidden] : [],
        npcUnits: [],
        ballistas: [],
        gameData: { skills: data.skills },
      });
      return { scene, me, hidden, grid };
    });

  it('a hidden foe never shapes the range, the path or the reach the player is shown', () => {
    const [a, b] = worlds();
    const rangeOf = ({ scene, me }) =>
      scene.grid.getMovementRange(me.col, me.row, 5, me.moveType, scene.buildUnitPositionMap(), me.faction, 0, movementOptionsFor(me)); // prettier-ignore
    expect(rangeOf(b)).toEqual(rangeOf(a));
    // …so the hidden foe's tile is offered like any fogged tile (the move meets it on commit).
    expect(stoppable(rangeOf(b))).toContain('3,0');
    const reach = ({ scene, me }) =>
      unitReach(scene.grid, me, { mov: 5, positions: scene.buildUnitPositionMap() });
    expect(reach(b)).toEqual(reach(a));
  });

  it('a SEEN foe on the same tile is walked through and not offered', () => {
    const me = hero(0, 0, { skills: ['pass'] });
    const grid = makeGrid(['.........']);
    const scene = new BattleScene();
    const seen = foe(3, 0);
    Object.assign(scene, {
      _battleSession: 1,
      grid,
      playerUnits: [me],
      enemyUnits: [seen],
      npcUnits: [],
      ballistas: [],
    });
    const r = grid.getMovementRange(0, 0, 5, 'Infantry', scene.buildUnitPositionMap(), 'player', 0, movementOptionsFor(me)); // prettier-ignore
    expect(stoppable(r)).toEqual(['0,0', '1,0', '2,0', '4,0', '5,0']);
    expect(passed(r)).toEqual(['3,0']);
  });

  it('on a seen board the preview and the committed move agree', () => {
    // No fog: knowledge is the real board. The route the preview draws is the route the
    // move walks, through the foe.
    const me = hero(0, 0, { skills: ['pass'] });
    const grid = makeGrid(['.......'], new Set(), { fog: false });
    const scene = new BattleScene();
    Object.assign(scene, {
      _battleSession: 1,
      grid,
      playerUnits: [me],
      enemyUnits: [foe(2, 0)],
      npcUnits: [],
      ballistas: [],
      battleState: 'UNIT_SELECTED',
      selectedUnit: me,
    });
    scene.unitPositions = scene.buildUnitPositionMap();
    scene.movementRange = grid.getMovementRange(0, 0, 5, 'Infantry', scene.unitPositions, 'player', 0, movementOptionsFor(me)); // prettier-ignore
    expect(stoppable(scene.movementRange)).toEqual(['0,0', '1,0', '3,0', '4,0', '5,0']);
    grid.showPath = vi.fn();
    grid.showSlidePath = vi.fn();
    grid.clearPath = vi.fn();
    new InputController(scene).updatePathPreview(4, 0);
    expect(keysOf(grid.showPath.mock.calls[0][0])).toEqual(['0,0', '1,0', '2,0', '3,0', '4,0']);
    // The move itself: the same range → the same path → a cut that leaves it whole.
    const path = grid.reconstructIcePath(scene.movementRange, 0, 0, 4, 0);
    expect(keysOf(path)).toEqual(['0,0', '1,0', '2,0', '3,0', '4,0']);
    const effective = computeEffectivePath(path, grid.mapLayout, grid.terrainData, 7, 1, 'Infantry', scene.buildOccupiedSet(me, { seenOnly: true }), 0); // prettier-ignore
    const cut = scene._ambushCut(me, effective);
    expect(cut.ambusher).toBeNull();
    expect(keysOf(cut.path)).toEqual(keysOf(path));
    expect(cut.cost).toBe(4);
  });
});

describe('execution meets hidden foes only where the unit would stand', () => {
  const walk = (cols) => cols.map((col) => ({ col, row: 0 }));
  const at = (units) => (col, row) => units.find((u) => u.col === col && u.row === row) || null;

  it('ambushStop: a hidden foe mid-path does not stop a unit that passes', () => {
    const lurker = foe(2, 0);
    const probes = { hiddenAt: at([lurker]), blockedAt: at([lurker]) };
    expect(ambushStop(walk([0, 1, 2, 3, 4]), probes).ambusher).toBe(lurker);
    const pass = ambushStop(walk([0, 1, 2, 3, 4]), { ...probes, passes: () => true });
    expect(pass.ambusher).toBeNull();
    expect(keysOf(pass.path)).toEqual(keysOf(walk([0, 1, 2, 3, 4])));
  });

  it('ambushStop: on the LAST tile it still stops the walk, backing off the tiles it passed through', () => {
    const middle = foe(2, 0);
    const lastTile = foe(4, 0);
    const probes = {
      hiddenAt: at([middle, lastTile]),
      blockedAt: at([middle, lastTile]),
      passes: () => true,
    };
    const cut = ambushStop(walk([0, 1, 2, 3, 4]), probes);
    // The foe on column 4 is the ambusher; the unit comes to rest on column 3, free.
    expect(cut.ambusher).toBe(lastTile);
    expect(keysOf(cut.path)).toEqual(['0,0', '1,0', '2,0', '3,0']);
    // With another foe on column 3 as well, it backs off further: column 2 is occupied too.
    const crowded = at([middle, foe(3, 0), lastTile]);
    const back = ambushStop(walk([0, 1, 2, 3, 4]), {
      ...probes,
      hiddenAt: crowded,
      blockedAt: crowded,
    });
    expect(keysOf(back.path)).toEqual(['0,0', '1,0']);
  });

  it('only a foe is passed through: a hidden NPC still stops a Pass unit', () => {
    const me = hero(0, 0, { skills: ['pass'] });
    expect(passesHiddenUnit(me, foe(2, 0))).toBe(true);
    expect(passesHiddenUnit(me, npc(2, 0))).toBe(false);
    expect(passesHiddenUnit(hero(0, 0), foe(2, 0))).toBe(false);
  });

  it('the scene’s move cut: a hidden foe on the way is walked through, one on the last tile backs it off', () => {
    const me = hero(0, 0, { skills: ['pass'] });
    const plan = (hiddenCols) => {
      const hiddenFoes = hiddenCols.map((col) => foe(col, 0));
      const grid = makeGrid(['.......'], new Set(hiddenCols.map((col) => `${col},0`)));
      const scene = new BattleScene();
      Object.assign(scene, {
        _battleSession: 1,
        grid,
        playerUnits: [me],
        enemyUnits: hiddenFoes,
        npcUnits: [],
        ballistas: [],
        gameData: { skills: data.skills },
      });
      const path = walk([0, 1, 2, 3, 4]);
      return scene._ambushCut(me, { effectivePath: path, movementCost: 4, slideSegments: [] });
    };
    // Hidden foe at 2: passed through, the walk is whole.
    const through = plan([2]);
    expect(through.ambusher).toBeNull();
    expect(through.path).toHaveLength(5);
    expect(through.cost).toBe(4);
    // Hidden foe on the destination (4): the unit stops short, on 3. The cost is what it paid.
    const blockedLast = plan([4]);
    expect(blockedLast.ambusher?.col).toBe(4);
    expect(keysOf(blockedLast.path)).toEqual(['0,0', '1,0', '2,0', '3,0']);
    expect(blockedLast.cost).toBe(3);
    // Hidden at 2 and 4: through the first, stopped by the second, resting on 3 (free).
    const both = plan([2, 4]);
    expect(both.ambusher?.col).toBe(4);
    expect(keysOf(both.path)).toEqual(['0,0', '1,0', '2,0', '3,0']);
    // The same walk WITHOUT Pass meets the first hidden foe, as before.
    const plain = hero(0, 0);
    const grid = makeGrid(['.......'], new Set(['2,0']));
    const scene = new BattleScene();
    Object.assign(scene, {
      _battleSession: 1,
      grid,
      playerUnits: [plain],
      enemyUnits: [foe(2, 0)],
      npcUnits: [],
      ballistas: [],
      gameData: { skills: data.skills },
    });
    const cut = scene._ambushCut(plain, { effectivePath: walk([0, 1, 2, 3, 4]), movementCost: 4, slideSegments: [] }); // prettier-ignore
    expect(cut.ambusher?.col).toBe(2);
    expect(keysOf(cut.path)).toEqual(['0,0', '1,0']);
  });
});

describe('enemies never get Pass, and a player’s Pass leaves their ranges alone', () => {
  it('Pass is a player option: an enemy mover never passes, even asked to', () => {
    expect(passesThrough(foe(1, 0), 'enemy')).toBe(false);
    expect(passesThrough({ faction: 'player' }, 'enemy')).toBe(false);
    const grid = makeGrid(['.....']);
    const mover = foe(0, 0);
    const wall = hero(2, 0);
    const positions = positionsOf(mover, wall);
    // Even with the option set, an enemy mover cannot pass through a player unit.
    const asked = computeMovementRange(grid, 0, 0, 4, 'Infantry', positions, 'enemy', 0, PASS);
    const normal = computeMovementRange(grid, 0, 0, 4, 'Infantry', positions, 'enemy', 0);
    expect(stoppable(asked)).toEqual(['0,0', '1,0']);
    expect(asked).toEqual(normal);
  });

  it('movementOptionsFor is false for an enemy that somehow carries the skill', () => {
    const enemy = foe(0, 0, { skills: ['pass'] });
    expect(effectiveSkills(enemy)).toContain('pass');
    expect(hasPass(enemy)).toBe(false);
    expect(movementOptionsFor(enemy)).toEqual({ pass: false });
    expect(movementOptionsFor(null)).toEqual({ pass: false });
  });

  it('an enemy’s threat is the same with or without a Pass unit among the player units', () => {
    const grid = makeGrid(['.........']);
    const enemy = foe(8, 0, { mov: 4, stats: { MOV: 4, HP: 20 } });
    const ctx = (player) => ({
      grid,
      enemyUnits: [enemy],
      ballistas: [],
      positions: () => positionsOf(player, enemy),
    });
    const withPass = enemyThreatTiles(ctx(hero(2, 0, { skills: ['pass'] })), enemy);
    const without = enemyThreatTiles(ctx(hero(2, 0)), enemy);
    expect(withPass).toEqual(without);
    expect([...withPass.damage].sort()).toEqual(['3,0', '4,0', '5,0', '6,0', '7,0', '8,0']);
  });

  it('the AI’s movement code never reads Pass (the file does not even import it)', () => {
    for (const file of ['src/engine/AIController.js', 'src/engine/ThreatForecast.js']) {
      const text = readFileSync(file, 'utf8');
      const reads = /hasPass|passesHiddenUnit|\bpass:\s*true/.test(text);
      expect(reads, file).toBe(false);
    }
    // ThreatForecast asks only for a unit's own reach, which is false for any enemy.
    expect(readFileSync('src/engine/ThreatForecast.js', 'utf8')).toMatch(
      /movementOptionsFor\(unit\)/,
    );
    expect(readFileSync('src/engine/AIController.js', 'utf8')).not.toMatch(/PassMovement/);
  });
});

describe('the one effective-skill model', () => {
  it('a Pass an accessory lends works exactly as a known one, and only while worn', () => {
    const known = hero(0, 0, { skills: ['pass'] });
    const lent = hero(0, 0, { accessory: { name: 'Speed Ring', _boundSkill: 'pass' } });
    const bare = hero(0, 0);
    expect(hasPass(known)).toBe(true);
    expect(hasPass(lent)).toBe(true);
    expect(hasPass(bare)).toBe(false);
    const grid = makeGrid(['.......']);
    const others = [foe(2, 0)];
    const of = (u) =>
      grid.getMovementRange(0, 0, 4, 'Infantry', positionsOf(u, ...others), 'player', 0, movementOptionsFor(u)); // prettier-ignore
    expect(of(lent)).toEqual(of(known));
    expect(stoppable(of(lent))).toContain('3,0');
    lent.accessory = null;
    expect(stoppable(of(lent))).not.toContain('3,0');
  });

  it('a benched Pass does nothing', () => {
    expect(hasPass(hero(0, 0, { skills: [], benchedSkills: ['pass'] }))).toBe(false);
  });

  it('the preview reach (unitReach) reads the same option', () => {
    const grid = makeGrid(['.......']);
    const me = hero(0, 0, { skills: ['pass'] });
    const blocker = foe(2, 0);
    const reach = unitReach(grid, me, { mov: 4, positions: positionsOf(me, blocker) });
    expect([...reach.moveRange.keys()]).toContain('4,0');
    expect(reach.moveRange.get('2,0').stoppable).toBe(false);
    const plain = unitReach(grid, hero(0, 0), { mov: 4, positions: positionsOf(me, blocker) });
    expect([...plain.moveRange.keys()]).not.toContain('4,0');
  });
});

describe('the headless harness moves a Pass unit through foes', () => {
  // A real HeadlessBattle on a corridor (row 2 plain, the rest wall): the only way east is
  // through the foe.
  function corridorBattle(skills) {
    installSeed(12345);
    const battle = new HeadlessBattle(data, { act: 'act1', objective: 'rout', row: 2 });
    battle.init();
    const { grid } = battle;
    grid.mapLayout = Array.from({ length: grid.rows }, (_, row) =>
      Array(grid.cols).fill(row === 2 ? T.Plain : T.Wall),
    );
    const me = battle.playerUnits[0];
    Object.assign(me, { col: 1, row: 2, skills, benchedSkills: [] });
    me.stats.MOV = 4;
    me.mov = 4;
    const blocker = battle.enemyUnits[0];
    Object.assign(blocker, { col: 2, row: 2 });
    // Everyone else out of the corridor's way (the wall rows hold them harmlessly).
    battle.playerUnits.slice(1).forEach((u, i) => Object.assign(u, { col: 10 + i, row: 0 }));
    battle.enemyUnits.slice(1).forEach((u, i) => Object.assign(u, { col: 10 + i, row: 8 }));
    return { battle, me, blocker };
  }

  it('without Pass the foe is a wall', () => {
    const { battle, me } = corridorBattle(['sol']);
    battle.selectUnit(me.name);
    expect(stoppable(battle.movementRange)).toEqual(['0,2', '1,2']);
    restoreMathRandom();
  });

  it('with Pass the unit selects, ranges and moves past the foe, never onto it', () => {
    const { battle, me, blocker } = corridorBattle(['pass']);
    battle.selectUnit(me.name);
    expect(stoppable(battle.movementRange)).toEqual(['0,2', '1,2', '3,2', '4,2', '5,2']);
    expect(battle.movementRange.get(`${blocker.col},${blocker.row}`).stoppable).toBe(false);
    expect(() => battle.moveTo(2, 2)).toThrow(/not reachable/);
    battle.moveTo(4, 2);
    expect([me.col, me.row]).toEqual([4, 2]);
    expect(me._movementSpent).toBe(3);
    restoreMathRandom();
  });

  it('a Pass an accessory lends moves the same way', () => {
    const { battle, me } = corridorBattle(['sol']);
    me.accessory = { name: 'Speed Ring', _boundSkill: 'pass' };
    battle.selectUnit(me.name);
    expect(stoppable(battle.movementRange)).toContain('4,2');
    restoreMathRandom();
  });

  it('the sims’ planner reads the same option', () => {
    expect(readFileSync('sim/lib/TacticianAgent.js', 'utf8')).toMatch(/movementOptionsFor\(unit\)/);
  });
});

describe('knowledge, once more: PlayerKnowledge itself', () => {
  it('a hidden foe is absent from the positions the preview range reads', () => {
    const grid = makeGrid(['.....'], new Set(['2,0']));
    const k = createPlayerKnowledge({ grid, units: [hero(0, 0), foe(2, 0)] });
    expect([...k.positions().keys()]).toEqual(['0,0']);
  });
});
