import { describe, it, expect } from 'vitest';
import {
  rollCaravanSpawn,
  pickCaravanSpawnTile,
  createCaravanUnit,
  computeCaravanStep,
  isCaravanAtEdge,
} from '../src/engine/CaravanSystem.js';
import { CARAVAN_SPAWN_CHANCE } from '../src/utils/constants.js';

// Minimal 2-terrain set: index 0 passable for everyone, index 1 impassable.
const terrainData = [
  { name: 'Plain', moveCost: { Infantry: '1', Armored: '1', Cavalry: '1', Flying: '1' } },
  { name: 'Mountain', moveCost: { Infantry: '--', Armored: '--', Cavalry: '--', Flying: '1' } },
];

function flatMap(cols, rows, fill = 0) {
  return Array.from({ length: rows }, () => Array(cols).fill(fill));
}

describe('CaravanSystem', () => {
  describe('rollCaravanSpawn', () => {
    const baseParams = { act: 'act2', objective: 'rout' };

    it('never spawns on act1', () => {
      const rng = () => 0; // would always trigger if allowed
      expect(rollCaravanSpawn({ ...baseParams, act: 'act1' }, 0, rng)).toBe(false);
    });

    it('excludes recruit battles', () => {
      const rng = () => 0;
      expect(rollCaravanSpawn({ ...baseParams, isRecruitBattle: true }, 0, rng)).toBe(false);
    });

    it('excludes boss battles', () => {
      const rng = () => 0;
      expect(rollCaravanSpawn({ ...baseParams, isBoss: true }, 0, rng)).toBe(false);
    });

    it('excludes escape objective', () => {
      const rng = () => 0;
      expect(rollCaravanSpawn({ ...baseParams, objective: 'escape' }, 0, rng)).toBe(false);
    });

    it('excludes ambush battles', () => {
      const rng = () => 0;
      expect(rollCaravanSpawn({ ...baseParams, isAmbush: true }, 0, rng)).toBe(false);
    });

    it('excludes prologue (scripted) battles', () => {
      const rng = () => 0;
      expect(
        rollCaravanSpawn({ ...baseParams, prologueChapter: 'p1_banner_at_dawn' }, 0, rng),
      ).toBe(false);
    });

    it('excludes colosseum battles', () => {
      const rng = () => 0;
      expect(rollCaravanSpawn({ ...baseParams, isColosseum: true }, 0, rng)).toBe(false);
    });

    it('allows a normal BATTLE/rout node on act2+', () => {
      const rng = () => 0; // below any positive chance
      expect(rollCaravanSpawn(baseParams, 0, rng)).toBe(true);
    });

    it('allows a seize (elite) node on act2+', () => {
      const rng = () => 0;
      expect(rollCaravanSpawn({ ...baseParams, objective: 'seize', isElite: true }, 0, rng)).toBe(
        true,
      );
    });

    it('honors the base chance boundary (seeded rng)', () => {
      const justUnder = () => CARAVAN_SPAWN_CHANCE - 0.001;
      const justOver = () => CARAVAN_SPAWN_CHANCE + 0.001;
      expect(rollCaravanSpawn(baseParams, 0, justUnder)).toBe(true);
      expect(rollCaravanSpawn(baseParams, 0, justOver)).toBe(false);
    });

    it('honors the meta caravanChanceBonus', () => {
      // Roll sits above base chance but below base+bonus.
      const roll = CARAVAN_SPAWN_CHANCE + 0.05;
      const rng = () => roll;
      expect(rollCaravanSpawn(baseParams, 0, rng)).toBe(false);
      expect(rollCaravanSpawn(baseParams, 0.1, rng)).toBe(true);
    });

    it('returns false for null params', () => {
      expect(rollCaravanSpawn(null)).toBe(false);
    });
  });

  describe('pickCaravanSpawnTile', () => {
    const man = (a, b) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
    // A 20x9 field: the army starts on the left, the enemy on the right.
    const cols = 20;
    const rows = 9;
    const playerSpawns = [
      { col: 1, row: 3 },
      { col: 1, row: 4 },
      { col: 1, row: 5 },
    ];
    const enemySpawns = [
      { col: 17, row: 2 },
      { col: 18, row: 4 },
      { col: 17, row: 6 },
    ];
    // Every rng draw, from the first candidate to the last.
    const draws = [0, 0.2, 0.4, 0.6, 0.8, 0.999];

    it('spawns in the neutral band: at least 6 from every enemy and every player spawn', () => {
      const mapLayout = flatMap(cols, rows, 0);
      for (const r of draws) {
        const tile = pickCaravanSpawnTile(
          mapLayout,
          cols,
          rows,
          terrainData,
          playerSpawns,
          enemySpawns,
          () => r,
        );
        expect(tile).toBeTruthy();
        for (const s of enemySpawns) expect(man(tile, s)).toBeGreaterThanOrEqual(6);
        for (const s of playerSpawns) expect(man(tile, s)).toBeGreaterThanOrEqual(6);
      }
    });

    it('exits away from the enemy: never toward the enemy edge, never nearer an enemy spawn', () => {
      const mapLayout = flatMap(cols, rows, 0);
      for (const r of draws) {
        const tile = pickCaravanSpawnTile(
          mapLayout,
          cols,
          rows,
          terrainData,
          playerSpawns,
          enemySpawns,
          () => r,
        );
        expect(tile.exit).not.toEqual({ dc: 1, dr: 0 }); // the enemy's side
        const nearest = (t) => Math.min(...enemySpawns.map((s) => man(s, t)));
        const start = nearest(tile);
        for (let c = tile.col, r2 = tile.row; c >= 0 && c < cols && r2 >= 0 && r2 < rows; ) {
          expect(nearest({ col: c, row: r2 })).toBeGreaterThanOrEqual(start);
          c += tile.exit.dc;
          r2 += tile.exit.dr;
        }
      }
    });

    it('takes the first safe tile in reading order for the lowest draw, walking away', () => {
      const mapLayout = flatMap(cols, rows, 0);
      const tile = pickCaravanSpawnTile(
        mapLayout,
        cols,
        rows,
        terrainData,
        playerSpawns,
        enemySpawns,
        () => 0,
      );
      // Row 0: (4,0) is the first tile 6 from the army ((1,3): 3+3); 13+ from the enemy.
      // Its only way out that never nears the enemy is left (down nears the formation's
      // centre row, right is the enemy's side, up is the edge it stands on).
      expect(tile).toEqual({ col: 4, row: 0, exit: { dc: -1, dr: 0 } });
    });

    it('never picks a tile the army cannot walk to', () => {
      // 12x3, the army at (0,1) behind a full wall at column 3: every tile 6+ from it
      // (columns 5+) is on the far side, so no caravan rather than one out of reach.
      const w = 12;
      const h = 3;
      const mapLayout = flatMap(w, h, 0);
      for (let r = 0; r < h; r++) mapLayout[r][3] = 1;
      const army = [{ col: 0, row: 1 }];
      for (const r of draws)
        expect(pickCaravanSpawnTile(mapLayout, w, h, terrainData, army, [], () => r)).toBeNull();
      mapLayout[0][3] = 0; // a gap in the wall: the far side is reachable now
      for (const r of draws) {
        const tile = pickCaravanSpawnTile(mapLayout, w, h, terrainData, army, [], () => r);
        expect(tile).toBeTruthy();
        expect(man(tile, army[0])).toBeGreaterThanOrEqual(6);
      }
    });

    it('skips the caravan when no tile is 6 from the enemy (never a bad tile)', () => {
      // 10 wide: every tile is within 5 of some enemy spawn in the middle column.
      const mapLayout = flatMap(10, 5, 0);
      const enemies = [
        { col: 4, row: 0 },
        { col: 4, row: 4 },
        { col: 8, row: 2 },
        { col: 0, row: 2 },
      ];
      for (const r of draws)
        expect(
          pickCaravanSpawnTile(
            mapLayout,
            10,
            5,
            terrainData,
            [{ col: 0, row: 0 }],
            enemies,
            () => r,
          ),
        ).toBeNull();
      expect(pickCaravanSpawnTile([[1, 1]], 2, 1, terrainData, [], [])).toBeNull();
    });

    it('comes nearer the army (never under 4) only when nothing 6 away is safe', () => {
      // 13x3, army at (0,1), enemy at (12,1), a full wall at column 5: the army reaches
      // columns 0..4 only, where the farthest tiles from it are (4,0) and (4,2) at 5.
      const w = 13;
      const h = 3;
      const mapLayout = flatMap(w, h, 0);
      for (let r = 0; r < h; r++) mapLayout[r][5] = 1;
      const army = [{ col: 0, row: 1 }];
      const enemy = [{ col: 12, row: 1 }];
      const seen = new Set();
      for (const r of draws) {
        const tile = pickCaravanSpawnTile(mapLayout, w, h, terrainData, army, enemy, () => r, {
          minExitSteps: 1,
        });
        expect(tile).toBeTruthy();
        expect(man(tile, enemy[0])).toBeGreaterThanOrEqual(6);
        seen.add(man(tile, army[0]));
      }
      // The band gives one tile at a time: 5 exists, so nothing nearer is used.
      expect([...seen]).toEqual([5]);
      // With the floor at 6 the map goes without.
      expect(
        pickCaravanSpawnTile(mapLayout, w, h, terrainData, army, enemy, () => 0, {
          minExitSteps: 1,
          minPlayerDistanceFloor: 6,
        }),
      ).toBeNull();
    });

    it('needs a few turns of walking to its exit', () => {
      const mapLayout = flatMap(cols, rows, 0);
      for (const r of draws) {
        const tile = pickCaravanSpawnTile(
          mapLayout,
          cols,
          rows,
          terrainData,
          playerSpawns,
          enemySpawns,
          () => r,
        );
        const { dc, dr } = tile.exit;
        const steps =
          dc > 0
            ? cols - 1 - tile.col
            : dc < 0
              ? tile.col
              : dr > 0
                ? rows - 1 - tile.row
                : tile.row;
        expect(steps).toBeGreaterThanOrEqual(4);
      }
    });
  });

  describe('createCaravanUnit', () => {
    it('creates an unarmed, MOV 1, flagged NPC unit scaled by act', () => {
      const unit = createCaravanUnit('act2', { col: 3, row: 4 });
      expect(unit.isCaravan).toBe(true);
      expect(unit.faction).toBe('npc');
      expect(unit.weapon).toBeNull();
      expect(unit.mov).toBe(1);
      expect(unit.stats.MOV).toBe(1);
      expect(unit.col).toBe(3);
      expect(unit.row).toBe(4);
      expect(unit.currentHP).toBeGreaterThan(0);
    });

    it('scales HP up with act number', () => {
      const act2 = createCaravanUnit('act2', { col: 0, row: 0 });
      const act4 = createCaravanUnit('act4', { col: 0, row: 0 });
      expect(act4.stats.HP).toBeGreaterThan(act2.stats.HP);
    });
  });

  describe('computeCaravanStep', () => {
    it('steps toward the nearest column edge (left)', () => {
      const cols = 10;
      const rows = 3;
      const mapLayout = flatMap(cols, rows, 0);
      const unit = { col: 1, row: 1, moveType: 'Infantry' };
      const step = computeCaravanStep(unit, mapLayout, cols, rows, terrainData, new Set());
      expect(step).toEqual({ col: 0, row: 1 });
    });

    it('steps toward the nearest column edge (right)', () => {
      const cols = 10;
      const rows = 3;
      const mapLayout = flatMap(cols, rows, 0);
      const unit = { col: 8, row: 1, moveType: 'Infantry' };
      const step = computeCaravanStep(unit, mapLayout, cols, rows, terrainData, new Set());
      expect(step).toEqual({ col: 9, row: 1 });
    });

    it('sidesteps vertically around a single wall segment blocking the forward tile', () => {
      // Live-smoke case: forward tile is a Wall, but the rows above/below are
      // open — the caravan should sidestep instead of parking forever.
      const cols = 10;
      const rows = 5;
      const mapLayout = flatMap(cols, rows, 0);
      mapLayout[2][8] = 1; // wall directly ahead of a right-bound caravan at (7,2)
      const unit = { col: 7, row: 2, moveType: 'Infantry' };
      const step = computeCaravanStep(unit, mapLayout, cols, rows, terrainData, new Set());
      expect(step).toBeTruthy();
      expect(step.col).toBe(7); // vertical sidestep, same column
      expect([1, 3]).toContain(step.row);
    });

    it('holds still against a full wall column (no oscillation)', () => {
      // Every row of the forward column is impassable: a sidestep gains
      // nothing (the destination row is equally blocked), so the caravan must
      // hold rather than wiggle up and down forever.
      const cols = 10;
      const rows = 5;
      const mapLayout = flatMap(cols, rows, 0);
      for (let r = 0; r < rows; r++) mapLayout[r][8] = 1; // full wall column
      const unit = { col: 7, row: 2, moveType: 'Infantry' };
      const step = computeCaravanStep(unit, mapLayout, cols, rows, terrainData, new Set());
      expect(step).toBeNull();
    });

    it('sidesteps when the forward tile is occupied by a unit and a sidestep row is open', () => {
      const cols = 10;
      const rows = 5;
      const mapLayout = flatMap(cols, rows, 0);
      const unit = { col: 7, row: 2, moveType: 'Infantry' };
      const occupied = new Set(['8,2']); // a unit stands on the forward tile
      const step = computeCaravanStep(unit, mapLayout, cols, rows, terrainData, occupied);
      expect(step).toBeTruthy();
      expect(step.col).toBe(7);
      expect([1, 3]).toContain(step.row);
    });

    it('holds still when the forward tile and both sidestep tiles are blocked', () => {
      const cols = 10;
      const rows = 5;
      const mapLayout = flatMap(cols, rows, 0);
      mapLayout[2][8] = 1; // forward wall
      const unit = { col: 7, row: 2, moveType: 'Infantry' };
      const occupied = new Set(['7,1', '7,3']); // both sidestep tiles occupied
      const step = computeCaravanStep(unit, mapLayout, cols, rows, terrainData, occupied);
      expect(step).toBeNull();
    });

    it('sidestep only targets a row whose own forward tile is passable', () => {
      // Forward (8,2) walled; row 1's forward (8,1) also walled, row 3's
      // forward (8,3) open -> must sidestep DOWN to (7,3), never up.
      const cols = 10;
      const rows = 5;
      const mapLayout = flatMap(cols, rows, 0);
      mapLayout[2][8] = 1;
      mapLayout[1][8] = 1;
      const unit = { col: 7, row: 2, moveType: 'Infantry' };
      const step = computeCaravanStep(unit, mapLayout, cols, rows, terrainData, new Set());
      expect(step).toEqual({ col: 7, row: 3 });
    });

    it('returns null when already at the edge', () => {
      const cols = 5;
      const rows = 3;
      const mapLayout = flatMap(cols, rows, 0);
      const unit = { col: 0, row: 1, moveType: 'Infantry' };
      const step = computeCaravanStep(unit, mapLayout, cols, rows, terrainData, new Set());
      expect(step).toBeNull();
    });
  });

  describe('isCaravanAtEdge', () => {
    it('a caravan without an exit (older saves): true at col 0 or cols-1', () => {
      expect(isCaravanAtEdge({ col: 0 }, 10)).toBe(true);
      expect(isCaravanAtEdge({ col: 9 }, 10)).toBe(true);
      expect(isCaravanAtEdge({ col: 5 }, 10)).toBe(false);
    });

    it('with an exit: only its own edge counts', () => {
      const at = (col, row, dc, dr) =>
        isCaravanAtEdge({ col, row, caravanExit: { dc, dr } }, 10, 6);
      expect(at(0, 3, -1, 0)).toBe(true);
      expect(at(9, 3, -1, 0)).toBe(false); // the far edge is not its way out
      expect(at(9, 3, 1, 0)).toBe(true);
      expect(at(4, 0, 0, -1)).toBe(true);
      expect(at(0, 2, 0, -1)).toBe(false);
      expect(at(4, 5, 0, 1)).toBe(true);
      expect(at(4, 0, 0, 1)).toBe(false);
    });
  });

  describe('exits: spawn to edge', () => {
    it('the unit keeps the exit its spawn tile chose', () => {
      expect(
        createCaravanUnit('act2', { col: 3, row: 4, exit: { dc: 0, dr: -1 } }).caravanExit,
      ).toEqual({ dc: 0, dr: -1 });
      expect(createCaravanUnit('act2', { col: 3, row: 4 }).caravanExit).toBeUndefined();
    });

    it('steps along its exit, not toward the nearest edge', () => {
      const mapLayout = flatMap(10, 6, 0);
      // Nearest edge is the right one (col 8 of 10), but its way out is left.
      const unit = { col: 8, row: 2, moveType: 'Infantry', caravanExit: { dc: -1, dr: 0 } };
      expect(computeCaravanStep(unit, mapLayout, 10, 6, terrainData, new Set())).toEqual({
        col: 7,
        row: 2,
      });
      const up = { col: 5, row: 4, moveType: 'Infantry', caravanExit: { dc: 0, dr: -1 } };
      expect(computeCaravanStep(up, mapLayout, 10, 6, terrainData, new Set())).toEqual({
        col: 5,
        row: 3,
      });
      const down = { col: 5, row: 5, moveType: 'Infantry', caravanExit: { dc: 0, dr: 1 } };
      expect(computeCaravanStep(down, mapLayout, 10, 6, terrainData, new Set())).toBeNull();
    });

    it('a vertical exit sidesteps across columns around a wall, toward the centre', () => {
      const mapLayout = flatMap(10, 6, 0);
      mapLayout[2][3] = 1; // wall right above (3,3)
      const unit = { col: 3, row: 3, moveType: 'Infantry', caravanExit: { dc: 0, dr: -1 } };
      // Both (2,3) and (4,3) work; (4,3) is nearer the centre column 4.5.
      expect(computeCaravanStep(unit, mapLayout, 10, 6, terrainData, new Set())).toEqual({
        col: 4,
        row: 3,
      });
      // A full wall row ahead: hold still.
      for (let c = 0; c < 10; c++) mapLayout[2][c] = 1;
      expect(computeCaravanStep(unit, mapLayout, 10, 6, terrainData, new Set())).toBeNull();
    });

    it('walks a spawn tile out through its exit edge without passing an enemy spawn', () => {
      const cols = 20;
      const rows = 9;
      const mapLayout = flatMap(cols, rows, 0);
      const army = [
        { col: 1, row: 3 },
        { col: 1, row: 4 },
      ];
      const enemies = [
        { col: 17, row: 2 },
        { col: 18, row: 4 },
        { col: 17, row: 6 },
      ];
      const enemyKeys = new Set(enemies.map((s) => `${s.col},${s.row}`));
      for (const r of [0, 0.3, 0.7, 0.999]) {
        const spawn = pickCaravanSpawnTile(
          mapLayout,
          cols,
          rows,
          terrainData,
          army,
          enemies,
          () => r,
        );
        const unit = createCaravanUnit('act3', spawn);
        let turns = 0;
        while (!isCaravanAtEdge(unit, cols, rows) && turns < 40) {
          const step = computeCaravanStep(unit, mapLayout, cols, rows, terrainData, enemyKeys);
          expect(step).toBeTruthy();
          expect(enemyKeys.has(`${step.col},${step.row}`)).toBe(false);
          Object.assign(unit, step);
          turns++;
        }
        expect(isCaravanAtEdge(unit, cols, rows)).toBe(true);
        expect(turns).toBeGreaterThanOrEqual(4);
      }
    });
  });
});
