// Siege casters and status-staff casters hold their post (docs/specs/dusk-pressure.md
// §2c, engine/SiegeArtillery.js). An enemy Breachbolt caster with shots left, or one with
// a Sleep / Silence Staff use left, never walks: it acts from where it stands (artillery
// fires at the best target 3-10 away; a staff caster casts or strikes) or waits. The Danger
// overlay, Threat Sight and the inspected reach draw the reach it will actually use.
//
// Ways this can break, one test each (or more):
// * the caster still walks (to cover, closer) when it could act from where it stands;
// * it walks toward a target out of range instead of waiting, or stays after its shots or
//   staff uses are spent instead of its orders;
// * an ally killing its only target changes what it does mid-phase;
// * a resumed phase re-reads a board enemies have already changed;
// * guard orders (walk back to the post) beat the stance;
// * Danger / Threat Sight / the inspected reach draw a walk for a caster that stays; its
//   cache misses a spent shot;
// * the harness and the scene disagree (both run AIController.processEnemyPhase);
// * the stance draws on Math.random.
import { describe, it, expect, vi, afterEach } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { Grid } from '../src/engine/Grid.js';
import { AIController } from '../src/engine/AIController.js';
import {
  computeDangerTiles,
  threatsOnTile,
  threatWorldSignature,
} from '../src/engine/ThreatForecast.js';
import {
  artilleryWeapon,
  isArtilleryPlanted,
  settleArtilleryStances,
} from '../src/engine/SiegeArtillery.js';
import { serializeBattleUnit } from '../src/engine/BattleUnitState.js';
import { createPlayerKnowledge } from '../src/engine/PlayerKnowledge.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { HeadlessBattle, HEADLESS_STATES } from './harness/HeadlessBattle.js';
import { loadFixture } from './fixtures/battles/index.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const T = Object.fromEntries(data.terrain.map((t, i) => [t.name, i]));
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));
// Stated independently of the code under test: Breachbolt is "3-10", an enemy's has 5
// shots, the Sage below moves 5 and its fallback Fire reaches 1-2.
const SIEGE_MIN = 3;
const SIEGE_MAX = 10;
const ENEMY_SHOTS = 5;
const MOV = 5;
const manhattan = (a, b) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
const key = (col, row) => `${col},${row}`;

function makeGrid(cols, rows, terrain = {}) {
  const layout = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => T[terrain[key(col, row)] || 'Plain']),
  );
  const stub = new Proxy({}, { get: (t, p) => (p === 'destroy' ? () => {} : () => stub) });
  const scene = {
    cameras: { main: { width: 640, height: 480 } },
    add: { rectangle: () => stub, image: () => stub, text: () => stub, container: () => stub },
    textures: { exists: () => false },
  };
  return new Grid(scene, cols, rows, data.terrain, layout, false);
}

function sage(col, row, extra = {}) {
  const bolt = weapon('Breachbolt');
  const fire = weapon('Fire');
  return {
    name: 'Sage',
    faction: 'enemy',
    className: 'Sage',
    level: 10,
    col,
    row,
    stats: { HP: 40, STR: 2, MAG: 20, SKL: 12, SPD: 8, DEF: 6, RES: 10, LCK: 5, MOV },
    currentHP: 40,
    mov: MOV,
    moveType: 'Infantry',
    proficiencies: [{ type: 'Tome', rank: 'Mast' }],
    skills: [],
    weapon: bolt,
    inventory: [bolt, fire],
    ...extra,
  };
}

/** A Mage with a Sleep Staff: it casts from its post and never walks. */
function mage(col, row, extra = {}) {
  const fire = weapon('Fire');
  const staff = weapon('Sleep Staff');
  staff.statusEffect = 'sleep';
  return {
    ...sage(col, row),
    name: 'Mage',
    className: 'Mage',
    weapon: fire,
    inventory: [fire],
    statusStaff: staff,
    ...extra,
  };
}

