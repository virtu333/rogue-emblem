// The Entity's splash as one engine step (engine/EntitySystem.js `entitySplash`), which
// BattleScene drives with presentation and the headless harness drives without. Ways this
// breaks, one test each:
//   - the count ignores the locked config, or a bad value escapes 0..4
//   - a different count changes how many draws the tiles take (the rest of the battle shifts)
//   - the move into the engine changes a draw, its order, a damage or a fall in the scene
//     (golden lines captured from the scene's inline splash before the move)
//   - the step pre-rolls its damage, so a draw the scene's presentation takes between two
//     hits (a legacy canvas text) lands elsewhere
//   - a splash strikes the target, a foe, the Entity's body, a diagonal or a dead unit, or a
//     foe on a struck tile still takes a damage draw
//   - the splash fells a unit the Unbroken Banner covers or a stone bearer, or writes HP
//     outside UnitHealth
//   - the harness never splashes (it did not before this step), or splashes differently from
//     the scene: tiles, damage, falls, kill credit, the battle's end, the stream's cursor
//   - a replay from the same checkpoint (units and stream state) splashes differently
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import './harness/JourneyTestSetup.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { presentationFailureProxy as rendering } from './harness/PresentationFailureProxy.js';
import { sceneSplashLine, splashBoard, splashUnit } from './entitySplashKit.js';
import {
  entitySplash,
  entitySplashCountFor,
  getFootprintKeys,
  rollSplashTiles,
  runEntitySplashSync,
} from '../src/engine/EntitySystem.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { registerBattleEntity } from '../src/engine/BattleEntityIdentity.js';
import { BANNER, createBattleBlessings } from '../src/engine/BattleBlessings.js';
import { isolateBattleTextFactory } from '../src/utils/presentationText.js';
import { ENTITY_SPLASH_COUNT } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const originalRandom = Math.random;
afterEach(() => {
  Math.random = originalRandom;
  vi.restoreAllMocks();
});

/** A stream that counts its draws. */
function counting(seed) {
  const stream = createBattleRng(seed);
  const rng = () => {
    rng.draws++;
    return stream();
  };
  rng.draws = 0;
  return rng;
}

/** The step's world over a plain list of units (the first unit standing on a tile). */
function plainWorld(units, extra = {}) {
  return {
    cols: 9,
    rows: 9,
    getUnitAt: (col, row) => units.find((u) => u.col === col && u.row === row) || null,
    battleBlessings: null,
    battleConfig: {},
    ...extra,
  };
}

/** Four allies around a target at (6,6), clear of the Entity's body at (1..3, 3..5). */
function ringAround(hp) {
  return [
    [6, 5],
    [5, 6],
    [7, 6],
    [6, 7],
  ].map(([c, r], i) => splashUnit(`R${i}`, 'player', c, r, hp));
}

describe('entitySplashCountFor', () => {
  it('reads the locked config, else ENTITY_SPLASH_COUNT', () => {
    expect(ENTITY_SPLASH_COUNT).toBe(2);
    expect(entitySplashCountFor(undefined)).toBe(2);
    expect(entitySplashCountFor(null)).toBe(2);
    expect(entitySplashCountFor({})).toBe(2);
    expect(entitySplashCountFor({ entitySplashCount: null })).toBe(2);
    for (const n of [0, 1, 2, 3, 4]) expect(entitySplashCountFor({ entitySplashCount: n })).toBe(n);
  });

  it('clamps to 0..4 whole tiles; anything but a finite number is the default', () => {
    expect(entitySplashCountFor({ entitySplashCount: -1 })).toBe(0);
    expect(entitySplashCountFor({ entitySplashCount: 5 })).toBe(4);
    expect(entitySplashCountFor({ entitySplashCount: 99 })).toBe(4);
    expect(entitySplashCountFor({ entitySplashCount: 2.7 })).toBe(2);
    expect(entitySplashCountFor({ entitySplashCount: -0.5 })).toBe(0);
    for (const bad of [NaN, Infinity, -Infinity, '3', true, {}])
      expect(entitySplashCountFor({ entitySplashCount: bad })).toBe(2);
  });
});

