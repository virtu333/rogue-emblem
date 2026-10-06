// Forced slides (owner decision 2026-10-06): a unit another unit's action puts on Ice
// slides on, as it would have walked there, minus the movement cost. The rule is one
// pure function (IceMovement.traceForcedSlide) used by every forced displacement:
// Shove, Smite and the weapon-art push and ram (ForcedMovement.traceForcedMove).
//
// Every expected tile below is worked out by hand on a small layout, never by running
// the code under test; the one cross-check against code is the walking slide, which the
// forced slide must equal (the "parity" block), and that code is the shipping Grid.
import { describe, it, expect } from 'vitest';
import { loadGameData } from './testData.js';
import { HeadlessGrid } from './harness/HeadlessGrid.js';
import { computeEffectivePath } from '../src/engine/Grid.js';
import { traceForcedSlide } from '../src/engine/IceMovement.js';
import { traceForcedMove, findShoveTargets, settleShove } from '../src/engine/ForcedMovement.js';
import { findSmiteTargets, settleSmite, traceSmite } from '../src/engine/ActionAbilitySystem.js';
import { resolvePostCombatMove } from '../src/engine/WeaponArtPostCombat.js';
import { postCombatEffects } from '../src/engine/PostCombatEffects.js';
import { HOLD_AI_MODE } from '../src/engine/HoldDisturbance.js';

const gameData = loadGameData();
const T = Object.fromEntries(gameData.terrain.map((t, i) => [t.name, i]));
const GLYPH = {
  '.': T.Plain,
  i: T.Ice,
  '#': T.Wall,
  m: T.Mountain,
  w: T.Water,
  L: T['Lava Crack'],
  a: T['Acidic Bog'],
};

/** Rows of glyphs: '.' plain, 'i' ice, '#' wall, 'm' mountain, 'w' water, 'L' lava, 'a' acid. */
function gridOf(...lines) {
  const layout = lines.map((line) => [...line].map((ch) => GLYPH[ch]));
  return new HeadlessGrid(layout[0].length, layout.length, gameData.terrain, layout);
}

const unit = (name, col, row, extra = {}) => ({
  name,
  faction: 'player',
  col,
  row,
  currentHP: 20,
  stats: { HP: 30 },
  moveType: 'Infantry',
  skills: [],
  _conditions: [],
  ...extra,
});
const foe = (name, col, row, extra = {}) => unit(name, col, row, { faction: 'enemy', ...extra });

/** A probe of the tiles units hold: truthy (the unit) there, null elsewhere. */
function holding(...units) {
  return (col, row) => units.find((u) => u.col === col && u.row === row) || null;
}
const noOne = () => null;
const tiles = (path) => path.map((t) => [t.col, t.row]);
const E = { dc: 1, dr: 0 };
const W = { dc: -1, dr: 0 };
const S = { dc: 0, dr: 1 };

