// An area art struck at the Entity starts from the body tile the strike lands on (the one
// nearest the attacker, AreaShapes.areaImpactTile), never from its top-left anchor; the
// Entity itself stays the primary by identity, so it is never one of its own victims.
//
// Every board below has the Entity anchored at (5,5): body cols 5-7, rows 5-7. The expected
// tiles are worked out by hand in each comment (not by the shape code), and each scenario
// is checked twice: the preview the player reads (AreaPreview.previewAreaArt) and a real
// combat followed by its post-combat effects (PostCombatEffects, which the harness runs too).

import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import { resolveCombat } from '../src/engine/Combat.js';
import { getWeaponArtCombatMods } from '../src/engine/WeaponArtSystem.js';
import { postCombatEffects } from '../src/engine/PostCombatEffects.js';
import { previewAreaArt } from '../src/engine/AreaPreview.js';
import { planAreaPush } from '../src/engine/AreaPush.js';
import { areaImpactTile, areaTilesFor } from '../src/engine/AreaShapes.js';
import { combatDistance, getFootprint } from '../src/engine/EntitySystem.js';

const data = loadGameData();
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));
const art = (id) => data.weaponArts.arts.find((a) => a.id === id);

const unit = (name, faction, col, row, stats = {}, extra = {}) => ({
  name,
  faction,
  col,
  row,
  level: 5,
  moveType: 'Infantry',
  weaponRank: 'Prof',
  currentHP: stats.HP ?? 80,
  stats: { HP: 80, STR: 0, MAG: 0, SKL: 0, SPD: 0, DEF: 0, RES: 0, LCK: 0, MOV: 5, ...stats },
  weapon: null,
  ...extra,
});

// Unarmed, so it never counters, and too big to fall to one blow.
const entity = () =>
  unit('The Entity', 'enemy', 5, 5, { HP: 999, DEF: 0, RES: 0, LCK: 0 }, { isEntity: true });

function worldOf(units) {
  return {
    affixes: data.affixes,
    cols: 12,
    rows: 12,
    getMoveCost: () => 1,
    getTerrainAt: () => null,
    getUnitAt: (col, row) =>
      units.find(
        (u) => u.currentHP > 0 && getFootprint(u).some((t) => t.col === col && t.row === row),
      ) || null,
    hostilesOf: (u) => units.filter((o) => o.faction !== u.faction && o.faction !== 'npc'),
    alliesOf: (u) => units.filter((o) => o.faction === u.faction),
    turnNumber: 1,
  };
}

/** A real combat with the art (every roll 0.01: it hits), then its post-combat effects. */
function strike(attacker, defender, artId, units) {
  const prev = Math.random;
  Math.random = () => 0.01;
  let result;
  try {
    result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      combatDistance(attacker, defender),
      null,
      null,
      { atkWeaponArtMods: getWeaponArtCombatMods(art(artId)) },
    );
  } finally {
    Math.random = prev;
  }
  defender.currentHP = result.defenderHP;
  attacker.currentHP = result.attackerHP;
  const beats = [
    ...postCombatEffects(
      { attacker, defender, result, attackerWeaponArt: art(artId) },
      worldOf(units),
    ),
  ];
  return { result, beats };
}

// The arts, each with its attacker and the blow it lands on a guard (DEF/RES 0 unless said,
// unarmed, so no weapon triangle):
//   Cataclysm (Ruin, range 1): STR 20 + Mt 14 + art Atk 5 - DEF 4 = 35; row 1 ×0.75 = 26,
//     row 2 ×0.5 = 17.
//   Fan Shot (Hermit's Bow, range 1-2): STR 15 + Mt 11 - DEF 2 = 24; ×0.7 = 16.
//   Burning Quake (Fire, range 1-2, a radius 1): MAG 20 + Mt 4 - RES 0 = 24; ×0.6 = 14.
const ARTS = {
  cataclysm: {
    id: 'legend_annihilate',
    attacker: (col, row) =>
      unit('Hero', 'player', col, row, { STR: 20, SKL: 20 }, { weapon: weapon('Ruin'), weaponRank: 'Mast' }), // prettier-ignore
    guardStats: { DEF: 4 },
  },
  fan: {
    id: 'legend_hermit_fan',
    attacker: (col, row) =>
      unit('Hermit', 'player', col, row, { STR: 15, SKL: 20 }, { weapon: weapon("Hermit's Bow"), weaponRank: 'Mast' }), // prettier-ignore
    guardStats: { DEF: 2 },
  },
  quake: {
    id: 'magic_burning_quake',
    attacker: (col, row) =>
      unit('Mage', 'player', col, row, { MAG: 20, SKL: 20 }, { weapon: weapon('Fire') }),
    guardStats: {},
  },
};

