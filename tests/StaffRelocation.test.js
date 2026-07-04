// Warp/Rescue staff relocation — pure engine tests.
// Spec: docs/specs/warp-rescue-staves.md (branch claude/rogue-emblem-early-game-5djnaz).
// Ally-relocation is staff-exclusive by design ruling; player-only.
import { describe, it, expect } from 'vitest';
import {
  getRelocateKind,
  isRelocateStaff,
  getRelocationTiles,
  getRelocationDestinations,
  findRelocateTargets,
} from '../src/engine/StaffRelocation.js';
import { serializeSuspendUnit } from '../src/ui/BattleSuspendController.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const rescueStaff = gameData.weapons.find((w) => w.name === 'Rescue Staff');
const warpStaff = gameData.weapons.find((w) => w.name === 'Warp Staff');

/**
 * Minimal grid stub. `blocked` maps "col,row" to 'all' or an array of
 * moveTypes that cannot enter that tile (mirrors Grid.getMoveCost Infinity).
 */
function makeGrid(cols, rows, blocked = {}) {
  return {
    cols,
    rows,
    getMoveCost(col, row, moveType) {
      const entry = blocked[`${col},${row}`];
      if (!entry) return 1;
      if (entry === 'all' || entry.includes(moveType)) return Infinity;
      return 1;
    },
  };
}

function makeUnitAt(units) {
  return (col, row) => units.find((u) => u.col === col && u.row === row) || null;
}

function unit(name, col, row, overrides = {}) {
  return {
    name,
    col,
    row,
    currentHP: 20,
    stats: { HP: 20, MAG: 5 },
    moveType: 'Infantry',
    ...overrides,
  };
}

describe('staff data (weapons.json)', () => {
  it('Rescue Staff matches the spec table', () => {
    expect(rescueStaff).toMatchObject({
      type: 'Staff',
      tier: 'Steel',
      rankRequired: 'Prof',
      might: 0,
      hit: 100,
      crit: 0,
      uses: 2,
      price: 2400,
      perBattleUses: true,
      relocate: 'rescue',
    });
    expect(rescueStaff.rangeBonuses).toEqual([
      { mag: 10, bonus: 1 },
      { mag: 18, bonus: 1 },
    ]);
    expect(rescueStaff.healBase).toBeUndefined();
    expect(rescueStaff.statusEffect).toBeUndefined();
    expect(rescueStaff.cureConditions).toBeUndefined();
  });

  it('Warp Staff matches the spec table (Mastery-gated, 1 use, premium price)', () => {
    expect(warpStaff).toMatchObject({
      type: 'Staff',
      tier: 'Legend',
      rankRequired: 'Mast',
      might: 0,
      hit: 100,
      crit: 0,
      uses: 1,
      price: 5000,
      perBattleUses: true,
      relocate: 'warp',
    });
    expect(warpStaff.rangeBonuses).toEqual([
      { mag: 12, bonus: 1 },
      { mag: 18, bonus: 1 },
    ]);
    expect(warpStaff.healBase).toBeUndefined();
  });

  it('classifies relocate staves and nothing else', () => {
    expect(getRelocateKind(rescueStaff)).toBe('rescue');
    expect(getRelocateKind(warpStaff)).toBe('warp');
    expect(isRelocateStaff(rescueStaff)).toBe(true);
    expect(isRelocateStaff(warpStaff)).toBe(true);
    expect(isRelocateStaff(gameData.weapons.find((w) => w.name === 'Heal'))).toBe(false);
    expect(isRelocateStaff(gameData.weapons.find((w) => w.name === 'Restore'))).toBe(false);
    expect(isRelocateStaff(gameData.weapons.find((w) => w.name === 'Iron Sword'))).toBe(false);
    expect(isRelocateStaff(null)).toBe(false);
    // Non-staff item with a stray relocate field is not a relocate staff.
    expect(isRelocateStaff({ type: 'Sword', relocate: 'warp' })).toBe(false);
  });
});

