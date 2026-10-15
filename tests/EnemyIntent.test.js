import { describe, it, expect, vi } from 'vitest';
import { Grid, computeEffectivePath } from '../src/engine/Grid.js';
import { AIController } from '../src/engine/AIController.js';
import { predictEnemyIntents, staysAsleepNextPhase } from '../src/engine/EnemyIntent.js';
import { threatsOnTile } from '../src/engine/ThreatForecast.js';
import { HOLD_AI_MODE } from '../src/engine/HoldActivation.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const T = Object.fromEntries(gameData.terrain.map((t, i) => [t.name, i]));
const weapon = (name) => structuredClone(gameData.weapons.find((w) => w.name === name));

function stubScene() {
  const stub = {};
  const chain = () => stub;
  for (const k of ['setDepth', 'setDisplaySize', 'setOrigin', 'setAlpha', 'setVisible'])
    stub[k] = chain;
  stub.setPosition = chain;
  stub.destroy = () => {};
  stub.add = () => {};
  return {
    cameras: { main: { width: 640, height: 480 } },
    add: { rectangle: chain, image: chain, text: chain, container: chain },
    textures: { exists: () => false },
  };
}

function makeGrid(layout) {
  return new Grid(stubScene(), layout[0].length, layout.length, gameData.terrain, layout, false);
}

const plainLayout = (cols, rows) => Array.from({ length: rows }, () => Array(cols).fill(T.Plain));

const BASE = { HP: 24, STR: 10, MAG: 0, SKL: 8, SPD: 7, LCK: 4, DEF: 6, RES: 3, MOV: 5 };
let nextId = 1;
function unit(faction, col, row, overrides = {}) {
  const w = weapon(overrides.weaponName || (faction === 'enemy' ? 'Iron Axe' : 'Iron Lance'));
  const stats = { ...BASE, ...(overrides.stats || {}) };
  const u = {
    name: overrides.name || `${faction}${nextId++}`,
    faction,
    col,
    row,
    mov: stats.MOV,
    moveType: 'Infantry',
    className: 'Fighter',
    level: 5,
    currentHP: overrides.currentHP ?? stats.HP,
    weapon: w,
    inventory: [w],
    skills: [],
    ...overrides,
    stats,
  };
  delete u.weaponName;
  return u;
}

function context(grid, world) {
  return {
    grid,
    enemyUnits: world.enemies,
    ballistas: [],
    positions: () => {
      const m = new Map();
      for (const u of [...world.players, ...world.enemies, ...world.npcs]) {
        if (u.currentHP <= 0) continue;
        if (u.faction === 'enemy' && grid.fogEnabled && !grid.isVisible(u.col, u.row)) continue;
        m.set(`${u.col},${u.row}`, { faction: u.faction });
      }
      return m;
    },
    isKnown: () => true,
    costModifier: () => 0,
  };
}

function predict(grid, world, mover, col, row, extra = {}) {
  const ai = new AIController(grid, gameData, { objective: 'rout' });
  return predictEnemyIntents({
    ai,
    ctx: context(grid, world),
    playerUnits: world.players,
    npcUnits: world.npcs,
    mover,
    col,
    row,
    turn: 1,
    ...extra,
  });
}

/** The real enemy phase on a copy of the world with the mover set down: who each foe hit. */
async function playEnemyPhase(grid, world, mover, col, row) {
  const copy = structuredClone({
    enemies: world.enemies,
    players: world.players.map((u) => (u === mover ? { ...u, col, row } : u)),
    npcs: world.npcs,
  });
  const ai = new AIController(grid, gameData, { objective: 'rout' });
  ai.setHoldContext(() => context(grid, copy));
  const hits = new Map();
  const occupied = () =>
    new Set(
      [...copy.enemies, ...copy.players, ...copy.npcs]
        .filter((u) => u.currentHP > 0)
        .map((u) => `${u.col},${u.row}`),
    );
  await ai.processEnemyPhase(copy.enemies, copy.players, copy.npcs, {
    turnNumber: 1,
    afterUnit: async () => {},
    onMoveUnit: async (enemy, path) => {
      const others = occupied();
      others.delete(`${enemy.col},${enemy.row}`);
      const { effectivePath } = computeEffectivePath(
        path,
        grid.mapLayout,
        grid.terrainData,
        grid.cols,
        grid.rows,
        enemy.moveType,
        others,
        0,
      );
      const end = effectivePath[effectivePath.length - 1];
      enemy.col = end.col;
      enemy.row = end.row;
    },
    onAttack: async (enemy, target) =>
      hits.set(enemy.name, { kind: 'attack', target: target.name }),
    onStatusStaff: async (enemy, target) =>
      hits.set(enemy.name, { kind: 'status', target: target.name }),
    onHeal: async (enemy, target) => hits.set(enemy.name, { kind: 'heal', target: target.name }),
    onUnitDone: async () => {},
  });
  return hits;
}