describe('traceForcedSlide: the rule', () => {
  const slide = (line, from, direction = E, extra = {}) => {
    const grid = gridOf(line);
    const pushed = unit('Pushed', from, 0, extra.unit);
    return traceForcedSlide(
      pushed,
      { col: from, row: 0 },
      direction,
      grid,
      extra.occupant || noOne,
    );
  };

  it.each([
    // [layout, entry tile, landing]: it ends ON the first tile that is not Ice
    ['.i....', 1, 2], // an ice line of one tile
    ['.ii...', 1, 3], // two
    ['.iii..', 1, 4], // three
    ['.iii..', 2, 4], // pushed onto the middle of a line: from there on
    ['.iii..', 3, 4], // onto its last tile
  ])('%s from column %i lands on %i, the first tile off the ice', (line, from, landing) => {
    const result = slide(line, from);
    expect([result.col, result.row]).toEqual([landing, 0]);
    expect(result).toMatchObject({ slid: true, stop: 'off_ice', blocker: null });
    // The path runs from the tile the push put it on to the landing, one tile at a time.
    expect(tiles(result.path)).toEqual(
      Array.from({ length: landing - from + 1 }, (_, k) => [from + k, 0]),
    );
  });

  it('does nothing on a tile that is not Ice, and a tile with no slide has no stop', () => {
    const result = slide('..i...', 0);
    expect(result).toMatchObject({ col: 0, row: 0, slid: false, stop: null, blocker: null });
    expect(tiles(result.path)).toEqual([[0, 0]]);
  });

  it('stops ON the last ice tile before a unit, and says which unit', () => {
    const wall = foe('Wall', 3, 0);
    const result = slide('.iii..', 1, E, { occupant: holding(wall) });
    expect([result.col, result.row]).toEqual([2, 0]);
    expect(result).toMatchObject({ slid: true, stop: 'unit' });
    expect(result.blocker).toBe(wall);
  });

  it('a unit on the very next tile means no slide at all: it stays on the entry tile', () => {
    const next = unit('Next', 2, 0);
    const result = slide('.iii..', 1, E, { occupant: holding(next) });
    expect(result).toMatchObject({ col: 1, row: 0, slid: false, stop: 'unit' });
    expect(result.blocker).toBe(next);
  });

  it('a unit on the first tile off the ice holds it on the last ice tile', () => {
    // Walking: the slide's landing must be free, or the unit stops short of it.
    const result = slide('.ii...', 1, E, { occupant: holding(unit('Blocker', 3, 0)) });
    expect([result.col, result.row]).toEqual([2, 0]);
    expect(result.stop).toBe('unit');
  });

  it('a unit beyond the landing is nothing to it', () => {
    const result = slide('.i....', 1, E, { occupant: holding(unit('Far', 3, 0)) });
    expect([result.col, result.row]).toEqual([2, 0]);
    expect(result.stop).toBe('off_ice');
  });

  it('stops ON the last ice tile before a wall, and in place when the wall is next', () => {
    expect(slide('.ii#..', 1)).toMatchObject({ col: 2, row: 0, slid: true, stop: 'terrain' });
    expect(slide('.i#...', 1)).toMatchObject({ col: 1, row: 0, slid: false, stop: 'terrain' });
  });

  it('stops ON the last ice tile at the map edge, and in place when the edge is next', () => {
    expect(slide('.ii', 1)).toMatchObject({ col: 2, row: 0, slid: true, stop: 'edge' });
    expect(slide('..i', 2)).toMatchObject({ col: 2, row: 0, slid: false, stop: 'edge' });
  });

  it('never goes onto ground its move type cannot stand on: it stops before it', () => {
    // A mountain: Infantry stand on it (so the slide ends there), Cavalry and Armored do not.
    expect(slide('.iim.', 1)).toMatchObject({ col: 3, row: 0, stop: 'off_ice' });
    expect(slide('.iim.', 1, E, { unit: { moveType: 'Cavalry' } })).toMatchObject({
      col: 2,
      row: 0,
      stop: 'terrain',
    });
    expect(slide('.iim.', 1, E, { unit: { moveType: 'Armored' } })).toMatchObject({
      col: 2,
      row: 0,
      stop: 'terrain',
    });
    // Water: nobody on foot or horseback.
    for (const moveType of ['Infantry', 'Cavalry', 'Armored'])
      expect(slide('.iiw..', 1, E, { unit: { moveType } })).toMatchObject({
        col: 2,
        row: 0,
        stop: 'terrain',
      });
  });

  it('fliers do not slide, as when walking', () => {
    for (const line of ['.i....', '.iii..', '.iiw..']) {
      const result = slide(line, 1, E, { unit: { moveType: 'Flying' } });
      expect(result).toMatchObject({ col: 1, row: 0, slid: false, stop: null });
    }
  });

  it('is the push direction only, never diagonal, and no direction is no slide', () => {
    const grid = gridOf('.i..', '..i.', '....');
    const pushed = unit('Pushed', 1, 0);
    const from = { col: 1, row: 0 };
    for (const direction of [{ dc: 1, dr: 1 }, { dc: -1, dr: 1 }, { dc: 0, dr: 0 }, null])
      expect(traceForcedSlide(pushed, from, direction, grid, noOne)).toMatchObject({
        col: 1,
        row: 0,
        slid: false,
      });
  });

  it('runs in every cardinal direction', () => {
    // North-south: a column of ground, ice, ice, ground.
    const column = gridOf('.', 'i', 'i', '.', '.');
    const pushed = unit('Pushed', 0, 1);
    expect(traceForcedSlide(pushed, { col: 0, row: 1 }, S, column, noOne)).toMatchObject({
      col: 0,
      row: 3,
    });
    expect(
      traceForcedSlide(unit('Up', 0, 2), { col: 0, row: 2 }, { dc: 0, dr: -1 }, column, noOne),
    ).toMatchObject({ col: 0, row: 0 });
    // West.
    expect(slide('.ii.', 2, W)).toMatchObject({ col: 0, row: 0, stop: 'off_ice' });
  });

  it('ends on lava or acid like any tile it lands on, and does nothing to the unit', () => {
    for (const hazard of ['L', 'a']) {
      const pushed = unit('Pushed', 1, 0, { currentHP: 12 });
      const grid = gridOf(`.i${hazard}.`);
      const result = traceForcedSlide(pushed, { col: 1, row: 0 }, E, grid, noOne);
      expect([result.col, result.row]).toEqual([2, 0]);
      // Pure: the tracer neither moves the unit nor touches its HP; the ground works on
      // it at the end of its phase, as after any move.
      expect([pushed.col, pushed.row, pushed.currentHP]).toEqual([1, 0, 12]);
    }
  });

  it('a grid that can say nothing of terrain has no ice', () => {
    const grid = { cols: 6, rows: 1, getMoveCost: () => 1 };
    expect(traceForcedSlide(unit('P', 1, 0), { col: 1, row: 0 }, E, grid, noOne)).toMatchObject({
      col: 1,
      slid: false,
    });
  });
});