describe('rollSplashTiles takes the same draws whatever the count', () => {
  // The candidates around a target: 4 in the open, 3 against the body, 2 in a corner, 1 in a
  // corner against the body. Draws: one per shuffle swap (candidates - 1), then one count.
  const body = { isEntity: true, col: 1, row: 3 }; // (1..3, 3..5)
  const cases = [
    { entity: body, target: [6, 6], candidates: 4 },
    { entity: body, target: [4, 4], candidates: 3 }, // west is the body
    { entity: body, target: [8, 0], candidates: 2 }, // the map's corner
    // The map's corner with the body (6..8, 5..7) above it: only the west tile is left.
    { entity: { isEntity: true, col: 6, row: 5 }, target: [8, 8], candidates: 1 },
  ];
  it.each(cases)('$candidates candidate(s)', ({ entity, target, candidates }) => {
    const byCount = [];
    for (let count = 0; count <= 4; count++) {
      const rng = counting(17);
      const tiles = rollSplashTiles(target[0], target[1], entity, 9, 9, count, rng);
      expect(rng.draws).toBe(Math.max(0, candidates - 1) + 1);
      expect(tiles.length).toBeLessThanOrEqual(Math.min(count, candidates));
      byCount.push(tiles);
    }
    // The shuffle is the same for every count: a larger count only reads further into it.
    const longest = byCount.reduce((a, b) => (b.length > a.length ? b : a));
    for (const tiles of byCount) expect(longest.slice(0, tiles.length)).toEqual(tiles);
  });
});