describe('loot pool placement (lootTables.json)', () => {
  it('Rescue Staff rides the act2+ weapon pools', () => {
    expect(gameData.lootTables.act1.weapons).not.toContain('Rescue Staff');
    expect(gameData.lootTables.act2.weapons).toContain('Rescue Staff');
    expect(gameData.lootTables.act3.weapons).toContain('Rescue Staff');
    expect(gameData.lootTables.act4.weapons).toContain('Rescue Staff');
  });

  it('Warp Staff is act3/act4 only', () => {
    expect(gameData.lootTables.act1.weapons).not.toContain('Warp Staff');
    expect(gameData.lootTables.act2.weapons).not.toContain('Warp Staff');
    expect(gameData.lootTables.act3.weapons).toContain('Warp Staff');
    expect(gameData.lootTables.act4.weapons).toContain('Warp Staff');
  });

  it('both pool names resolve to real weapons', () => {
    for (const name of ['Rescue Staff', 'Warp Staff']) {
      expect(gameData.weapons.find((w) => w.name === name)).toBeTruthy();
    }
  });

  it('neither staff joins enemy pools', () => {
    const enemyJson = JSON.stringify(gameData.enemies);
    expect(enemyJson).not.toContain('Rescue Staff');
    expect(enemyJson).not.toContain('Warp Staff');
  });
});

describe('getRelocationTiles', () => {
  it('returns the FULL diamond, not just the max-distance ring', () => {
    const grid = makeGrid(9, 9);
    const tiles = getRelocationTiles(grid, () => null, 4, 4, 2, 'Infantry');
    // Manhattan diamond radius 2 minus center: 4 at dist 1 + 8 at dist 2
    expect(tiles).toHaveLength(12);
    expect(tiles).toContainEqual({ col: 5, row: 4 }); // dist 1 included
    expect(tiles).toContainEqual({ col: 6, row: 4 }); // dist 2 included
    expect(tiles).not.toContainEqual({ col: 4, row: 4 }); // center excluded
    expect(tiles).not.toContainEqual({ col: 6, row: 6 }); // Chebyshev corner excluded
  });

  it('clips to grid bounds', () => {
    const grid = makeGrid(3, 3);
    const tiles = getRelocationTiles(grid, () => null, 0, 0, 2, 'Infantry');
    expect(tiles).toHaveLength(5); // (1,0),(0,1),(2,0),(0,2),(1,1)
    for (const t of tiles) {
      expect(t.col).toBeGreaterThanOrEqual(0);
      expect(t.row).toBeGreaterThanOrEqual(0);
    }
  });

  it('excludes occupied tiles (any faction)', () => {
    const grid = makeGrid(9, 9);
    const enemy = unit('Enemy', 5, 4);
    const tiles = getRelocationTiles(grid, makeUnitAt([enemy]), 4, 4, 1, 'Infantry');
    expect(tiles).toHaveLength(3);
    expect(tiles).not.toContainEqual({ col: 5, row: 4 });
  });

  it('judges passability by the given moveType', () => {
    // Mountain-like tile at (5,4): impassable for Armored, fine for Flying
    const grid = makeGrid(9, 9, { '5,4': ['Armored', 'Cavalry'] });
    const armored = getRelocationTiles(grid, () => null, 4, 4, 1, 'Armored');
    const flying = getRelocationTiles(grid, () => null, 4, 4, 1, 'Flying');
    expect(armored).not.toContainEqual({ col: 5, row: 4 });
    expect(flying).toContainEqual({ col: 5, row: 4 });
  });

  it('respects minDistance and returns [] for degenerate radius', () => {
    const grid = makeGrid(9, 9);
    expect(getRelocationTiles(grid, () => null, 4, 4, 0, 'Infantry')).toEqual([]);
    const ring = getRelocationTiles(grid, () => null, 4, 4, 2, 'Infantry', { minDistance: 2 });
    expect(ring).toHaveLength(8);
    expect(ring).not.toContainEqual({ col: 5, row: 4 });
  });
});

