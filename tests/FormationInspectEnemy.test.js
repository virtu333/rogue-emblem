// Formation: a tap on a foe shows that foe's reach, as it does on a turn. Before this,
// placement handed the tap to the idle-click path, whose move/attack-range block only
// ran in PLAYER_IDLE, so the foe's panel opened (or nothing did) and no range was drawn.
// Ways this can break:
//   - the foe's move and attack tiles are not drawn in DEPLOY_POSITIONING
//   - the range is drawn for a foe the fog hides (PlayerKnowledge: canInspectUnit)
//   - tapping the foe again, bare terrain, a formation tile or a waiting unit's chip
//     leaves the range behind; Start battle leaves it on the first turn
//   - looking at a foe puts the unit in hand down (it must stay held)
//   - the range drawn in the player phase changes
//   - the desktop right click puts the unit in hand down instead of inspecting
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: { Scene: class {}, Math: { Clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)) } },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { FormationController } from '../src/ui/FormationController.js';
import { InputController } from '../src/ui/InputController.js';
import { createFormation } from '../src/engine/FormationPlacement.js';
import { Grid } from '../src/engine/Grid.js';
import { TERRAIN } from '../src/utils/constants.js';
import { HELP_TABS, HOW_TO_PLAY_PAGES } from '../src/data/helpContent.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const PLAIN = gameData.terrain.findIndex((t) => t.name === 'Plain');
const COLS = 9;
const ROWS = 5;
const tiles = [
  { col: 0, row: 0 },
  { col: 0, row: 1 },
  { col: 0, row: 2 },
  { col: 0, row: 3 },
];

// A display-object stand-in: any method chains, properties set on it stay readable.
function shape() {
  const obj = {};
  const chain = new Proxy(obj, {
    get: (target, key) =>
      key in target ? target[key] : key === 'destroy' ? () => {} : () => chain,
  });
  return chain;
}

function unit(name, faction, col, row, extra = {}) {
  return {
    name,
    faction,
    col,
    row,
    moveType: 'Infantry',
    mov: 3,
    stats: { MOV: 3, HP: 20 },
    currentHP: 20,
    weapon: { name: 'Iron Sword', type: 'Sword', range: '1' },
    graphic: { setVisible() {}, setTint() {}, clearTint() {} },
    ...extra,
  };
}

function setup({
  fog = false,
  state = 'DEPLOY_POSITIONING',
  isMobileInput = true,
  ballistas = [],
} = {}) {
  const map = Array.from({ length: ROWS }, () => Array(COLS).fill(PLAIN));
  for (const b of ballistas) map[b.row][b.col] = TERRAIN.Ballista;
  const painted = [];
  const scene = {
    _battleSession: 1,
    gameData,
    battleState: state,
    isMobileInput,
    playerUnits: [],
    ballistas: ballistas.map((b) => ({ ...b })),
    infoText: {
      text: '',
      setText(t) {
        this.text = t;
      },
    },
    enemyUnits: [
      unit('Brigand', 'enemy', 6, 2),
      unit('Archer', 'enemy', 8, 4, {
        weapon: { name: 'Iron Bow', type: 'Bow', range: '2' },
        mov: 2,
        stats: { MOV: 2, HP: 20 },
      }),
    ],
    npcUnits: [],
    add: {
      rectangle: (x, y, w, h, color) => {
        const r = shape();
        r.color = color;
        r.x = x;
        r.y = y;
        painted.push(r);
        return r;
      },
      text: shape,
    },
    inspectionPanel: {
      visible: false,
      _unit: null,
      show(u) {
        this.visible = true;
        this._unit = u;
      },
      hide() {
        this.visible = false;
        this._unit = null;
      },
    },
    isStoryInputLocked: () => false,
    requestCancel: vi.fn(() => true),
    refreshEndTurnControl: vi.fn(),
    updateUnitPosition: () => {},
    _getCostModifier: () => 0,
    calculateDangerZone: () => [],
    _battleCamera: { screenToWorld: (x, y) => ({ x, y }) },
  };
  scene.getUnitAt = BattleScene.prototype.getUnitAt.bind(scene);
  scene.buildUnitPositionMap = BattleScene.prototype.buildUnitPositionMap.bind(scene);
  // The grid draws through the scene's own `add`, so its highlights land in `painted`.
  scene.grid = new Grid(
    {
      cameras: { main: { width: 640, height: 480 } },
      add: { ...scene.add, image: shape, container: shape },
      textures: { exists: () => false },
    },
    COLS,
    ROWS,
    gameData.terrain,
    map,
    fog,
  );
  const input = new InputController(scene);
  scene._inputController = input;
  scene.clearInspectionVisuals = () => input.clearInspectionVisuals();
  const c = new FormationController(scene);
  c.units = [
    unit('Edric', 'player', 0, 0),
    unit('Sera', 'player', 0, 1),
    unit('Rowan', 'player', 0, 2),
  ];
  c.tiles = tiles;
  c.leniency = c.units.map(() => 'strict');
  c.rules = { issue: () => '' };
  c.formation = createFormation(c.units.length, tiles);
  c.defaultTiles = c.units.map((u) => ({ col: u.col, row: u.row }));
  c.active = true;
  c.ready = true;
  scene._formation = c;
  return { c, scene, input, painted };
}