const named = (intents) => {
  const out = new Map();
  for (const [enemy, intent] of intents)
    if (intent.target) out.set(enemy.name, { kind: intent.kind, target: intent.target.name });
  return out;
};

describe('EnemyIntent: a unit entering reach does not by itself draw the attack', () => {
  // An axe fighter between a frail mage and a lance knight. The knight steps into its reach;
  // the fighter still prefers the mage (more damage, a kill), as the real phase does.
  it('keeps its target when the newcomer is the worse pick, and takes the newcomer when better', async () => {
    const grid = makeGrid(plainLayout(10, 5));
    const fighter = unit('enemy', 5, 2, { name: 'Fighter' });
    const mage = unit('player', 2, 2, {
      name: 'Mage',
      weaponName: 'Fire',
      stats: { HP: 16, DEF: 1, SPD: 5 },
      currentHP: 9,
    });
    const knight = unit('player', 9, 0, {
      name: 'Knight',
      stats: { HP: 30, DEF: 14, MOV: 5 },
    });
    const world = { enemies: [fighter], players: [mage, knight], npcs: [] };

    // The knight's destination (6, 2) is inside the fighter's reach.
    const reach = threatsOnTile(context(grid, world), 6, 2, { mover: knight });
    expect(reach.damage).toEqual([fighter]);

    const intents = predict(grid, world, knight, 6, 2);
    expect(intents.get(fighter)).toMatchObject({ kind: 'attack', target: mage });
    expect(named(intents)).toEqual(await playEnemyPhase(grid, world, knight, 6, 2));

    // The mage moving there instead, where it is the only unit the fighter reaches: aimed at.
    mage.col = 0;
    mage.row = 0;
    const mageIntents = predict(grid, world, mage, 6, 2);
    expect(mageIntents.get(fighter)).toMatchObject({ kind: 'attack', target: mage });
  });
});

describe('EnemyIntent projects an enemy Canto step before the next foe decides', () => {
  // A wall with a one-tile gap at (5,2); the army holds the far side. Foe A walks into the
  // gap to strike the knight, then its Canto steps it back out of the knight's reach, which
  // opens the gap for foe B behind it. A fight nobody dies in, so occupancy is the only
  // difference between the preview and the phase.
  function chokepoint(cantoSkills) {
    const layout = plainLayout(10, 5);
    for (let r = 0; r < 5; r++) if (r !== 2) layout[r][5] = T.Wall;
    const grid = makeGrid(layout);
    const a = unit('enemy', 4, 2, {
      name: 'A',
      skills: cantoSkills,
      stats: { HP: 40, DEF: 12, MOV: 5 },
    });
    const b = unit('enemy', 2, 3, { name: 'B', stats: { HP: 40, DEF: 12, MOV: 5 } });
    const knight = unit('player', 6, 2, {
      name: 'Knight',
      stats: { HP: 60, DEF: 20, STR: 2, MOV: 1 },
    });
    return { grid, a, b, knight, world: { enemies: [a, b], players: [knight], npcs: [] } };
  }

  it('B takes the gap A vacated, as the real phase does', async () => {
    const { grid, a, b, knight, world } = chokepoint(['canto']);
    const intents = predict(grid, world, null);
    expect(intents.get(a)).toMatchObject({ kind: 'attack', target: knight });
    expect(intents.get(b)).toMatchObject({ kind: 'attack', target: knight });
    const played = await playEnemyPhase(grid, world, null, 0, 0);
    expect(played.get('A')).toEqual({ kind: 'attack', target: 'Knight' });
    expect(played.get('B')).toEqual({ kind: 'attack', target: 'Knight' });
    expect(named(intents)).toEqual(played);
  });

  it('without Canto A keeps the gap and B has no one to strike, in both', async () => {
    const { grid, a, b, world } = chokepoint([]);
    const intents = predict(grid, world, null);
    expect(intents.get(a)).toMatchObject({ kind: 'attack' });
    expect(intents.get(b)).toMatchObject({ kind: 'none' });
    expect(named(intents)).toEqual(await playEnemyPhase(grid, world, null, 0, 0));
  });
});

