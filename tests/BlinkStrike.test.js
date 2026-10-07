// Blink Strike (docs/specs/phase3.md 3E): warp next to a seen foe within 4 tiles, then attack
// it, as one action. The rules (engine/ActionAbilitySystem), the player's choices (destination,
// foe, forecast from the destination, Cancel at every step) and the hand-off to the ordinary
// attack. The attack's own durable boundary (one checkpoint, resume, rewind, Canto) is in
// tests/BlinkStrikeBattle.test.js.
//
// Ways this goes wrong, each caught below:
//   rules      a destination the weapon cannot strike from; a bow user offered adjacent tiles; a
//              tile beyond 4, a wall, a unit, a fogged tile; a foe the player cannot see; a
//              weapon that cannot attack (silence, a staff, no uses) still offered
//   knowledge  a unit the fog hides changing what is offered (two worlds that differ only by
//              it must give identical choices)
//   forecast   a forecast read from where the unit STANDS rather than where it will land; one
//              that lets the player swap weapons or use an art; the unit left displaced
//   cancel     any step leaving something moved, spent, highlighted or equipped
//   confirm    the warp not settled before the attack starts; the use not spent; a stale pair
//              (the foe fell, the weapon broke) accepted; a hidden occupant letting the unit land
//              on another, or not spending the use
// Expected values are worked out by hand from the spec and the data files.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/HintDisplay.js', () => ({
  showImportantHint: vi.fn(async () => {}),
  showMinorHint: vi.fn(),
  showContextualHint: vi.fn(),
  claimContextualHint: vi.fn(() => false),
  observeContextualHint: vi.fn(() => () => {}),
  isHintTextVisible: vi.fn(() => false),
}));
const renders = [];
vi.mock('../src/ui/ForecastOverlay.js', () => ({
  ForecastOverlay: class {
    constructor(scene) {
      this.scene = scene;
      this.displayObjects = [];
      this.destroyed = false;
    }
    render(config) {
      renders.push(config);
    }
    destroy() {
      this.destroyed = true;
    }
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { AbilityController } from '../src/ui/AbilityController.js';
import {
  abilityHasTargets,
  canUseAbility,
  findWarpStrikeOptions,
  getActionAbilities,
  markUsed,
  planWarpStrike,
  settleWarpStrike,
} from '../src/engine/ActionAbilitySystem.js';
import { seenTileOccupant } from '../src/engine/BattleInformation.js';
import { getFootprintKeys, isEntity } from '../src/engine/EntitySystem.js';
import { applyCondition } from '../src/engine/StatusConditionSystem.js';
import { UI_HEX } from '../src/utils/uiStyles.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const SKILL = data.skills.find((s) => s.id === 'blink_strike');
const ABILITY = SKILL.actionAbility;
const weapon = (name, uid) => ({
  ...structuredClone(data.weapons.find((w) => w.name === name)),
  uid,
});
const terrainNamed = (name) => data.terrain.find((t) => t.name === name);

function unit(name, faction, col, row, inventory, extra = {}) {
  return {
    name,
    faction,
    col,
    row,
    className: faction === 'player' ? 'Lord' : 'Fighter',
    level: 5,
    skills: faction === 'player' ? ['blink_strike'] : [],
    affixes: [],
    _conditions: [],
    stats: { HP: 22, STR: 7, MAG: 3, SKL: 7, SPD: 8, DEF: 5, RES: 2, LCK: 5, MOV: 5 },
    currentHP: 22,
    mov: 5,
    moveType: 'Infantry',
    proficiencies: [
      { type: 'Sword', rank: 'Prof' },
      { type: 'Bow', rank: 'Prof' },
      { type: 'Tome', rank: 'Prof' },
    ],
    weaponRank: 'Prof',
    inventory,
    weapon: inventory[0] || null,
    consumables: [],
    ...extra,
  };
}

// --- The rules, on a bare board -------------------------------------------------------------

function bareGrid({ cols = 14, rows = 14, blocked = new Set(), fog = null } = {}) {
  return {
    cols,
    rows,
    fogEnabled: Boolean(fog),
    isVisible: (col, row) => !fog || !fog.has(`${col},${row}`),
    getMoveCost: (col, row) => (blocked.has(`${col},${row}`) ? Infinity : 1),
  };
}
const occupantsAt =
  (...units) =>
  (col, row) =>
    units.find((u) =>
      isEntity(u) ? getFootprintKeys(u).includes(`${col},${row}`) : u.col === col && u.row === row,
    ) || null;
const tilesOf = (options) => options.map((o) => `${o.col},${o.row}`);
const find = (user, grid, units, enemies, extra = {}) =>
  findWarpStrikeOptions(user, ABILITY, {
    grid,
    getUnitAt: seenTileOccupant(grid, occupantsAt(...units)),
    enemies,
    skillsData: data.skills,
    ...extra,
  });

describe('which tiles Blink Strike offers', () => {
  const sword = () => [weapon('Iron Sword', 'sw')];

  it('a melee weapon: only free tiles beside a foe, within 4 tiles of the user', () => {
    const user = unit('Edric', 'player', 5, 5, sword());
    const near = unit('Near', 'enemy', 9, 5, []); // 4 away: its west neighbour (8,5) is 3 away
    const north = unit('North', 'enemy', 5, 2, []); // 3 away: neighbours (5,3) 2, (4,2) 4, (6,2) 4, (5,1) 4
    const grid = bareGrid();
    const options = find(user, grid, [user, near, north], [near, north]);
    // Hand-counted (see the spec's diamond): (9,4), (9,6) and (10,5) are 5 away, so out.
    expect(tilesOf(options)).toEqual(['5,1', '4,2', '6,2', '5,3', '8,5']);
    expect(options.map((o) => o.targets.map((t) => t.name))).toEqual([
      ['North'],
      ['North'],
      ['North'],
      ['North'],
      ['Near'],
    ]);
  });

  it('a foe further than 4 + reach cannot be struck at all', () => {
    const user = unit('Edric', 'player', 5, 5, sword());
    const far = unit('Far', 'enemy', 11, 5, []); // its nearest neighbour (10,5) is 5 away
    expect(find(user, bareGrid(), [user, far], [far])).toEqual([]);
    expect(
      abilityHasTargets(user, SKILL, {
        grid: bareGrid(),
        getUnitAt: occupantsAt(user, far),
        enemies: [far],
        skillsData: data.skills,
      }),
    ).toBe(false);
  });

  it('a bow user sees only the tiles its weapon reaches: two away, never adjacent', () => {
    const user = unit('Wil', 'player', 5, 5, [weapon('Iron Bow', 'bow')]);
    const foe = unit('Foe', 'enemy', 9, 5, []);
    const options = find(user, bareGrid(), [user, foe], [foe]);
    // Exactly 2 from the foe and within 4 of the user: (8,4) and (8,6) are 4 away, (7,5) is 2.
    expect(tilesOf(options)).toEqual(['8,4', '7,5', '8,6']);
    expect(tilesOf(options)).not.toContain('8,5'); // adjacent: a bow cannot fire at 1
  });

  it('a tome (range 1–2) is offered both rings; Foresight adds a third', () => {
    const user = unit('Mage', 'player', 5, 5, [weapon('Fire', 'fire')]);
    const foe = unit('Foe', 'enemy', 9, 5, []);
    expect(tilesOf(find(user, bareGrid(), [user, foe], [foe]))).toEqual([
      '8,4',
      '7,5',
      '8,5',
      '8,6',
    ]);
    user.skills = ['blink_strike', 'foresight'];
    const withForesight = tilesOf(find(user, bareGrid(), [user, foe], [foe]));
    // Range 1–3: the ring three from the foe joins, where the user can still reach it: (6,5),
    // (7,4) and (7,6). (8,3) and (8,7) would be five tiles from the user.
    expect(withForesight).toEqual(['7,4', '8,4', '6,5', '7,5', '8,5', '7,6', '8,6']);
  });

  it('a unit, a wall, or the foe’s own tile is never a destination', () => {
    const user = unit('Edric', 'player', 5, 5, sword());
    const foe = unit('Foe', 'enemy', 8, 5, []);
    const ally = unit('Ally', 'player', 7, 5, []);
    const grid = bareGrid({ blocked: new Set(['8,4']) });
    // Neighbours of (8,5): (7,5) ally, (9,5) 4 away and free, (8,4) wall, (8,6) 4 away and free.
    expect(tilesOf(find(user, grid, [user, foe, ally], [foe]))).toEqual(['9,5', '8,6']);
  });

  it('the Entity: tiles beside any of its nine', () => {
    const user = unit('Edric', 'player', 5, 5, sword());
    const entity = unit('Entity', 'enemy', 8, 4, [], { isEntity: true }); // covers 8–10 × 4–6
    const options = find(user, bareGrid(), [user, entity], [entity]);
    expect(tilesOf(options)).toEqual(['7,4', '7,5', '7,6']);
  });

  it('only a foe the player sees is a target', () => {
    const user = unit('Edric', 'player', 5, 5, sword());
    const unseen = unit('Unseen', 'enemy', 8, 5, []);
    expect(find(user, bareGrid(), [user, unseen], [])).toEqual([]);
  });

  it('a fogged tile counts as taken: never offered, free or not', () => {
    const user = unit('Edric', 'player', 5, 5, sword());
    const foe = unit('Foe', 'enemy', 8, 5, []);
    const grid = bareGrid({ fog: new Set(['7,5', '8,6']) });
    // (8,5)'s neighbours: (7,5) fogged, (9,5) free, (8,4) free, (8,6) fogged.
    expect(tilesOf(find(user, grid, [user, foe], [foe]))).toEqual(['8,4', '9,5']);
  });

  it('two worlds that differ only by a hidden unit offer exactly the same choices', () => {
    const grid = () => bareGrid({ fog: new Set(['7,5', '9,5']) });
    const run = (withHidden) => {
      const user = unit('Edric', 'player', 5, 5, sword());
      const foe = unit('Foe', 'enemy', 8, 5, []);
      const lurker = unit('Lurker', 'enemy', 9, 5, []); // fogged, hidden
      const real = withHidden ? [user, foe, lurker] : [user, foe];
      const seen = [foe]; // what the player sees, either way
      return tilesOf(
        findWarpStrikeOptions(user, ABILITY, {
          grid: grid(),
          getUnitAt: seenTileOccupant(grid(), occupantsAt(...real)),
          enemies: seen,
          skillsData: data.skills,
        }),
      );
    };
    expect(run(true)).toEqual(run(false));
    expect(run(false)).toEqual(['8,4', '8,6']);
  });

  it('nothing is offered with no weapon, a staff, a silenced mage’s tome, or a spent per-battle weapon', () => {
    const foe = unit('Foe', 'enemy', 8, 5, []);
    const make = (inventory, extra = {}) => unit('U', 'player', 5, 5, inventory, extra);
    expect(find(make([]), bareGrid(), [foe], [foe])).toEqual([]);
    expect(find(make([weapon('Heal', 'h')]), bareGrid(), [foe], [foe])).toEqual([]);
    const mage = make([weapon('Fire', 'f')]);
    expect(find(mage, bareGrid(), [mage, foe], [foe]).length).toBeGreaterThan(0);
    applyCondition(mage, 'silence', 2);
    expect(find(mage, bareGrid(), [mage, foe], [foe])).toEqual([]);
    // Silence also stops the ability itself (Blink Strike is no bodily act).
    expect(canUseAbility(mage, SKILL)).toEqual({ ok: false, reason: 'silenced' });
  });

  it('rooted does not matter: the warp is not a walk', () => {
    const user = unit('Edric', 'player', 5, 5, sword());
    applyCondition(user, 'root', 2);
    const foe = unit('Foe', 'enemy', 8, 5, []);
    expect(find(user, bareGrid(), [user, foe], [foe]).length).toBeGreaterThan(0);
    expect(canUseAbility(user, SKILL).ok).toBe(true);
  });

  it('once per battle, and the limit belongs to the user', () => {
    const a = unit('A', 'player', 5, 5, sword());
    const b = unit('B', 'player', 1, 1, sword());
    markUsed(a, 'blink_strike');
    expect(canUseAbility(a, SKILL)).toEqual({ ok: false, reason: 'per_map_limit' });
    expect(canUseAbility(b, SKILL).ok).toBe(true);
  });
});

describe('validating the pair (planWarpStrike) and settling the warp', () => {
  const setup = () => {
    const user = unit('Edric', 'player', 5, 5, [weapon('Iron Sword', 'sw')]);
    const foe = unit('Foe', 'enemy', 8, 5, []);
    const other = unit('Other', 'enemy', 5, 2, []);
    const ctx = () => ({
      grid: bareGrid(),
      getUnitAt: occupantsAt(user, foe, other),
      enemies: [foe, other].filter((u) => u.currentHP > 0),
      skillsData: data.skills,
    });
    return { user, foe, other, ctx };
  };

  it('accepts what was offered, and nothing else', () => {
    const { user, foe, other, ctx } = setup();
    const plan = planWarpStrike(user, ABILITY, { col: 7, row: 5 }, foe, ctx());
    expect(plan).toMatchObject({
      ok: true,
      from: { col: 5, row: 5 },
      destination: { col: 7, row: 5 },
      distance: 1,
    });
    expect(plan.target).toBe(foe);
    // A tile that reaches nobody, a tile beyond 4, the wrong foe for that tile.
    expect(planWarpStrike(user, ABILITY, { col: 6, row: 5 }, foe, ctx())).toEqual({
      ok: false,
      reason: 'bad_destination',
    });
    expect(planWarpStrike(user, ABILITY, { col: 5, row: 13 }, foe, ctx()).ok).toBe(false);
    expect(planWarpStrike(user, ABILITY, { col: 7, row: 5 }, other, ctx())).toEqual({
      ok: false,
      reason: 'bad_target',
    });
    expect(planWarpStrike(user, ABILITY, { col: 7, row: 5 }, null, ctx()).ok).toBe(false);
  });

  it('is refused when the board changed: a foe fell, the weapon is gone, a unit took the tile', () => {
    const { user, foe, ctx } = setup();
    foe.currentHP = 0;
    expect(planWarpStrike(user, ABILITY, { col: 7, row: 5 }, foe, ctx()).ok).toBe(false);
    foe.currentHP = 22;
    const equipped = user.weapon;
    user.weapon = null;
    expect(planWarpStrike(user, ABILITY, { col: 7, row: 5 }, foe, ctx()).ok).toBe(false);
    user.weapon = equipped;
    const taken = { ...ctx(), getUnitAt: occupantsAt(user, foe, unit('Ally', 'player', 7, 5, [])) };
    expect(planWarpStrike(user, ABILITY, { col: 7, row: 5 }, foe, taken).ok).toBe(false);
  });

  it('the settled warp moves the unit, spends the use, and moves nobody else', () => {
    const { user, foe, ctx } = setup();
    const plan = planWarpStrike(user, ABILITY, { col: 7, row: 5 }, foe, ctx());
    const facts = settleWarpStrike(user, SKILL, plan, { occupantAt: occupantsAt(user, foe) });
    expect(facts).toMatchObject({ warped: true, usage: 1, blocker: null });
    expect([user.col, user.row]).toEqual([7, 5]);
    expect(facts.moves).toEqual([{ unit: user, from: { col: 5, row: 5 }, to: { col: 7, row: 5 } }]);
    expect([foe.col, foe.row]).toEqual([8, 5]);
    expect(user._battleAbilityUsage.map.blink_strike).toBe(1);
  });

  it('a unit only the real board knows on the destination: the warp fails, the use is spent, the unit stays', () => {
    const { user, foe, ctx } = setup();
    const plan = planWarpStrike(user, ABILITY, { col: 7, row: 5 }, foe, ctx());
    expect(plan.ok).toBe(true);
    const ghost = unit('Ghost', 'enemy', 7, 5, []);
    const facts = settleWarpStrike(user, SKILL, plan, {
      occupantAt: occupantsAt(user, foe, ghost),
    });
    expect(facts).toMatchObject({ warped: false, moves: [], usage: 1 });
    expect(facts.blocker).toBe(ghost);
    expect([user.col, user.row]).toEqual([5, 5]);
    expect(canUseAbility(user, SKILL)).toEqual({ ok: false, reason: 'per_map_limit' });
  });
});

// --- The choices, through the scene ------------------------------------------------------

function makeScene({ fog = null, destinationTerrain = null } = {}) {
  const iron = weapon('Iron Sword', 'iron');
  const hero = unit('Edric', 'player', 5, 5, [iron]);
  hero.battleEntityId = 'u1';
  const foe = unit('Fighter', 'enemy', 9, 5, [weapon('Iron Axe', 'axe')]);
  foe.battleEntityId = 'u2';
  const second = unit('Archer', 'enemy', 5, 2, [weapon('Iron Bow', 'ebow')]);
  second.battleEntityId = 'u3';
  const far = unit('Knight', 'enemy', 13, 13, [weapon('Iron Lance', 'lance')]);
  far.battleEntityId = 'u4';
  const plain = terrainNamed('Plain');
  const scene = Object.create(BattleScene.prototype);
  Object.assign(scene, {
    _battleSession: 1,
    gameData: data,
    battleParams: {},
    battleConfig: {},
    runManager: null,
    turnManager: { currentPhase: 'player', turnNumber: 1 },
    playerUnits: [hero],
    enemyUnits: [foe, second, far],
    npcUnits: [],
    selectedUnit: hero,
    battleState: 'UNIT_ACTION_MENU',
    attackTargets: [],
    _battleRewindPolicy: 'fixed-v1',
    visionBaseSeed: 7,
    grid: {
      fogEnabled: Boolean(fog),
      cols: 16,
      rows: 16,
      isVisible: (col, row) => !fog || !fog.has(`${col},${row}`),
      getMoveCost: () => 1,
      getTerrainAt: (col, row) => {
        const special = destinationTerrain?.(col, row);
        return special || plain;
      },
      clearAttackHighlights: vi.fn(),
      clearHighlights: vi.fn(),
      showAttackRange: vi.fn(),
      showRelocateGuide: vi.fn(),
      gridToPixel: (c, r) => ({ x: c * 32 + 16, y: r * 32 + 16 }),
    },
    registry: { get: () => null },
    _gridCursor: { snapTo: vi.fn() },
    _pinToScreen: vi.fn(),
    hideActionMenu: vi.fn(),
    showActionMenu: vi.fn(function (u) {
      this._selectedWeaponArt = null;
      this.battleState = 'UNIT_ACTION_MENU';
      this.selectedUnit = u;
    }),
    isStoryInputLocked: () => false,
    commitVisionSnapshotIfPending: vi.fn(),
    executeCombat: vi.fn(async () => {}),
    refreshEndTurnControl: vi.fn(),
    _reduceMotion: () => true,
  });
  scene._abilityController = new AbilityController(scene);
  return { scene, hero, iron, foe, second, far };
}

let random;
beforeEach(() => {
  renders.length = 0;
  random = vi.spyOn(Math, 'random');
});
afterEach(() => random.mockRestore());

/** Everything a cancelled flow must leave exactly as it found it. */
const snapshot = (scene) =>
  structuredClone({
    units: [...scene.playerUnits, ...scene.enemyUnits].map((u) => ({
      name: u.name,
      col: u.col,
      row: u.row,
      hp: u.currentHP,
      weapon: u.weapon?.uid,
      inventory: u.inventory.map((w) => w.uid),
      usage: u._battleAbilityUsage || null,
      hasActed: u.hasActed ?? false,
      hasMoved: u.hasMoved ?? false,
    })),
  });

const flow = (scene) => scene._abilityController._warpStrike();
const tapDestination = (scene, col, row) => scene.handleAbilityTileClick({ col, row });

describe('the Ability menu', () => {
  it('lists Blink Strike with its use and what it does, and greys it with no foe in reach', () => {
    const { scene, hero, foe, second, far } = makeScene();
    const ctrl = scene._abilityController;
    expect(getActionAbilities(hero, data.skills).map((s) => s.id)).toEqual(['blink_strike']);
    let [entry] = ctrl._getAbilityEntries(hero);
    expect(entry).toMatchObject({ canUse: true, hasTargets: true });
    expect(ctrl._statusLine(hero, entry)).toBe('1/1 uses left · Ends unit action');
    scene.enemyUnits = [far];
    [entry] = ctrl._getAbilityEntries(hero);
    expect(ctrl._statusLine(hero, entry)).toBe('1/1 uses left · No valid targets');
    markUsed(hero, 'blink_strike');
    scene.enemyUnits = [foe, second];
    [entry] = ctrl._getAbilityEntries(hero);
    expect(ctrl._statusLine(hero, entry)).toBe('0/1 uses left · Used this battle');
  });

  it('a Blink Strike an accessory lends is listed and works exactly as a known one', () => {
    const { scene, hero } = makeScene();
    const known = scene._abilityController._getAbilityEntries(hero);
    hero.skills = [];
    hero.accessory = { name: 'Speed Ring', _boundSkill: 'blink_strike' };
    const lent = scene._abilityController._getAbilityEntries(hero);
    expect(lent).toEqual(known);
    flow(scene).begin(hero, SKILL);
    expect(scene.abilityTiles.length).toBeGreaterThan(0);
  });
});

describe('step 1: the destination', () => {
  it('highlights every destination and waits for a tap on one', () => {
    const { scene, hero } = makeScene();
    expect(flow(scene).begin(hero, SKILL)).toBe(true);
    expect(scene.battleState).toBe('SELECTING_ABILITY_TILE');
    // Archer at (5,2): (5,3) 2 away, (4,2) 4, (6,2) 4, (5,1) 4; Fighter at (9,5): (8,5) 3.
    const tiles = scene.abilityTiles.map((t) => `${t.col},${t.row}`);
    expect(tiles).toEqual(['5,1', '4,2', '6,2', '5,3', '8,5']);
    expect(scene._pendingAbility).toEqual({ unitName: 'Edric', skillId: 'blink_strike', step: 'destination' }); // prettier-ignore
    const [shown, color] = scene.grid.showAttackRange.mock.calls.at(-1);
    expect(shown).toEqual(scene.abilityTiles);
    expect(color).toBe(UI_HEX.lineStrong); // Blink's tile colour
    expect(scene.hideActionMenu).toHaveBeenCalled();
  });

  it('opens nothing when there is nowhere to go (the menu greys it, but a stale tap is safe)', () => {
    const { scene, hero, far } = makeScene();
    scene.enemyUnits = [far];
    expect(flow(scene).begin(hero, SKILL)).toBe(false);
    expect(scene.battleState).toBe('UNIT_ACTION_MENU');
  });

  it('clears a weapon art picked before: Blink Strike is a plain attack', () => {
    const { scene, hero } = makeScene();
    scene._selectedWeaponArt = { unitName: 'Edric', artId: 'sword_slash', weaponIndex: 0 };
    flow(scene).begin(hero, SKILL);
    expect(scene._selectedWeaponArt).toBeNull();
  });

  it('a tap off the highlighted tiles does nothing', () => {
    const { scene, hero } = makeScene();
    flow(scene).begin(hero, SKILL);
    tapDestination(scene, 6, 5);
    expect(scene._pendingAbility.step).toBe('destination');
    expect(snapshot(scene).units[0]).toMatchObject({ col: 5, row: 5 });
  });
});

describe('step 2: the foe', () => {
  it('a destination shows only the foes it reaches, outlined on the chosen tile', () => {
    const { scene, hero } = makeScene();
    flow(scene).begin(hero, SKILL);
    tapDestination(scene, 5, 3);
    expect(scene._pendingAbility).toMatchObject({
      step: 'target',
      destination: { col: 5, row: 3 },
    });
    expect(scene.abilityTiles).toEqual([{ col: 5, row: 2 }]); // the Archer, 1 away
    const [outlined, tiles] = scene.grid.showRelocateGuide.mock.calls.at(-1);
    expect(outlined).toEqual({ col: 5, row: 3 });
    expect(tiles).toEqual([{ col: 5, row: 2 }]);
    // The unit has not moved: only the highlight did.
    expect(snapshot(scene).units[0]).toMatchObject({ col: 5, row: 5, usage: null });
  });

  it('a tap on a foe that destination does not reach does nothing', () => {
    const { scene, hero } = makeScene();
    flow(scene).begin(hero, SKILL);
    tapDestination(scene, 5, 3);
    tapDestination(scene, 9, 5); // the Fighter, 5 away from (5,3)
    expect(scene.battleState).toBe('SELECTING_ABILITY_TILE');
    expect(scene._pendingAbility.step).toBe('target');
  });
});

describe('step 3: the forecast, read from the destination', () => {
  const openForecast = async (scene, hero, dest, foeAt) => {
    flow(scene).begin(hero, SKILL);
    tapDestination(scene, dest.col, dest.row);
    tapDestination(scene, foeAt.col, foeAt.row);
    await Promise.resolve();
  };

  it('opens the ordinary forecast on the equipped weapon alone, the unit still where it stood', async () => {
    const { scene, hero, iron, foe } = makeScene();
    await openForecast(scene, hero, { col: 8, row: 5 }, { col: 9, row: 5 });
    expect(scene.battleState).toBe('SHOWING_FORECAST');
    expect(scene.forecastTarget).toBe(foe);
    expect(scene._forecastWeapon).toBe(iron);
    const config = renders.at(-1);
    expect(config.validWeapons).toEqual([iron]); // nothing to cycle to
    expect(config.weapon).toBe(iron);
    expect(config.targetCount).toBe(1);
    expect([hero.col, hero.row]).toEqual([5, 5]);
    expect(hero.inventory).toEqual([iron]);
    expect(scene.executeCombat).not.toHaveBeenCalled();
    expect(hero._battleAbilityUsage).toBeUndefined();
  });

  it('is exactly the forecast of the same unit standing there: numbers, skills, notes', async () => {
    // The oracle is the ordinary attack path with the unit physically on the tile.
    const warp = makeScene();
    await openForecast(warp.scene, warp.hero, { col: 8, row: 5 }, { col: 9, row: 5 });
    const warped = renders.at(-1);
    renders.length = 0;

    const stood = makeScene();
    Object.assign(stood.hero, { col: 8, row: 5 });
    stood.scene.attackTargets = [stood.foe];
    stood.scene.battleState = 'SELECTING_TARGET';
    await stood.scene.showForecast(stood.hero, stood.foe);
    const ordinary = renders.at(-1);

    expect(warped.forecast).toEqual(ordinary.forecast);
    expect(warped.validWeapons.map((w) => w.uid)).toEqual(ordinary.validWeapons.map((w) => w.uid));
    // Sanity: it IS the adjacent forecast (the foe counters), not an out-of-reach one.
    expect(warped.forecast.defender.attacks ?? warped.forecast.defender.hit).toBeTruthy();
  });

  it('reads the destination’s ground: Forest on the landing tile raises the foe’s miss chance by its 20 avoid', async () => {
    const forest = terrainNamed('Forest');
    const onForest = makeScene({
      destinationTerrain: (col, row) => (col === 8 && row === 5 ? forest : null),
    });
    await openForecast(onForest.scene, onForest.hero, { col: 8, row: 5 }, { col: 9, row: 5 });
    const forested = renders.at(-1).forecast;
    renders.length = 0;
    const onPlain = makeScene();
    await openForecast(onPlain.scene, onPlain.hero, { col: 8, row: 5 }, { col: 9, row: 5 });
    const open = renders.at(-1).forecast;
    // The foe's chance to hit the hero falls by the forest's avoid bonus (terrain.json: 20).
    expect(open.defender.hit - forested.defender.hit).toBe(Number(forest.avoidBonus));
    // The attack's own hit chance does not read its own ground.
    expect(forested.attacker.hit).toBe(open.attacker.hit);
  });

  it('the tapped foe’s neighbours are the targets the forecast cycles (stepping stays on the destination)', async () => {
    const { scene, hero, second } = makeScene();
    // (5,3) reaches only the Archer; use a destination two foes share by moving the Fighter.
    scene.enemyUnits[0].col = 6;
    scene.enemyUnits[0].row = 3; // Fighter now beside (5,3), (6,2), (6,4)...
    await openForecast(scene, hero, { col: 5, row: 3 }, { col: 5, row: 2 });
    expect(scene.attackTargets.map((t) => t.name).sort()).toEqual(['Archer', 'Fighter']);
    expect(scene.forecastTarget).toBe(second);
    expect(scene._cycleForecastTarget(1)).toBe(true);
    expect(scene.forecastTarget.name).toBe('Fighter');
    const config = renders.at(-1);
    expect(config.targetCount).toBe(2);
    // Still planning from the destination, still unmoved.
    expect([hero.col, hero.row]).toEqual([5, 5]);
    expect(scene._warpStrike.destination).toEqual({ col: 5, row: 3 });
  });

  it('draws no battle RNG while choosing, forecasting or cancelling', async () => {
    const { scene, hero } = makeScene();
    await openForecast(scene, hero, { col: 8, row: 5 }, { col: 9, row: 5 });
    scene.handleCancel();
    scene.handleCancel();
    scene.handleCancel();
    expect(random).not.toHaveBeenCalled();
  });
});

describe('Cancel, at each step, undoes everything', () => {
  it('forecast → foe → destination → the action menu, each leaving the state as it was', async () => {
    const { scene, hero } = makeScene();
    const before = snapshot(scene);
    flow(scene).begin(hero, SKILL);
    expect(snapshot(scene)).toEqual(before);

    tapDestination(scene, 8, 5);
    expect(snapshot(scene)).toEqual(before);
    tapDestination(scene, 9, 5);
    await Promise.resolve();
    expect(scene.battleState).toBe('SHOWING_FORECAST');
    expect(snapshot(scene)).toEqual(before);

    // Forecast Cancel: back to the foe step on the same destination.
    scene.handleCancel();
    expect(scene.battleState).toBe('SELECTING_ABILITY_TILE');
    expect(scene.forecastTarget).toBeNull();
    expect(scene._warpStrike).toBeNull();
    expect(scene._forecastWeapon).toBeNull();
    expect(scene._pendingAbility).toMatchObject({
      step: 'target',
      destination: { col: 8, row: 5 },
    });
    expect(scene.abilityTiles).toEqual([{ col: 9, row: 5 }]);
    expect(snapshot(scene)).toEqual(before);

    // Foe step Cancel: back to the destinations.
    scene.handleCancel();
    expect(scene.battleState).toBe('SELECTING_ABILITY_TILE');
    expect(scene._pendingAbility.step).toBe('destination');
    expect(scene.abilityTiles).toHaveLength(5);
    expect(snapshot(scene)).toEqual(before);

    // Destination Cancel: the action menu, every highlight and pending flag gone.
    scene.handleCancel();
    expect(scene.showActionMenu).toHaveBeenCalledWith(hero);
    expect(scene._pendingAbility).toBeNull();
    expect(scene.abilityTiles).toEqual([]);
    expect(scene._warpStrike).toBeNull();
    expect(scene.attackTargets).toEqual([]);
    expect(scene.grid.clearAttackHighlights).toHaveBeenCalled();
    expect(snapshot(scene)).toEqual(before);
    expect(scene.executeCombat).not.toHaveBeenCalled();
    // The use is still there to spend.
    expect(canUseAbility(hero, SKILL).ok).toBe(true);
  });

  it('the destination it backs out to is offered again, and a second try can go a different way', async () => {
    const { scene, hero } = makeScene();
    flow(scene).begin(hero, SKILL);
    tapDestination(scene, 8, 5);
    scene.handleCancel();
    tapDestination(scene, 5, 3);
    expect(scene._pendingAbility).toMatchObject({
      step: 'target',
      destination: { col: 5, row: 3 },
    });
  });

  it('a forecast that closes any other way (End Turn, a rewind) drops the plan', async () => {
    const { scene, hero } = makeScene();
    flow(scene).begin(hero, SKILL);
    tapDestination(scene, 8, 5);
    tapDestination(scene, 9, 5);
    await Promise.resolve();
    expect(scene._warpStrike).toBeTruthy();
    scene.hideForecast();
    expect(scene._warpStrike).toBeNull();
    // A later ordinary forecast never reads the abandoned destination.
    scene.battleState = 'SELECTING_TARGET';
    Object.assign(hero, { col: 8, row: 4 });
    scene.attackTargets = [scene.enemyUnits[0]];
    await scene.showForecast(hero, scene.enemyUnits[0]);
    expect([hero.col, hero.row]).toEqual([8, 4]);
  });
});

describe('Confirm', () => {
  const toForecast = async (scene, hero, dest = { col: 8, row: 5 }, foeAt = { col: 9, row: 5 }) => {
    flow(scene).begin(hero, SKILL);
    tapDestination(scene, dest.col, dest.row);
    tapDestination(scene, foeAt.col, foeAt.row);
    await Promise.resolve();
  };

  it('settles the warp BEFORE the attack starts, spends the use and hands the attack on', async () => {
    const { scene, hero, foe } = makeScene();
    await toForecast(scene, hero);
    const seen = [];
    scene.executeCombat = vi.fn(async (attacker, defender, options) => {
      seen.push({
        at: [attacker.col, attacker.row],
        usage: attacker._battleAbilityUsage?.map?.blink_strike,
        hasActed: Boolean(attacker.hasActed),
        defender,
        options,
      });
    });
    scene.confirmForecastCombat();
    expect(scene.executeCombat).toHaveBeenCalledTimes(1);
    const [call] = seen;
    expect(call.at).toEqual([8, 5]);
    expect(call.usage).toBe(1);
    expect(call.hasActed).toBe(false); // the attack's own checkpoint ends the action
    expect(call.defender).toBe(foe);
    expect(call.options.warpStrike.present).toBeTypeOf('function');
    expect(scene.commitVisionSnapshotIfPending).toHaveBeenCalled();
    // The plan is spent: no leftover flow state.
    expect(scene._warpStrike).toBeNull();
    expect(scene._pendingAbility).toBeNull();
    expect(scene.attackTargets).toEqual([]);
  });

  it('clicking the foe in the canvas forecast confirms, as every attack', async () => {
    const { scene, hero } = makeScene();
    await toForecast(scene, hero);
    const { InputController } = await import('../src/ui/InputController.js');
    new InputController(scene).handleForecastClick({ col: 9, row: 5 });
    expect(scene.executeCombat).toHaveBeenCalledTimes(1);
    expect([hero.col, hero.row]).toEqual([8, 5]);
  });

  it('a pair that no longer holds (the foe fell) is refused: nothing moves, nothing is spent', async () => {
    const { scene, hero, foe } = makeScene();
    await toForecast(scene, hero);
    foe.currentHP = 0;
    scene.enemyUnits = scene.enemyUnits.filter((u) => u !== foe);
    scene.confirmForecastCombat();
    expect(scene.executeCombat).not.toHaveBeenCalled();
    expect(scene.showActionMenu).toHaveBeenCalledWith(hero);
    const after = snapshot(scene);
    after.units = after.units.filter((u) => u.name !== 'Fighter');
    expect(after.units.find((u) => u.name === 'Edric')).toMatchObject({
      col: 5,
      row: 5,
      usage: null,
    });
    expect(canUseAbility(hero, SKILL).ok).toBe(true);
  });

  it('a weapon that can no longer strike refuses the pair too', async () => {
    const { scene, hero } = makeScene();
    await toForecast(scene, hero);
    hero.weapon = null;
    scene.confirmForecastCombat();
    expect(scene.executeCombat).not.toHaveBeenCalled();
    expect([hero.col, hero.row]).toEqual([5, 5]);
  });

  it('a unit only the real board knows on the destination: the warp fails and the use is spent, the action ends', async () => {
    const { scene, hero } = makeScene();
    await toForecast(scene, hero);
    const ghost = unit('Ghost', 'enemy', 8, 5, []);
    const realAt = scene.getUnitAt.bind(scene);
    scene.getUnitAt = (col, row) => (col === 8 && row === 5 ? ghost : realAt(col, row));
    Object.assign(scene, {
      updateUnitPosition: vi.fn(),
      showMinorHintAt: vi.fn(),
      finishUnitAction: vi.fn(),
      _captureSuspendCheckpoint: vi.fn(() => true),
      hideActionMenu: vi.fn(),
    });
    scene.confirmForecastCombat();
    await vi.waitFor(() => expect(scene.finishUnitAction).toHaveBeenCalled());
    expect(scene.executeCombat).not.toHaveBeenCalled();
    expect([hero.col, hero.row]).toEqual([5, 5]);
    expect(hero._battleAbilityUsage.map.blink_strike).toBe(1);
    expect(scene.showMinorHintAt).toHaveBeenCalledWith(8 * 32 + 16, 5 * 32 + 16, 'Blocked!', expect.anything()); // prettier-ignore
    // No Canto after a failed warp: nothing was struck.
    expect(scene.finishUnitAction).toHaveBeenCalledWith(hero, { session: 1, skipCanto: true });
  });
});

describe('one effective-skill model: a lent Blink Strike behaves like a known one end to end', () => {
  it('the same destinations, forecast and confirm', async () => {
    const run = async (lend) => {
      renders.length = 0;
      const { scene, hero } = makeScene();
      if (lend) {
        hero.skills = [];
        hero.accessory = { name: 'Speed Ring', _boundSkill: 'blink_strike' };
      }
      flow(scene).begin(hero, SKILL);
      const tiles = scene.abilityTiles.map((t) => `${t.col},${t.row}`);
      tapDestination(scene, 8, 5);
      tapDestination(scene, 9, 5);
      await Promise.resolve();
      const forecast = renders.at(-1).forecast;
      scene.confirmForecastCombat();
      return { tiles, forecast, at: [hero.col, hero.row], usage: hero._battleAbilityUsage };
    };
    expect(await run(true)).toEqual(await run(false));
  });

  it('the limit is the unit’s: taking the ring off and putting it on does not refill it', () => {
    const { scene, hero } = makeScene();
    hero.skills = [];
    hero.accessory = { name: 'Speed Ring', _boundSkill: 'blink_strike' };
    markUsed(hero, 'blink_strike');
    const ring = hero.accessory;
    hero.accessory = null;
    hero.accessory = ring;
    const [entry] = scene._abilityController._getAbilityEntries(hero);
    expect(entry.canUse).toBe(false);
    // A second unit that receives the ring has its own count.
    const other = unit('Other', 'player', 4, 4, [weapon('Iron Sword', 'o')], {
      skills: [],
      accessory: ring,
    });
    scene.playerUnits.push(other);
    const [theirs] = scene._abilityController._getAbilityEntries(other);
    expect(theirs.canUse).toBe(true);
  });
});