/** A player unit; `fragile` dies to one bolt, otherwise nothing the Sage casts hurts it. */
function foe(name, col, row, { fragile = false } = {}) {
  const lance = weapon('Iron Lance');
  const hp = fragile ? 1 : 99;
  return {
    name,
    faction: 'player',
    className: 'Soldier',
    level: 5,
    col,
    row,
    stats: { HP: hp, STR: 6, MAG: 0, SKL: 5, SPD: 0, DEF: 0, RES: fragile ? 0 : 99, LCK: 0 },
    currentHP: hp,
    mov: 4,
    moveType: 'Infantry',
    proficiencies: [{ type: 'Lance', rank: 'Prof' }],
    skills: [],
    weapon: lance,
    inventory: [lance],
  };
}

function controller(grid, options = {}) {
  const ai = new AIController(grid, data, { objective: 'rout', ...options });
  ai._delay = () => Promise.resolve();
  return ai;
}

/**
 * One enemy phase with scene-like callbacks: moves land on the path's end; attacks are
 * recorded (and `onStrike` may resolve them); a killed unit leaves its army.
 */
async function enemyPhase(ai, { enemies, players, npcs = [], turn = 1, onStrike = null }) {
  const attacks = [];
  const decisions = new Map();
  await ai.processEnemyPhase(enemies, players, npcs, {
    turnNumber: turn,
    onDecision: (enemy, decision) => decisions.set(enemy, decision),
    onMoveUnit: (enemy, path) => {
      const end = path[path.length - 1];
      enemy.col = end.col;
      enemy.row = end.row;
      return Promise.resolve();
    },
    onAttack: (enemy, target) => {
      attacks.push({ by: enemy.name, target: target.name, weapon: enemy.weapon.name });
      onStrike?.(enemy, target);
      if (target.currentHP <= 0) {
        for (const army of [players, npcs]) {
          const i = army.indexOf(target);
          if (i >= 0) army.splice(i, 1);
        }
      }
      return Promise.resolve();
    },
    onUnitDone: (enemy) => {
      enemy.hasActed = true;
      return Promise.resolve();
    },
  });
  return { attacks, decisions };
}

/** ThreatForecast's view of a fogless board: every living unit is known. */
function threatCtx(grid, enemies, others) {
  return {
    grid,
    enemyUnits: enemies,
    ballistas: [],
    positions: () => {
      const map = new Map();
      for (const u of [...enemies, ...others])
        if (u.currentHP > 0) map.set(key(u.col, u.row), { faction: u.faction });
      return map;
    },
    costModifier: () => 0,
  };
}

const damageKeys = (tiles) =>
  new Set(tiles.filter((t) => t.damageThreat).map((t) => key(t.col, t.row)));
const farthest = (tiles, from) =>
  Math.max(...tiles.filter((t) => t.damageThreat).map((t) => manhattan(t, from)));
const nearest = (tiles, from) =>
  Math.min(...tiles.filter((t) => t.damageThreat).map((t) => manhattan(t, from)));

afterEach(() => {
  vi.restoreAllMocks();
  restoreMathRandom();
});

describe('a siege caster with shots left and a target in range', () => {
  it('fires from its post, even with a fort beside it, and draws no Math.random', async () => {
    // Today the caster steps onto the Fort first (cover scores higher) and fires from it.
    const grid = makeGrid(25, 25, { [key(11, 12)]: 'Fort', [key(13, 12)]: 'Forest' });
    const caster = sage(12, 12);
    const target = foe('Target', 12, 5); // 7 away: inside 3-10, also from the Fort
    const random = vi.spyOn(Math, 'random');
    const { attacks, decisions } = await enemyPhase(controller(grid), {
      enemies: [caster],
      players: [target],
    });
    expect({ col: caster.col, row: caster.row }).toEqual({ col: 12, row: 12 });
    expect(attacks).toEqual([{ by: 'Sage', target: 'Target', weapon: 'Breachbolt' }]);
    expect(decisions.get(caster).reason).toBe('artillery_fire');
    expect(random).not.toHaveBeenCalled();
  });

  it('a guard caster off its post fires instead of walking back to it', async () => {
    const grid = makeGrid(25, 25);
    const caster = sage(12, 12, { aiMode: 'guard', guardPost: { col: 12, row: 17 } });
    const target = foe('Target', 12, 6); // 6 from the caster, 11 from the guard post
    const { attacks } = await enemyPhase(controller(grid), {
      enemies: [caster],
      players: [target],
    });
    expect({ col: caster.col, row: caster.row }).toEqual({ col: 12, row: 12 });
    expect(attacks.map((a) => a.target)).toEqual(['Target']);
  });

  it('picks the best target in range and never one outside it', async () => {
    const grid = makeGrid(25, 25);
    const caster = sage(12, 12);
    const sturdy = foe('Sturdy', 12, 7); // in range, nothing the bolt can hurt
    const frail = foe('Frail', 12, 2, { fragile: true }); // in range at 10: a kill
    const beyond = foe('Beyond', 12, 0, { fragile: true }); // 12 away: out of the ring
    const { attacks } = await enemyPhase(controller(grid), {
      enemies: [caster],
      players: [sturdy, beyond, frail],
    });
    expect(attacks.map((a) => a.target)).toEqual(['Frail']);
    expect({ col: caster.col, row: caster.row }).toEqual({ col: 12, row: 12 });
  });
});