describe('getRelocationDestinations', () => {
  it('rescue destinations are the free tiles adjacent to the CASTER', () => {
    const caster = unit('Sera', 4, 4, { stats: { HP: 18, MAG: 5 } });
    const ally = unit('Edric', 4, 7);
    const blockerAlly = unit('Galvin', 3, 4);
    const grid = makeGrid(9, 9, { '4,3': 'all' }); // wall above caster
    const tiles = getRelocationDestinations(
      rescueStaff,
      caster,
      ally,
      grid,
      makeUnitAt([caster, ally, blockerAlly]),
    );
    // Adjacent to caster: (5,4) free, (4,5) free; (3,4) occupied, (4,3) wall
    expect(tiles).toEqual(
      expect.arrayContaining([
        { col: 5, row: 4 },
        { col: 4, row: 5 },
      ]),
    );
    expect(tiles).toHaveLength(2);
  });

  it('warp destinations form the effective-radius diamond and exclude the ally tile', () => {
    const caster = unit('Sera', 6, 6, { stats: { HP: 18, MAG: 12 } }); // radius 5 at MAG 12
    const ally = unit('Edric', 7, 6);
    const grid = makeGrid(20, 20); // diamond fully inside the grid
    const tiles = getRelocationDestinations(
      warpStaff,
      caster,
      ally,
      grid,
      makeUnitAt([caster, ally]),
    );
    expect(tiles).not.toContainEqual({ col: 7, row: 6 }); // ally's own tile
    expect(tiles).not.toContainEqual({ col: 6, row: 6 }); // caster tile (center)
    expect(tiles).toContainEqual({ col: 6, row: 11 }); // dist 5 reachable
    expect(tiles).not.toContainEqual({ col: 6, row: 12 }); // dist 6 out of radius
    expect(tiles).toHaveLength(59); // 60-tile diamond minus the occupied ally tile
  });

  it('returns [] for a non-relocate staff', () => {
    const healStaff = gameData.weapons.find((w) => w.name === 'Heal');
    const caster = unit('Sera', 4, 4);
    const ally = unit('Edric', 5, 4);
    expect(getRelocationDestinations(healStaff, caster, ally, makeGrid(9, 9), () => null)).toEqual(
      [],
    );
  });
});

describe('findRelocateTargets — rescue', () => {
  const grid = makeGrid(11, 11);

  function casterAt(col, row, mag = 5) {
    return unit('Sera', col, row, { stats: { HP: 18, MAG: mag } });
  }

  it('targets living allies within effective range, never self', () => {
    const caster = casterAt(5, 5);
    const inRange = unit('Edric', 5, 8); // dist 3
    const tooFar = unit('Galvin', 5, 9); // dist 4 > base max 3
    const dead = unit('Yorn', 8, 5, { currentHP: 0 });
    const removing = unit('Mira', 5, 2, { _removing: true });
    const targets = findRelocateTargets(
      rescueStaff,
      caster,
      [caster, inRange, tooFar, dead, removing],
      grid,
      makeUnitAt([caster, inRange]),
    );
    expect(targets).toEqual([inRange]);
  });

  it('MAG 10 extends the targeting range to 4', () => {
    const caster = casterAt(5, 5, 10);
    const distFour = unit('Galvin', 5, 9);
    const targets = findRelocateTargets(
      rescueStaff,
      caster,
      [caster, distFour],
      grid,
      makeUnitAt([caster, distFour]),
    );
    expect(targets).toEqual([distFour]);
  });

  it('excludes already-adjacent allies (relocation would be a no-op)', () => {
    const caster = casterAt(5, 5);
    const adjacent = unit('Edric', 5, 6);
    const targets = findRelocateTargets(
      rescueStaff,
      caster,
      [caster, adjacent],
      grid,
      makeUnitAt([caster, adjacent]),
    );
    expect(targets).toEqual([]);
  });

  it('filters out allies with no legal adjacent destination for THEIR moveType', () => {
    // Caster boxed in by walls except one adjacent tile only fliers can enter.
    const boxedGrid = makeGrid(11, 11, {
      '4,5': 'all',
      '6,5': 'all',
      '5,4': 'all',
      '5,6': ['Infantry', 'Armored', 'Cavalry'],
    });
    const caster = casterAt(5, 5);
    const knight = unit('Borin', 5, 8, { moveType: 'Armored' });
    const flier = unit('Aria', 8, 5, { moveType: 'Flying' });
    const targets = findRelocateTargets(
      rescueStaff,
      caster,
      [caster, knight, flier],
      boxedGrid,
      makeUnitAt([caster, knight, flier]),
    );
    expect(targets).toEqual([flier]);
  });
});

