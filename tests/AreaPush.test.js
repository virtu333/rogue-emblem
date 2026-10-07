// AreaPush — Override's push, planned and executed (docs/specs/phase3.md 3F). The plan is pure
// and runs over whatever board it is handed, so the same code serves the generator that moves
// units (the real board) and the preview that draws the move (the board the player knows).
// Boards are one row, row 3: the attacker on col 1, the target on col 2, the line on cols 3
// and 4 (Skewer's two tiles behind the target), so a push moves everyone one col east.
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import { planAreaPush } from '../src/engine/AreaPush.js';
import { areaForecastLines, previewAreaArt } from '../src/engine/AreaPreview.js';
import { createPlayerKnowledge } from '../src/engine/PlayerKnowledge.js';
import { postCombatEffects } from '../src/engine/PostCombatEffects.js';
import { getPostCombatPipelineSteps } from '../src/engine/WeaponArtPostCombat.js';
import { getWeaponArtArea, getWeaponArtCombatMods } from '../src/engine/WeaponArtSystem.js';
import { combatStrikeMods, mergeCombatMods } from '../src/engine/Combat.js';
import { applyCondition } from '../src/engine/StatusConditionSystem.js';

const data = loadGameData();
const art = data.weaponArts.arts.find((a) => a.id === 'lance_override');
const area = getWeaponArtArea(art);
const iceTerrain = data.terrain.find((t) => t.name === 'Ice');
const weapon = () => structuredClone(data.weapons.find((w) => w.name === 'Steel Lance'));

const unit = (name, faction, col, hp = 30, extra = {}) => ({
  name,
  faction,
  col,
  row: 3,
  level: 5,
  moveType: 'Infantry',
  currentHP: hp,
  stats: { HP: 30, STR: 12, MAG: 0, SKL: 0, SPD: 0, DEF: 4, RES: 0, LCK: 0, MOV: 5 },
  ...extra,
});

function setup(extras = {}, land = {}) {
  const attacker = unit('Lancer', 'player', 1, 40, { weapon: weapon() });
  const target = unit('Primary', 'enemy', 2, 30, extras.primary);
  const near = unit('Near', 'enemy', 3, 30, extras.near);
  const far = unit('Far', 'enemy', 4, 30, extras.far);
  const foes = [target, near, far];
  const everyone = [attacker, ...foes, ...(extras.others || [])];
  const walls = land.walls || [];
  const ice = land.ice || [];
  const world = {
    cols: 8,
    rows: 8,
    affixes: data.affixes,
    getMoveCost: (col, row) => (walls.includes(`${col},${row}`) ? Infinity : 1),
    getTerrainAt: (col, row) => (ice.includes(`${col},${row}`) ? iceTerrain : null),
    getUnitAt: (col, row) =>
      everyone.find((u) => u.col === col && u.row === row && u.currentHP > 0) || null,
    hostilesOf: (u) => (u.faction === 'enemy' ? [attacker] : foes),
    alliesOf: () => [],
    turnNumber: 1,
  };
  return { attacker, target, near, far, foes, world };
}

const plan = ({ attacker, target, foes, world }, extra = {}) =>
  planAreaPush({
    source: attacker,
    primary: target,
    area,
    distance: 1,
    units: foes,
    world,
    getUnitAt: world.getUnitAt,
    ...extra,
  });

