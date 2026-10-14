import { describe, it, expect, vi } from 'vitest';
import { Grid } from '../src/engine/Grid.js';
import { ThreatSightController } from '../src/ui/ThreatSightController.js';
import { threatsOnTile } from '../src/engine/ThreatForecast.js';
import { rasterizeThreatSigil, THREAT_SIGIL_SIZE } from '../src/art/threatSigil.js';
import { AIController } from '../src/engine/AIController.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const WALL = gameData.terrain.findIndex((t) => t.name === 'Wall');
const PLAIN = gameData.terrain.findIndex((t) => t.name === 'Plain');

function stub() {
  const obj = {};
  const chain = () => obj;
  Object.assign(obj, {
    setDepth: chain,
    setVisible: chain,
    setOrigin: chain,
    setPosition: chain,
    setText: chain,
    setName: chain,
    clear: chain,
    lineStyle: chain,
    lineBetween: chain,
    fillStyle: chain,
    fillTriangle: chain,
    fillRect: chain,
    beginPath: chain,
    moveTo: chain,
    lineTo: chain,
    strokePath: chain,
    destroy: vi.fn(),
  });
  return obj;
}

function makeScene({ enemies, player, hover = null, state = 'UNIT_SELECTED', reduce = false }) {
  const map = Array.from({ length: 5 }, () => Array(12).fill(0));
  const grid = new Grid(
    {
      cameras: { main: { width: 640, height: 480 } },
      add: { rectangle: stub, image: stub, text: stub, container: stub },
      textures: { exists: () => false },
    },
    12,
    5,
    gameData.terrain,
    map,
    false,
  );
  const handlers = new Map();
  const scene = {
    _battleSession: 1,
    grid,
    battleState: state,
    selectedUnit: player,
    playerUnits: [player],
    enemyUnits: enemies,
    npcUnits: [],
    ballistas: [],
    turnManager: { currentPhase: 'player', turnNumber: 1 },
    _threatFocusTile: hover,
    _reduceMotion: () => reduce,
    events: {
      on: (name, fn) => handlers.set(name, fn),
      off: vi.fn(),
      once: vi.fn(),
    },
    add: { graphics: vi.fn(stub), image: vi.fn(stub), text: vi.fn(stub) },
    textures: { exists: () => true },
    tweens: { add: vi.fn(), killTweensOf: vi.fn() },
    threatContext() {
      return {
        grid,
        enemyUnits: this.enemyUnits,
        ballistas: [],
        positions: () => {
          const m = new Map();
          for (const u of [...this.playerUnits, ...this.enemyUnits])
            if (u.currentHP > 0) m.set(`${u.col},${u.row}`, { faction: u.faction });
          return m;
        },
        costModifier: () => 0,
      };
    },
  };
  scene.movementRange = grid.getMovementRange(
    player.col,
    player.row,
    player.mov,
    'Infantry',
    scene.threatContext().positions(),
    'player',
  );
  return scene;
}

const foe = (col, row) => ({
  faction: 'enemy',
  col,
  row,
  currentHP: 20,
  mov: 3,
  stats: { MOV: 3 },
  moveType: 'Infantry',
  weapon: { range: '1' },
});
const sera = () => ({
  name: 'Sera',
  faction: 'player',
  col: 1,
  row: 2,
  currentHP: 18,
  mov: 4,
  stats: { MOV: 4 },
  moveType: 'Infantry',
});