describe('traceForcedSlide equals walking onto the same ice (computeEffectivePath)', () => {
  // The same layouts, move types and bodies; the walker steps onto the entry tile from the
  // tile behind it, the pushed unit is put there. The slide must end on the same tile.
  const cases = [
    ['.i....', 'Infantry', []],
    ['.iii..', 'Infantry', []],
    ['.iii..', 'Infantry', [[3, 0]]],
    ['.ii...', 'Infantry', [[3, 0]]],
    ['.ii#..', 'Infantry', []],
    ['.i#...', 'Infantry', []],
    ['.ii', 'Infantry', []],
    ['.iim.', 'Infantry', []],
    ['.iim.', 'Cavalry', []],
    ['.iim.', 'Armored', []],
    ['.iiw.', 'Infantry', []],
    ['.iiL.', 'Infantry', []],
    ['.i.i..', 'Infantry', []],
  ];
  it.each(cases)('%s (%s, held tiles %j)', (line, moveType, held) => {
    const grid = gridOf(line);
    const occupied = new Set(held.map(([c, r]) => `${c},${r}`));
    const walked = computeEffectivePath(
      [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
      ],
      grid.mapLayout,
      grid.terrainData,
      grid.cols,
      grid.rows,
      moveType,
      occupied,
    ).effectivePath;
    const pushed = unit('Pushed', 1, 0, { moveType });
    const forced = traceForcedSlide(
      pushed,
      { col: 1, row: 0 },
      E,
      grid,
      (c, r) => occupied.has(`${c},${r}`) || null,
    );
    expect(tiles(forced.path)).toEqual(tiles(walked.slice(1)));
  });
});