const key = ({ col, row }) => `${col},${row}`;
const manhattan = (a, b) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
const everyTile = () =>
  Array.from({ length: COLS * ROWS }, (_, i) => ({ col: i % COLS, row: Math.floor(i / COLS) }));

/** The tiles the grid's highlight layers hold, read back from their pixel positions. */
function litTiles(scene) {
  const g = scene.grid;
  const at = new Map(
    everyTile().map((t) => [
      `${g.gridToPixel(t.col, t.row).x},${g.gridToPixel(t.col, t.row).y}`,
      t,
    ]),
  );
  const read = (list) =>
    list
      .map((h) => at.get(`${h.x},${h.y}`))
      .filter(Boolean)
      .map(key)
      .sort();
  return { move: read(g.highlightTiles), attack: read(g.attackHighlightTiles) };
}

/** Independent expectation on an open plain map with nothing in the way. */
function expectedReach(foe, mov, strike) {
  const move = everyTile().filter((t) => manhattan(t, foe) <= mov && manhattan(t, foe) > 0);
  const attack = everyTile().filter((t) => {
    const d = Math.min(...move.concat([foe]).map((m) => manhattan(m, t)));
    return d <= strike && manhattan(t, foe) > mov;
  });
  return { move: move.map(key).sort(), attack: attack.map(key).sort() };
}