describe('the step', () => {
  const entity = splashUnit('The Entity', 'enemy', 1, 3, 200, { isEntity: true });

  it('strikes only the living non-foes orthogonally beside the target, never the body', () => {
    // 0.99: no shuffle swap and the full count, candidates in scan order N, W, E, S.
    const target = splashUnit('Edric', 'player', 4, 4, 40);
    const north = splashUnit('North', 'player', 4, 3, 30);
    const east = splashUnit('East', 'npc', 5, 4, 30);
    const south = splashUnit('South', 'enemy', 4, 5, 30);
    const diagonal = splashUnit('Diagonal', 'player', 5, 5, 30);
    let draws = 0;
    const world = plainWorld([entity, target, north, east, south, diagonal], {
      battleConfig: { entitySplashCount: 4 },
      rng: () => (draws++, 0.99),
    });
    const record = runEntitySplashSync(entity, target, world);
    // West (3,4) is the Entity's body: three candidates, all struck; the foe takes no draw.
    expect(getFootprintKeys(entity)).toContain('3,4');
    expect(record.count).toBe(4);
    expect(record.tiles).toEqual([
      { col: 4, row: 3 },
      { col: 5, row: 4 },
      { col: 4, row: 5 },
    ]);
    expect(record.hits.map((h) => h.victim.name)).toEqual(['North', 'East']);
    // 5 + floor(0.99 * 6) = 10.
    expect(record.hits.map((h) => h.damage)).toEqual([10, 10]);
    expect([north, east, south, diagonal, target].map((u) => u.currentHP)).toEqual([
      20, 20, 30, 30, 40,
    ]);
    expect(draws).toBe(2 + 1 + 2); // two swaps, the count, two damage draws
  });

  it('a count of 0 strikes nothing but still takes the tiles draws', () => {
    const target = splashUnit('Edric', 'player', 6, 6, 40);
    const ring = ringAround(30);
    const rng = counting(3);
    const record = runEntitySplashSync(
      entity,
      target,
      plainWorld([entity, target, ...ring], { battleConfig: { entitySplashCount: 0 }, rng }),
    );
    expect(record.hits).toEqual([]);
    expect(rng.draws).toBe(3 + 1);
    expect(ring.every((u) => u.currentHP === 30)).toBe(true);
  });

  it('damage lies in 5..10 and a fallen victim is handed over with the Entity as killer', () => {
    const seen = new Set();
    for (let seed = 1; seed <= 300; seed++) {
      const target = splashUnit('Edric', 'player', 6, 6, 40);
      const ring = ringAround(7);
      const removed = [];
      const record = runEntitySplashSync(
        entity,
        target,
        plainWorld([entity, target, ...ring], {
          battleConfig: { entitySplashCount: 4 },
          rng: createBattleRng(seed),
        }),
        { remove: (u, o) => removed.push([u.name, o.killer]) },
      );
      for (const hit of record.hits) {
        seen.add(hit.damage);
        expect(hit.damage).toBeGreaterThanOrEqual(5);
        expect(hit.damage).toBeLessThanOrEqual(10);
        expect(hit.lost).toBe(Math.min(7, hit.damage));
        expect(hit.fell).toBe(hit.damage >= 7);
        expect(hit.victim.currentHP).toBe(Math.max(0, 7 - hit.damage));
      }
      const fallen = record.hits.filter((h) => h.fell).map((h) => [h.victim.name, entity]);
      expect(removed).toEqual(fallen);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 9, 10]);
  });

  it('skips a victim already down and the primary target, even on a struck tile', () => {
    const target = splashUnit('Edric', 'player', 6, 6, 40);
    const down = splashUnit('Down', 'player', 6, 5, 0);
    let draws = 0;
    const world = plainWorld([], {
      battleConfig: { entitySplashCount: 4 },
      rng: () => (draws++, 0.99),
      // A lookup that answers the target itself on the west tile, a downed ally on the north.
      getUnitAt: (col, row) =>
        col === 5 && row === 6 ? target : col === 6 && row === 5 ? down : null,
    });
    expect(runEntitySplashSync(entity, target, world).hits).toEqual([]);
    expect([target.currentHP, down.currentHP]).toEqual([40, 0]);
    expect(draws).toBe(4); // the tiles only: no damage draw for either
  });

  it('the Unbroken Banner holds the first lethal splash at 1, and only the first', () => {
    const target = splashUnit('Edric', 'player', 6, 6, 40);
    const a = splashUnit('A', 'player', 6, 5, 4); // north
    const b = splashUnit('B', 'player', 5, 6, 4); // west
    const blessings = createBattleBlessings({ lastStand: 1 });
    const removed = [];
    const record = runEntitySplashSync(
      entity,
      target,
      plainWorld([entity, target, a, b], { battleBlessings: blessings, rng: () => 0.99 }),
      { remove: (u) => removed.push(u.name) },
    );
    expect(record.hits.map((h) => [h.victim.name, h.bannerHeld, h.fell, h.lost])).toEqual([
      ['A', true, false, 3],
      ['B', false, true, 4],
    ]);
    expect([a.currentHP, b.currentHP]).toEqual([1, 0]);
    expect(blessings.spent).toEqual([BANNER]);
    expect(removed).toEqual(['B']);
  });

  it('a Revival Stone refills the bar instead of a fall (UnitHealth.absorbLethal)', () => {
    const target = splashUnit('Edric', 'player', 6, 6, 40);
    const bearer = splashUnit('Bearer', 'npc', 6, 5, 4, { revivalStones: 1, revivalStonesMax: 1 });
    const removed = [];
    const record = runEntitySplashSync(
      entity,
      target,
      plainWorld([entity, target, bearer], { rng: () => 0.99 }),
      { remove: (u) => removed.push(u.name) },
    );
    expect(record.hits).toHaveLength(1);
    expect(record.hits[0]).toMatchObject({ stoneBroken: true, fell: false, lost: 4 });
    expect([bearer.currentHP, bearer.revivalStones]).toEqual([40, 0]);
    expect(removed).toEqual([]);
  });

  it('reads each tile lazily: the caller acts on a hit before the next tile is read', () => {
    // The generator yields before it reads the next tile, so the caller's removal (and any
    // draw its presentation takes) comes first, as in the scene's inline loop.
    const target = splashUnit('Edric', 'player', 6, 6, 40);
    const a = splashUnit('A', 'player', 6, 5, 30);
    const b = splashUnit('B', 'player', 5, 6, 30);
    const units = [entity, target, a, b];
    const order = [];
    let n = 0;
    const steps = entitySplash(entity, target, {
      ...plainWorld(units),
      getUnitAt: (col, row) => {
        order.push(`look ${col},${row}`);
        return units.find((u) => u.col === col && u.row === row) || null;
      },
      rng: () => (order.push(`draw ${++n}`), 0.99),
    });
    for (const hit of steps) order.push(`hit ${hit.victim.name}`);
    expect(order).toEqual([
      'draw 1', 'draw 2', 'draw 3', 'draw 4', // three swaps, the count
      'look 6,5', 'draw 5', 'hit A',
      'look 5,6', 'draw 6', 'hit B',
    ]); // prettier-ignore
  });
});