// [art, side, attacker tile, { 'col,row': damage } for the guards the area must reach,
//  ['col,row'] guards it must not (where the anchor's geometry would put them)]
const SCENARIOS = [
  // Cataclysm, facing attacker → struck tile. East (8,7) strikes (7,7) facing west: row 1 is
  // col 6, rows 6-8 ((6,6),(6,7) are body), row 2 col 5, rows 6-8 ((5,6),(5,7) are body).
  ['cataclysm', 'east', [8, 7], { '6,8': 26, '5,8': 17 }, ['7,8']],
  // South (7,8) strikes (7,7) facing north: row 1 row 6, cols 6-8; row 2 row 5, cols 6-8.
  ['cataclysm', 'south', [7, 8], { '8,6': 26, '8,5': 17 }, ['6,8']],
  // West (4,7) strikes (5,7) facing east: row 1 col 6, rows 6-8; row 2 col 7, rows 6-8.
  ['cataclysm', 'west', [4, 7], { '6,8': 26, '7,8': 17 }, ['4,8']],
  // North (7,4) strikes (7,5) facing south: row 1 row 6, cols 6-8; row 2 row 7, cols 6-8.
  ['cataclysm', 'north', [7, 4], { '8,6': 26, '8,7': 17 }, ['8,4']],

  // Fan Shot: the two tiles beside the struck tile on its distance-2 ring from the archer.
  // The anchor's ring (distance 6 from (9,7)) would take (6,4) and (4,6) instead.
  ['fan', 'east', [9, 7], { '8,6': 16, '8,8': 16 }, ['6,4', '4,6']],
  // South (6,9) strikes (6,7); the anchor's distance-5 ring would take (4,6) and (6,4).
  ['fan', 'south', [6, 9], { '5,8': 16, '7,8': 16 }, ['6,4', '4,6']],
  // West (3,6) strikes (5,6); the anchor's distance-3 ring would take (4,4).
  ['fan', 'west', [3, 6], { '4,5': 16, '4,7': 16 }, ['4,4']],
  // North (6,3) strikes (6,5); the anchor's distance-3 ring would take (4,4).
  ['fan', 'north', [6, 3], { '5,4': 16, '7,4': 16 }, ['4,4']],
  // Range 2 from the south-east corner's diagonal (8,8): strikes the corner (7,7); its ring
  // neighbours are (6,8) and (8,6). The anchor's distance-6 ring would take (4,6), (6,4).
  ['fan', 'south-east (range 2)', [8, 8], { '6,8': 16, '8,6': 16 }, ['4,6', '6,4']],

  // Burning Quake: radius 1 round the struck tile (body tiles and the attacker drop out).
  // The anchor's radius would take (5,4) and (4,5).
  ['quake', 'east', [8, 7], { '7,8': 14 }, ['5,4', '4,5']],
  ['quake', 'south', [7, 8], { '8,7': 14 }, ['5,4', '4,5']],
  ['quake', 'west', [4, 7], { '5,8': 14 }, ['5,4', '4,5']],
  ['quake', 'north', [7, 4], { '8,5': 14 }, ['5,4', '4,5']],
  ['quake', 'south-east (range 2)', [8, 8], { '7,8': 14, '8,7': 14 }, ['5,4', '4,5']],
];

function board(artKey, [col, row], hitKeys, missKeys) {
  const spec = ARTS[artKey];
  const attacker = spec.attacker(col, row);
  const boss = entity();
  const guards = [...hitKeys, ...missKeys].map((key) => {
    const [c, r] = key.split(',').map(Number);
    return unit(`Guard ${key}`, 'enemy', c, r, spec.guardStats);
  });
  return { spec, attacker, boss, guards, units: [attacker, boss, ...guards] };
}