describe('falling back to its orders', () => {
  it('with no player unit in siege range it waits at its post: it never walks', async () => {
    const grid = makeGrid(25, 25);
    const caster = sage(12, 22);
    const target = foe('Target', 12, 8); // 14 away: out of 3-10, inside MOV 5 + 10
    const { attacks, decisions } = await enemyPhase(controller(grid), {
      enemies: [caster],
      players: [target],
    });
    expect(caster.artilleryStance).toEqual({ turn: 1, planted: true });
    expect({ col: caster.col, row: caster.row }).toEqual({ col: 12, row: 22 });
    expect(decisions.get(caster).reason).toBe('artillery_hold');
    expect(attacks).toEqual([]);
  });

  it('with its shots spent it is no longer artillery: it closes in with its own tome', async () => {
    const grid = makeGrid(25, 25);
    const caster = sage(12, 12);
    caster.weapon._usesSpent = ENEMY_SHOTS;
    const target = foe('Target', 12, 6); // 6 away: Fire (1-2) needs to walk in
    const { attacks } = await enemyPhase(controller(grid), {
      enemies: [caster],
      players: [target],
    });
    expect(artilleryWeapon(caster)).toBeNull();
    expect(caster.artilleryStance).toBeUndefined();
    expect(manhattan(caster, target)).toBeLessThanOrEqual(2);
    expect(attacks).toEqual([{ by: 'Sage', target: 'Target', weapon: 'Fire' }]);
  });

  it('a caster that also carries a status staff (an old per-spawn roll) only fires', async () => {
    const grid = makeGrid(25, 25);
    const caster = sage(12, 12, { statusStaff: weapon('Silence Staff') });
    const target = foe('Target', 12, 7); // 5 away: in Silence (3-7) and siege range
    target.proficiencies = [{ type: 'Tome', rank: 'Prof' }]; // the staff's favourite
    const ctx = threatCtx(grid, [caster], [target]);
    expect(computeDangerTiles(ctx).filter((t) => t.statusThreat)).toEqual([]);
    // A staff turn would have struck nobody (the status branch never attacks).
    const { attacks } = await enemyPhase(controller(grid), {
      enemies: [caster],
      players: [target],
    });
    expect(attacks).toEqual([{ by: 'Sage', target: 'Target', weapon: 'Breachbolt' }]);
  });

  it('a holder or a village bandit keeps its own orders', () => {
    expect(artilleryWeapon(sage(0, 0, { aiMode: 'hold' }))).toBeNull();
    expect(artilleryWeapon(sage(0, 0, { aiMode: 'seek_tile' }))).toBeNull();
    expect(artilleryWeapon(sage(0, 0, { faction: 'player' }))).toBeNull();
    expect(artilleryWeapon(sage(0, 0)).name).toBe('Breachbolt');
  });
});