describe('the scene: the move into the engine changed nothing', () => {
  // Captured from BattleScene._applyEntitySplash before the move (rollSplashTiles and
  // rollSplashDamage inline in the scene), on tests/entitySplashKit.js: draws,
  // HP, falls with their killer, the banner, and the battle stream's next value.
  const GOLDEN = {
    flank: [
      'd3|The Entity:200,Edric:40,Ally:6,Green:20,Foe:20|rm:-|next:0.981051',
      'd3|The Entity:200,Edric:40,Ally:6,Green:20,Foe:20|rm:-|next:0.537955',
      'd4|The Entity:200,Edric:40,Ally:6,Green:15,Foe:20|rm:-|next:0.763005',
      'd3|The Entity:200,Edric:40,Ally:6,Green:20,Foe:20|rm:-|next:0.081841',
      'd3|The Entity:200,Edric:40,Ally:6,Green:20,Foe:20|rm:-|next:0.623179',
      'd3|The Entity:200,Edric:40,Ally:6,Green:20,Foe:20|rm:-|next:0.202163',
      'd4|The Entity:200,Edric:40,Ally:6,Green:11,Foe:20|rm:-|next:0.521445',
      'd3|The Entity:200,Edric:40,Ally:6,Green:20,Foe:20|rm:-|next:0.695954',
      'd3|The Entity:200,Edric:40,Ally:6,Green:20,Foe:20|rm:-|next:0.821672',
      'd4|The Entity:200,Edric:40,Ally:0,Green:20,Foe:20|rm:Ally<The Entity|next:0.457418',
      'd4|The Entity:200,Edric:40,Ally:0,Green:20,Foe:20|rm:Ally<The Entity|next:0.850777',
      'd4|The Entity:200,Edric:40,Ally:6,Green:10,Foe:20|rm:-|next:0.152772',
      'd3|The Entity:200,Edric:40,Ally:6,Green:20,Foe:20|rm:-|next:0.048167',
      'd3|The Entity:200,Edric:40,Ally:6,Green:20,Foe:20|rm:-|next:0.353849',
      'd4|The Entity:200,Edric:40,Ally:6,Green:13,Foe:20|rm:-|next:0.222750',
      'd4|The Entity:200,Edric:40,Ally:0,Green:20,Foe:20|rm:Ally<The Entity|next:0.339685',
    ],
    open: [
      'd6|The Entity:200,Edric:40,North:7,East:30,South:0,West:24|rm:South<The Entity|next:0.612839',
      'd5|The Entity:200,Edric:40,North:7,East:30,South:9,West:20|rm:-|next:0.630833',
      'd4|The Entity:200,Edric:40,North:7,East:30,South:9,West:30|rm:-|next:0.763005',
      'd4|The Entity:200,Edric:40,North:7,East:30,South:9,West:30|rm:-|next:0.233997',
      'd5|The Entity:200,Edric:40,North:7,East:30,South:9,West:25|rm:-|next:0.592165',
      'd4|The Entity:200,Edric:40,North:7,East:30,South:9,West:30|rm:-|next:0.542120',
      'd6|The Entity:200,Edric:40,North:7,East:22,South:9,West:23|rm:-|next:0.466233',
      'd6|The Entity:200,Edric:40,North:7,East:22,South:2,West:30|rm:-|next:0.818760',
      'd6|The Entity:200,Edric:40,North:7,East:30,South:0,West:21|rm:South<The Entity|next:0.262718',
      'd6|The Entity:200,Edric:40,North:0,East:30,South:9,West:23|rm:North<The Entity|next:0.202287',
      'd5|The Entity:200,Edric:40,North:0,East:30,South:9,West:30|rm:North<The Entity|next:0.538022',
      'd6|The Entity:200,Edric:40,North:7,East:25,South:4,West:30|rm:-|next:0.696004',
      'd4|The Entity:200,Edric:40,North:7,East:30,South:9,West:30|rm:-|next:0.036771',
      'd5|The Entity:200,Edric:40,North:1,East:30,South:9,West:30|rm:-|next:0.425535',
      'd5|The Entity:200,Edric:40,North:7,East:24,South:9,West:30|rm:-|next:0.661061',
      'd5|The Entity:200,Edric:40,North:7,East:30,South:2,West:30|rm:-|next:0.019686',
    ],
    corner: [
      'd2|The Entity:200,Edric:40,Right:6,Below:30|rm:-|next:0.527447',
      'd2|The Entity:200,Edric:40,Right:6,Below:30|rm:-|next:0.285296',
      'd2|The Entity:200,Edric:40,Right:6,Below:30|rm:-|next:0.456192',
      'd2|The Entity:200,Edric:40,Right:6,Below:30|rm:-|next:0.221668',
      'd4|The Entity:200,Edric:40,Right:0,Below:22|rm:Right<The Entity|next:0.085137',
      'd2|The Entity:200,Edric:40,Right:6,Below:30|rm:-|next:0.663171',
      'd2|The Entity:200,Edric:40,Right:6,Below:30|rm:-|next:0.976908',
      'd3|The Entity:200,Edric:40,Right:6,Below:24|rm:-|next:0.695954',
      'd4|The Entity:200,Edric:40,Right:0,Below:25|rm:Right<The Entity|next:0.723804',
      'd4|The Entity:200,Edric:40,Right:0,Below:21|rm:Right<The Entity|next:0.457418',
      'd3|The Entity:200,Edric:40,Right:0,Below:30|rm:Right<The Entity|next:0.590158',
      'd2|The Entity:200,Edric:40,Right:6,Below:30|rm:-|next:0.580161',
      'd3|The Entity:200,Edric:40,Right:1,Below:30|rm:-|next:0.048167',
      'd3|The Entity:200,Edric:40,Right:6,Below:22|rm:-|next:0.353849',
      'd3|The Entity:200,Edric:40,Right:6,Below:23|rm:-|next:0.446168',
      'd2|The Entity:200,Edric:40,Right:6,Below:30|rm:-|next:0.752338',
    ],
    banner: [
      'd6|The Entity:200,Edric:40,North:7,East:30,South:1,West:24|rm:-|spent:banner|next:0.612839',
      'd5|The Entity:200,Edric:40,North:7,East:30,South:9,West:20|rm:-|spent:-|next:0.630833',
      'd4|The Entity:200,Edric:40,North:7,East:30,South:9,West:30|rm:-|spent:-|next:0.763005',
      'd4|The Entity:200,Edric:40,North:7,East:30,South:9,West:30|rm:-|spent:-|next:0.233997',
      'd5|The Entity:200,Edric:40,North:7,East:30,South:9,West:25|rm:-|spent:-|next:0.592165',
      'd4|The Entity:200,Edric:40,North:7,East:30,South:9,West:30|rm:-|spent:-|next:0.542120',
      'd6|The Entity:200,Edric:40,North:7,East:22,South:9,West:23|rm:-|spent:-|next:0.466233',
      'd6|The Entity:200,Edric:40,North:7,East:22,South:2,West:30|rm:-|spent:-|next:0.818760',
      'd6|The Entity:200,Edric:40,North:7,East:30,South:1,West:21|rm:-|spent:banner|next:0.262718',
      'd6|The Entity:200,Edric:40,North:1,East:30,South:9,West:23|rm:-|spent:banner|next:0.202287',
      'd5|The Entity:200,Edric:40,North:1,East:30,South:9,West:30|rm:-|spent:banner|next:0.538022',
      'd6|The Entity:200,Edric:40,North:7,East:25,South:4,West:30|rm:-|spent:-|next:0.696004',
      'd4|The Entity:200,Edric:40,North:7,East:30,South:9,West:30|rm:-|spent:-|next:0.036771',
      'd5|The Entity:200,Edric:40,North:1,East:30,South:9,West:30|rm:-|spent:-|next:0.425535',
      'd5|The Entity:200,Edric:40,North:7,East:24,South:9,West:30|rm:-|spent:-|next:0.661061',
      'd5|The Entity:200,Edric:40,North:7,East:30,South:2,West:30|rm:-|spent:-|next:0.019686',
    ],
  };

  it.each(Object.keys(GOLDEN))('the %s board, seeds 1-16', async (kind) => {
    for (let seed = 1; seed <= 16; seed++)
      expect(await sceneSplashLine(kind, seed)).toBe(GOLDEN[kind][seed - 1]);
  });

  it('every golden cursor is the one the rules predict (derived without the code)', () => {
    // Draws = (candidates - 1) swaps + 1 count + 1 per struck victim; a victim is struck iff
    // its HP moved (every splash takes at least 5). The next value is the stream after them.
    const candidates = { flank: 3, open: 4, corner: 2, banner: 4 };
    for (const [kind, lines] of Object.entries(GOLDEN)) {
      const { entity, target, others } = splashBoard(kind);
      const start = new Map([entity, target, ...others].map((u) => [u.name, u.currentHP]));
      lines.forEach((line, i) => {
        const struck = line
          .split('|')[1]
          .split(',')
          .map((pair) => pair.split(':'))
          .filter(([name, hp]) => Number(hp) !== start.get(name)).length;
        const draws = candidates[kind] - 1 + 1 + struck;
        const stream = createBattleRng(i + 1);
        for (let k = 0; k < draws; k++) stream();
        const label = `${kind} seed ${i + 1}`;
        expect(line.startsWith(`d${draws}|`), label).toBe(true);
        expect(line.endsWith(`next:${stream().toFixed(6)}`), label).toBe(true);
      });
    }
  });

  it('a draw the presentation takes between hits keeps its place (no damage is pre-rolled)', async () => {
    // A draw the presentation takes after a hit (here, its tick's wait) comes after that hit's
    // damage draw and before the next hit's; the hit's floating number takes none.
    const hints = [];
    const run = async (hintDraws) => {
      const { entity, target, others } = splashBoard('open');
      for (const u of others) u.currentHP = 30; // nobody falls: four hits, four hints
      const scene = journeyBattleScene({}, {});
      Object.assign(scene.grid, { cols: 9, rows: 9, fogEnabled: false });
      scene.battleConfig = { objective: 'rout', entitySplashCount: 4 };
      scene.gameData = { affixes: [], dialogue: {}, deeds: null };
      scene.playerUnits = [target, ...others];
      scene.enemyUnits = [entity];
      rendering(scene, 0);
      scene.sys = { isActive: () => true };
      scene.scene = { isActive: () => true };
      // The hit's number floats through presentationText (a canvas text that draws Math.random
      // as it is made, shielded); then the presentation takes `hintDraws` draws of its own.
      const makeText = scene.add.text;
      scene.add.text = (x, y, text, ...rest) => {
        if (String(text).startsWith('Splash -')) hints.push(text);
        return makeText(x, y, text, ...rest);
      };
      scene._awaitSceneDelay = async () => {
        for (let k = 0; k < hintDraws; k++) Math.random();
      };
      // The tiles' four draws answer 0.99 (no swap, all four tiles); then the seeded stream.
      const stream = createBattleRng(5);
      let tileDraws = 4;
      Math.random = () => (tileDraws-- > 0 ? 0.99 : stream());
      await scene._applyEntitySplash(entity, target);
      return others.map((u) => 30 - u.currentHP);
    };
    const quiet = await run(0);
    const drawing = await run(1);
    // Derived by hand: damage = 5 + floor(r * 6) for the stream's values in turn.
    const dmg = (r) => 5 + Math.floor(r * 6);
    const s0 = createBattleRng(5);
    const s1 = createBattleRng(5);
    const interleaved = [];
    for (let k = 0; k < 4; k++) {
      interleaved.push(dmg(s1()));
      s1(); // the hint's own draw
    }
    // others are North, East, South, West; struck in scan order N, W, E, S.
    const [n, w, e, s] = [s0(), s0(), s0(), s0()].map(dmg);
    expect(quiet).toEqual([n, e, s, w]);
    const [ni, wi, ei, si] = interleaved;
    expect(drawing).toEqual([ni, ei, si, wi]);
    expect(hints).toHaveLength(8);
  });
});

