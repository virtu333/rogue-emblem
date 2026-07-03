// Phase 5 — AIController exercised against the REAL Grid (not the mock used by
// AIController.test.js, whose getMovementRange returns raw costs instead of the
// real { cost, parent, stoppable } entries). Covers candidate generation vs
// stoppable moveRange entries, boss throne clamping, ice-diverted movement, and
// acidic-tile avoidance.
import { describe, it, expect } from 'vitest';
import { Grid } from '../src/engine/Grid.js';
import { AIController } from '../src/engine/AIController.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const T = Object.fromEntries(gameData.terrain.map((t, i) => [t.name, i]));

function makeMockScene() {
  const stub = {
    depth: 0,
    setDepth() {
      return this;
    },
    setDisplaySize() {
      return this;
    },
    setOrigin() {
      return this;
    },
    setAlpha() {
      return this;
    },
    setVisible() {
      return this;
    },
    setPosition() {
      return this;
    },
    destroy() {},
  };
  return {
    cameras: { main: { width: 640, height: 480 } },
    add: {
      rectangle: () => ({ ...stub }),
      image: () => ({ ...stub }),
      text: () => ({ ...stub }),
      container: () => ({ ...stub, add() {} }),
    },
    textures: { exists: () => false },
  };
}

function gridFromNames(rowsOfNames) {
  const rows = rowsOfNames.length;
  const cols = rowsOfNames[0].length;
  const mapLayout = rowsOfNames.map((row) => row.map((name) => T[name]));
  return new Grid(makeMockScene(), cols, rows, gameData.terrain, mapLayout, false);
}

const STATS = { HP: 24, STR: 12, MAG: 0, SKL: 8, SPD: 6, LCK: 5, DEF: 6, RES: 4, MOV: 5 };

function enemy(overrides = {}) {
  return {
    col: 0,
    row: 0,
    mov: 5,
    moveType: 'Infantry',
    faction: 'enemy',
    isBoss: false,
    className: 'Fighter',
    weapon: { name: 'Iron Sword', range: '1', type: 'Sword', might: 5 },
    stats: { ...STATS },
    currentHP: STATS.HP,
    ...overrides,
  };
}
function player(overrides = {}) {
  return {
    col: 0,
    row: 0,
    faction: 'player',
    isLord: false,
    className: 'Soldier',
    weapon: { name: 'Iron Lance', range: '1', type: 'Lance', might: 5 },
    stats: { ...STATS },
    currentHP: STATS.HP,
    ...overrides,
  };
}

function lastTile(path, fallback) {
  if (Array.isArray(path) && path.length > 0) return path[path.length - 1];
  return fallback;
}

describe('AIController vs real Grid — candidate generation', () => {
  it('moves adjacent to the target and attacks, landing on a stoppable range tile', () => {
    const grid = gridFromNames([
      ['Plain', 'Plain', 'Plain', 'Plain', 'Plain', 'Plain'],
      ['Plain', 'Plain', 'Plain', 'Plain', 'Plain', 'Plain'],
    ]);
    const ai = new AIController(grid, gameData, { objective: 'rout' });
    const e = enemy({ col: 0, row: 0, mov: 5 });
    const p = player({ col: 5, row: 0 });

    const decision = ai._decideAction(e, [e], [p], []);
    expect(decision.target).toBe(p);
    const tile = decision.detail.attackTile;
    // Ended adjacent to the target...
    expect(Math.abs(tile.col - p.col) + Math.abs(tile.row - p.row)).toBe(1);
    // ...on a real, stoppable movement-range tile that is not the target's tile.
    const range = grid.getMovementRange(e.col, e.row, e.mov, e.moveType, null, 'enemy', 0);
    const entry = range.get(`${tile.col},${tile.row}`);
    expect(entry).toBeDefined();
    expect(entry.stoppable).not.toBe(false);
    expect(`${tile.col},${tile.row}`).not.toBe(`${p.col},${p.row}`);
  });

  it('never stops on an ally-occupied tile (passes through, does not land)', () => {
    const grid = gridFromNames([['Plain', 'Plain', 'Plain', 'Plain', 'Plain', 'Plain']]);
    const ai = new AIController(grid, gameData, { objective: 'rout' });
    const e = enemy({ col: 0, row: 0, mov: 5 });
    const ally = enemy({ col: 1, row: 0 }); // same faction, blocks stopping
    const p = player({ col: 5, row: 0 });

    const decision = ai._decideAction(e, [e, ally], [p], []);
    const tile = decision.detail?.attackTile || lastTile(decision.path, { col: e.col, row: e.row });
    expect(`${tile.col},${tile.row}`).not.toBe('1,0'); // never lands on the ally
    // Positive assertion: with mov 5 and the target at col 5, the only tile
    // adjacent to the target within range is (4,0) — the enemy must actually
    // move there (not stand still at its start tile) and attack.
    expect(decision.reason).toBe('attack_in_range');
    expect(tile).toEqual({ col: 4, row: 0 });
    expect(decision.path.length).toBeGreaterThan(1);
  });
});