describe('EnemyIntent agrees with the real enemy phase', () => {
  // A seeded sweep of small boards: walls, mixed weapons, several foes and units. For every
  // destination of the mover, the prediction must equal what processEnemyPhase does.
  function mulberry(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const ENEMY_WEAPONS = ['Iron Axe', 'Iron Sword', 'Iron Lance', 'Iron Bow', 'Fire', 'Javelin'];
  const PLAYER_WEAPONS = ['Iron Sword', 'Iron Lance', 'Iron Axe', 'Iron Bow', 'Fire'];

  function board(seed) {
    const rand = mulberry(seed);
    const pick = (list) => list[Math.floor(rand() * list.length)];
    const cols = 10;
    const rows = 7;
    const layout = plainLayout(cols, rows);
    for (let i = 0; i < 8; i++)
      layout[Math.floor(rand() * rows)][2 + Math.floor(rand() * (cols - 4))] = pick([
        T.Wall,
        T.Forest,
        T.Forest,
        T.Mountain,
      ]);
    const taken = new Set();
    const spot = (minCol, maxCol) => {
      for (;;) {
        const col = minCol + Math.floor(rand() * (maxCol - minCol + 1));
        const row = Math.floor(rand() * rows);
        const k = `${col},${row}`;
        if (taken.has(k) || layout[row][col] === T.Wall) continue;
        taken.add(k);
        return { col, row };
      }
    };
    const stats = () => ({
      HP: 16 + Math.floor(rand() * 14),
      STR: 6 + Math.floor(rand() * 8),
      MAG: 6 + Math.floor(rand() * 6),
      SKL: 4 + Math.floor(rand() * 8),
      SPD: 3 + Math.floor(rand() * 9),
      LCK: Math.floor(rand() * 8),
      DEF: 2 + Math.floor(rand() * 9),
      RES: Math.floor(rand() * 7),
      MOV: 4 + Math.floor(rand() * 2),
    });
    const enemies = Array.from({ length: 2 + Math.floor(rand() * 3) }, (_, i) => {
      const s = stats();
      return unit('enemy', 0, 0, {
        ...spot(cols - 4, cols - 1),
        name: `E${i}`,
        weaponName: pick(ENEMY_WEAPONS),
        stats: s,
        currentHP: Math.max(1, s.HP - Math.floor(rand() * 8)),
      });
    });
    const players = Array.from({ length: 3 }, (_, i) => {
      const s = stats();
      return unit('player', 0, 0, {
        ...spot(0, 3),
        name: `P${i}`,
        weaponName: pick(PLAYER_WEAPONS),
        stats: s,
        currentHP: Math.max(1, s.HP - Math.floor(rand() * 10)),
      });
    });
    return { grid: makeGrid(layout), world: { enemies, players, npcs: [] } };
  }

  it('on every destination of a seeded set of boards', async () => {
    let compared = 0;
    let changed = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const { grid, world } = board(seed);
      const mover = world.players[0];
      const range = grid.getMovementRange(
        mover.col,
        mover.row,
        mover.mov,
        mover.moveType,
        context(grid, world).positions(),
        'player',
      );
      const stayed = named(predict(grid, world, mover, mover.col, mover.row));
      for (const [key, entry] of range) {
        if (entry.stoppable === false) continue;
        const [col, row] = key.split(',').map(Number);
        const predicted = named(predict(grid, world, mover, col, row));
        expect(predicted, `seed ${seed} at ${key}`).toEqual(
          await playEnemyPhase(grid, world, mover, col, row),
        );
        if (JSON.stringify([...predicted]) !== JSON.stringify([...stayed])) changed++;
        compared++;
      }
    }
    // The sweep exercises real decisions: many tiles, and the mover's tile matters on some.
    expect(compared).toBeGreaterThan(100);
    expect(changed).toBeGreaterThan(5);
  });
});