/** The board through the scene: the Entity's whole attack (executeEnemyCombat). */
function sceneWorld(units, { config = {}, blessings = null } = {}) {
  const scene = journeyBattleScene({}, data);
  scene.runManager = null;
  scene._battleRewindPolicy = 'fixed-v1';
  const plain = data.terrain.find((t) => t.name === 'Plain');
  Object.assign(scene.grid, {
    cols: 9,
    rows: 9,
    fogEnabled: false,
    clearTemporaryTerrainsBySource: () => {},
    getMoveCost: () => 1,
    getTerrainAt: () => plain,
  });
  scene.battleConfig = { objective: 'rout', ...config };
  scene.goldEarned = 0;
  scene.turnPar = 99;
  scene.turnBonusConfig = data.turnBonus;
  scene.getCurrentTurnNumber = () => 1;
  scene.playerUnits = units.filter((u) => u.faction === 'player');
  scene.enemyUnits = units.filter((u) => u.faction === 'enemy');
  scene.npcUnits = units.filter((u) => u.faction === 'npc');
  scene._battleBlessings = blessings;
  for (const u of units) registerBattleEntity(scene, u);
  rendering(scene, 0);
  isolateBattleTextFactory(scene); // fixed-v1: a canvas text never draws the battle stream
  scene._getSelectedWeaponArtForUnit = () => null;
  scene.animateStrike = async () => {};
  scene.animateSkillActivation = async () => {};
  scene._battleBeats.checkBossHalfHealth = async () => {};
  scene._battleBeats.onChipLance = () => {};
  scene._battleBeats.onLowHealth = () => {};
  scene.sys = { isActive: () => true };
  scene.scene = { isActive: () => true };
  scene.onVictory = () => {
    scene.battleState = 'BATTLE_END';
  };
  scene.onDefeat = () => {
    scene.result = 'defeat';
    scene.battleState = 'BATTLE_END';
  };
  scene.awardScaledXP = async () => {};
  scene.checkBattleEnd = BattleScene.prototype.checkBattleEnd; // the fixture stubs it
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const removed = [];
  const realRemove = scene.removeUnit.bind(scene);
  scene.removeUnit = async (unit, options) => {
    removed.push(`${unit.name}<${options?.killer?.name ?? '-'}`);
    return realRemove(unit, options);
  };
  return {
    removed,
    attack: (entity, target) => scene.executeEnemyCombat(entity, target),
    roster: () => [...scene.playerUnits, ...scene.npcUnits].map((u) => u.name),
    defeated: () => scene.result === 'defeat',
  };
}