describe('the stance is taken once, at the top of the phase', () => {
  it('an ally that kills its only target first does not send it walking', async () => {
    const grid = makeGrid(25, 25);
    const caster = sage(12, 12);
    const inRing = foe('InRing', 12, 6, { fragile: true }); // 6 away
    const outside = foe('Outside', 12, 25 - 1, { fragile: true }); // 12 away, within 15
    const killer = {
      ...sage(11, 6),
      name: 'Killer',
      weapon: weapon('Iron Sword'),
      inventory: [],
    };
    killer.inventory = [killer.weapon];
    killer.proficiencies = [{ type: 'Sword', rank: 'Prof' }];
    const players = [inRing, outside];
    const { attacks, decisions } = await enemyPhase(controller(grid), {
      enemies: [killer, caster],
      players,
      // The Killer's blow lands (the scene resolves combat; this test pins the AI).
      onStrike: (enemy, target) => {
        if (enemy === killer) target.currentHP = 0;
      },
    });
    expect(attacks.map((a) => `${a.by}>${a.target}`)).toEqual(['Killer>InRing']);
    expect(decisions.get(caster).reason).toBe('artillery_hold');
    expect({ col: caster.col, row: caster.row }).toEqual({ col: 12, row: 12 });
    expect(outside.currentHP).toBe(1);
  });

  it('a phase-start blow that empties the ring does not send it walking (scene)', async () => {
    // The caster at 12,12; A 6 away (in range), B 12 away. Danger shows B's tile safe.
    // An enemy ballista fells A as the enemy phase begins, before the AI runs.
    const grid = makeGrid(25, 25);
    grid.tickTemporaryTerrains = () => {};
    const caster = sage(12, 12);
    const a = foe('A', 12, 6, { fragile: true });
    const b = foe('B', 12, 24, { fragile: true });
    expect(damageKeys(computeDangerTiles(threatCtx(grid, [caster], [a, b]))).has(key(12, 24))).toBe(
      false,
    );
    const scene = new BattleScene();
    Object.assign(scene, {
      scene: { isActive: () => true },
      showPhaseBanner: vi.fn(),
      dangerZone: { hide: vi.fn() },
      updateAntiTurtlePressure: vi.fn(),
      grid,
      enemyUnits: [caster],
      playerUnits: [a, b],
      npcUnits: [],
      refreshEndTurnControl: vi.fn(),
      processTerrainDamage: vi.fn(async () => {}),
      processTurnStartEffects: vi.fn(async () => {}),
      processZombieRevival: vi.fn(async () => {}),
      processBallistaFire: vi.fn(async () => {
        a.currentHP = 0;
        scene.playerUnits.splice(scene.playerUnits.indexOf(a), 1);
      }),
      applyDueHybridOverridesForTurn: vi.fn(),
      turnManager: { currentPhase: 'enemy', turnNumber: 4 },
    });
    let phase = null;
    scene.startEnemyPhase = vi.fn(async () => {
      phase = await enemyPhase(controller(grid), {
        enemies: scene.enemyUnits,
        players: scene.playerUnits,
        turn: 4,
      });
    });
    let pipeline = null;
    scene.time = { delayedCall: vi.fn((_ms, cb) => (pipeline = cb)) };
    BattleScene.prototype.onPhaseChange.call(scene, 'enemy', 4);
    await pipeline();
    expect(scene.processBallistaFire).toHaveBeenCalled();
    expect(phase.attacks).toEqual([]);
    expect({ col: caster.col, row: caster.row }).toEqual({ col: 12, row: 12 });
    expect(b.currentHP).toBe(1);
  });

  it('a siege caster or a staff caster with something left holds its post; nothing left, none', () => {
    const stance = (caster) => {
      settleArtilleryStances({ enemyUnits: [caster], turn: 1 });
      return caster.artilleryStance?.planted ?? null;
    };
    expect(stance(sage(12, 12))).toBe(true);
    expect(stance(mage(12, 12))).toBe(true);
    const spentBolt = sage(12, 12);
    spentBolt.weapon._usesSpent = ENEMY_SHOTS;
    expect(stance(spentBolt)).toBeNull();
    const spentStaff = mage(12, 12);
    spentStaff.statusStaff._usesSpent = spentStaff.statusStaff.uses;
    expect(stance(spentStaff)).toBeNull();
    expect(stance(mage(12, 12, { aiMode: 'hold' }))).toBeNull(); // its own orders
    expect(stance(mage(12, 12, { aiMode: 'seek_tile' }))).toBeNull();
    expect(stance(mage(12, 12, { faction: 'player' }))).toBeNull();
    expect(stance(mage(12, 12, { currentHP: 0 }))).toBeNull(); // fallen
  });

  it('a save from the old rule (planted: false, same turn) is migrated to planted on resume', async () => {
    const grid = makeGrid(25, 25);
    for (const make of [() => sage(12, 22), () => mage(12, 22)]) {
      const caster = make();
      // Fixture: what the old code serialised mid enemy phase for a caster that would walk.
      const saved = JSON.parse(JSON.stringify(serializeBattleUnit(caster)));
      saved.artilleryStance = { turn: 3, planted: false };
      Object.assign(caster, { artilleryStance: saved.artilleryStance });
      const target = foe('Target', 12, 8); // out of every reach from the post
      const { decisions } = await enemyPhase(controller(grid), {
        enemies: [caster],
        players: [target],
        turn: 3,
      });
      expect(caster.artilleryStance).toEqual({ turn: 3, planted: true });
      expect({ col: caster.col, row: caster.row }).toEqual({ col: 12, row: 22 });
      expect(['artillery_hold', 'post_hold']).toContain(decisions.get(caster).reason);
    }
  });

  it('a phase resumed from a checkpoint keeps the stance; the next turn takes it again', async () => {
    const grid = makeGrid(25, 25);
    const caster = sage(12, 12);
    const target = foe('Target', 12, 6);
    settleArtilleryStances({ enemyUnits: [caster], turn: 3 });
    expect(isArtilleryPlanted(caster)).toBe(true);
    // Saved with the unit (suspend checkpoint, Vision snapshot).
    const restored = JSON.parse(JSON.stringify(serializeBattleUnit(caster)));
    expect(restored.artilleryStance).toEqual({ turn: 3, planted: true });

    // By the resume an ally had moved the target out of range: it still waits at its post.
    target.row = 0; // 12 away
    let phase = await enemyPhase(controller(grid), {
      enemies: [caster],
      players: [target],
      turn: 3,
    });
    expect(phase.decisions.get(caster).reason).toBe('artillery_hold');
    expect({ col: caster.col, row: caster.row }).toEqual({ col: 12, row: 12 });

    caster.hasActed = false;
    phase = await enemyPhase(controller(grid), { enemies: [caster], players: [target], turn: 4 });
    expect(caster.artilleryStance).toEqual({ turn: 4, planted: true });
    expect(phase.attacks).toEqual([]);
    expect({ col: caster.col, row: caster.row }).toEqual({ col: 12, row: 12 });
  });
});