describe('traceForcedMove: a push, then the slide', () => {
  const move = (line, start, distance, extra = {}) => {
    const grid = gridOf(line);
    const pushed = unit('Pushed', start, 0, extra.unit);
    return traceForcedMove(pushed, 1, 0, distance, grid, extra.occupant, extra.slideOccupant);
  };

  it('is plain walking-free distance on open ground', () => {
    expect(move('......', 1, 2)).toMatchObject({ col: 3, steps: 2, slid: false, stop: null });
  });

  it('a push of two whose first tile is Ice slides the rest of the way and on', () => {
    // '.i...' from column 0: tile 1 is ice, the slide lands on tile 2, which is also where
    // two plain tiles would have put it: ice never makes a push shorter.
    expect(move('.i....', 0, 2)).toMatchObject({ col: 2, steps: 2, slid: true });
    // Ice on tiles 1 and 2: the slide carries it to the first plain tile, 3.
    expect(move('.ii...', 0, 2)).toMatchObject({ col: 3, steps: 3, slid: true });
  });

  it('a push of two whose second tile is Ice slides on from there', () => {
    // '..i..': plain at 1, ice at 2, the slide lands on 3 (past the push's reach).
    expect(move('..i...', 0, 2)).toMatchObject({ col: 3, steps: 3, slid: true });
    expect(move('..ii..', 0, 2)).toMatchObject({ col: 4, steps: 4, slid: true });
  });

  it('a slid tile is a tile of the push: distance left over goes on from the landing', () => {
    // Distance 3 with ice at tile 1: slide to 2 (two tiles spent), one tile of push left,
    // so it ends on 3, as on plain ground; ice did not shorten the push.
    expect(move('.i....', 0, 3)).toMatchObject({ col: 3, steps: 3 });
    // The leftover push can enter more ice, and that slides too.
    expect(move('.i.i...', 0, 3)).toMatchObject({ col: 4, steps: 4 });
  });

  it('marks the tiles of the slide, the ice entry included, for the presentation', () => {
    const result = move('..ii..', 0, 2);
    expect(result.path.map((t) => [t.col, t.row, t.slide === true])).toEqual([
      [0, 0, false],
      [1, 0, false],
      [2, 0, true],
      [3, 0, true],
      [4, 0, true],
    ]);
  });

  it('a push is stopped before the edge, ground it cannot stand on or a unit: no slide, no step', () => {
    expect(move('.i', 0, 2)).toMatchObject({ col: 1, steps: 1, stop: 'edge' });
    expect(move('.#..', 0, 2)).toMatchObject({ col: 0, steps: 0, stop: 'terrain' });
    const blocker = foe('Blocker', 2, 0);
    const result = move('....', 0, 2, { occupant: holding(blocker) });
    expect(result).toMatchObject({ col: 1, steps: 1, stop: 'unit', stoppedShort: true });
    expect(result.blocker).toBe(blocker);
  });

  it('a push stopped on ice by a unit is stopped short; a slide held after the push was spent is not', () => {
    const blocker = foe('Blocker', 2, 0);
    // Tile 1 is ice, tile 2 is held: the push (distance 2) was stopped short.
    expect(move('.i..', 0, 2, { occupant: holding(blocker) })).toMatchObject({
      col: 1,
      stoppedShort: true,
    });
    // Tiles 2 and 3 are ice and a wall follows: the push got its 2 tiles, then the slide
    // was held at 3 (4 tiles moved against a push of 2): nothing was stopped short.
    expect(move('..ii#.', 0, 2)).toMatchObject({
      col: 3,
      steps: 3,
      stop: 'terrain',
      stoppedShort: false,
    });
  });

  it('the push reads the board as chosen, the slide the board it is given', () => {
    // A fogged tile (3, 0) counts as taken for the push's tiles but is no body to a slide.
    const fogged = (col) => (col === 3 ? true : null);
    // Push of 1 onto ice at 1, ice at 2 and 3 (fogged), ground at 4.
    const result = move('.iii..', 0, 1, { occupant: fogged, slideOccupant: noOne });
    expect([result.col, result.steps]).toEqual([4, 4]);
    // With the fog read as a body for the slide too, it would have stopped at 2.
    expect(move('.iii..', 0, 1, { occupant: fogged }).col).toBe(2);
    // A push into the fogged tile itself is no push.
    expect(move('...i..', 2, 1, { occupant: fogged, slideOccupant: noOne }).steps).toBe(0);
  });

  it('fliers are pushed their distance and never slide', () => {
    expect(move('.ii...', 0, 2, { unit: { moveType: 'Flying' } })).toMatchObject({
      col: 2,
      steps: 2,
      slid: false,
    });
  });
});

