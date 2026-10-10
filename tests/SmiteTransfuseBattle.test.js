// Smite and Transfuse in the battle scene: the Ability menu, the target step in
// SELECTING_ABILITY_TILE (input, cancel, the action), the history beat a rewind row
// reads, and what the previews may know. The rules themselves are in
// tests/SmiteTransfuse.test.js; the settle/suspend/rewind boundary is in
// tests/ActionMovementBoundaryPresentation.test.js.
import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { Grid } from '../src/engine/Grid.js';
import { AbilityController } from '../src/ui/AbilityController.js';
import { InputController } from '../src/ui/InputController.js';
import { summarizeActionFact, describeBefore } from '../src/engine/RewindDestinations.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const skillById = new Map(gameData.skills.map((skill) => [skill.id, skill]));
const T = Object.fromEntries(gameData.terrain.map((t, i) => [t.name, i]));

function unit(name, col, row, extra = {}) {
  const stats = { HP: 24, STR: 8, MAG: 4, SKL: 6, SPD: 7, LCK: 3, DEF: 4, RES: 2, MOV: 5 };
  return {
    name,
    faction: 'player',
    col,
    row,
    currentHP: 24,
    stats,
    mov: 5,
    moveType: 'Infantry',
    weapon: null,
    inventory: [],
    consumables: [],
    skills: [],
    proficiencies: [],
    _conditions: [],
    ...extra,
  };
}
const foe = (name, col, row, extra = {}) => unit(name, col, row, { faction: 'enemy', ...extra });

function stubGrid() {
  return {
    cols: 12,
    rows: 12,
    fogEnabled: false,
    getMoveCost: () => 1,
    gridToPixel: (col, row) => ({ x: col * 32, y: row * 32 }),
    showAttackRange: vi.fn(),
    clearAttackHighlights: vi.fn(),
    clearHighlights: vi.fn(),
  };
}

function sceneWith({ players, enemies = [] }) {
  const scene = new BattleScene();
  Object.assign(scene, {
    _battleSession: 1,
    gameData: { skills: gameData.skills, affixes: gameData.affixes, classes: [], lords: [] },
    turnManager: { turnNumber: 1, currentPhase: 'player' },
    grid: stubGrid(),
    playerUnits: players,
    enemyUnits: enemies,
    npcUnits: [],
    registry: { get: vi.fn(() => null) },
    updateHPBar: vi.fn(),
    showMinorHintAt: vi.fn(),
    updateUnitPosition: vi.fn(),
    commitVisionSnapshotIfPending: vi.fn(),
    finishUnitAction: vi.fn(),
    _refreshPostCombatMovementState: vi.fn(),
    _combatFx: { playBuff: vi.fn(), playHeal: vi.fn(), playStatus: vi.fn() },
    _awaitSceneTween: vi.fn(async () => {}),
    hideActionMenu: vi.fn(() => {
      scene.actionMenu = [];
    }),
    showActionMenu: vi.fn(),
    selectedUnit: players[0],
  });
  scene._abilityController = new AbilityController(scene);
  return scene;
}