describe('what the player sees is the reach it uses', () => {
  it('Danger draws the ring from its post, wherever the player stands', () => {
    const grid = makeGrid(41, 41);
    const caster = sage(20, 20);
    const post = { col: 20, row: 20 };
    const unit = foe('Unit', 20, 14); // 6 away
    const ctx = threatCtx(grid, [caster], [unit]);
    let tiles = computeDangerTiles(ctx);
    expect(nearest(tiles, post)).toBe(SIEGE_MIN);
    expect(farthest(tiles, post)).toBe(SIEGE_MAX);
    // Every tile of the ring, nothing else.
    let ring = 0;
    for (let row = 0; row < 41; row++)
      for (let col = 0; col < 41; col++) {
        const d = manhattan({ col, row }, post);
        if (d >= SIEGE_MIN && d <= SIEGE_MAX) ring++;
      }
    expect(damageKeys(tiles).size).toBe(ring);

    unit.row = 5; // 15 away: out of range, the caster still stays
    tiles = computeDangerTiles(ctx);
    expect(farthest(tiles, post)).toBe(SIEGE_MAX);

    // Its shots are spent: it moves with Fire
    caster.weapon._usesSpent = ENEMY_SHOTS;
    tiles = computeDangerTiles(ctx);
    expect(farthest(tiles, post)).toBe(MOV + 2);
  });

  it('Danger: the ring is the same with an NPC, a fallen unit or nobody near', () => {
    const grid = makeGrid(41, 41);
    const caster = sage(20, 20);
    const post = { col: 20, row: 20 };
    // Positions as the scene builds them: PlayerKnowledge over every unit on the board.
    const reachWith = (others) => {
      const knowledge = createPlayerKnowledge({ grid, units: [caster, ...others] });
      const ctx = { ...threatCtx(grid, [caster], []), positions: () => knowledge.positions() };
      return farthest(computeDangerTiles(ctx), post);
    };
    expect(reachWith([foe('Close', 20, 18)])).toBe(SIEGE_MAX);
    expect(reachWith([{ ...foe('Villager', 20, 14), faction: 'npc' }])).toBe(SIEGE_MAX);
    expect(reachWith([{ ...foe('Fallen', 20, 14), currentHP: 0 }])).toBe(SIEGE_MAX);
    expect(reachWith([foe('Standing', 20, 14)])).toBe(SIEGE_MAX);
    expect(reachWith([])).toBe(SIEGE_MAX);
  });

  it('every tile Danger marks is one it strikes, and no other (it never moves)', async () => {
    // A sturdy anchor nothing hurts, in range or not, and a frail probe on every tile:
    // the AI kills the probe whenever it can reach it, so "struck" = "reachable".
    const size = 17;
    const post = { col: 8, row: 8 };
    for (const anchorAt of [
      { col: 8, row: 3 }, // in range
      { col: 8, row: 16 }, // 8 away, on the other side
      { col: 0, row: 0 }, // 16 away: out of range, it still stays
    ]) {
      let struck = 0;
      let mismatches = [];
      for (let row = 0; row < size; row++)
        for (let col = 0; col < size; col++) {
          if (
            (col === post.col && row === post.row) ||
            (col === anchorAt.col && row === anchorAt.row)
          )
            continue;
          const grid = makeGrid(size, size);
          const caster = sage(post.col, post.row);
          const anchor = foe('Anchor', anchorAt.col, anchorAt.row);
          const probe = foe('Probe', col, row, { fragile: true });
          const danger = damageKeys(computeDangerTiles(threatCtx(grid, [caster], [anchor, probe])));
          const { attacks } = await enemyPhase(controller(grid), {
            enemies: [caster],
            players: [anchor, probe],
          });
          const hit = attacks.some((a) => a.target === 'Probe');
          if (hit) struck++;
          if (hit !== danger.has(key(col, row))) mismatches.push({ col, row, hit });
        }
      expect(mismatches, JSON.stringify(anchorAt)).toEqual([]);
      expect(struck).toBeGreaterThan(0);
      // It never strikes inside 3 of its post.
      expect(struck).toBeLessThan(size * size - 2);
    }
  });

  it('Threat Sight: only the ring around the post threatens, whoever stays or moves', () => {
    const grid = makeGrid(25, 25);
    const caster = sage(12, 12);
    const mover = foe('Mover', 12, 6);
    const ctx = threatCtx(grid, [caster], [mover]);
    expect(threatsOnTile(ctx, 12, 0, { mover }).damage).toEqual([]); // 12 away: safe
    expect(threatsOnTile(ctx, 12, 6, { mover }).damage).toEqual([caster]); // 6 away
    expect(threatsOnTile(ctx, 12, 10, { mover }).damage).toEqual([]); // 2 away: inside the minimum
  });

  it("Threat Sight's cache sees a spent shot", () => {
    const grid = makeGrid(25, 25);
    const caster = sage(12, 12);
    const unit = foe('Unit', 12, 6);
    const ctx = threatCtx(grid, [caster], [unit]);
    const before = threatWorldSignature(ctx, [caster, unit]);
    caster.weapon._usesSpent = 1;
    expect(threatWorldSignature(ctx, [caster, unit])).not.toBe(before);
  });

  it('the inspected reach of a post-holding caster has no movement', () => {
    const caster = sage(2, 3);
    const getMovementRange = vi.fn(() => new Map([['2,3', { cost: 0 }]]));
    const scene = {
      battleState: 'PLAYER_IDLE',
      grid: {
        pixelToGrid: () => ({ col: 2, row: 3 }),
        getTerrainAt: () => ({ name: 'Plain' }),
        getMovementRange,
        getAttackRange: () => [],
        showMovementRange: vi.fn(),
        showAttackRange: vi.fn(),
        clearHighlights: vi.fn(),
        clearAttackHighlights: vi.fn(),
      },
      inspectionPanel: { show: vi.fn() },
      getUnitAt: (c, r) => (c === caster.col && r === caster.row ? caster : null),
      buildUnitPositionMap: vi.fn(),
      refreshEndTurnControl: vi.fn(),
      _showInspectionAtPixel: BattleScene.prototype._showInspectionAtPixel,
      _getCostModifier: () => 0,
    };
    const movFor = (positions) => {
      scene.buildUnitPositionMap.mockReturnValue(positions);
      getMovementRange.mockClear();
      scene._showInspectionAtPixel(100, 100);
      return getMovementRange.mock.calls[0][2];
    };
    // A player unit 6 away, or nobody in range: it does not move either way.
    expect(movFor(new Map([['2,9', { faction: 'player' }]]))).toBe(0);
    expect(movFor(new Map([['2,20', { faction: 'player' }]]))).toBe(0);
  });
});