describe('Shove', () => {
  const shove = (line, { ally = 1, others = [], fog = noOne, slideProbe = null } = {}) => {
    const grid = gridOf(line);
    const shover = unit('Shover', 0, 0);
    const pushed = unit('Ally', ally, 0);
    const bodies = [shover, pushed, ...others];
    const seen = (col, row) => fog(col, row) || holding(...bodies)(col, row);
    const ctx = {
      grid,
      allies: bodies.filter((u) => u.faction === 'player'),
      getUnitAt: seen,
      slideUnitAt: slideProbe || undefined,
    };
    return { grid, shover, pushed, targets: findShoveTargets(shover, ctx), ctx, bodies };
  };

  it('puts an ally one tile on plain ground, as before (no ice, no change)', () => {
    const { targets } = shove('......');
    expect(targets).toHaveLength(1);
    expect([targets[0].destCol, targets[0].destRow, targets[0].steps, targets[0].slid]).toEqual([
      2,
      0,
      1,
      false,
    ]);
  });

  it.each([
    ['..i...', 3], // one ice tile: slides to the first plain tile past it
    ['..ii..', 4], // two
    ['..iii.', 5], // three
  ])('shoving an ally onto ice (%s) slides it to column %i', (line, landing) => {
    const { targets } = shove(line);
    expect([targets[0].destCol, targets[0].destRow]).toEqual([landing, 0]);
    expect(targets[0].slid).toBe(true);
  });

  it('the settle moves the ally to the end of the slide and carries the tiles', () => {
    const { targets, pushed, shover } = shove('..ii..');
    const result = settleShove(targets[0]);
    expect([pushed.col, pushed.row]).toEqual([4, 0]);
    expect([shover.col, shover.row]).toEqual([0, 0]);
    expect(result.moves).toHaveLength(1);
    expect(result.moves[0]).toMatchObject({ unit: pushed, from: { col: 1, row: 0 } });
    expect(result.moves[0].to).toEqual({ col: 4, row: 0 });
    expect(tiles(result.moves[0].path)).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ]);
  });

  it('a slide held by an ally, a wall or the edge stops on the ice', () => {
    const friend = unit('Friend', 4, 0);
    expect(shove('..iii.', { others: [friend] }).targets[0]).toMatchObject({ destCol: 3 });
    expect(shove('..ii#.').targets[0]).toMatchObject({ destCol: 3 });
    expect(shove('..ii').targets[0]).toMatchObject({ destCol: 3 });
  });

  it('is not offered when the first tile is taken, impassable or fogged (as before)', () => {
    expect(shove('..#...').targets).toEqual([]);
    expect(shove('......', { others: [foe('Foe', 2, 0)] }).targets).toEqual([]);
    expect(shove('......', { fog: (c) => (c === 2 ? true : null) }).targets).toEqual([]);
    // A tile that is not the first (the slide's) never takes the option away.
    expect(
      shove('..ii..', { fog: (c) => (c === 3 ? true : null), slideProbe: noOne }).targets,
    ).toHaveLength(1);
  });

  it('an ally the shove puts on lava or acid stays there, unhurt (the ground works at phase end)', () => {
    for (const hazard of ['L', 'a']) {
      const { targets, pushed } = shove(`..i${hazard}.`);
      expect([targets[0].destCol, targets[0].destRow]).toEqual([3, 0]);
      settleShove(targets[0]);
      expect([pushed.col, pushed.currentHP]).toEqual([3, 20]);
    }
  });

  it('a mounted ally stops before a mountain it cannot stand on; one on foot does not', () => {
    const grid = gridOf('..im..');
    const run = (moveType) => {
      const shover = unit('Shover', 0, 0);
      const pushed = unit('Ally', 1, 0, { moveType });
      const [target] = findShoveTargets(shover, {
        grid,
        allies: [shover, pushed],
        getUnitAt: holding(shover, pushed),
      });
      return target.destCol;
    };
    expect(run('Infantry')).toBe(3);
    expect(run('Cavalry')).toBe(2);
  });

  it('a flying ally is shoved one tile and stays', () => {
    const grid = gridOf('..ii..');
    const shover = unit('Shover', 0, 0);
    const pushed = unit('Ally', 1, 0, { moveType: 'Flying' });
    const [target] = findShoveTargets(shover, {
      grid,
      allies: [shover, pushed],
      getUnitAt: holding(shover, pushed),
    });
    expect([target.destCol, target.slid]).toEqual([2, false]);
  });

  it('settles on the real board: a body the preview did not know of holds the slide', () => {
    // Preview over known units only: the ally is offered a landing on 4. A hidden foe on 3
    // is not in the preview, and holds the ally on the ice at 2 when it really slides.
    const hidden = foe('Hidden', 3, 0);
    const { targets, ctx, pushed, shover } = shove('..iii.');
    expect(targets[0].destCol).toBe(5);
    const knownOnly = (c, r) => holding(...ctx.allies)(c, r);
    const preview = findShoveTargets(shover, { ...ctx, slideUnitAt: knownOnly });
    expect(preview[0].destCol).toBe(5);
    const result = settleShove(preview[0], {
      grid: ctx.grid,
      getUnitAt: ctx.getUnitAt,
      slideUnitAt: holding(hidden, ...ctx.allies),
    });
    expect([pushed.col, pushed.row]).toEqual([2, 0]);
    expect(result.blocker).toBe(hidden);
  });
});

