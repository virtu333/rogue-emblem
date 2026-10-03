// A player unit's reach preview (unit inspection, the formation screen) must draw the
// tiles targeting would let it strike, no more and no fewer (review finding B,
// 2026-10-02): every weapon it can attack with, at its effective range (Foresight),
// from every tile it can stop on. The enemy view (Danger, pinned threat, Threat Sight)
// stays what the AI does: its next strike weapon at raw range.
import { describe, it, expect, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { BattleScene } from '../src/scenes/BattleScene.js';
import { InputController } from '../src/ui/InputController.js';
import { Grid } from '../src/engine/Grid.js';
import { attackFringe, planAttackTargets } from '../src/engine/AttackOptions.js';
import { computeDangerTiles, playerUnitReach, unitReach } from '../src/engine/ThreatForecast.js';
import { gridDistance, isInRange, nextStrikeWeapon } from '../src/engine/Combat.js';
import { createEnemyUnit, createLordUnit } from '../src/engine/UnitManager.js';
import { applyCondition } from '../src/engine/StatusConditionSystem.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const T = Object.fromEntries(data.terrain.map((t, i) => [t.name, i]));
const SIZE = 15;
const weapon = (name, extra = {}) => ({
  ...structuredClone(data.weapons.find((w) => w.name === name)),
  ...extra,
});

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mockScene() {
  const stub = new Proxy({}, { get: (t, p) => (p === 'destroy' ? () => {} : () => stub) });
  return {
    cameras: { main: { width: 640, height: 480 } },
    add: { rectangle: () => stub, image: () => stub, text: () => stub, container: () => stub },
    textures: { exists: () => false },
  };
}

/** Seed 0: open plain. Otherwise a few forests, mountains and walls. */
function board(seed) {
  const rng = mulberry32(seed);
  const terrain = [T.Forest, T.Mountain, T.Wall, T.Sand];
  const layout = Array.from({ length: SIZE }, () =>
    Array.from({ length: SIZE }, () =>
      seed && rng() < 0.2 ? terrain[Math.floor(rng() * terrain.length)] : T.Plain,
    ),
  );
  layout[7][7] = T.Plain;
  return new Grid(mockScene(), SIZE, SIZE, data.terrain, layout, false);
}

/** Seed 0: nobody else. Otherwise some allies (pass through, no stop) and foes (block). */
function bystanders(seed) {
  const positions = new Map();
  if (!seed) return positions;
  const rng = mulberry32(seed * 7919);
  for (let i = 0; i < 8; i++) {
    const col = Math.floor(rng() * SIZE);
    const row = Math.floor(rng() * SIZE);
    if (col === 7 && row === 7) continue;
    positions.set(`${col},${row}`, { faction: rng() < 0.5 ? 'player' : 'enemy' });
  }
  return positions;
}

function kira() {
  const lord = data.lords.find((l) => l.name === 'Kira');
  const unit = createLordUnit(
    lord,
    data.classes.find((c) => c.name === lord.class),
    data.weapons,
  );
  return Object.assign(unit, { col: 7, row: 7 });
}

function soldier(inventory, proficiencies, equipped = inventory[0]) {
  return {
    name: 'Soldier',
    faction: 'player',
    col: 7,
    row: 7,
    mov: 4,
    moveType: 'Infantry',
    skills: [],
    stats: { HP: 20, STR: 6, MAG: 6, SKL: 6, SPD: 6, DEF: 4, RES: 4, LCK: 4, MOV: 4 },
    currentHP: 20,
    proficiencies: proficiencies.map((type) => ({ type, rank: 'Prof' })),
    inventory,
    weapon: equipped,
  };
}

const CASES = {
  'Kira (Foresight, Fire 1–2)': () => {
    const unit = kira();
    expect(unit.skills).toContain('foresight');
    expect(unit.weapon.type).toBe('Tome');
    return unit;
  },
  'a silenced unit with Fire equipped and an Iron Sword': () => {
    const unit = soldier([weapon('Fire'), weapon('Iron Sword')], ['Tome', 'Sword']);
    applyCondition(unit, 'silence', 3);
    return unit;
  },
  'a unit carrying an unequipped Iron Bow': () =>
    soldier([weapon('Iron Sword'), weapon('Iron Bow')], ['Sword', 'Bow']),
  'a unit with a spent Breachbolt and a carried Iron Bow': () => {
    const unit = soldier([weapon('Breachbolt'), weapon('Iron Bow')], ['Tome', 'Bow']);
    unit.weapon._usesSpent = 99;
    return unit;
  },
};

const keys = (tiles) => tiles.map((t) => `${t.col},${t.row}`).sort();

/**
 * What targeting allows: from each tile the unit can stop on, each board tile where an
 * enemy would be a legal target (AttackOptions.planAttackTargets, as BattleScene's
 * findAttackTargets), less the tiles it can move to.
 */
function legalStrikeTiles(grid, unit, moveRange) {
  const legal = new Set();
  for (const [key, entry] of moveRange) {
    if (entry?.stoppable === false) continue;
    const [col, row] = key.split(',').map(Number);
    const atStop = { ...unit, col, row };
    for (let tc = 0; tc < grid.cols; tc++) {
      for (let tr = 0; tr < grid.rows; tr++) {
        if (tc === col && tr === row) continue;
        const probe = { name: 'Probe', faction: 'enemy', col: tc, row: tr, currentHP: 10 };
        const plan = planAttackTargets(atStop, [probe], {
          distanceTo: (t) => gridDistance(col, row, t.col, t.row),
          skillsData: data.skills,
        });
        if (plan.length) legal.add(`${tc},${tr}`);
      }
    }
  }
  for (const key of moveRange.keys()) legal.delete(key);
  return [...legal].sort();
}

describe('player reach previews draw exactly what targeting allows', () => {
  for (const [name, make] of Object.entries(CASES)) {
    it(`${name}: fringe = legal targets from every stop, less the move tiles`, () => {
      for (const seed of [0, 1, 2, 3, 4, 5]) {
        const grid = board(seed);
        const unit = make();
        const positions = bystanders(seed);
        const mov = unit.mov ?? unit.stats.MOV;
        const reach = playerUnitReach(grid, unit, { mov, positions, skillsData: data.skills });
        const want = legalStrikeTiles(grid, unit, reach.moveRange);
        expect(want.length).toBeGreaterThan(0);
        expect({ seed, tiles: keys(reach.attackTiles) }).toEqual({ seed, tiles: want });
      }
    });
  }

  it('the open-board cases the old preview got wrong (how far off it was)', () => {
    // The pre-fix preview (unitReach: equipped weapon, raw range) against the legal set.
    const grid = board(0);
    const off = {};
    for (const [name, make] of Object.entries(CASES)) {
      const unit = make();
      const mov = unit.mov ?? unit.stats.MOV;
      const before = keys(unitReach(grid, unit, { mov, positions: new Map() }).attackTiles);
      const after = keys(
        playerUnitReach(grid, unit, { mov, positions: new Map(), skillsData: data.skills })
          .attackTiles,
      );
      const want = legalStrikeTiles(
        grid,
        unit,
        grid.getMovementRange(7, 7, mov, unit.moveType, new Map(), 'player'),
      );
      expect(after).toEqual(want);
      const missing = want.filter((k) => !before.includes(k)).length;
      const extra = before.filter((k) => !want.includes(k)).length;
      off[name] = { missing, extra };
    }
    // Kira at MOV 4 from the centre: the distance-7 ring is 28 tiles.
    expect(off['Kira (Foresight, Fire 1–2)']).toEqual({ missing: 28, extra: 0 });
    // Silenced: Fire's distance-6 ring (24) is drawn but only the sword strikes.
    expect(off['a silenced unit with Fire equipped and an Iron Sword']).toEqual({
      missing: 0,
      extra: 24,
    });
    // Sword equipped, bow carried: the bow's distance-6 ring (24) went undrawn.
    expect(off['a unit carrying an unequipped Iron Bow']).toEqual({ missing: 24, extra: 0 });
  });

  it('a unit with nothing it can attack with has no fringe', () => {
    const grid = board(0);
    const unit = soldier([weapon('Fire')], ['Tome']);
    applyCondition(unit, 'silence', 3);
    const reach = playerUnitReach(grid, unit, { mov: 4, skillsData: data.skills });
    expect(reach.moveRange.size).toBeGreaterThan(1);
    expect(reach.attackTiles).toEqual([]);
    expect(attackFringe(grid, soldier([weapon('Heal')], ['Staff']), reach.moveRange)).toEqual([]);
  });
});

describe('enemy reach stays the AI’s: next strike weapon, raw range', () => {
  const enemyPool = () => {
    const cls = (name) => data.classes.find((c) => c.name === name);
    const make = (className, weaponName, col, row, extra = {}) => {
      const unit = createEnemyUnit(cls(className), 5, data.weapons, 1.0, null, 'act2');
      unit.weapon = weapon(weaponName);
      unit.inventory = [unit.weapon];
      return Object.assign(unit, { col, row }, extra);
    };
    return [
      make('Fighter', 'Hand Axe', 2, 2),
      make('Archer', 'Longbow', 12, 3),
      make('Mage', 'Fire', 3, 11),
      // A range skill on an enemy changes neither the AI's reach nor Danger (both raw).
      make('Mage', 'Fire', 11, 11, { skills: ['foresight'] }),
      make('Cavalier', 'Iron Lance', 7, 1),
    ];
  };

  it('Danger for each enemy = tiles the AI could strike with isInRange from a stop', () => {
    for (const seed of [0, 1, 2, 3]) {
      const grid = board(seed);
      const enemies = enemyPool();
      const ctx = {
        grid,
        enemyUnits: enemies,
        ballistas: [],
        positions: () =>
          new Map(
            [...enemies, { col: 7, row: 7, faction: 'player' }].map((u) => [
              `${u.col},${u.row}`,
              { faction: u.faction || 'enemy' },
            ]),
          ),
      };
      for (const enemy of enemies) {
        const danger = computeDangerTiles(ctx, { onlyEnemy: enemy })
          .filter((t) => t.damageThreat)
          .map((t) => `${t.col},${t.row}`)
          .sort();
        // As AIController._decideAction: the others block, then isInRange from each stop.
        const others = new Map(ctx.positions());
        others.delete(`${enemy.col},${enemy.row}`);
        const moves = grid.getMovementRange(
          enemy.col,
          enemy.row,
          enemy.mov,
          enemy.moveType,
          others,
          enemy.faction,
          0,
        );
        const strike = nextStrikeWeapon(enemy);
        const ai = new Set();
        for (const [key, entry] of moves) {
          if (entry?.stoppable === false) continue;
          const [sc, sr] = key.split(',').map(Number);
          for (let c = 0; c < SIZE; c++)
            for (let r = 0; r < SIZE; r++)
              if (isInRange(strike, gridDistance(sc, sr, c, r))) ai.add(`${c},${r}`);
        }
        expect({ seed, enemy: enemy.className, danger }).toEqual({
          seed,
          enemy: enemy.className,
          danger: [...ai].sort(),
        });
      }
    }
  });
});

describe('the previews that draw it', () => {
  // Kira at (7,7) on the open board, Fire 1–2 with Foresight: from her farthest stops
  // (MOV 4) the fringe reaches distance 7, e.g. (0,7) and (7,14).
  const FAR = ['0,7', '14,7', '7,0', '7,14'];

  it('unit inspection of a player unit draws targeting’s fringe', () => {
    const unit = kira();
    const scene = new BattleScene();
    Object.assign(scene, {
      _battleSession: 1,
      grid: board(0),
      enemyUnits: [],
      playerUnits: [unit],
      npcUnits: [],
      ballistas: [],
      gameData: data,
      battleState: 'PLAYER_IDLE',
      selectedUnit: null,
      inspectionPanel: { show() {}, hide() {}, visible: false, objects: [] },
      refreshEndTurnControl() {},
    });
    let attack = [];
    scene.grid.pixelToGrid = () => ({ col: unit.col, row: unit.row });
    scene.grid.showMovementRange = () => {};
    scene.grid.showAttackRange = (tiles) => {
      attack = keys(tiles);
    };
    expect(new InputController(scene)._showInspectionAtPixel(0, 0)).toBe(true);
    const mov = unit.mov ?? unit.stats.MOV;
    const moves = scene.grid.getMovementRange(7, 7, mov, unit.moveType, new Map(), 'player');
    expect(attack).toEqual(legalStrikeTiles(scene.grid, unit, moves));
    for (const tile of FAR) expect(attack).toContain(tile);
  });
});