describe('a status-staff caster with a use left holds its post', () => {
  const run = async (grid, caster, players, turn = 1) => {
    const casts = [];
    const { attacks, decisions } = await (async () => {
      const attacks = [];
      const decisions = new Map();
      const ai = controller(grid);
      await ai.processEnemyPhase([caster], players, [], {
        turnNumber: turn,
        onDecision: (e, d) => decisions.set(e, d),
        onMoveUnit: (e, path) => {
          const end = path[path.length - 1];
          e.col = end.col;
          e.row = end.row;
          return Promise.resolve();
        },
        onAttack: (e, t) => {
          attacks.push(t.name);
          return Promise.resolve();
        },
        onStatusStaff: (e, t) => {
          casts.push(t.name);
          return Promise.resolve();
        },
        onUnitDone: (e) => {
          e.hasActed = true;
          return Promise.resolve();
        },
      });
      return { attacks, decisions };
    })();
    return { attacks, casts, decisions };
  };

  it('casts from its post at a unit in staff range, without stepping', async () => {
    const grid = makeGrid(25, 25);
    const caster = mage(12, 12);
    const target = foe('Target', 12, 8); // 4 away: Sleep Staff reaches 3-5
    const { casts, decisions } = await run(grid, caster, [target]);
    expect(casts).toEqual(['Target']);
    expect(decisions.get(caster).reason).toBe('status_staff');
    expect({ col: caster.col, row: caster.row }).toEqual({ col: 12, row: 12 });
  });

  it('with nobody in reach it waits instead of walking toward the army', async () => {
    const grid = makeGrid(25, 25);
    const caster = mage(12, 12);
    const target = foe('Target', 12, 1); // 11 away: a walk would bring it in
    const { casts, attacks } = await run(grid, caster, [target]);
    expect(casts).toEqual([]);
    expect(attacks).toEqual([]);
    expect({ col: caster.col, row: caster.row }).toEqual({ col: 12, row: 12 });
  });

  it('waiting ends on post_hold: no chase, no no-path streak, no wall to break', async () => {
    const grid = makeGrid(25, 25);
    const caster = mage(12, 12);
    const target = foe('Target', 12, 1);
    const { decisions } = await run(grid, caster, [target]);
    expect(decisions.get(caster).reason).toBe('post_hold');
    expect(caster._aiNoMoveStreak).toBe(0);
  });

  it('strikes with its weapon from the post when a unit stands in weapon reach', async () => {
    const grid = makeGrid(25, 25);
    const caster = mage(12, 12);
    const target = foe('Target', 12, 11); // adjacent: inside Fire (1-2), too close for the staff
    const { casts, attacks } = await run(grid, caster, [target]);
    expect(casts).toEqual([]);
    expect(attacks).toEqual(['Target']);
    expect({ col: caster.col, row: caster.row }).toEqual({ col: 12, row: 12 });
  });

  it('once the staff is spent it is an ordinary caster again and closes in', async () => {
    const grid = makeGrid(25, 25);
    const caster = mage(12, 12);
    caster.statusStaff._usesSpent = caster.statusStaff.uses;
    const target = foe('Target', 12, 7);
    const { casts, attacks } = await run(grid, caster, [target]);
    expect(casts).toEqual([]);
    expect(attacks).toEqual(['Target']);
    expect(manhattan(caster, target)).toBeLessThanOrEqual(2);
  });

  it('Danger draws the staff ring from the post, with no walked reach', () => {
    const grid = makeGrid(41, 41);
    const caster = mage(20, 20);
    const post = { col: 20, row: 20 };
    const tiles = computeDangerTiles(threatCtx(grid, [caster], [foe('Unit', 20, 5)]));
    const status = tiles.filter((t) => t.statusThreat);
    expect(status.length).toBeGreaterThan(0);
    for (const t of status) {
      expect(manhattan(t, post)).toBeGreaterThanOrEqual(3);
      expect(manhattan(t, post)).toBeLessThanOrEqual(5);
    }
    expect(farthest(tiles, post)).toBeLessThanOrEqual(2); // Fire from the post only
  });
});