describe('Smite', () => {
  const ABILITY = { kind: 'push_enemy', distance: 2 };
  const smite = (line, { target = 6, others = [], probe = null, unitExtra = {} } = {}) => {
    const grid = gridOf(line);
    const caster = unit('Caster', 5, 0);
    const victim = foe('Brigand', target, 0, unitExtra);
    const bodies = [caster, victim, ...others];
    const entries = findSmiteTargets(caster, ABILITY, {
      grid,
      getUnitAt: holding(...bodies),
      slideUnitAt: probe || undefined,
      enemies: [victim, ...others.filter((u) => u.faction === 'enemy')],
      affixes: gameData.affixes,
    });
    return { grid, caster, victim, bodies, entries, entry: entries[0] };
  };
  const land = (entry) => [entry.destCol, entry.destRow];

  it('on plain ground pushes two tiles, as before', () => {
    expect(land(smite('...........').entry)).toEqual([8, 0]);
  });

  it('first tile Ice: the foe slides on from it', () => {
    // 5 caster, 6 foe, 7 ice, 8 plain: the slide lands on 8, the same two tiles.
    const { entry } = smite('.......i....');
    expect(land(entry)).toEqual([8, 0]);
    expect(entry).toMatchObject({ slid: true, steps: 2 });
    // Ice on 7 and 8: the slide runs to the first plain tile, 9.
    expect(land(smite('.......ii...').entry)).toEqual([9, 0]);
  });

  it('second tile Ice: the foe slides on from it, past the push', () => {
    const { entry } = smite('........i...');
    expect(land(entry)).toEqual([9, 0]);
    expect(entry).toMatchObject({ slid: true, steps: 3 });
    // Ice on 8 and 9 to the edge of a 10-wide board: held on the last ice tile.
    expect(land(smite('........ii').entry)).toEqual([9, 0]);
  });

  it('the slide is held by a unit, a wall or the edge, on the ice', () => {
    const wall = foe('Wall', 9, 0);
    expect(land(smite('.......ii...', { others: [wall] }).entry)).toEqual([8, 0]);
    expect(land(smite('.......ii#..').entry)).toEqual([8, 0]);
    expect(land(smite('.......ii').entry)).toEqual([8, 0]);
  });

  it('the push is held by a unit on its second tile: one tile, on the ice, no slide beyond', () => {
    // First tile ice (7), second held: the foe stops on 7.
    const second = foe('Second', 8, 0);
    const { entry } = smite('.......i....', { others: [second] });
    expect(land(entry)).toEqual([7, 0]);
    expect(entry.steps).toBe(1);
  });

  it('is not offered when the first tile is blocked, ice or not', () => {
    expect(smite('.......#....').entries).toEqual([]);
    expect(smite('.......i....', { others: [foe('Behind', 7, 0)] }).entries).toEqual([]);
  });

  it('a flying foe is pushed two tiles and does not slide', () => {
    const { entry } = smite('.......ii...', { unitExtra: { moveType: 'Flying' } });
    expect(land(entry)).toEqual([8, 0]);
    expect(entry.slid).toBe(false);
  });

  it('a foe that cannot stand on the ground past the ice stops on the ice', () => {
    const { entry } = smite('.......im...', { unitExtra: { moveType: 'Cavalry' } });
    expect(land(entry)).toEqual([7, 0]);
    expect(land(smite('.......im...').entry)).toEqual([8, 0]);
  });

  it('settles at the end of the slide, moves only the foe and marks a holder disturbed', () => {
    const holder = { aiMode: HOLD_AI_MODE, holdPack: 2, holdPackSize: 2 };
    const { entry, victim, caster } = smite('.......ii...', { unitExtra: holder });
    const result = settleSmite(entry);
    expect([victim.col, victim.row]).toEqual([9, 0]);
    expect([caster.col, caster.row]).toEqual([5, 0]);
    expect(victim.holdDisturbed).toBe('moved');
    expect(victim.currentHP).toBe(20);
    expect(result.moves[0]).toMatchObject({ unit: victim, from: { col: 6, row: 0 } });
    expect(result.moves[0].to).toEqual({ col: 9, row: 0 });
    expect(tiles(result.moves[0].path)).toEqual([
      [6, 0],
      [7, 0],
      [8, 0],
      [9, 0],
    ]);
  });

  it('a foe smitten onto lava stands on it, unhurt; the phase end burns it', () => {
    const { entry, victim } = smite('.......iL...');
    expect(land(entry)).toEqual([8, 0]);
    settleSmite(entry);
    expect([victim.col, victim.currentHP]).toEqual([8, 20]);
  });

  it('the settle over the real board is stopped by a body the preview did not know', () => {
    const hidden = foe('Hidden', 9, 0);
    const known = smite('.......iii...', { probe: noOne });
    expect(land(known.entry)).toEqual([10, 0]);
    const world = {
      grid: known.grid,
      getUnitAt: holding(known.caster, known.victim),
      slideUnitAt: holding(known.caster, known.victim, hidden),
    };
    const result = settleSmite(known.entry, world);
    expect([known.victim.col, known.victim.row]).toEqual([8, 0]);
    expect(result.steps).toBe(2);
  });

  it('traceSmite keeps its old contract: null when nothing moves, a tile otherwise', () => {
    const grid = gridOf('......#...');
    expect(traceSmite(foe('B', 5, 0), 1, 0, 2, grid, noOne)).toBeNull();
    expect(traceSmite(foe('B', 3, 0), 1, 0, 2, grid, noOne)).toMatchObject({ col: 5, steps: 2 });
  });
});