describe('ThreatSightController', () => {
  it('reads the hovered destination while moving, else the unit tile', () => {
    const player = sera();
    const enemy = foe(8, 2);
    const scene = makeScene({ enemies: [enemy], player, hover: { col: 5, row: 2 } });
    const sight = new ThreatSightController(scene).create();
    sight.sync();
    expect(sight.current).toMatchObject({ col: 5, row: 2, hovering: true });
    expect(sight.current.result.damage).toEqual([enemy]);
    expect(scene.add.image).toHaveBeenCalledTimes(1); // one eye
    // Hovering outside the move range falls back to the unit's own tile.
    scene._threatFocusTile = { col: 11, row: 4 };
    sight.sync();
    expect(sight.current).toMatchObject({ col: 1, row: 2, hovering: false });
    expect(sight.current.result.count).toBe(0);
    expect(sight.sigils).toHaveLength(0);
  });

  it('keeps the current tile after a move (action menu) and hides when idle', () => {
    const player = sera();
    player.col = 6; // tentatively moved next to the enemy
    const scene = makeScene({ enemies: [foe(8, 2)], player, state: 'UNIT_ACTION_MENU' });
    const sight = new ThreatSightController(scene).create();
    sight.sync();
    expect(sight.current).toMatchObject({ col: 6, row: 2, hovering: false });
    expect(sight.describe(6, 2)).toBe('1 foe can reach');
    scene.battleState = 'PLAYER_IDLE';
    scene.selectedUnit = null;
    sight.sync();
    expect(sight.current).toBeNull();
    expect(sight.describe(6, 2)).toBeNull();
  });

  it('Canto: hover previews a tile of the canto range, even though the unit has acted', () => {
    const player = sera();
    player.hasActed = true;
    const enemy = foe(8, 2);
    const scene = makeScene({
      enemies: [enemy],
      player,
      state: 'CANTO_MOVING',
      hover: { col: 5, row: 2 },
    });
    // The move range is stale and empty; only the canto range (2 tiles left) may count.
    scene.movementRange = new Map();
    scene.cantoRange = scene.grid.getMovementRange(
      player.col,
      player.row,
      4,
      'Infantry',
      scene.threatContext().positions(),
      'player',
    );
    const sight = new ThreatSightController(scene).create();
    sight.sync();
    expect(sight.current).toMatchObject({ col: 5, row: 2, hovering: true });
    expect(sight.current.result.damage).toEqual([enemy]);
    expect(sight.describe(5, 2)).toBe('1 foe can reach');
    // Outside the canto range: falls back to the unit's own tile.
    scene._threatFocusTile = { col: 11, row: 4 };
    sight.sync();
    expect(sight.current).toMatchObject({ col: 1, row: 2, hovering: false });
    expect(sight.describe(11, 4)).toBeNull();
  });

  it('Canto: a hover only movementRange would allow is ignored', () => {
    const player = sera();
    player.hasActed = true;
    const scene = makeScene({
      enemies: [foe(8, 2)],
      player,
      state: 'CANTO_MOVING',
      hover: { col: 5, row: 2 },
    });
    scene.cantoRange = new Map([['2,2', { cost: 1, parent: '1,2' }]]);
    const sight = new ThreatSightController(scene).create();
    sight.sync();
    expect(sight.current).toMatchObject({ col: 1, row: 2, hovering: false });
  });

  it('Canto confirm: reads the tile the unit moved to', () => {
    const player = sera();
    player.hasActed = true;
    player.col = 6;
    const scene = makeScene({
      enemies: [foe(8, 2)],
      player,
      state: 'CANTO_CONFIRM',
      hover: { col: 3, row: 2 },
    });
    scene.cantoRange = null;
    const sight = new ThreatSightController(scene).create();
    sight.sync();
    expect(sight.current).toMatchObject({ col: 6, row: 2, hovering: false });
    expect(sight.describe(6, 2)).toBe('1 foe can reach');
  });

  it('a unit that has acted gets no threat sight in an ordinary state', () => {
    for (const state of ['PLAYER_IDLE', 'UNIT_SELECTED', 'UNIT_ACTION_MENU']) {
      const player = sera();
      player.hasActed = true;
      const scene = makeScene({ enemies: [foe(8, 2)], player, state, hover: { col: 5, row: 2 } });
      const sight = new ThreatSightController(scene).create();
      sight.sync();
      expect(sight.current, state).toBeNull();
      expect(sight.describe(1, 2), state).toBeNull();
    }
  });

  it('memoizes per tile until the world changes', () => {
    const player = sera();
    const enemy = foe(8, 2);
    const scene = makeScene({ enemies: [enemy], player });
    const sight = new ThreatSightController(scene);
    const first = sight.query(player, 5, 2);
    expect(sight.query(player, 5, 2)).toBe(first);
    enemy.currentHP = 0;
    const after = sight.query(player, 5, 2);
    expect(after).not.toBe(first);
    expect(after.count).toBe(0);
  });

  it('a remembered answer does not outlive a terrain change', () => {
    // A full-height wall at col 7 keeps the foe (col 9, 3 moves) away from (5,2).
    const player = sera();
    const enemy = foe(9, 2);
    const scene = makeScene({ enemies: [enemy], player });
    for (let row = 0; row < 5; row++) scene.grid.setTerrainAt(7, row, WALL);
    const sight = new ThreatSightController(scene);
    expect(sight.query(player, 5, 2).count).toBe(0);
    // Break (or a temporary wall expiring) opens the middle of the wall.
    scene.grid.setTerrainAt(7, 2, PLAIN);
    const fresh = threatsOnTile(scene.threatContext(), 5, 2, { mover: player });
    expect(fresh.damage).toEqual([enemy]);
    expect(sight.query(player, 5, 2)).toEqual(fresh);
  });

  it('re-reads a still selection when terrain changes under it', () => {
    // Sera stands at (5,2) in her action menu; nothing about the focus changes.
    const player = sera();
    player.col = 5;
    const enemy = foe(9, 2);
    const scene = makeScene({ enemies: [enemy], player, state: 'UNIT_ACTION_MENU' });
    for (let row = 0; row < 5; row++) scene.grid.setTerrainAt(7, row, WALL);
    const sight = new ThreatSightController(scene).create();
    sight.sync();
    expect(sight.current.result.count).toBe(0);
    expect(sight.sigils).toHaveLength(0);
    scene.grid.setTerrainAt(7, 2, PLAIN);
    sight.sync();
    expect(sight.current.result.damage).toEqual([enemy]);
    expect(sight.sigils).toHaveLength(1); // the foe's eye appears without a new hover
    expect(sight.describe(5, 2)).toBe('1 foe can reach');
  });

  it('does not pulse under reduced motion and never touches Math.random', () => {
    const player = sera();
    const scene = makeScene({
      enemies: [foe(8, 2)],
      player,
      hover: { col: 5, row: 2 },
      reduce: true,
    });
    const random = vi.spyOn(Math, 'random');
    const sight = new ThreatSightController(scene).create();
    sight.sync();
    expect(scene.tweens.add).not.toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });

  it('is silent during the enemy phase', () => {
    const player = sera();
    const scene = makeScene({ enemies: [foe(8, 2)], player, hover: { col: 5, row: 2 } });
    scene.turnManager.currentPhase = 'enemy';
    const sight = new ThreatSightController(scene);
    sight.sync();
    expect(sight.current).toBeNull();
  });
});