describe('Smite in the battle scene', () => {
  const setup = () => {
    const caster = unit('Caster', 5, 5, { skills: ['smite'] });
    const brigand = foe('Brigand', 6, 5);
    const scene = sceneWith({ players: [caster], enemies: [brigand] });
    return { scene, caster, brigand };
  };

  it('is offered with its status: unlimited, ends the action', () => {
    const { scene, caster } = setup();
    const [entry] = scene._abilityController._getAbilityEntries(caster);
    expect(entry).toMatchObject({ canUse: true, hasTargets: true });
    expect(scene._abilityController._statusLine(caster, entry)).toBe(
      'Unlimited uses · Ends unit action',
    );
  });

  it('says why it is greyed: no foe in reach, or one that cannot be moved', () => {
    const { scene, caster, brigand } = setup();
    brigand.isBoss = true;
    const [entry] = scene._abilityController._getAbilityEntries(caster);
    expect(entry.hasTargets).toBe(false);
    expect(scene._abilityController._statusLine(caster, entry)).toBe(
      'Unlimited uses · No valid targets',
    );
  });

  it('aiming highlights the foe, in the foe colour, and waits for a tap on it', () => {
    const { scene, caster } = setup();
    scene._abilityController._selectAbility(caster, skillById.get('smite'));
    expect(scene.battleState).toBe('SELECTING_ABILITY_TILE');
    expect(scene.abilityTiles).toEqual([{ col: 6, row: 5 }]);
    expect(scene._pendingAbility).toEqual({ unitName: 'Caster', skillId: 'smite' });
    const [tiles, color] = scene.grid.showAttackRange.mock.calls.at(-1);
    expect(tiles).toEqual([{ col: 6, row: 5 }]);
    expect(color).toBe(0xe8a44a);
  });

  it('a tap elsewhere does nothing; a tap on the foe pushes it two tiles and ends the action', async () => {
    const { scene, caster, brigand } = setup();
    scene._abilityController._selectAbility(caster, skillById.get('smite'));
    scene.handleAbilityTileClick({ col: 9, row: 9 });
    expect([brigand.col, brigand.row]).toEqual([6, 5]);
    expect(scene.finishUnitAction).not.toHaveBeenCalled();

    scene.handleAbilityTileClick({ col: 6, row: 5 });
    await vi.waitFor(() => expect(scene.finishUnitAction).toHaveBeenCalled());
    expect([brigand.col, brigand.row]).toEqual([8, 5]);
    expect([caster.col, caster.row]).toEqual([5, 5]);
    expect(brigand.currentHP).toBe(24);
    expect(scene._pendingAbility).toBeNull();
    expect(scene.abilityTiles).toEqual([]);
    // Canto applies like any other action: nothing asks to skip it.
    expect(scene.finishUnitAction).toHaveBeenCalledWith(caster, { session: 1 });
    expect(caster._battleAbilityUsage).toBeUndefined();
  });

  it('Back out of aiming returns to the action menu and clears the highlight', () => {
    const { scene, caster, brigand } = setup();
    scene._abilityController._selectAbility(caster, skillById.get('smite'));
    scene.handleCancel();
    expect(scene.grid.clearAttackHighlights).toHaveBeenCalled();
    expect(scene.abilityTiles).toEqual([]);
    expect(scene._pendingAbility).toBeNull();
    expect(scene.showActionMenu).toHaveBeenCalledWith(caster);
    expect([brigand.col, brigand.row]).toEqual([6, 5]);
  });

  it('the input controller routes the tap to the same handler as Blink', () => {
    const { scene, caster } = setup();
    scene._abilityController._selectAbility(caster, skillById.get('smite'));
    const click = vi.spyOn(scene, 'handleAbilityTileClick').mockImplementation(() => {});
    scene.isStoryInputLocked = () => false;
    scene.unitDetailOverlay = null;
    scene.isMobileInput = false;
    scene.inspectMode = false;
    scene.grid.pixelToGrid = () => ({ col: 6, row: 5 });
    const input = new InputController(scene);
    input._screenToWorld = () => ({ x: 192, y: 160 });
    input.onClick({ x: 192, y: 160, rightButtonDown: () => false });
    expect(click).toHaveBeenCalledWith({ col: 6, row: 5 });
  });

  it('records a history beat a rewind row can name: "Before Caster’s smite on Brigand"', async () => {
    const { scene, caster, brigand } = setup();
    let beats;
    scene.runManager = { battleInProgress: true };
    // The checkpoint is where the timeline reads the beats; read them there.
    scene._captureSuspendCheckpoint = vi.fn(() => {
      beats = structuredClone(scene._historyBeats);
      return true;
    });
    caster.battleEntityId = 'u1';
    brigand.battleEntityId = 'u2';
    scene._abilityController._selectAbility(caster, skillById.get('smite'));
    scene.handleAbilityTileClick({ col: 6, row: 5 });
    await vi.waitFor(() => expect(scene.finishUnitAction).toHaveBeenCalled());
    const lookup = (id) => ({ u1: caster, u2: brigand })[id];
    const fact = summarizeActionFact(beats, 'u1', lookup);
    expect(fact).toMatchObject({ verb: 'smite', target: 'Brigand' });
    expect(describeBefore(fact)).toBe('Before Caster’s smite on Brigand');
  });
});