describe('findRelocateTargets — warp', () => {
  const grid = makeGrid(11, 11);

  it('targets only living ADJACENT allies', () => {
    const caster = unit('Bishop', 5, 5, { stats: { HP: 20, MAG: 5 } });
    const adjacent = unit('Edric', 5, 6);
    const distTwo = unit('Galvin', 5, 7);
    const deadAdjacent = unit('Yorn', 4, 5, { currentHP: 0 });
    const targets = findRelocateTargets(
      warpStaff,
      caster,
      [caster, adjacent, distTwo, deadAdjacent],
      grid,
      makeUnitAt([caster, adjacent, distTwo]),
    );
    expect(targets).toEqual([adjacent]);
  });

  it('filters out an adjacent ally with no legal destination in the radius', () => {
    // 3x1 corridor: caster and ally fill it; every other tile is wall.
    const blocked = {};
    for (let c = 0; c < 11; c++) {
      for (let r = 0; r < 11; r++) {
        if (!(r === 5 && (c === 4 || c === 5))) blocked[`${c},${r}`] = 'all';
      }
    }
    const corridorGrid = makeGrid(11, 11, blocked);
    const caster = unit('Bishop', 4, 5, { stats: { HP: 20, MAG: 5 } });
    const ally = unit('Edric', 5, 5);
    const targets = findRelocateTargets(
      warpStaff,
      caster,
      [caster, ally],
      corridorGrid,
      makeUnitAt([caster, ally]),
    );
    expect(targets).toEqual([]);
  });

  it('a flier ally can be warped over terrain an infantry ally cannot land on', () => {
    // Only water tiles inside the radius: flier has destinations, infantry none.
    const blocked = {};
    for (let c = 0; c < 11; c++) {
      for (let r = 0; r < 11; r++) {
        if (!(r === 5 && (c === 4 || c === 5))) {
          blocked[`${c},${r}`] = ['Infantry', 'Armored', 'Cavalry'];
        }
      }
    }
    const waterGrid = makeGrid(11, 11, blocked);
    const caster = unit('Bishop', 4, 5, { stats: { HP: 20, MAG: 5 } });
    const infantry = unit('Edric', 5, 5, { moveType: 'Infantry' });
    expect(
      findRelocateTargets(
        warpStaff,
        caster,
        [caster, infantry],
        waterGrid,
        makeUnitAt([caster, infantry]),
      ),
    ).toEqual([]);
    const flier = unit('Aria', 5, 5, { moveType: 'Flying' });
    expect(
      findRelocateTargets(
        warpStaff,
        caster,
        [caster, flier],
        waterGrid,
        makeUnitAt([caster, flier]),
      ),
    ).toEqual([flier]);
  });
});

describe('suspend/resume round-trip', () => {
  it('serializeSuspendUnit preserves _usesSpent on a relocate staff and relinks the weapon', () => {
    const staff = { ...structuredClone(warpStaff), uid: 'w-warp-1', _usesSpent: 1 };
    const healer = {
      name: 'Bishop',
      className: 'Bishop',
      faction: 'player',
      level: 12,
      col: 3,
      row: 3,
      stats: { HP: 28, STR: 4, MAG: 14, SKL: 9, SPD: 9, LCK: 7, DEF: 6, RES: 12, MOV: 5 },
      currentHP: 28,
      weapon: staff,
      inventory: [staff],
      consumables: [],
      skills: [],
      proficiencies: [{ type: 'Staff', rank: 'Mast' }],
      hasMoved: true,
      hasActed: true,
      _movementSpent: 3,
      _conditions: [],
    };

    const data = serializeSuspendUnit(healer);

    expect(data.inventory[0]._usesSpent).toBe(1);
    expect(data.inventory[0].relocate).toBe('warp');
    expect(data.weapon).toBe(data.inventory[0]); // identity invariant preserved
    expect(data.hasActed).toBe(true);
    // Round-trip through JSON (localStorage persistence shape)
    const restored = JSON.parse(JSON.stringify(data));
    expect(restored.inventory[0]._usesSpent).toBe(1);
    expect(restored.inventory[0].relocate).toBe('warp');
  });
});