describe('planAreaPush', () => {
  it('pushes the farthest first and every unit once, the target included', () => {
    const board = setup();
    const { direction, entries } = plan(board);
    expect(direction).toEqual({ dc: 1, dr: 0 });
    expect(entries.map((e) => e.unit.name)).toEqual(['Far', 'Near', 'Primary']);
    expect(entries.map((e) => [e.from.col, e.to.col, e.moved])).toEqual([
      [4, 5, true],
      [3, 4, true],
      [2, 3, true],
    ]);
    // Planning moves nothing.
    expect([board.target, board.near, board.far].map((u) => u.col)).toEqual([2, 3, 4]);
  });

  it('plans nothing from range: a push needs the user cardinally next to the target', () => {
    const board = setup();
    board.attacker.col = 0;
    expect(plan(board)).toEqual({ direction: null, entries: [] });
    board.attacker.col = 1;
    board.attacker.row = 4; // beside it diagonally
    expect(plan(board).entries).toEqual([]);
  });

  it('a wall, an edge or another unit stops a push; the unit stays and the ones behind it too', () => {
    const walled = plan(setup({}, { walls: ['5,3'] }));
    expect(walled.entries.map((e) => [e.unit.name, e.moved, e.reason])).toEqual([
      ['Far', false, 'blocked'],
      ['Near', false, 'blocked'],
      ['Primary', false, 'blocked'],
    ]);
    // A bystander behind Far blocks it just the same, whoever it is.
    const crowded = setup({ others: [unit('Ally', 'enemy', 5)] });
    expect(plan(crowded).entries.every((e) => !e.moved)).toBe(true);
    // At the edge of the map.
    const edge = setup();
    edge.far.col = 7;
    edge.near.col = 6;
    edge.target.col = 5;
    edge.attacker.col = 4;
    const edgePlan = plan(edge);
    expect(edgePlan.entries.map((e) => e.moved)).toEqual([false, false, false]);
  });

  it('a boss, the Entity, an Anchored or rooted foe stays, and blocks the one before it', () => {
    const pinned = (extra) => plan(setup({ near: extra }));
    const rooted = setup();
    applyCondition(rooted.near, 'root', 3, { recoveryChance: 0 });
    for (const [extra, reason] of [
      [{ isBoss: true }, 'boss'],
      [{ affixes: ['anchored'] }, 'anchored'],
    ]) {
      const { entries } = pinned(extra);
      const near = entries.find((e) => e.unit.name === 'Near');
      expect([near.moved, near.reason], reason).toEqual([false, reason]);
      // Far still goes, the target behind the pinned foe cannot.
      expect(entries.find((e) => e.unit.name === 'Far').moved).toBe(true);
      expect(entries.find((e) => e.unit.name === 'Primary').moved).toBe(false);
    }
    const rootedPlan = plan(rooted);
    expect(rootedPlan.entries.find((e) => e.unit.name === 'Near').reason).toBe('rooted');
    // The Entity (a 3x3 body anchored at its top-left tile) never moves either.
    const entity = plan(setup({ near: { isEntity: true, isBoss: true }, far: { col: 7, row: 7 } }));
    expect(entity.entries.find((e) => e.unit.name === 'Near')).toMatchObject({
      moved: false,
      reason: 'entity',
    });
  });

  it('a pushed foe slides on Ice, and the next foe follows into the room it leaves', () => {
    const board = setup({}, { ice: ['5,3'] });
    const { entries } = plan(board);
    const far = entries[0];
    expect([far.moved, far.to.col, far.slid]).toEqual([true, 6, true]);
    expect(far.path.map((t) => t.col)).toEqual([4, 5, 6]);
    expect(entries.map((e) => e.to.col)).toEqual([6, 4, 3]);
  });

  it('never pushes a foe the plan is told has fallen, and a fallen foe blocks nothing', () => {
    const board = setup();
    const { entries } = plan(board, { felled: [board.near] });
    expect(entries.map((e) => e.unit.name)).toEqual(['Far', 'Primary']);
    // Near's tile is free for the target.
    expect(entries.map((e) => e.to.col)).toEqual([5, 3]);
    // A dead target is not pushed either.
    board.target.currentHP = 0;
    expect(plan(board).entries.map((e) => e.unit.name)).toEqual(['Far', 'Near']);
  });
});