describe('Transfuse in the battle scene', () => {
  const setup = () => {
    const giver = unit('Giver', 5, 5, { skills: ['transfuse'], currentHP: 20 });
    const ally = unit('Ally', 5, 6, { currentHP: 8 });
    const scene = sceneWith({ players: [giver, ally] });
    return { scene, giver, ally };
  };

  it('aiming highlights the hurt ally in the ally colour', () => {
    const { scene, giver } = setup();
    scene._abilityController._selectAbility(giver, skillById.get('transfuse'));
    expect(scene.battleState).toBe('SELECTING_ABILITY_TILE');
    expect(scene.abilityTiles).toEqual([{ col: 5, row: 6 }]);
    expect(scene.grid.showAttackRange.mock.calls.at(-1)[1]).toBe(0x86b27b);
  });

  it('a tap moves 10 HP, shows both bars, and writes nothing to currentHP from the UI', async () => {
    const { scene, giver, ally } = setup();
    scene._abilityController._selectAbility(giver, skillById.get('transfuse'));
    scene.handleAbilityTileClick({ col: 5, row: 6 });
    await vi.waitFor(() => expect(scene.finishUnitAction).toHaveBeenCalled());
    expect([giver.currentHP, ally.currentHP]).toEqual([10, 18]);
    expect(scene.updateHPBar).toHaveBeenCalledWith(ally);
    expect(scene.updateHPBar).toHaveBeenCalledWith(giver);
    const hints = scene.showMinorHintAt.mock.calls.map((call) => call[2]);
    expect(hints).toEqual(['+10', '-10']);
    expect(giver.xp).toBeUndefined();
  });

  it('is greyed for a giver at 1 HP and for allies at full HP', () => {
    const { scene, giver, ally } = setup();
    const status = () => {
      const [entry] = scene._abilityController._getAbilityEntries(giver);
      return [entry.hasTargets, scene._abilityController._statusLine(giver, entry)];
    };
    expect(status()).toEqual([true, 'Unlimited uses · Ends unit action']);
    giver.currentHP = 1;
    expect(status()).toEqual([false, 'Unlimited uses · No valid targets']);
    giver.currentHP = 20;
    ally.currentHP = ally.stats.HP;
    expect(status()[0]).toBe(false);
  });

  it('records the amount for the rewind row, with its +HP chip', async () => {
    const { scene, giver, ally } = setup();
    let beats;
    scene.runManager = { battleInProgress: true };
    // The checkpoint is where the timeline reads the beats; read them there.
    scene._captureSuspendCheckpoint = vi.fn(() => {
      beats = structuredClone(scene._historyBeats);
      return true;
    });
    giver.battleEntityId = 'u1';
    ally.battleEntityId = 'u2';
    scene._abilityController._selectAbility(giver, skillById.get('transfuse'));
    scene.handleAbilityTileClick({ col: 5, row: 6 });
    await vi.waitFor(() => expect(scene.finishUnitAction).toHaveBeenCalled());
    const fact = summarizeActionFact(beats, 'u1', (id) => ({ u1: giver, u2: ally })[id]);
    expect(describeBefore(fact)).toBe('Before Giver’s transfuse on Ally');
    expect(fact.outcome).toEqual({ healed: 10 });
  });
});

// --- Previews read what the player knows ------------------------------------

function mockGfx() {
  const stub = new Proxy({}, { get: (t, p) => (p === 'destroy' ? () => {} : () => stub) });
  return {
    cameras: { main: { width: 640, height: 480 } },
    add: { rectangle: () => stub, image: () => stub, text: () => stub, container: () => stub },
    textures: { exists: () => false },
  };
}

/** A 1x`width` row of plain ground; `hidden` = fogged tiles ("col,row"). */
function fogRow(width, hidden) {
  const map = [Array(width).fill(T.Plain)];
  const grid = new Grid(mockGfx(), width, 1, gameData.terrain, map, true);
  grid.isVisible = (col, row) => !hidden.has(`${col},${row}`);
  return grid;
}