describe('Formation: tapping a foe shows its reach', () => {
  it('draws the foe’s move and attack tiles, with its panel', () => {
    const { c, scene } = setup();
    const foe = scene.enemyUnits[0];
    c.handleTileTap({ col: foe.col, row: foe.row });
    expect(scene.inspectionPanel._unit).toBe(foe);
    const lit = litTiles(scene);
    const want = expectedReach(foe, 3, 1);
    expect(lit.move).toEqual(want.move);
    expect(lit.attack).toEqual(want.attack);
  });

  it('a ranged foe’s attack ring is its own', () => {
    const { c, scene } = setup();
    const archer = scene.enemyUnits[1];
    c.handleTileTap({ col: archer.col, row: archer.row });
    const lit = litTiles(scene);
    const want = expectedReach(archer, 2, 2);
    expect(lit.move).toEqual(want.move);
    expect(lit.attack).toEqual(want.attack);
    expect(lit.attack.length).toBeGreaterThan(0);
  });

  it('does not inspect a foe the fog hides', () => {
    const { c, scene } = setup({ fog: true });
    // The formation tiles see three tiles around them: the Brigand (col 6) is far outside.
    scene.grid.updateFogOfWar(tiles.map((t) => ({ ...t, moveType: 'Infantry' })));
    const foe = scene.enemyUnits[0];
    c.handleTileTap({ col: foe.col, row: foe.row });
    expect(scene.inspectionPanel.visible).toBe(false);
    expect(litTiles(scene)).toEqual({ move: [], attack: [] });
    // And a foe in view is inspected in the same fog.
    foe.col = 3;
    foe.row = 1;
    c.handleTileTap({ col: 3, row: 1 });
    expect(scene.inspectionPanel._unit).toBe(foe);
    expect(litTiles(scene).move.length).toBeGreaterThan(0);
  });

  it('tapping the foe again, or bare terrain, clears it', () => {
    const { c, scene } = setup();
    const foe = scene.enemyUnits[0];
    c.handleTileTap({ col: foe.col, row: foe.row });
    c.handleTileTap({ col: foe.col, row: foe.row });
    expect(scene.inspectionPanel.visible).toBe(false);
    expect(litTiles(scene)).toEqual({ move: [], attack: [] });
    c.handleTileTap({ col: foe.col, row: foe.row });
    expect(litTiles(scene).move.length).toBeGreaterThan(0);
    c.handleTileTap({ col: 4, row: 4 });
    expect(scene.inspectionPanel.visible).toBe(false);
    expect(litTiles(scene)).toEqual({ move: [], attack: [] });
  });

  it('picking up a unit, setting one down or auto-placing clears it', () => {
    const { c, scene } = setup();
    const foe = scene.enemyUnits[0];
    c.assign(0, 0);
    c.handleTileTap({ col: foe.col, row: foe.row });
    expect(litTiles(scene).move.length).toBeGreaterThan(0);
    c.handleTileTap(tiles[0]); // the placed Edric is picked up
    expect(c.heldUnit?.name).toBe('Edric');
    expect(scene.inspectionPanel.visible).toBe(false);
    expect(litTiles(scene)).toEqual({ move: [], attack: [] });

    c.handleTileTap({ col: foe.col, row: foe.row });
    expect(litTiles(scene).move.length).toBeGreaterThan(0);
    c.holdUnit(c.units[1]); // a waiting unit's chip
    expect(litTiles(scene)).toEqual({ move: [], attack: [] });

    c.handleTileTap({ col: foe.col, row: foe.row });
    c.autoPlace();
    expect(scene.inspectionPanel.visible).toBe(false);
    expect(litTiles(scene)).toEqual({ move: [], attack: [] });
  });

  it('keeps the unit in hand while a foe is inspected, and its own reach drawn', () => {
    const { c, scene, painted } = setup();
    c.assign(0, 0);
    c.handleTileTap(tiles[0]);
    const held = c.heldUnit;
    expect(held?.name).toBe('Edric');
    const before = painted.length;
    const foe = scene.enemyUnits[0];
    c.handleTileTap({ col: foe.col, row: foe.row });
    expect(c.heldUnit).toBe(held);
    expect(scene.inspectionPanel._unit).toBe(foe);
    expect(litTiles(scene).move.length).toBeGreaterThan(0);
    // The formation's own markers (spawn tiles and the held unit's reach) were drawn
    // before the look and are not redrawn away by it.
    expect(before).toBeGreaterThan(0);
    expect(c.markers.length).toBeGreaterThan(0);
    // Setting the held unit down still works, and ends the look.
    c.handleTileTap(tiles[1]);
    expect(c.heldUnit).toBe(null);
    expect(c.formation.at[0]).toBe(1);
    expect(litTiles(scene)).toEqual({ move: [], attack: [] });
  });

  it('Start battle leaves no foe range behind', () => {
    const { c, scene } = setup();
    c.autoPlace();
    const foe = scene.enemyUnits[0];
    c.handleTileTap({ col: foe.col, row: foe.row });
    expect(litTiles(scene).move.length).toBeGreaterThan(0);
    expect(c.start()).toBe(true);
    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(scene.inspectionPanel.visible).toBe(false);
    expect(litTiles(scene)).toEqual({ move: [], attack: [] });
  });

  it('a desktop right click inspects a foe and leaves the unit in hand', () => {
    const { c, scene, input } = setup({ isMobileInput: false });
    c.assign(0, 0);
    c.handleTileTap(tiles[0]);
    const held = c.heldUnit;
    const foe = scene.enemyUnits[0];
    const { x, y } = scene.grid.gridToPixel(foe.col, foe.row);
    input.onRightClick({ x, y });
    expect(scene.inspectionPanel._unit).toBe(foe);
    expect(litTiles(scene).move.length).toBeGreaterThan(0);
    expect(scene.requestCancel).not.toHaveBeenCalled();
    expect(c.heldUnit).toBe(held);
    // Right click on bare terrain keeps its meaning (Back).
    scene.inspectionPanel.hide();
    const bare = scene.grid.gridToPixel(4, 4);
    input.onRightClick({ x: bare.x, y: bare.y });
    expect(scene.requestCancel).toHaveBeenCalledTimes(1);
  });

  it('a placed ally is not given a foe’s range by a long press', () => {
    const { c, scene, input } = setup();
    c.assign(0, 0);
    const ally = c.units[0];
    scene.playerUnits.push(ally);
    const { x, y } = scene.grid.gridToPixel(ally.col, ally.row);
    expect(input._showInspectionAtPixel(x, y)).toBe(true);
    expect(scene.inspectionPanel._unit).toBe(ally);
    expect(litTiles(scene)).toEqual({ move: [], attack: [] });
  });
});

