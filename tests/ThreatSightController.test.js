import { describe, it, expect, vi } from 'vitest';
import { Grid } from '../src/engine/Grid.js';
import { ThreatSightController } from '../src/ui/ThreatSightController.js';
import { rasterizeThreatSigil, THREAT_SIGIL_SIZE } from '../src/art/threatSigil.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

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