describe('EnemyIntent is read-only', () => {
  it('leaves every unit as it was and never draws Math.random', () => {
    const grid = makeGrid(plainLayout(10, 5));
    const guard = unit('enemy', 7, 1, { name: 'Guard', aiMode: 'guard' });
    const fighter = unit('enemy', 6, 3, { name: 'Fighter' });
    fighter.inventory.push(weapon('Hand Axe'));
    const holders = [
      unit('enemy', 9, 0, { name: 'H1', aiMode: HOLD_AI_MODE, holdPack: 1, holdPackSize: 2 }),
      unit('enemy', 9, 2, { name: 'H2', aiMode: HOLD_AI_MODE, holdPack: 1, holdPackSize: 2 }),
    ];
    const knight = unit('player', 1, 2, { name: 'Knight' });
    const world = { enemies: [guard, fighter, ...holders], players: [knight], npcs: [] };
    const before = structuredClone(world);
    const random = vi.spyOn(Math, 'random');
    predict(grid, world, knight, 6, 1);
    predict(grid, world, knight, 8, 1);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
    expect(structuredClone(world)).toEqual(before);
  });
});

describe('EnemyIntent: what the player cannot see', () => {
  it('a foe the fog hides has no intent and never blocks the visible foes', () => {
    const grid = makeGrid(plainLayout(10, 1));
    grid.fogEnabled = true;
    grid.visibleSet = new Set(['0,0', '1,0', '2,0', '3,0', '4,0', '5,0', '6,0', '7,0']);
    grid.isVisible = (col, row) => grid.visibleSet.has(`${col},${row}`);
    const hidden = unit('enemy', 9, 0, { name: 'Hidden' });
    const seen = unit('enemy', 7, 0, { name: 'Seen' });
    const knight = unit('player', 0, 0, { name: 'Knight' });
    const world = { enemies: [hidden, seen], players: [knight], npcs: [] };
    const intents = predict(grid, world, knight, 3, 0);
    expect(intents.has(hidden)).toBe(false);
    expect(intents.get(seen)).toMatchObject({ kind: 'attack', target: knight });
  });
});

describe('EnemyIntent: foes that will not move', () => {
  it('a foe asleep through the phase start aims at nobody; one that may wake is read awake', () => {
    const grid = makeGrid(plainLayout(8, 1));
    const sleeper = unit('enemy', 6, 0, { name: 'Sleeper' });
    const knight = unit('player', 0, 0, { name: 'Knight' });
    const world = { enemies: [sleeper], players: [knight], npcs: [] };
    sleeper._conditions = [{ id: 'sleep', turnsRemaining: 3, recoveryChance: 0 }];
    expect(staysAsleepNextPhase(sleeper)).toBe(true);
    expect(predict(grid, world, knight, 4, 0).get(sleeper)).toMatchObject({
      kind: 'none',
      reason: 'asleep',
    });
    // The countdown ends at the phase start: it wakes and acts.
    sleeper._conditions = [{ id: 'sleep', turnsRemaining: 1, recoveryChance: 0 }];
    expect(predict(grid, world, knight, 4, 0).get(sleeper)).toMatchObject({
      kind: 'attack',
      target: knight,
    });
    // A recovery roll might wake it: read awake (the worse case for the player).
    sleeper._conditions = [{ id: 'sleep', turnsRemaining: 3, recoveryChance: 0.5 }];
    expect(predict(grid, world, knight, 4, 0).get(sleeper)?.kind).toBe('attack');
  });

  it("a holding pack stays put until the mover steps into a member's reach", () => {
    const grid = makeGrid(plainLayout(12, 3));
    const holders = [
      unit('enemy', 10, 0, { name: 'H1', aiMode: HOLD_AI_MODE, holdPack: 1, holdPackSize: 2 }),
      unit('enemy', 10, 2, { name: 'H2', aiMode: HOLD_AI_MODE, holdPack: 1, holdPackSize: 2 }),
    ];
    const knight = unit('player', 0, 1, { name: 'Knight', stats: { MOV: 8 } });
    const world = { enemies: holders, players: [knight], npcs: [] };
    const far = predict(grid, world, knight, 2, 1);
    expect(far.get(holders[0])).toMatchObject({ kind: 'none', reason: 'hold' });
    expect(far.get(holders[1])).toMatchObject({ kind: 'none', reason: 'hold' });
    // Inside a member's Danger tiles: the pack wakes, both go for the knight.
    const near = predict(grid, world, knight, 6, 1);
    expect(near.get(holders[0])).toMatchObject({ kind: 'attack', target: knight });
    expect(near.get(holders[1])).toMatchObject({ kind: 'attack', target: knight });
  });

  it("the next phase's anti-turtle flag is the one read", () => {
    // A seize boss clamps to its throne unless aggression is on.
    const grid = makeGrid(plainLayout(10, 1));
    const boss = unit('enemy', 9, 0, { name: 'Boss', isBoss: true });
    const knight = unit('player', 0, 0, { name: 'Knight' });
    const world = { enemies: [boss], players: [knight], npcs: [] };
    const ai = new AIController(grid, gameData, {
      objective: 'seize',
      thronePos: { col: 9, row: 0 },
    });
    const run = (aggressiveMode) =>
      predictEnemyIntents({
        ai,
        ctx: context(grid, world),
        playerUnits: world.players,
        mover: knight,
        col: 4,
        row: 0,
        turn: 1,
        aggressiveMode,
      }).get(boss);
    expect(run(false)).toMatchObject({ kind: 'none', reason: 'boss_hold_throne' });
    expect(run(true)).toMatchObject({ kind: 'attack', target: knight });
    expect(ai.aggressiveMode).toBe(false); // the battle's AI is untouched
  });
});