describe('The player phase still draws the same reach', () => {
  it('PLAYER_IDLE shows the foe’s move and attack tiles, as before', () => {
    const { scene, input } = setup({ state: 'PLAYER_IDLE' });
    const foe = scene.enemyUnits[0];
    const { x, y } = scene.grid.gridToPixel(foe.col, foe.row);
    expect(input._showInspectionAtPixel(x, y)).toBe(true);
    const want = expectedReach(foe, 3, 1);
    expect(litTiles(scene)).toEqual({ move: want.move, attack: want.attack });
  });

  it('other states still draw no reach for an inspected foe', () => {
    const { scene, input } = setup({ state: 'UNIT_ACTION_MENU' });
    const foe = scene.enemyUnits[0];
    const { x, y } = scene.grid.gridToPixel(foe.col, foe.row);
    input._showInspectionAtPixel(x, y);
    expect(litTiles(scene)).toEqual({ move: [], attack: [] });
  });
});

describe('The purple Danger outline is explained to the player', () => {
  const text = (lines) => lines.map((l) => l.text).join(' ');

  it('the status-staff help page and the Danger line of the guide both name it', () => {
    const staves = HELP_TABS.find((t) => t.label === 'Combat').pages.find(
      (p) => p.title === 'Status Countermeasures',
    );
    expect(text(staves.lines)).toMatch(/purple outline/i);
    const basics = HOW_TO_PLAY_PAGES.find((p) => p.title === 'Combat Basics');
    expect(text(basics.lines)).toMatch(/purple edge: status staff/i);
  });
});