/** The same board through the headless harness (HeadlessBattle._executeEnemyCombat). */
function harnessWorld(units, { config = {}, blessings = null } = {}) {
  const battle = new HeadlessBattle(structuredClone(data), { act: 'act1', objective: 'rout' });
  battle.turnManager = { turnNumber: 1, unitActed() {} };
  battle.battleConfig = { objective: 'rout', ...config };
  battle.turnPar = 99;
  battle.playerUnits = units.filter((u) => u.faction === 'player');
  battle.enemyUnits = units.filter((u) => u.faction === 'enemy');
  battle.npcUnits = units.filter((u) => u.faction === 'npc');
  battle._battleBlessings = blessings;
  const plain = data.terrain.find((t) => t.name === 'Plain');
  battle.grid = {
    cols: 9,
    rows: 9,
    fogEnabled: false,
    getTerrainAt: () => plain,
    getMoveCost: () => 1,
    updateFogOfWar() {},
  };
  battle._grantScaledXP = () => {};
  let defeated = false;
  battle._onDefeat = () => {
    defeated = true;
    battle.battleState = 'BATTLE_END';
  };
  const removed = [];
  const realRemove = battle._removeUnit.bind(battle);
  battle._removeUnit = (unit, options) => {
    removed.push(`${unit.name}<${options?.killer?.name ?? '-'}`);
    return realRemove(unit, options);
  };
  return {
    removed,
    attack: async (entity, target) => battle._executeEnemyCombat(entity, target),
    roster: () => [...battle.playerUnits, ...battle.npcUnits].map((u) => u.name),
    defeated: () => defeated,
  };
}

