import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));

// The picker is a DOM dialog; here it records how it was opened and closes on demand.
const pickers = [];
vi.mock('../src/ui/FormationPicker.js', () => ({
  formationUnitLine: (unit) => unit?.className || '',
  FormationPicker: class {
    constructor(scene, formation, tileIndex, opts) {
      Object.assign(this, { tileIndex, opts, subject: opts.subject ?? null });
      pickers.push(this);
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      this.opts.onClose?.();
    }
    destroy() {
      this.closed = true;
    }
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { FormationController } from '../src/ui/FormationController.js';
import { createFormation } from '../src/engine/FormationPlacement.js';
import { Grid } from '../src/engine/Grid.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const PLAIN = gameData.terrain.findIndex((t) => t.name === 'Plain');

// Formation tiles down the left edge of a 7x5 plain map; tile 0 is off-limits to
// Cavalry (the rules stub), everything else is open to everyone.
const tiles = [
  { col: 0, row: 0 },
  { col: 0, row: 1 },
  { col: 0, row: 2 },
  { col: 0, row: 3 },
  { col: 0, row: 4 },
];
const CAVALRY_BANNED = 0;

function stubGraphic() {
  return {
    tint: null,
    visible: true,
    setTint(c) {
      this.tint = c;
    },
    clearTint() {
      this.tint = null;
    },
    setVisible(v) {
      this.visible = v;
    },
  };
}

function unit(name, extra = {}) {
  const sword = { name: 'Iron Sword', type: 'Sword', range: '1', rankRequired: 'Prof' };
  return {
    name,
    faction: 'player',
    moveType: 'Infantry',
    mov: 2,
    stats: { MOV: 2 },
    currentHP: 20,
    weapon: sword,
    inventory: [sword],
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    skills: [],
    graphic: stubGraphic(),
    ...extra,
  };
}

function chain() {
  const obj = {
    setDepth: () => obj,
    setStrokeStyle: () => obj,
    setAlpha: () => obj,
    setOrigin: () => obj,
    destroy: () => {},
  };
  return obj;
}

function setup({ fog = false, enemies = [] } = {}) {
  const map = Array.from({ length: 5 }, () => Array(7).fill(PLAIN));
  const drawn = [];
  const scene = {
    _battleSession: 1,
    gameData,
    enemyUnits: enemies,
    npcUnits: [],
    playerUnits: [],
    add: {
      rectangle: (x, y, w, h, color, alpha) => {
        drawn.push({ x, y, color, alpha });
        return chain();
      },
      text: () => chain(),
    },
    updateUnitPosition: () => {},
    _getCostModifier: () => 0,
    _inputController: { handleIdleClick: vi.fn() },
  };
  scene.buildUnitPositionMap = BattleScene.prototype.buildUnitPositionMap.bind(scene);
  scene.grid = new Grid(
    {
      cameras: { main: { width: 640, height: 480 } },
      add: { rectangle: chain, image: chain, text: chain, container: chain },
      textures: { exists: () => false },
    },
    7,
    5,
    gameData.terrain,
    map,
    fog,
  );
  const c = new FormationController(scene);
  c.units = [unit('Edric'), unit('Sera'), unit('Rowan', { moveType: 'Cavalry' }), unit('Kira')];
  c.tiles = tiles;
  c.leniency = c.units.map(() => 'strict');
  c.rules = {
    issue: (moveType, t) =>
      moveType === 'Cavalry' && t === CAVALRY_BANNED
        ? "Cavalry units can't stand on Mountain."
        : '',
  };
  c.formation = createFormation(c.units.length, tiles);
  c.active = true;
  c.ready = true;
  return { c, scene, drawn };
}

const tap = (c, t) => c.handleTileTap(tiles[t]);
const names = (c) => c.formation.at.map((t, u) => [c.units[u].name, t]);

beforeEach(() => {
  pickers.length = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('Formation: tap a placed unit to pick it up', () => {
  it('an occupied tile picks its unit up; an empty tile still asks who stands there', () => {
    const { c } = setup();
    c.assign(0, 1);
    tap(c, 1);
    expect(c.heldUnit?.name).toBe('Edric');
    expect(pickers).toHaveLength(0);
    // The held unit wears the selection tint.
    expect(c.units[0].graphic.tint).toBe(0xaaaaff);

    c.release();
    expect(c.units[0].graphic.tint).toBeNull();
    tap(c, 2);
    expect(c.heldUnit).toBeNull();
    expect(pickers).toHaveLength(1);
    expect(pickers[0]).toMatchObject({ tileIndex: 2, subject: null });
  });

  it('a held unit moves to an empty tile and is set down', () => {
    const { c } = setup();
    c.assign(0, 1);
    tap(c, 1);
    tap(c, 3);
    expect(c.formation.at[0]).toBe(3);
    expect(c.heldUnit).toBeNull();
    expect(c.units[0].graphic.tint).toBeNull();
    expect(pickers).toHaveLength(0);
  });

  it('a held unit dropped on another placed unit swaps them', () => {
    const { c } = setup();
    c.assign(0, 1);
    c.assign(1, 2);
    tap(c, 1);
    tap(c, 2);
    expect(c.formation.at.slice(0, 2)).toEqual([2, 1]);
    expect(c.heldUnit).toBeNull();
    expect(c.notice || '').toBe('');
  });

  it('a swap that would put the other unit where it cannot stand sends it to wait, and says so', () => {
    const { c } = setup();
    c.assign(0, CAVALRY_BANNED); // Edric on the cavalry-banned tile
    c.assign(2, 3); // Rowan (Cavalry)
    tap(c, CAVALRY_BANNED);
    tap(c, 3);
    expect(c.formation.at[0]).toBe(3);
    expect(c.formation.at[2]).toBeNull();
    expect(c.notice).toBe("Rowan waits: Cavalry units can't stand on Mountain.");
  });

  it('a tile the held unit may not stand on keeps it in hand with the reason', () => {
    const { c } = setup();
    c.assign(2, 3);
    tap(c, 3);
    const before = names(c);
    tap(c, CAVALRY_BANNED);
    expect(names(c)).toEqual(before);
    expect(c.heldUnit?.name).toBe('Rowan');
    expect(c.notice).toBe("Cavalry units can't stand on Mountain.");
  });

  it('tapping outside the formation inspects and keeps the unit in hand', () => {
    const { c, scene } = setup();
    c.assign(0, 1);
    tap(c, 1);
    c.handleTileTap({ col: 5, row: 2 });
    expect(scene._inputController.handleIdleClick).toHaveBeenCalledWith({ col: 5, row: 2 });
    expect(c.heldUnit?.name).toBe('Edric');
    expect(c.formation.at[0]).toBe(1);
  });
});

describe('Formation: the held unit’s menu', () => {
  it('a second tap on the held unit opens its menu; closing it keeps the unit in hand', () => {
    const { c } = setup();
    c.assign(0, 1);
    tap(c, 1);
    tap(c, 1);
    expect(pickers).toHaveLength(1);
    expect(pickers[0]).toMatchObject({ tileIndex: 1, subject: 0 });
    expect(c.formation.at[0]).toBe(1);
    // Back: the menu closes first, then the unit is set down.
    expect(c.cancel()).toBe(true);
    expect(c.picker).toBeNull();
    expect(c.heldUnit?.name).toBe('Edric');
    expect(c.cancel()).toBe(true);
    expect(c.heldUnit).toBeNull();
    expect(c.cancel()).toBe(false);
  });

  it('the menu swaps the held unit with a waiting unit (who takes its tile)', () => {
    const { c } = setup();
    c.assign(0, 1);
    tap(c, 1);
    tap(c, 1);
    pickers[0].opts.onPick(3); // Kira is waiting
    expect(c.formation.at[3]).toBe(1);
    expect(c.formation.at[0]).toBeNull();
    expect(c.heldUnit).toBeNull();
  });

  it('the menu swaps the held unit with a placed unit', () => {
    const { c } = setup();
    c.assign(0, 1);
    c.assign(1, 4);
    tap(c, 1);
    tap(c, 1);
    pickers[0].opts.onPick(1);
    expect(c.formation.at.slice(0, 2)).toEqual([4, 1]);
    expect(c.heldUnit).toBeNull();
  });

  it('a menu swap that sends the held unit to wait says so', () => {
    const { c } = setup();
    c.assign(0, CAVALRY_BANNED); // Edric
    c.assign(2, 1); // Rowan (Cavalry)
    tap(c, 1);
    tap(c, 1); // Rowan's menu
    pickers[0].opts.onPick(0); // Edric takes Rowan's tile; Rowan can't take the banned tile
    expect(c.formation.at[0]).toBe(1);
    expect(c.formation.at[2]).toBeNull();
    expect(c.notice).toBe("Rowan waits: Cavalry units can't stand on Mountain.");
  });

  it('a menu pick that may not take the held unit’s tile is refused: the unit stays in hand, tinted', () => {
    const { c } = setup();
    c.assign(0, CAVALRY_BANNED); // Edric
    tap(c, CAVALRY_BANNED);
    tap(c, CAVALRY_BANNED); // Edric's menu
    const before = names(c);
    expect(c.moveTo(2, CAVALRY_BANNED)).toBe(false); // Rowan (Cavalry) is waiting
    expect(names(c)).toEqual(before);
    // What is drawn matches what is held: no tint left on a unit that is no longer in hand.
    expect(c.heldUnit?.name).toBe('Edric');
    expect(c.units[0].graphic.tint).toBe(0xaaaaff);
    expect(c.notice).toBe("Cavalry units can't stand on Mountain.");
  });

  it('Details pages through the units on the field only', () => {
    const { c, scene } = setup();
    scene.unitDetailOverlay = { show: vi.fn(), visible: false };
    c.assign(0, 1);
    c.assign(3, 2);
    tap(c, 2);
    tap(c, 2);
    pickers[0].opts.onDetails();
    const [unit, terrain, , roster] = scene.unitDetailOverlay.show.mock.calls[0];
    expect(unit.name).toBe('Kira');
    expect(terrain?.name).toBe('Plain');
    expect(roster.rosterUnits.map((u) => u.name)).toEqual(['Edric', 'Kira']);
    expect(roster.rosterIndex).toBe(1);
  });

  it('the menu (or the rail’s Remove) sends the held unit back to wait', () => {
    const { c } = setup();
    c.assign(0, 1);
    c.assign(1, 2);
    tap(c, 1);
    tap(c, 1);
    pickers[0].opts.onClear();
    expect(c.formation.at.slice(0, 2)).toEqual([null, 2]);
    expect(c.heldUnit).toBeNull();

    tap(c, 2);
    c.unplace(1);
    expect(c.formation.at[1]).toBeNull();
    expect(c.heldUnit).toBeNull();
    expect(c.units[1].graphic.tint).toBeNull();
  });
});

describe('Formation: waiting units and the unit in hand', () => {
  it('a placed unit in hand + a waiting unit’s chip: the waiting unit takes its tile', () => {
    const { c } = setup();
    c.assign(0, 1);
    tap(c, 1);
    c.holdUnit(c.units[3]);
    expect(c.formation.at[3]).toBe(1);
    expect(c.formation.at[0]).toBeNull();
    expect(c.heldUnit).toBeNull();
  });

  it('a waiting unit that may not stand on the held unit’s tile is refused with the reason', () => {
    const { c } = setup();
    c.assign(0, CAVALRY_BANNED);
    tap(c, CAVALRY_BANNED);
    c.holdUnit(c.units[2]); // Rowan (Cavalry) is waiting
    expect(c.formation.at[0]).toBe(CAVALRY_BANNED);
    expect(c.formation.at[2]).toBeNull();
    expect(c.heldUnit?.name).toBe('Edric');
    expect(c.notice).toBe("Cavalry units can't stand on Mountain.");
  });

  it('the bench flow still works: a waiting unit in hand is placed, displacing the occupant', () => {
    const { c } = setup();
    c.assign(0, 1);
    c.holdUnit(c.units[1]);
    expect(c.heldUnit?.name).toBe('Sera');
    // A waiting unit in hand is not on the field: no tint, no reach.
    expect(c.units[1].graphic.tint).toBeNull();
    expect(c.reachTiles()).toBeNull();
    tap(c, 1);
    expect(c.formation.at.slice(0, 2)).toEqual([null, 1]);
    expect(c.heldUnit).toBeNull();
    // Its chip again lets go.
    c.holdUnit(c.units[3]);
    c.holdUnit(c.units[3]);
    expect(c.heldUnit).toBeNull();
  });
});

describe('Formation: nothing stays in hand once placement changes wholesale', () => {
  it('Auto-place, Clear and Start each set the unit down and drop its tint', () => {
    const { c, scene } = setup();
    c.assign(0, 1);
    tap(c, 1);
    c.autoPlace = FormationController.prototype.autoPlace;
    c.defaultTiles = tiles.slice(0, 4);
    c.autoPlace();
    expect(c.heldUnit).toBeNull();
    expect(c.units[0].graphic.tint).toBeNull();

    tap(c, c.formation.at[0]);
    c.clearAll();
    expect(c.heldUnit).toBeNull();

    c.autoPlace();
    tap(c, c.formation.at[0]);
    scene.unitDetailOverlay = { visible: true, hide: vi.fn() };
    scene.inspectionPanel = null;
    expect(c.start()).toBe(true);
    expect(c.heldUnit).toBeNull();
    expect(c.units[0].graphic.tint).toBeNull();
    expect(scene.unitDetailOverlay.hide).toHaveBeenCalled();
    expect(scene.playerUnits.map((u) => u.name)).toEqual(['Edric', 'Sera', 'Rowan', 'Kira']);
  });
});

describe('Formation: the held unit shows its turn-1 reach', () => {
  const keys = (tilesList) => tilesList.map((t) => `${t.col},${t.row}`).sort();

  function held(options) {
    const env = setup(options);
    env.c.assign(0, 2); // Edric at (0,2), MOV 2, sword range 1 (syncField puts him on the field)
    tap(env.c, 2);
    expect(env.c.heldUnit?.name).toBe('Edric');
    return env;
  }

  it('move tiles within MOV and the sword’s reach one step beyond', () => {
    const { c } = held();
    const reach = c.reachTiles();
    expect(keys(reach.move)).toEqual(
      keys([
        { col: 0, row: 0 },
        { col: 0, row: 1 },
        { col: 0, row: 3 },
        { col: 0, row: 4 },
        { col: 1, row: 1 },
        { col: 1, row: 2 },
        { col: 1, row: 3 },
        { col: 2, row: 2 },
      ]),
    );
    expect(keys(reach.attack)).toEqual(
      keys([
        { col: 1, row: 0 },
        { col: 1, row: 4 },
        { col: 2, row: 1 },
        { col: 2, row: 3 },
        { col: 3, row: 2 },
      ]),
    );
  });

  it('the fringe is what targeting allows: Foresight’s tome reach', () => {
    const env = setup();
    const fire = { name: 'Fire', type: 'Tome', range: '1-2', rankRequired: 'Prof' };
    const bow = { name: 'Iron Bow', type: 'Bow', range: '2', rankRequired: 'Prof' };
    env.c.units[3] = unit('Kira', {
      weapon: fire,
      inventory: [fire, bow],
      proficiencies: [
        { type: 'Tome', rank: 'Prof' },
        { type: 'Bow', rank: 'Prof' },
      ],
      skills: ['foresight'],
    });
    env.c.assign(3, 2); // Kira at (0,2), MOV 2: Fire 1–3 with Foresight, the bow 2
    tap(env.c, 2);
    expect(env.c.heldUnit?.name).toBe('Kira');
    // From her farthest stop (2,2) Foresight reaches (5,2); Fire alone ends at (4,2).
    const attack = keys(env.c.reachTiles().attack);
    expect(attack).toContain('5,2');
    expect(attack).toContain('4,1');
    expect(attack).not.toContain('6,2');
  });

  it('a visible enemy blocks the path; an enemy hidden in fog does not shape the preview', () => {
    const foe = { name: 'Brigand', faction: 'enemy', col: 1, row: 2, currentHP: 20 };
    const seen = held({ fog: true, enemies: [foe] });
    seen.scene.grid.updateFogOfWar([{ col: 0, row: 2, moveType: 'Infantry' }]);
    expect(seen.scene.grid.isVisible(1, 2)).toBe(true);
    expect(keys(seen.c.reachTiles().move)).not.toContain('2,2');

    const hidden = held({ fog: true, enemies: [{ ...foe }] });
    // Nobody sees (1,2): the fog stays over it.
    hidden.scene.grid.updateFogOfWar([]);
    expect(hidden.scene.grid.isVisible(1, 2)).toBe(false);
    expect(keys(hidden.c.reachTiles().move)).toContain('2,2');
  });

  it('draws the reach while held and clears it when set down', () => {
    const { c, drawn } = held();
    drawn.length = 0;
    c.drawMarkers();
    const moveFill = drawn.filter((r) => r.color === 0x3366cc);
    expect(moveFill).toHaveLength(8);
    drawn.length = 0;
    c.release();
    expect(drawn.filter((r) => r.color === 0x3366cc)).toHaveLength(0);
  });
});