describe('the push in the post-combat pipeline', () => {
  const result = (attacker, hits = 1) => ({
    events: Array.from({ length: hits }, () => ({
      type: 'strike',
      attackerSide: 'attacker',
      attacker: attacker.name,
      miss: false,
      damage: 16,
    })),
    strikeMods: { attacker: mergeCombatMods(null, getWeaponArtCombatMods(art)) },
  });
  const steps = (board) =>
    getPostCombatPipelineSteps({
      attacker: board.attacker,
      defender: board.target,
      attackerWeaponArt: art,
      result: result(board.attacker),
    });

  it('runs once, after the line damage', () => {
    const list = steps(setup());
    const types = list.map((s) => s.type);
    expect(types.filter((t) => t === 'tier2_move')).toHaveLength(1);
    expect(types.indexOf('area_damage')).toBeGreaterThanOrEqual(0);
    expect(types.indexOf('area_damage')).toBeLessThan(types.indexOf('tier2_move'));
    const move = list.find((s) => s.type === 'tier2_move');
    expect(move).toMatchObject({ mode: 'pushAreaVictims', distance: 1 });
    expect(move.area).toEqual(area);
    expect(list.find((s) => s.type === 'area_damage').area.shape).toBe('line');
  });

  it('is not run when the art never landed', () => {
    const board = setup();
    const miss = getPostCombatPipelineSteps({
      attacker: board.attacker,
      defender: board.target,
      attackerWeaponArt: art,
      result: {
        events: [{ type: 'strike', attackerSide: 'attacker', miss: true, damage: 0 }],
        strikeMods: { attacker: null },
      },
    });
    expect(miss.some((s) => s.type === 'tier2_move' || s.type === 'area_damage')).toBe(false);
  });

  /** Run the whole generator against `board`, acting on remove beats as the harness does. */
  function run(board, hits = 1) {
    const beats = [];
    const gen = postCombatEffects(
      {
        attacker: board.attacker,
        defender: board.target,
        result: result(board.attacker, hits),
        attackerWeaponArt: art,
      },
      board.world,
    );
    for (const beat of gen) {
      beats.push(beat);
      if (beat.kind === 'remove') {
        const index = board.foes.indexOf(beat.unit);
        if (index >= 0) board.foes.splice(index, 1);
      }
    }
    return beats;
  }

  it('one moved beat settles every tile, the primary once, and lists the slide', () => {
    const board = setup({}, { ice: ['5,3'] });
    const beats = run(board);
    const moved = beats.filter((b) => b.kind === 'moved');
    expect(moved).toHaveLength(1);
    expect(moved[0].units.map((u) => u.name)).toEqual(['Far', 'Near', 'Primary']);
    expect(new Set(moved[0].units).size).toBe(3);
    expect(moved[0].slides).toEqual([
      {
        unit: board.far,
        from: { col: 4, row: 3 },
        to: { col: 6, row: 3 },
        path: [
          { col: 4, row: 3 },
          { col: 5, row: 3, slide: true },
          { col: 6, row: 3, slide: true },
        ],
      },
    ]);
    expect([board.target, board.near, board.far].map((u) => u.col)).toEqual([3, 4, 6]);
    // The line's blow reached both foes behind it: Steel Lance 9 + STR 12 - DEF 4 = 17, and
    // floor(0.6 x 17) = 10 each. (The primary's own damage is the combat's, not the generator's.)
    expect([board.near.currentHP, board.far.currentHP]).toEqual([20, 20]);
  });

  it('a foe the line kills falls (a remove beat) and is not pushed', () => {
    const board = setup({ near: { currentHP: 9 } });
    const beats = run(board);
    expect(beats.filter((b) => b.kind === 'remove').map((b) => b.unit.name)).toEqual(['Near']);
    expect(board.near.col).toBe(3);
    expect(board.far.col).toBe(5);
    expect(board.target.col).toBe(3);
  });

  it('a foe that holds firm says so; one a wall stopped does not', () => {
    const board = setup({ near: { isBoss: true } });
    const braced = run(board).filter((b) => b.kind === 'hint' && b.text === 'Braced!');
    expect(braced.map((b) => b.unit.name)).toEqual(['Near']);
    const walled = run(setup({}, { walls: ['5,3'] }));
    expect(
      walled.some((b) => b.kind === 'moved' || (b.kind === 'hint' && b.text === 'Braced!')),
    ).toBe(false);
  });

  it('a user who fell to the counter pushes nothing', () => {
    const board = setup();
    board.attacker.currentHP = 0;
    const beats = run(board);
    expect(beats.some((b) => b.kind === 'moved')).toBe(false);
    expect([board.target, board.near, board.far].map((u) => u.col)).toEqual([2, 3, 4]);
  });

  it('two landed strikes still push once', () => {
    const board = setup();
    run(board, 2);
    expect([board.target, board.near, board.far].map((u) => u.col)).toEqual([3, 4, 5]);
  });
});