describe('A ballista is tapped like a foe', () => {
  const enemyBallista = { col: 6, row: 0, owner: 'enemy', range: 4 };
  // Independent expectation: every tile 1..range away (Manhattan) on the map.
  const reachOf = (b) =>
    everyTile()
      .filter((t) => manhattan(t, b) >= 1 && manhattan(t, b) <= b.range)
      .map(key)
      .sort();
  const tap = (c, b) => c.handleTileTap({ col: b.col, row: b.row });

  it('a tap in Formation draws its reach and reads its details; a second tap clears it', () => {
    const { c, scene, input } = setup({ ballistas: [enemyBallista] });
    tap(c, enemyBallista);
    input.refreshTileInfo(6, 0); // what a tap's onClick does first on a phone
    expect(litTiles(scene).attack).toEqual(reachOf(enemyBallista));
    expect(input._ballistaRangeShown).toBe(true);
    expect(scene.infoText.text).toContain('Enemy ballista · Range 1-4');
    expect(scene.infoText.text).toContain('Mt 10 vs RES · Hit 85');
    expect(scene.infoText.text).toContain('Fires at your nearest unit each enemy phase.');
    tap(c, enemyBallista);
    expect(litTiles(scene)).toEqual({ move: [], attack: [] });
    expect(input._ballistaRangeShown).toBe(false);
  });

  it('a tap elsewhere, a formation tile or a unit’s chip clears it', () => {
    const { c, scene, input } = setup({ ballistas: [enemyBallista] });
    c.assign(0, 0);
    tap(c, enemyBallista);
    c.handleTileTap({ col: 4, row: 4 });
    expect(litTiles(scene)).toEqual({ move: [], attack: [] });
    expect(input._ballistaRangeShown).toBe(false);
    tap(c, enemyBallista);
    c.handleTileTap(tiles[0]);
    expect(litTiles(scene).attack).toEqual([]);
    expect(input._ballistaRangeShown).toBe(false);
    tap(c, enemyBallista);
    c.holdUnit(c.units[1]);
    expect(litTiles(scene).attack).toEqual([]);
  });

  it('a different ballista or foe replaces the look', () => {
    const second = { col: 2, row: 4, owner: 'enemy', range: 3 };
    const { c, scene } = setup({ ballistas: [enemyBallista, second] });
    tap(c, enemyBallista);
    tap(c, second);
    expect(litTiles(scene).attack).toEqual(reachOf(second));
    const foe = scene.enemyUnits[0];
    c.handleTileTap({ col: foe.col, row: foe.row });
    expect(scene.inspectionPanel._unit).toBe(foe);
    expect(litTiles(scene).attack).not.toEqual(reachOf(second));
  });

  it('reads the same in the player phase, on any input', () => {
    for (const isMobileInput of [true, false]) {
      const { scene, input } = setup({
        state: 'PLAYER_IDLE',
        isMobileInput,
        ballistas: [enemyBallista],
      });
      input.handleIdleClick({ col: 6, row: 0 });
      expect(litTiles(scene).attack).toEqual(reachOf(enemyBallista));
      input.handleIdleClick({ col: 6, row: 0 });
      expect(litTiles(scene)).toEqual({ move: [], attack: [] });
    }
  });

  it('a long press still shows it', () => {
    const { scene, input } = setup({ ballistas: [enemyBallista] });
    const { x, y } = scene.grid.gridToPixel(6, 0);
    expect(input._showInspectionAtPixel(x, y)).toBe(true);
    expect(litTiles(scene).attack).toEqual(reachOf(enemyBallista));
  });

  it('a captured ballista reads as yours and draws no threat range', () => {
    const mine = { ...enemyBallista, owner: 'player', captured: true };
    const { c, scene, input } = setup({ ballistas: [mine] });
    tap(c, mine);
    input.refreshTileInfo(6, 0);
    expect(litTiles(scene)).toEqual({ move: [], attack: [] });
    expect(input._ballistaRangeShown).toBeFalsy();
    expect(scene.infoText.text).toContain('Your ballista · Range 1-4');
    expect(scene.infoText.text).toContain('Fires at the nearest foe each player turn.');
  });

  it('the fog hides a ballista: no range, no details', () => {
    const { c, scene, input } = setup({ fog: true, ballistas: [enemyBallista] });
    scene.grid.updateFogOfWar(tiles.map((t) => ({ ...t, moveType: 'Infantry' })));
    tap(c, enemyBallista);
    input.refreshTileInfo(6, 0);
    expect(litTiles(scene)).toEqual({ move: [], attack: [] });
    expect(input._ballistaRangeShown).toBeFalsy();
    // (the tile's own terrain rule, "Ballista", is map knowledge; what holds it is not)
    expect(scene.infoText.text).not.toMatch(/Enemy ballista|Your ballista|Range 1-/);
    // The same ballista in view is read.
    scene.grid.updateFogOfWar([{ col: 5, row: 0, moveType: 'Infantry' }]);
    tap(c, enemyBallista);
    expect(litTiles(scene).attack).toEqual(reachOf(enemyBallista));
  });
});