/** What the player is shown while choosing Smite, as a plain, comparable value. */
function previewOf(scene, caster) {
  const smiteSkill = skillById.get('smite');
  const controller = scene._abilityController;
  const [entry] = controller._getAbilityEntries(caster);
  scene.grid.showAttackRange = vi.fn();
  controller._selectAbility(caster, smiteSkill);
  return {
    hasTargets: entry.hasTargets,
    status: controller._statusLine(caster, entry),
    tiles: scene.abilityTiles,
    shown: scene.grid.showAttackRange.mock.calls.map(([tiles, color, alpha]) => ({
      tiles,
      color,
      alpha,
    })),
    landings: controller
      ._targeting()
      .find(caster, smiteSkill)
      .map((t) => [t.destCol, t.destRow]),
  };
}

function worldsDifferingByHiddenFoe({ hiddenTile, hiddenAt, visible }) {
  return [false, true].map((withHidden) => {
    const caster = unit('Caster', 4, 0, { skills: ['smite'] });
    const enemies = [...visible];
    if (withHidden) enemies.push(foe('Lurker', hiddenAt, 0));
    const scene = sceneWith({ players: [caster], enemies });
    scene.grid = fogRow(12, new Set([`${hiddenTile},0`]));
    scene.grid.showAttackRange = vi.fn();
    scene.grid.clearAttackHighlights = vi.fn();
    scene._abilityController = new AbilityController(scene);
    return { scene, caster };
  });
}

describe('Smite previews ignore a foe the fog hides', () => {
  it('a hidden foe on the second tile changes nothing: the fogged tile already counts as taken', () => {
    // Visible Brigand at (5,0); (6,0) is fogged. One world has a hidden Lurker on it.
    const [empty, occupied] = worldsDifferingByHiddenFoe({
      hiddenTile: 6,
      hiddenAt: 6,
      visible: [foe('Brigand', 5, 0)],
    });
    const a = previewOf(empty.scene, empty.caster);
    const b = previewOf(occupied.scene, occupied.caster);
    // Worked out by hand: tile (6,0) is fogged, so the visible foe is not pushed there
    // at all, in both worlds: it has no legal first tile.
    expect(a.landings).toEqual([]);
    expect(a.hasTargets).toBe(false);
    expect(b).toEqual(a);
  });

  it('a hidden foe beyond a seen free tile is not betrayed by a shorter push', () => {
    // Brigand at (5,0), (6,0) visible and free, (7,0) fogged. The push stops at (6,0)
    // whether or not a Lurker stands on (7,0).
    const [empty, occupied] = worldsDifferingByHiddenFoe({
      hiddenTile: 7,
      hiddenAt: 7,
      visible: [foe('Brigand', 5, 0)],
    });
    const a = previewOf(empty.scene, empty.caster);
    expect(a.landings).toEqual([[6, 0]]);
    expect(previewOf(occupied.scene, occupied.caster)).toEqual(a);
  });

  it('a hidden foe next to the caster is never offered, and its absence shows nothing', () => {
    // The caster has moved beside a fogged tile that the move has not lifted yet.
    const [empty, occupied] = worldsDifferingByHiddenFoe({
      hiddenTile: 5,
      hiddenAt: 5,
      visible: [],
    });
    const a = previewOf(empty.scene, empty.caster);
    expect(a.hasTargets).toBe(false);
    expect(a.status).toBe('Unlimited uses · No valid targets');
    expect(previewOf(occupied.scene, occupied.caster)).toEqual(a);
  });

  it('control: once the tile is seen, the foe on it is offered', () => {
    const caster = unit('Caster', 4, 0, { skills: ['smite'] });
    const scene = sceneWith({ players: [caster], enemies: [foe('Brigand', 5, 0)] });
    scene.grid = fogRow(12, new Set());
    scene._abilityController = new AbilityController(scene);
    const preview = previewOf(scene, caster);
    expect(preview.hasTargets).toBe(true);
    expect(preview.landings).toEqual([[7, 0]]);
  });
});