describe('Area arts struck at the Entity start from the struck body tile', () => {
  it.each(SCENARIOS)('%s from the %s: the preview', (artKey, _side, at, hits, misses) => {
    const { spec, attacker, boss, units } = board(artKey, at, Object.keys(hits), misses);
    const preview = previewAreaArt({
      attacker,
      art: art(spec.id),
      target: boss,
      knowledge: { units },
      world: worldOf(units),
      strikeMods: getWeaponArtCombatMods(art(spec.id)),
    });
    const victims = Object.fromEntries(
      preview.victims.map((v) => [`${v.unit.col},${v.unit.row}`, v.damage]),
    );
    expect(victims).toEqual(hits);
    expect(preview.victims.some((v) => v.unit === boss)).toBe(false);
  });

  it.each(SCENARIOS)('%s from the %s: execution', (artKey, _side, at, hits, misses) => {
    const { spec, attacker, boss, guards, units } = board(artKey, at, Object.keys(hits), misses);
    const { result } = strike(attacker, boss, spec.id, units);
    expect(result.events[0].miss).toBe(false);
    const lost = Object.fromEntries(
      guards.map((g) => [`${g.col},${g.row}`, 80 - g.currentHP]).filter(([, d]) => d > 0),
    );
    expect(lost).toEqual(hits);
    // The Entity took the combat's blow and nothing more: never its own area victim.
    expect(boss.currentHP).toBe(result.defenderHP);
    expect((result.areaCredits || []).some((c) => c.victim === boss)).toBe(false);
  });
});

describe('areaImpactTile: the body tile nearest the attacker', () => {
  const boss = { col: 5, row: 5, isEntity: true };

  it('is the edge tile in the attacker’s row or column, or the corner on its diagonal', () => {
    expect(areaImpactTile({ col: 8, row: 6 }, boss)).toEqual({ col: 7, row: 6 });
    expect(areaImpactTile({ col: 6, row: 9 }, boss)).toEqual({ col: 6, row: 7 });
    expect(areaImpactTile({ col: 3, row: 7 }, boss)).toEqual({ col: 5, row: 7 });
    expect(areaImpactTile({ col: 7, row: 4 }, boss)).toEqual({ col: 7, row: 5 });
    expect(areaImpactTile({ col: 8, row: 8 }, boss)).toEqual({ col: 7, row: 7 });
    expect(areaImpactTile({ col: 4, row: 4 }, boss)).toEqual({ col: 5, row: 5 });
    expect(areaImpactTile({ col: 9, row: 3 }, boss)).toEqual({ col: 7, row: 5 });
  });

  it('a single-tile target is itself, so its shapes are unchanged', () => {
    const foe = { col: 2, row: 3 };
    expect(areaImpactTile({ col: 1, row: 3 }, foe)).toBe(foe);
  });

  it("a corner's diagonal is a diagonal facing: no cone and no line, as for any diagonal target", () => {
    const bounds = { cols: 12, rows: 12 };
    const from = { col: 8, row: 8 };
    const cone = { shape: 'cone', rows: [{ width: 3, multiplier: 0.75 }, { width: 3, multiplier: 0.5 }] }; // prettier-ignore
    const line = { shape: 'line', length: 2 };
    expect(areaTilesFor(cone, { attacker: from, target: boss }, bounds)).toEqual([]);
    expect(areaTilesFor(line, { attacker: from, target: boss }, bounds)).toEqual([]);
    const foe = { col: 7, row: 7 };
    expect(areaTilesFor(cone, { attacker: from, target: foe }, bounds)).toEqual([]);
  });

  it('a line from an edge runs on through the body and out the far side', () => {
    // From (9,6): strikes (7,6), then 4 tiles west: (6,6), (5,6) body, (4,6), (3,6).
    const tiles = areaTilesFor(
      { shape: 'line', length: 4 },
      { attacker: { col: 8, row: 6 }, target: boss },
      { cols: 12, rows: 12 },
    );
    expect(tiles).toEqual([
      { col: 6, row: 6 },
      { col: 5, row: 6 },
      { col: 4, row: 6 },
      { col: 3, row: 6 },
    ]);
  });
});

describe("Override's push at the Entity", () => {
  it('beside any edge the Entity braces, and nothing moves', () => {
    for (const [col, row] of [
      [8, 6],
      [6, 8],
      [4, 6],
      [6, 4],
    ]) {
      const lancer = unit('Lancer', 'player', col, row, { STR: 20 }, { weapon: weapon('Iron Lance') }); // prettier-ignore
      const boss = entity();
      const units = [lancer, boss];
      const world = worldOf(units);
      const plan = planAreaPush({
        source: lancer,
        primary: boss,
        area: { shape: 'line', length: 2 },
        units: [boss],
        world,
        getUnitAt: world.getUnitAt,
      });
      // Struck tile minus the lancer's tile: one step toward the body.
      const dc = Math.sign(6 - col) * (col === 6 ? 0 : 1);
      const dr = Math.sign(6 - row) * (row === 6 ? 0 : 1);
      expect(plan.direction).toEqual({ dc, dr });
      expect(plan.entries.map((e) => [e.unit, e.moved, e.reason])).toEqual([
        [boss, false, 'entity'],
      ]);
    }
  });
});