describe('in a battle (headless harness, as the scene)', () => {
  /** A siege Sage at 0,0; `near` 9 away (in range), `far` 12 away (a walk away). */
  function siegeBattle() {
    installSeed(7);
    const fixture = loadFixture('act1_rout_basic');
    const battle = new HeadlessBattle(data, { ...fixture.battleParams }, fixture.buildRoster(data));
    battle.init();
    restoreMathRandom();
    const rows = battle.battleConfig.mapLayout.length;
    const cols = battle.battleConfig.mapLayout[0].length;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) battle.battleConfig.mapLayout[r][c] = T.Plain;
    battle.grid.mapLayout = battle.battleConfig.mapLayout;
    const [near, far] = battle.playerUnits;
    battle.playerUnits = [near, far];
    for (const u of [near, far]) {
      Object.assign(u.stats, { HP: 999, DEF: 99, RES: 99, SPD: 99, LCK: 99 });
      u.currentHP = 999;
    }
    // `far` would be the easier prey (no RES, nothing to dodge with), but it stands out
    // of range: a caster that walked would turn on it.
    Object.assign(far.stats, { RES: 0, SPD: 0, LCK: 0 });
    battle.enemyUnits = [];
    const caster = battle._addEnemyFromSpawn({
      className: 'Sage',
      level: 10,
      col: 0,
      row: 0,
      siegeWeapon: 'Breachbolt',
    });
    Object.assign(near, { col: 9, row: 0 }); // 9 away
    // 12 away along the far edge (the map is at least 10 wide).
    Object.assign(far, { col: cols - 1, row: Math.min(rows - 1, 12 - (cols - 1)) });
    // Out of siege range, but a MOV 5 walk would bring it in.
    expect(manhattan(far, caster)).toBeGreaterThan(SIEGE_MAX);
    expect(manhattan(far, caster)).toBeLessThanOrEqual(MOV + SIEGE_MAX);
    const struck = [];
    const original = battle._executeEnemyCombat.bind(battle);
    battle._executeEnemyCombat = (enemy, target) => {
      struck.push(target);
      return original(enemy, target);
    };
    battle.turnManager.turnNumber = 2;
    battle.turnManager.currentPhase = 'enemy';
    battle.battleState = HEADLESS_STATES.ENEMY_PHASE;
    return { battle, caster, near, far, struck };
  }

  it('a siege Sage holds its post and fires at the unit in range, not the one it could walk to', async () => {
    const { battle, caster, near, struck } = siegeBattle();
    await battle._processEnemyPhase();
    expect(struck).toEqual([near]);
    expect({ col: caster.col, row: caster.row }).toEqual({ col: 0, row: 0 });
    expect(caster.artilleryStance).toEqual({ turn: 2, planted: true });
  });

  it('the stance is taken before the phase-start hazards, as the scene', async () => {
    const { battle, caster, near, far, struck } = siegeBattle();
    // A phase-start blow fells the only unit in range (in the scene an enemy ballista
    // can; the harness's hazards are not lethal, so this one is staged).
    const hazards = battle._processTerrainDamage.bind(battle);
    battle._processTerrainDamage = (units) => {
      hazards(units);
      near.currentHP = 0;
      battle._removeUnit(near, { killer: null });
    };
    await battle._processEnemyPhase();
    expect(battle.playerUnits).toEqual([far]);
    expect(struck).toEqual([]);
    expect({ col: caster.col, row: caster.row }).toEqual({ col: 0, row: 0 });
  });
});