describe('the Override preview reads the board the player knows', () => {
  const fogGrid = (fogged = []) => ({
    fogEnabled: true,
    cols: 8,
    rows: 8,
    isVisible: (col, row) => !fogged.includes(`${col},${row}`),
  });
  const preview = (board, fogged, dealt = 0) =>
    previewAreaArt({
      attacker: board.attacker,
      art,
      target: board.target,
      knowledge: createPlayerKnowledge({
        grid: fogGrid(fogged),
        units: [board.attacker, ...board.foes, ...(board.others || [])],
      }),
      world: board.world,
      strikeMods: combatStrikeMods(
        { atkWeaponArtMods: getWeaponArtCombatMods(art) },
        board.attacker.weapon,
      ),
      weapon: board.attacker.weapon,
      dealt,
    });
  const shown = (p) => ({
    pushes: p.pushes.map((e) => [e.unit.name, e.from.col, e.to.col, e.moved, e.reason]),
    lines: areaForecastLines(p),
  });

  it('shows each foe it drives back, farthest first, with the damage the line deals', () => {
    const p = preview(setup(), []);
    expect(shown(p).pushes).toEqual([
      ['Far', 4, 5, true, null],
      ['Near', 3, 4, true, null],
      ['Primary', 2, 3, true, null],
    ]);
    // Near and Far take floor(0.6 x (12 + 9 - 4)) = floor(10.2) = 10 with the Steel Lance.
    expect(shown(p).lines).toEqual([
      'Area if it hits: 2 foes',
      'Near −10',
      'Far −10',
      'Pushed back: Far, Near, Primary',
    ]);
  });

  it('a hidden unit behind the line changes the outcome, never the preview', () => {
    // A fogged foe stands on col 5. Execution: it blocks Far, so nobody moves. The preview
    // cannot know, and is the same in both worlds.
    const lurker = unit('Lurker', 'enemy', 5);
    const withLurker = setup({ others: [lurker] });
    const without = setup();
    const a = preview(withLurker, ['5,3']);
    const b = preview(without, []);
    expect(shown(a)).toEqual(shown(b));
    // What really happens on each board (the plan over the real units):
    expect(plan(withLurker).entries.every((e) => !e.moved)).toBe(true);
    expect(plan(without).entries.every((e) => e.moved)).toBe(true);
  });

  it('a pinned foe is shown as braced; a foe the preview says dies is not pushed', () => {
    const boss = preview(setup({ near: { isBoss: true } }), []);
    expect(shown(boss).lines).toContain('Braced: Near');
    expect(
      shown(boss)
        .pushes.find((p) => p[0] === 'Near')
        .slice(3),
    ).toEqual([false, 'boss']);
    // Near at 9 HP falls to the 10-point blow; the target (30 HP) takes 16 + more only if told so.
    const frail = setup({ near: { currentHP: 9 } });
    const p = preview(frail, [], 0);
    expect(shown(p).pushes.map((e) => e[0])).toEqual(['Far', 'Primary']);
    // A target the forecast says dies is not pushed.
    const doomed = preview(setup(), [], 30);
    expect(shown(doomed).pushes.map((e) => e[0])).toEqual(['Far', 'Near']);
  });
});