describe('ThreatSightController: "counters from here" follows the mover\'s weapons', () => {
  // The Entity (a 3x3 body at 7..9, 0..2) cannot strike (4, 1), three tiles off, but it answers
  // a blow from there: a note only for a unit carrying a weapon that reaches 3.
  const weapon = (name) => structuredClone(gameData.weapons.find((w) => w.name === name));
  const entity = () => ({
    name: 'The Entity',
    faction: 'enemy',
    isEntity: true,
    col: 7,
    row: 0,
    currentHP: 300,
    mov: 0,
    stats: { MOV: 0, HP: 300 },
    moveType: 'Infantry',
    weapon: weapon('Eldritch Grasp'),
    inventory: [weapon('Eldritch Grasp')],
  });
  const archerless = () => ({
    ...sera(),
    col: 4,
    row: 1,
    weapon: weapon('Iron Sword'),
    inventory: [weapon('Iron Sword')],
  });
  const COUNTERS = 'No foe can reach · The Entity counters from here';

  it('a Trade that hands the unit a bow, with no move, changes the line it is asked for', () => {
    const player = archerless();
    const scene = makeScene({ enemies: [entity()], player });
    const sight = new ThreatSightController(scene).create();
    expect(sight.describe(4, 1)).toBe('No foe can reach');
    // The trade: a Longbow comes into the bag. Same tile, same turn, same foes.
    player.inventory.push(weapon('Longbow'));
    expect(sight.describe(4, 1)).toBe(COUNTERS);
    // And the other way: it hands the bow on again.
    player.inventory.pop();
    expect(sight.describe(4, 1)).toBe('No foe can reach');
  });

  it('the drawn answer is asked again after a Trade or Equip that leaves the unit in place', () => {
    const player = archerless();
    const scene = makeScene({ enemies: [entity()], player, state: 'UNIT_ACTION_MENU' });
    const sight = new ThreatSightController(scene).create();
    sight.sync();
    expect(sight.current.result.counter).toEqual([]);
    // An Equip from the convoy: the Longbow is now the weapon in hand (and in the bag).
    const bow = weapon('Longbow');
    player.inventory.push(bow);
    player.weapon = bow;
    sight.sync(); // the per-frame tick: the same call the scene's update makes
    expect(sight.current.result.counter).toHaveLength(1);
    expect(sight.current.result.counter[0].isEntity).toBe(true);
    // Trading the bow away takes the note back.
    player.inventory = [player.inventory[0]];
    player.weapon = player.inventory[0];
    sight.sync();
    expect(sight.current.result.counter).toEqual([]);
  });

  it('swapping which carried weapon is equipped does not change what it can reach', () => {
    const player = archerless();
    player.inventory.push(weapon('Longbow'));
    const scene = makeScene({ enemies: [entity()], player, state: 'UNIT_ACTION_MENU' });
    const sight = new ThreatSightController(scene).create();
    sight.sync();
    const first = sight.current.result;
    expect(first.counter).toHaveLength(1);
    player.weapon = player.inventory[1];
    sight.sync();
    // The same memoized answer: nothing it reads changed.
    expect(sight.current.result).toBe(first);
  });
});