/** The Entity (its real weapon) at (1..3, 3..5), its target beside the body, allies around. */
function entityBoard({ frail = 7 } = {}) {
  const grasp = structuredClone(data.weapons.find((w) => w.name === 'Eldritch Grasp'));
  const entity = splashUnit('The Entity', 'enemy', 1, 3, 200, {
    isEntity: true,
    isBoss: true,
    className: 'Entity',
    stats: { HP: 200, STR: 20, MAG: 0, SKL: 15, SPD: 8, DEF: 10, RES: 10, LCK: 0, MOV: 0 },
    weapon: grasp,
    inventory: [grasp],
  });
  const target = splashUnit('Edric', 'player', 4, 4, 90, {
    isCommander: true,
    isLord: true,
    stats: { HP: 90, STR: 12, MAG: 0, SKL: 9, SPD: 9, DEF: 9, RES: 3, LCK: 5, MOV: 5 },
  });
  const others = [
    splashUnit('North', 'player', 4, 3, frail),
    splashUnit('East', 'npc', 5, 4, 30),
    splashUnit('South', 'player', 4, 5, frail),
  ];
  const bystander = splashUnit('Bystander', 'enemy', 8, 8, 30);
  return [entity, target, ...others, bystander];
}

describe('scene and harness splash alike in the Entity’s attack', () => {
  const WORLDS = [
    ['the scene', sceneWorld],
    ['the harness', harnessWorld],
  ];

  async function play(makeWorld, seed, { units = entityBoard(), ...opts } = {}) {
    const world = makeWorld(units, opts);
    const stream = createBattleRng(seed);
    Math.random = stream;
    try {
      await world.attack(units[0], units[1]);
    } finally {
      Math.random = originalRandom;
    }
    return {
      hp: units.map((u) => `${u.name}:${u.currentHP}`).join(','),
      removed: world.removed.join('+'),
      roster: world.roster().join(','),
      defeated: world.defeated(),
      cursor: stream.getState().cursor,
    };
  }

  it('the same seeds give the same HP, falls, kill credit and stream cursor', async () => {
    let struck = 0;
    let fell = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const scene = await play(sceneWorld, seed);
      const harness = await play(harnessWorld, seed);
      expect(harness, `seed ${seed}`).toEqual(scene);
      if (!/North:7,East:30,South:7,/.test(scene.hp)) struck++;
      if (/<The Entity/.test(scene.removed)) fell++;
    }
    // The board exercises the splash: some seeds strike, some fell (with the Entity's credit).
    expect(struck).toBeGreaterThan(3);
    expect(fell).toBeGreaterThan(0);
  });

  it.each(WORLDS)('%s reads the locked count, and its draws stay put', async (_l, makeWorld) => {
    for (let seed = 1; seed <= 12; seed++) {
      const none = await play(makeWorld, seed, { config: { entitySplashCount: 0 } });
      expect(none.hp).toMatch(/North:7,East:30,South:7,/);
      // The tiles take the same draws at 0 and at 2: the cursors differ by the victims' draws.
      const base = await play(makeWorld, seed);
      const victims = ['North:7,', 'East:30,', 'South:7,'].filter((s) => !base.hp.includes(s));
      expect((none.cursor + victims.length * 0x6d2b79f5) >>> 0, `seed ${seed}`).toBe(base.cursor);
    }
  });

  it.each(WORLDS)(
    '%s: the commander felled by the splash loses the battle',
    async (_l, makeWorld) => {
      // Edric stands beside the target as a splash victim; the primary target is a sturdy ally.
      let lost = 0;
      for (let seed = 1; seed <= 24; seed++) {
        const units = entityBoard();
        const [entity, edric, north] = units;
        const primary = splashUnit('Primary', 'player', edric.col, edric.row, 90);
        Object.assign(edric, { col: north.col, row: north.row, currentHP: 3 });
        units.splice(units.indexOf(north), 1);
        units.splice(1, 0, primary);
        const world = makeWorld(units);
        Math.random = createBattleRng(seed);
        try {
          await world.attack(entity, primary);
        } finally {
          Math.random = originalRandom;
        }
        if (edric.currentHP <= 0) {
          expect(world.removed).toContain('Edric<The Entity');
          expect(world.defeated(), `seed ${seed}`).toBe(true);
          lost++;
        } else expect(world.defeated(), `seed ${seed}`).toBe(false);
      }
      expect(lost).toBeGreaterThan(0);
    },
  );
});