describe("EnemyIntent: the Entity's Grasping Limbs (live and preview agree)", () => {
  // The Entity's body at cols 1-3, rows 2-4; a limb at (9,3). The Entity strikes within 3 of
  // its body or beside a living limb (EntitySystem.canEntityStrike).
  const entityAt = (col, row) =>
    unit('enemy', col, row, {
      name: 'The Entity',
      className: 'Entity',
      isEntity: true,
      isBoss: true,
      mov: 0,
      weaponName: 'Eldritch Grasp',
      stats: { HP: 120, STR: 24, MAG: 22, SKL: 20, SPD: 12, DEF: 22, RES: 20, LCK: 15, MOV: 0 },
      currentHP: 120,
    });
  const limbAt = (col, row, extra = {}) =>
    unit('enemy', col, row, {
      name: 'Grasping Limb',
      className: 'Grasping Limb',
      _summonedBy: 'entity:limb',
      mov: 0,
      weaponName: 'Grasping Coil',
      stats: { HP: 22, STR: 18, SKL: 14, SPD: 8, DEF: 12, RES: 8, MOV: 0 },
      ...extra,
    });
  const board = ({ limb = {}, fogHidesLimb = false } = {}) => {
    const grid = makeGrid(plainLayout(14, 8));
    if (fogHidesLimb) {
      grid.fogEnabled = true;
      grid.isVisible = (col, row) => !(col === 9 && row === 3);
    }
    const entity = entityAt(1, 2);
    const knight = unit('player', 13, 7, { name: 'Knight', weaponName: 'Iron Bow' });
    const world = { enemies: [entity, limbAt(9, 3, limb)], players: [knight], npcs: [] };
    return { grid, entity, knight, world };
  };
  const entityPreview = (b, col, row) => predict(b.grid, b.world, b.knight, col, row).get(b.entity);
  const entityLive = async (b, col, row) =>
    (await playEnemyPhase(b.grid, b.world, b.knight, col, row)).get('The Entity') || null;

  it('a mover set down beside a visible living limb is struck, in both', async () => {
    const b = board();
    expect(entityPreview(b, 10, 3)).toMatchObject({ kind: 'attack', target: b.knight });
    expect(await entityLive(b, 10, 3)).toEqual({ kind: 'attack', target: 'Knight' });
  });

  it('a mover set down out of every reach is not, in both', async () => {
    const b = board();
    expect(entityPreview(b, 11, 3)).toMatchObject({ kind: 'none', target: null });
    expect(await entityLive(b, 11, 3)).toBeNull();
  });

  it('a dead limb lends no reach, in both', async () => {
    const b = board({ limb: { currentHP: 0 } });
    expect(entityPreview(b, 10, 3)).toMatchObject({ kind: 'none', target: null });
    expect(await entityLive(b, 10, 3)).toBeNull();
  });

  it('a limb the fog hides lends the preview nothing (it would name an unseen foe)', () => {
    const b = board({ fogHidesLimb: true });
    expect(entityPreview(b, 10, 3)).toMatchObject({ kind: 'none', target: null });
  });
});