describe('AIController vs real Grid — boss throne clamping', () => {
  it('a seize boss stays within 1 tile of the throne instead of chasing', () => {
    const grid = gridFromNames([
      ['Plain', 'Plain', 'Plain', 'Plain', 'Plain', 'Plain', 'Plain'],
      ['Plain', 'Plain', 'Plain', 'Plain', 'Plain', 'Plain', 'Plain'],
      ['Plain', 'Plain', 'Plain', 'Plain', 'Plain', 'Plain', 'Plain'],
    ]);
    const throne = { col: 5, row: 1 };
    const ai = new AIController(grid, gameData, { objective: 'seize', thronePos: throne });
    const boss = enemy({ col: 5, row: 1, mov: 6, isBoss: true });
    const p = player({ col: 0, row: 1 }); // far away

    const decision = ai._decideAction(boss, [boss], [p], []);
    const tile = lastTile(decision.path, { col: boss.col, row: boss.row });
    expect(Math.abs(tile.col - throne.col) + Math.abs(tile.row - throne.row)).toBeLessThanOrEqual(
      1,
    );
  });
});

describe('AIController vs real Grid — ice-diverted movement', () => {
  it('lands on the ice-slide landing tile, not a mid-ice tile', () => {
    // Enemy at (0,0); stepping right onto ice at (1,0) slides over (2,0) to (3,0).
    const grid = gridFromNames([['Plain', 'Ice', 'Ice', 'Plain', 'Plain']]);
    const ai = new AIController(grid, gameData, { objective: 'rout' });
    const e = enemy({ col: 0, row: 0, mov: 4 });
    const p = player({ col: 4, row: 0 });

    const decision = ai._decideAction(e, [e], [p], []);
    const tile = decision.detail?.attackTile || lastTile(decision.path, { col: e.col, row: e.row });
    // The landing must be a real stoppable range tile — ice tiles (1,0)/(2,0) are
    // not valid stopping points, so the enemy must not "stop" on them.
    const range = grid.getMovementRange(e.col, e.row, e.mov, e.moveType, null, 'enemy', 0);
    expect(range.has(`${tile.col},${tile.row}`)).toBe(true);
    expect(`${tile.col},${tile.row}`).not.toBe('1,0');
    expect(`${tile.col},${tile.row}`).not.toBe('2,0');
    // Positive assertion: the slide over (1,0)/(2,0) deterministically lands at
    // (3,0), adjacent to the player at (4,0) — the enemy must actually reach and
    // attack from there, not stay put at its start tile.
    expect(decision.reason).toBe('attack_in_range');
    expect(tile).toEqual({ col: 3, row: 0 });
    expect(decision.path.length).toBeGreaterThan(1);
  });
});

describe('AIController vs real Grid — acidic-tile avoidance', () => {
  it('prefers a non-acidic landing when a safe alternative reaches the target', () => {
    // Target at (3,1). Adjacent tiles include (3,0) Acidic Swamp and (3,2) Plain
    // (and (2,1) Plain). The enemy should avoid ending on the acidic tile.
    const grid = gridFromNames([
      ['Plain', 'Plain', 'Plain', 'Acidic Swamp'],
      ['Plain', 'Plain', 'Plain', 'Plain'],
      ['Plain', 'Plain', 'Plain', 'Plain'],
    ]);
    const ai = new AIController(grid, gameData, { objective: 'rout' });
    const e = enemy({ col: 0, row: 1, mov: 6 });
    const p = player({ col: 3, row: 1 });

    const decision = ai._decideAction(e, [e], [p], []);
    const tile = decision.detail?.attackTile || lastTile(decision.path, { col: e.col, row: e.row });
    const idx = grid.mapLayout[tile.row][tile.col];
    expect(gameData.terrain[idx].name).not.toBe('Acidic Swamp');
    // Positive assertion: the enemy must actually move to and attack from the
    // safe alternative (2,1) — not merely avoid the acidic tile by standing still.
    expect(decision.reason).toBe('attack_in_range');
    expect(tile).toEqual({ col: 2, row: 1 });
    expect(decision.path.length).toBeGreaterThan(1);
  });
});