describe('a replay from the same checkpoint splashes the same', () => {
  it('the units and the stream state alone decide it (the splash keeps no state of its own)', () => {
    const units = entityBoard();
    const live = createBattleRng(31);
    for (let k = 0; k < 7; k++) live(); // somewhere mid-battle
    const checkpoint = { units: structuredClone(units), rng: live.getState() };
    const first = runEntitySplashSync(units[0], units[1], plainWorld(units, { rng: live }));
    const restored = structuredClone(checkpoint.units);
    const resumed = createBattleRng(0, checkpoint.rng);
    const again = runEntitySplashSync(
      restored[0],
      restored[1],
      plainWorld(restored, { rng: resumed }),
    );
    const view = (record) => record.hits.map((h) => [h.victim.name, h.damage, h.victim.currentHP]);
    expect(view(again)).toEqual(view(first));
    expect(again.tiles).toEqual(first.tiles);
    expect(resumed.getState()).toEqual(live.getState());
  });
});

describe('the rule has one home', () => {
  const methodBody = (text, name) => {
    const at = text.search(new RegExp(`\\n  (?:async )?${name}\\(`));
    let i = text.indexOf('{', text.indexOf(')', at));
    const start = i;
    let depth = 0;
    do {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
      i++;
    } while (i < text.length && depth > 0);
    return text.slice(start, i);
  };
  const HP_WRITE = /\bcurrentHP\s*(?:[-+*/]?=(?!=)|\+\+|--)/;

  it('the step changes HP only through UnitHealth, handing the banner its chance', () => {
    const code = readFileSync('src/engine/EntitySystem.js', 'utf8').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(HP_WRITE);
    expect(code).toMatch(
      /damageUnitDetailed\(victim, damage, \{\s*blessings: world\.battleBlessings/,
    );
  });

  it.each([
    ['src/scenes/BattleScene.js', '_applyEntitySplash'],
    ['tests/harness/HeadlessBattle.js', '_applyEntitySplash'],
  ])('%s %s drives the step and keeps no copy of the rule', (file, name) => {
    const body = methodBody(readFileSync(file, 'utf8'), name);
    expect(body).toMatch(/entitySplash\(|runEntitySplashSync\(/);
    for (const copy of [/rollSplash/, /damageUnit/, /ENTITY_SPLASH/, HP_WRITE])
      expect(body).not.toMatch(copy);
  });
});