describe('threat sigil art', () => {
  it('is an ink-outlined eye with a glow and a violet status variant', () => {
    const damage = rasterizeThreatSigil('damage');
    const status = rasterizeThreatSigil('status');
    expect(damage.width).toBe(THREAT_SIGIL_SIZE.width);
    expect(damage.data.length).toBe(damage.width * damage.height * 4);
    const at = (img, x, y) => [
      ...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4),
    ];
    const cx = Math.floor(damage.width / 2);
    const cy = Math.floor(damage.height / 2);
    expect(at(damage, cx, cy)).toEqual([28, 6, 9, 255]); // slit pupil (ink)
    expect(at(damage, 0, 0)[3]).toBe(0); // transparent corner
    expect(at(status, cx, 1)).not.toEqual(at(damage, cx, 1));
  });
});

describe('ThreatSightController: reach is not intent', () => {
  // An axe fighter, a wounded mage within its reach and a knight moving in. Reaching the
  // knight's new tile, the fighter would still go for the mage: the AI's own pick.
  const weapon = (name) => structuredClone(gameData.weapons.find((w) => w.name === name));
  const STATS = { HP: 24, STR: 10, MAG: 0, SKL: 8, SPD: 7, LCK: 4, DEF: 6, RES: 3, MOV: 5 };
  const unit = (name, faction, col, row, weaponName, stats = {}, hp = null) => {
    const w = weapon(weaponName);
    const s = { ...STATS, ...stats };
    return {
      name,
      faction,
      col,
      row,
      mov: s.MOV,
      moveType: 'Infantry',
      level: 5,
      stats: s,
      currentHP: hp ?? s.HP,
      weapon: w,
      inventory: [w],
      skills: [],
    };
  };

  function setup(moverName) {
    const fighter = unit('Fighter', 'enemy', 8, 2, 'Iron Axe');
    const mage = unit('Mage', 'player', 5, 2, 'Fire', { HP: 16, DEF: 1, SPD: 5 }, 9);
    const knight = unit('Knight', 'player', 1, 1, 'Iron Lance', { HP: 30, DEF: 14, MOV: 8 });
    const mover = moverName === 'Knight' ? knight : mage;
    if (mover === mage) {
      mage.col = 1;
      mage.row = 4;
      mage.mov = 8;
    }
    const scene = makeScene({ enemies: [fighter], player: mover, hover: { col: 9, row: 3 } });
    scene.playerUnits = [mage, knight];
    scene.movementRange = scene.grid.getMovementRange(
      mover.col,
      mover.row,
      mover.mov,
      'Infantry',
      scene.threatContext().positions(),
      'player',
    );
    scene.aiController = new AIController(scene.grid, gameData, { objective: 'rout' });
    scene.nextEnemyPhaseAiFlags = () => ({ aggressiveMode: false, bossEnraged: false });
    const lines = [];
    scene.add.graphics = vi.fn(() => {
      const g = stub();
      g.lineBetween = (x1, y1, x2, y2) => {
        lines.push({ x1, y1, x2, y2 });
        return g;
      };
      return g;
    });
    const images = [];
    scene.add.image = vi.fn(() => {
      const img = stub();
      img.setAlpha = (a) => {
        img.alpha = a;
        return img;
      };
      images.push(img);
      return img;
    });
    return { scene, fighter, mage, knight, lines, images };
  }

  it('a knight stepping into reach: the eye dims and the thread goes to the mage', () => {
    const { scene, fighter, mage, lines, images } = setup('Knight');
    scene._threatFocusTile = { col: 7, row: 3 };
    const sight = new ThreatSightController(scene).create();
    sight.sync();
    expect(sight.current.result.damage).toEqual([fighter]);
    expect(sight.current.result.intents.get(fighter)).toMatchObject({ target: mage });
    expect(sight.describe(7, 3)).toBe('1 foe can reach · none target you');
    expect(images).toHaveLength(1);
    expect(images[0].threatAim).toBe('aside');
    // Its thread ends at the mage's tile, not the knight's destination.
    const at = scene.grid.gridToPixel(mage.col, mage.row);
    const end = lines[lines.length - 1];
    expect(Math.hypot(end.x2 - at.x, end.y2 - at.y)).toBeLessThan(scene.grid.tileSize ?? 32);
  });

  it('the mage moving in is the one aimed at: a bright eye and a thread to its tile', () => {
    const { scene, fighter, mage, images } = setup('Mage');
    scene._threatFocusTile = { col: 7, row: 3 };
    const sight = new ThreatSightController(scene).create();
    sight.sync();
    expect(sight.current.result.intents.get(fighter)).toMatchObject({
      kind: 'attack',
      target: mage,
    });
    expect(sight.describe(7, 3)).toBe('1 foe can reach · 1 targets you');
    expect(images[0].threatAim).toBe('mover');
  });

  it('without a battle AI the answer is reach alone', () => {
    const { scene } = setup('Knight');
    scene.aiController = null;
    scene._threatFocusTile = { col: 7, row: 3 };
    const sight = new ThreatSightController(scene).create();
    expect(sight.describe(7, 3)).toBe('1 foe can reach');
  });
});