describe('weapon-art push and ram', () => {
  // The art's user is the attacker at column 1; the target stands beside it at column 2.
  const world = (line, units, extra = {}) => {
    const grid = gridOf(line);
    return {
      affixes: gameData.affixes,
      cols: grid.cols,
      rows: grid.rows,
      getMoveCost: (c, r, moveType) => grid.getMoveCost(c, r, moveType),
      getTerrainAt: (c, r) => grid.getTerrainAt(c, r),
      getUnitAt: (c, r) => units.find((u) => u.col === c && u.row === r && u.currentHP > 0) || null,
      hostilesOf: (u) => units.filter((o) => o.faction !== u.faction),
      alliesOf: (u) => units.filter((o) => o.faction === u.faction),
      turnNumber: 1,
      ...extra,
    };
  };
  const resolve = (mode, distance, line, units, { source, target }) => {
    const w = world(line, units);
    return resolvePostCombatMove({
      sourceUnit: source,
      targetUnit: target,
      mode,
      distance,
      cols: w.cols,
      rows: w.rows,
      getMoveCost: w.getMoveCost,
      getUnitAt: w.getUnitAt,
      getTerrainAt: w.getTerrainAt,
    });
  };
  const setup = (extra = {}) => {
    const source = unit('Lancer', 1, 0);
    const target = foe('Target', 2, 0, extra);
    return { source, target, units: [source, target] };
  };

  it('a push (distance 1) onto ice slides the target on', () => {
    const s = setup();
    // 3 is ice, 4 plain: pushed from 2 onto 3, it slides to 4.
    const result = resolve('push', 1, '...i....', s.units, s);
    expect(result.ok).toBe(true);
    expect(result.assignments).toHaveLength(1);
    expect([result.assignments[0].col, result.assignments[0].row]).toEqual([4, 0]);
    expect(result.assignments[0].slid).toBe(true);
    expect(tiles(result.assignments[0].path)).toEqual([
      [2, 0],
      [3, 0],
      [4, 0],
    ]);
  });

  it('a push onto plain ground is exactly as before', () => {
    const s = setup();
    const result = resolve('push', 1, '........', s.units, s);
    expect(result.assignments).toEqual([{ unit: s.target, col: 3, row: 0 }]);
  });

  it('a push held in place by the very next tile still fails as blocked', () => {
    const s = setup();
    expect(resolve('push', 1, '...#....', s.units, s)).toEqual({ ok: false, reason: 'blocked' });
  });

  it('a push onto ice held by a unit is not blocked: the target stays on the ice', () => {
    const s = setup();
    const wall = foe('Wall', 4, 0);
    const result = resolve('push', 1, '...ii...', [...s.units, wall], s);
    expect(result.ok).toBe(true);
    expect([result.assignments[0].col]).toEqual([3]);
  });

  it('a ram (distance 2) with ice on its first tile slides on and does not crash', () => {
    const s = setup();
    // Tile 3 is ice, 4 plain: the slide lands on 4 (two tiles). No collision.
    const result = resolve('ram', 2, '...i....', s.units, s);
    expect([result.assignments[0].col, result.collision]).toEqual([4, null]);
    // Ice on 3 and 4: it lands on 5.
    expect(resolve('ram', 2, '...ii...', s.units, s).assignments[0].col).toBe(5);
  });

  it('a ram with ice on its second tile slides past the push', () => {
    const s = setup();
    expect(resolve('ram', 2, '....i...', s.units, s).assignments[0].col).toBe(5);
  });

  it('a ram stopped short on the ice crashes; a slide held after the push was spent does not', () => {
    const s = setup();
    const foeAt4 = foe('Obstacle', 4, 0);
    // Tile 3 ice, tile 4 held: the ram was stopped after one tile, on the ice: a crash.
    const crash = resolve('ram', 2, '...i....', [...s.units, foeAt4], s);
    expect([crash.assignments[0].col, crash.collision.obstacle]).toEqual([3, foeAt4]);
    // Tiles 4 and 5 ice, a wall at 6: the ram got both its tiles, the slide stops at 5.
    const held = resolve('ram', 2, '....ii#.', s.units, s);
    expect([held.assignments[0].col, held.collision]).toEqual([5, null]);
  });

  it('a ram into a wall with no ice is unchanged: one tile, a crash with nothing', () => {
    const s = setup();
    const result = resolve('ram', 2, '....#...', s.units, s);
    expect([result.assignments[0].col, result.collision]).toEqual([3, { obstacle: null }]);
  });

  it('a flying target is rammed its distance and never slides', () => {
    const s = setup({ moveType: 'Flying' });
    expect(resolve('ram', 2, '...ii...', s.units, s).assignments[0]).toEqual({
      unit: s.target,
      col: 4,
      row: 0,
    });
  });

  it("the user's own moves (advance, retreat, through) are not forced and do not slide", () => {
    const s = setup();
    // Advance: after a kill the user steps into the target's tile, here ice, and stays.
    const felled = setup();
    felled.target.currentHP = 0;
    const advance = resolve('advance', 1, '..i.....', felled.units, felled);
    expect(advance.assignments).toEqual([{ unit: felled.source, col: 2, row: 0 }]);
    const retreat = resolve('retreat', 1, 'i.......', s.units, s);
    expect(retreat.assignments).toEqual([{ unit: s.source, col: 0, row: 0 }]);
    const through = resolve('through', 1, '...i....', s.units, s);
    expect(through.assignments[0]).toEqual({ unit: s.source, col: 3, row: 0 });
    expect(through.assignments[0].path).toBeUndefined();
  });

  it('through the real pipeline: the push moves the unit, marks the pack and yields the slide to draw', () => {
    // Fixture art: push 1 after a landed hit.
    const art = {
      id: 'fixture_push',
      targeting: 'normal_attack',
      effects: { afterCombat: [{ type: 'move', mode: 'push', distance: 1 }] },
      combatMods: {},
    };
    const holder = { aiMode: HOLD_AI_MODE, holdPack: 4, holdPackSize: 2 };
    const attacker = unit('Lancer', 1, 0);
    const defender = foe('Target', 2, 0, holder);
    const units = [attacker, defender];
    const result = {
      events: [{ type: 'strike', attackerSide: 'attacker', miss: false, damage: 1 }],
    };
    const beats = [
      ...postCombatEffects(
        { attacker, defender, result, attackerWeaponArt: art },
        world('...ii...', units),
      ),
    ];
    expect([defender.col, defender.row]).toEqual([5, 0]);
    expect(defender.holdDisturbed).toBe('moved');
    const moved = beats.find((b) => b.kind === 'moved');
    expect(moved.units).toEqual([defender]);
    expect(moved.slides).toHaveLength(1);
    expect(moved.slides[0]).toMatchObject({ unit: defender, from: { col: 2, row: 0 } });
    expect(moved.slides[0].to).toEqual({ col: 5, row: 0 });
    expect(tiles(moved.slides[0].path)).toEqual([
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 0],
    ]);
    // On plain ground the beat carries no slide.
    const plain = foe('Target', 2, 0);
    const none = [
      ...postCombatEffects(
        { attacker, defender: plain, result, attackerWeaponArt: art },
        world('........', [attacker, plain]),
      ),
    ].find((b) => b.kind === 'moved');
    expect(none.slides).toBeUndefined();
  });
});

describe('Pull: the pulled ally cannot slide, because the puller holds the next tile', () => {
  it("lands on the puller's old tile, which may be Ice, and goes no further", () => {
    // Puller at 3 on ice steps back to 4; the ally from 2 lands on 3 (ice). The next tile,
    // 4, is where the puller now stands: the ally's slide is held on the spot.
    const grid = gridOf('...i...');
    const ally = unit('Ally', 3, 0);
    const puller = unit('Puller', 4, 0);
    const result = traceForcedSlide(ally, { col: 3, row: 0 }, E, grid, holding(puller, ally));
    expect(result).toMatchObject({ col: 3, row: 0, slid: false, stop: 'unit' });
    expect(result.blocker).toBe(puller);
  });
});
