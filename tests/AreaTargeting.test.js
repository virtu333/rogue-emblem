// Pick-a-center weapon arts in the battle scene (docs/specs/aoe-weapon-arts.md §6):
// Stormcall on Breachbolt, aimed by AreaTargetingController. The ways this can fail:
// the menu hides the art without a target (or offers it with no reach, while silenced,
// or with Breachbolt spent); aiming starts on, previews or names a foe the fog hides;
// an illegal tile acts; Back skips a level; the strike counters, misses, skips its cost,
// its XP, a kill or its continuation; its intent is not saved first, a saved intent is
// trusted when it should not be, or replays when no longer legal; a stale session acts.
// Breachbolt's shots: a cast spends none, or one per victim; a replay spends it twice;
// the last shot swaps the tome out before the blast's kills are credited to it; the
// tome's strike and kill counters miss a blind cast or count a kill it did not make.
//
// Numbers worked by hand: Sage MAG 22 with Breachbolt (8 might) on RES 6 is 24, × 0.8 =
// 19 a blow. Stormcall costs 8 HP. Breachbolt reaches 3-10 tiles and has 3 shots a
// battle for a player unit.
import { afterEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { presentationFailureProxy as rendering } from './harness/PresentationFailureProxy.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { registerBattleEntity } from '../src/engine/BattleEntityIdentity.js';
import { applyCondition } from '../src/engine/StatusConditionSystem.js';
import { AREA_CENTER_STATE } from '../src/ui/AreaTargetingController.js';
import { InputController } from '../src/ui/InputController.js';
import { readCommittedAction } from '../src/ui/BattlePresentationCheckpoint.js';
import { getPerBattleRemainingUses } from '../src/engine/Combat.js';
import { canUseWeaponArt } from '../src/engine/WeaponArtSystem.js';
import { recordAreaStrike } from '../src/engine/DeedSystem.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const stormcall = data.weaponArts.arts.find((a) => a.id === 'legend_stormcall');
const breachbolt = () => structuredClone(data.weapons.find((w) => w.name === 'Breachbolt'));
const originalRandom = Math.random;
afterEach(() => {
  Math.random = originalRandom;
  vi.restoreAllMocks();
});

const sage = (col = 0, row = 5, extra = {}) => {
  const tome = breachbolt();
  return {
    name: 'Sage',
    faction: 'player',
    level: 10,
    tier: 'base', // level 10 like its foes, for XP that is easy to work by hand
    className: 'Sage',
    col,
    row,
    xp: 0,
    currentHP: 32,
    stats: { HP: 40, STR: 0, MAG: 22, SKL: 10, SPD: 10, DEF: 5, RES: 10, LCK: 5, MOV: 5 },
    moveType: 'Infantry',
    weapon: tome,
    inventory: [tome],
    proficiencies: [{ type: 'Tome', rank: 'Mast' }],
    skills: [],
    accessory: null,
    affixes: [],
    isCommander: true,
    isLord: true,
    ...extra,
  };
};
const foe = (name, col, row, hp = 30, extra = {}) => ({
  name,
  faction: 'enemy',
  level: 10,
  tier: 'base',
  className: 'Soldier',
  col,
  row,
  currentHP: hp,
  stats: { HP: 30, STR: 8, MAG: 0, SKL: 5, SPD: 5, DEF: 5, RES: 6, LCK: 0, MOV: 5 },
  moveType: 'Infantry',
  weapon: structuredClone(data.weapons.find((w) => w.name === 'Iron Lance')),
  inventory: [],
  skills: [],
  accessory: null,
  affixes: [],
  ...extra,
});

/** A 12×12 battle on the production scene, with the phone rail's menu captured. */
function battle(units, { fogVisible = null } = {}) {
  const scene = journeyBattleScene({ battleInProgress: {} }, data);
  scene.runManager = null;
  scene._battleRewindPolicy = 'fixed-v1';
  scene._battleRng = createBattleRng(42);
  Math.random = scene._battleRng;
  Object.assign(scene.grid, {
    cols: 12,
    rows: 12,
    fogEnabled: Boolean(fogVisible),
    isVisible: (col, row) => !fogVisible || fogVisible.has(`${col},${row}`),
    clearTemporaryTerrainsBySource: () => {},
    getMoveCost: () => 1,
    getTerrainAt: () => data.terrain.find((t) => t.name === 'Plain'),
  });
  scene.battleConfig = { objective: 'rout' };
  scene.goldEarned = 0;
  scene.turnPar = 99;
  scene.turnBonusConfig = data.turnBonus;
  scene.getCurrentTurnNumber = () => 1;
  scene.playerUnits = units.filter((u) => u.faction === 'player');
  scene.enemyUnits = units.filter((u) => u.faction === 'enemy');
  scene.npcUnits = [];
  rendering(scene, 0);
  for (const u of units) registerBattleEntity(scene, u);
  scene.sys = { isActive: () => true };
  scene.scene = { isActive: () => true };
  const rail = { items: null };
  scene._mobileBattleHud = {
    showMenu: (items) => (rail.items = items),
    hideMenu: () => (rail.items = null),
    focusMenuItem() {},
  };
  scene.showWeaponArtPicker = vi.fn(() => {
    scene.battleState = 'UNIT_ACTION_MENU';
    scene.inEquipMenu = true;
  });
  scene.showActionMenu = vi.fn();
  scene.selectedUnit = scene.playerUnits[0];
  const granted = [];
  scene.awardScaledXP = async (u, xp) => granted.push([u.name, xp]);
  return { scene, rail, granted, area: scene._areaTargeting() };
}

describe('the art menu offers Stormcall by reach, never by targets', () => {
  it('with no foe anywhere, Stormcall is still offered', () => {
    const caster = sage();
    const { scene } = battle([caster]);
    expect(scene._hasUsableWeaponArtTargets(caster, caster.weapon, { isInitiating: true })).toBe(
      true,
    );
  });

  it('not while silenced, with Breachbolt spent, or with too little HP', () => {
    for (const setup of [
      (u) => applyCondition(u, 'silence', 2),
      (u) => (u.weapon._usesSpent = 99), // every shot this battle spent
      (u) => (u.currentHP = 8),
    ]) {
      const caster = sage();
      setup(caster);
      const { scene } = battle([caster]);
      expect(scene._hasUsableWeaponArtTargets(caster, caster.weapon, { isInitiating: true })).toBe(
        false,
      );
    }
  });
});

describe('a Breachbolt out of shots', () => {
  it('lists its arts disabled as "Out of shots", as an attack with it is refused', () => {
    const caster = sage();
    caster.weapon._usesSpent = 3; // a player's 3 shots
    const { scene } = battle([caster, foe('Center', 4, 5)]);
    const rows = scene._getWeaponArtChoices(caster, caster.weapon, { isInitiating: true });
    expect(rows.map((r) => [r.art.id, r.canUse, r.reason])).toEqual([
      ['legend_cataclysm_bolt', false, 'no_shots'],
      ['legend_stormcall', false, 'no_shots'],
    ]);
    const stormRow = rows.find((r) => r.art.id === 'legend_stormcall');
    expect(scene._getWeaponArtStatusLine(caster, stormcall, stormRow)).toMatch(/^Out of shots · /);
    expect(scene._hasUsableWeaponArtTargets(caster, caster.weapon, { isInitiating: true })).toBe(
      false,
    );
  });

  it('counts the shots each side has: a player 3, an enemy 5; other weapons never', () => {
    const ctx = { turnNumber: 1, isInitiating: true };
    const player = sage();
    player.weapon._usesSpent = 2;
    expect(canUseWeaponArt(player, player.weapon, stormcall, ctx).ok).toBe(true);
    player.weapon._usesSpent = 3;
    expect(canUseWeaponArt(player, player.weapon, stormcall, ctx).reason).toBe('no_shots');
    // An enemy wielder has 5 (usesByFaction), with any tome art open to enemies.
    const enemy = foe('Warlock', 6, 5, 30, {
      className: 'Sage',
      stats: { ...sage().stats },
      proficiencies: [{ type: 'Tome', rank: 'Mast' }],
    });
    enemy.weapon = breachbolt();
    const tomeArt = data.weaponArts.arts.find(
      (a) => canUseWeaponArt(enemy, enemy.weapon, a, ctx).ok,
    );
    expect(tomeArt).toBeTruthy();
    enemy.weapon._usesSpent = 4;
    expect(canUseWeaponArt(enemy, enemy.weapon, tomeArt, ctx).ok).toBe(true);
    enemy.weapon._usesSpent = 5;
    expect(canUseWeaponArt(enemy, enemy.weapon, tomeArt, ctx).reason).toBe('no_shots');
    // A weapon without per-battle shots ignores a stray _usesSpent.
    const blade = structuredClone(data.weapons.find((w) => w.name === 'Oathblade'));
    blade._usesSpent = 99;
    const rush = data.weaponArts.arts.find((a) => a.id === 'legend_phantom_rush');
    const swordsman = sage(0, 5, { proficiencies: [{ type: 'Sword', rank: 'Mast' }] });
    expect(canUseWeaponArt(swordsman, blade, rush, ctx).ok).toBe(true);
  });
});

describe('aiming', () => {
  it('opens on the nearest foe the player sees, never one the fog hides', () => {
    const caster = sage(0, 5);
    const hidden = foe('Hidden', 3, 5); // 3 tiles, in reach, in fog
    const seen = foe('Seen', 6, 5); // 6 tiles, seen
    const fogVisible = new Set(['0,5', '6,5', '5,5', '7,5', '6,4', '6,6']);
    const { scene, area } = battle([caster, hidden, seen], { fogVisible });
    expect(area.begin(caster, caster.weapon, stormcall)).toBe(true);
    expect(scene.battleState).toBe(AREA_CENTER_STATE);
    expect(area.pending.aim).toEqual({ col: 6, row: 5 });
  });

  it('with no seen foe it opens on the nearest legal tile (3 away)', () => {
    const caster = sage(0, 5);
    const { area } = battle([caster]);
    area.begin(caster, caster.weapon, stormcall);
    const aim = area.pending.aim;
    expect(Math.abs(aim.col - 0) + Math.abs(aim.row - 5)).toBe(3);
  });

  it('the preview names only seen foes, though the blast reaches the hidden one too', () => {
    const caster = sage(0, 5);
    const seen = foe('Seen', 6, 5);
    const hidden = foe('Hidden', 6, 6);
    const fogVisible = new Set(['0,5', '6,5', '5,5', '7,5', '6,4']);
    const { area } = battle([caster, seen, hidden], { fogVisible });
    area.begin(caster, caster.weapon, stormcall);
    const preview = area.previewAt({ col: 6, row: 5 });
    expect(preview.victims.map((v) => v.unit.name)).toEqual(['Seen']);
    expect(preview.victims[0].damage).toBe(19);
  });

  it('Q/E (and L1/R1) step through seen foes in reach only', () => {
    const caster = sage(0, 5);
    const a = foe('A', 4, 5);
    const b = foe('B', 6, 3);
    const hidden = foe('Hidden', 5, 7);
    const far = foe('Far', 11, 11); // out of reach (17 tiles)
    const fogVisible = new Set(['0,5', '4,5', '6,3', '11,11']);
    const { area } = battle([caster, a, b, hidden, far], { fogVisible });
    area.begin(caster, caster.weapon, stormcall);
    expect(area.pending.aim).toEqual({ col: 4, row: 5 }); // A is nearest
    const steps = [];
    for (let i = 0; i < 3; i++) {
      area.handleKey({ key: 'e', preventDefault() {} });
      steps.push(`${area.pending.aim.col},${area.pending.aim.row}`);
    }
    // Board order is row then col: B (6,3) then A (4,5).
    expect(steps).toEqual(['6,3', '4,5', '6,3']);
  });
});

describe('inspecting while aiming', () => {
  /** The real InputController over a grid that records what is lit, and a panel. */
  function inspectable(units) {
    const ctx = battle(units);
    const { scene } = ctx;
    const marks = { lit: [] };
    Object.assign(scene.grid, {
      showAttackRange: (tiles) => (marks.lit = tiles.map(({ col, row }) => `${col},${row}`)),
      clearAttackHighlights: () => (marks.lit = []),
      clearHighlights() {},
      pixelToGrid: (x, y) => ({ col: x, row: y }),
      gridToPixel: (col, row) => ({ x: col, y: row }),
    });
    scene.inspectionPanel = {
      visible: false,
      show(unit) {
        this.visible = true;
        this._unit = unit;
      },
      hide() {
        this.visible = false;
        this._unit = null;
      },
    };
    scene._inputController = new InputController(scene);
    scene.refreshEndTurnControl = () => {};
    return { ...ctx, marks };
  }

  it('keeps the lit centers under the panel and has them back once it closes', () => {
    const caster = sage(0, 5);
    const target = foe('Target', 4, 5);
    const { scene, area, marks } = inspectable([caster, target]);
    area.begin(caster, caster.weapon, stormcall);
    const centers = area.pending.centers.map(({ col, row }) => `${col},${row}`);
    expect(marks.lit).toEqual(centers);
    // Pad L2 and a long-press both inspect through _showInspectionAtPixel.
    expect(scene._showInspectionAtPixel(target.col, target.row)).toBe(true);
    expect(scene.inspectionPanel._unit).toBe(target);
    expect(marks.lit).toEqual(centers);
    scene.clearInspectionVisuals();
    expect(scene.inspectionPanel.visible).toBe(false);
    expect(marks.lit).toEqual(centers);
    expect(scene.battleState).toBe(AREA_CENTER_STATE);
  });

  it('closing an inspection once the aim is over draws no centers', () => {
    for (const leave of [
      (scene, area) => area.back(), // to the art picker
      // Any other way out of the state (a rewind, the enemy phase) leaves no tint behind,
      // even if it skipped clearing the aim.
      (scene) => (scene.battleState = 'PLAYER_IDLE'),
    ]) {
      const caster = sage(0, 5);
      const { scene, area, marks } = inspectable([caster, foe('Target', 4, 5)]);
      area.begin(caster, caster.weapon, stormcall);
      leave(scene, area);
      scene.clearInspectionVisuals();
      expect(marks.lit).toEqual([]);
    }
  });
});

describe('aiming at the Entity (a 3×3 body anchored top-left)', () => {
  const entity = (col, row) => foe('Entity', col, row, 30, { isEntity: true, isBoss: true });

  it('opens on its seen body tile nearest the caster, not on its anchor', () => {
    // Body (4..6, 3..5); from (0,5) the nearest body tile is (4,5), 4 away; the
    // anchor (4,3) is 6 away.
    const caster = sage(0, 5);
    const { area } = battle([caster, entity(4, 3)]);
    area.begin(caster, caster.weapon, stormcall);
    expect(area.pending.aim).toEqual({ col: 4, row: 5 });
  });

  it('is offered when only its body is in reach, and only on tiles the player sees', () => {
    // Body (1..3, 4..6): the anchor (1,4) is 2 away, inside the minimum range 3.
    // In fog only (3,5) and (3,6) are seen: (3,5) is 3 away, (3,6) 4.
    const caster = sage(0, 5);
    const fogVisible = new Set(['0,5', '3,5', '3,6']);
    const { area } = battle([caster, entity(1, 4)], { fogVisible });
    area.begin(caster, caster.weapon, stormcall);
    expect(area.pending.aim).toEqual({ col: 3, row: 5 });
  });

  it('Q/E counts the cursor on any body tile as the Entity and steps past it', () => {
    const caster = sage(0, 5);
    const soldier = foe('Soldier', 0, 9); // 4 away, below the body in board order
    const { area } = battle([caster, entity(4, 3), soldier]);
    area.begin(caster, caster.weapon, stormcall);
    // Board order of the aim tiles: Entity (4,5), then Soldier (0,9).
    area.aim({ col: 5, row: 3 }); // the cursor on another tile of the body
    area.handleKey({ key: 'e', preventDefault() {} });
    expect(area.pending.aim).toEqual({ col: 0, row: 9 });
    area.handleKey({ key: 'e', preventDefault() {} });
    expect(area.pending.aim).toEqual({ col: 4, row: 5 });
  });
});

describe('the prompt and Back', () => {
  it('an illegal tile does nothing; a legal one opens [Fire] [Back]', () => {
    const caster = sage(0, 5);
    const target = foe('Target', 4, 5);
    const { scene, area, rail } = battle([caster, target]);
    area.begin(caster, caster.weapon, stormcall);
    expect(area.lock({ col: 1, row: 5 })).toBe(false); // 1 tile: inside the minimum range
    expect(area.locked).toBeNull();
    expect(area.lock({ col: 4, row: 5 })).toBe(true);
    expect(area.locked).toEqual({ col: 4, row: 5 });
    expect(scene.battleState).toBe(AREA_CENTER_STATE);
    expect(rail.items.map((i) => i.id)).toEqual(['area:fire', 'area:back']);
    const lines = area.promptLines();
    expect(lines.hp).toBe('HP 32→24');
    expect(lines.area[0]).toBe('Area: 1 foe');
  });

  it('a blind shot says so', () => {
    const caster = sage(0, 5);
    const { area } = battle([caster]);
    area.begin(caster, caster.weapon, stormcall);
    area.lock({ col: 4, row: 5 });
    expect(area.promptLines().area).toEqual(['No known foes in the blast']);
  });

  it('Esc steps back one level: prompt → aiming on the same tile → the art picker', () => {
    const caster = sage(0, 5);
    const target = foe('Target', 4, 5);
    const { scene, area } = battle([caster, target]);
    area.begin(caster, caster.weapon, stormcall);
    area.lock({ col: 4, row: 5 });
    expect(scene.requestCancel({ allowPause: false })).toBe(true);
    expect([scene.battleState, area.locked, area.pending.aim]).toEqual([
      AREA_CENTER_STATE,
      null,
      { col: 4, row: 5 },
    ]);
    expect(scene.requestCancel({ allowPause: false })).toBe(true);
    expect(area.pending).toBeNull();
    expect(scene.showWeaponArtPicker).toHaveBeenCalledWith(caster);
    expect(caster.currentHP).toBe(32); // nothing spent
  });
});

describe('the strike', () => {
  async function fire(units, options) {
    const ctx = battle(units, options);
    const { area, scene } = ctx;
    const caster = scene.playerUnits[0];
    area.begin(caster, caster.weapon, stormcall);
    area.lock({ col: 4, row: 5 });
    area.lock({ col: 4, row: 5 }); // the same tile again fires
    for (let i = 0; i < 20 && scene.battleState === 'COMBAT_RESOLVING'; i++)
      await new Promise((r) => setTimeout(r, 0));
    return { ...ctx, caster, units };
  }

  it('every foe in the blast takes 19, no counter, no miss; 8 HP and one use spent', async () => {
    const center = foe('Center', 4, 5);
    const side = foe('Side', 4, 6);
    const outside = foe('Outside', 6, 5);
    const { caster, scene } = await fire([sage(0, 5), center, side, outside]);
    expect([center, side, outside].map((u) => u.currentHP)).toEqual([11, 11, 30]);
    expect(caster.currentHP).toBe(24);
    expect(caster._battleWeaponArtUsage.map.legend_stormcall).toBe(1);
    expect(caster.hasActed).toBe(true);
    expect(scene.battleState).toBe('PLAYER_IDLE');
  });

  it('a kill is removed and the best credit pays as the primary', async () => {
    // Frail (10 HP) dies: a level-10 kill 40 (25 + 15) at the primary rate; Sturdy took
    // 19 of 30: 25 × 19/30 × 0.35 = 5.5 → 5. Base 45 (before the battle's multipliers).
    const frail = foe('Frail', 4, 5, 10);
    const sturdy = foe('Sturdy', 4, 6);
    const { scene, granted } = await fire([sage(0, 5), frail, sturdy]);
    expect(scene.enemyUnits).toEqual([sturdy]);
    expect(granted).toEqual([['Sage', 45]]);
  });

  it('saves the intent before anything is applied, and drops it once applied', async () => {
    const saves = [];
    const ctx = battle([sage(0, 5), foe('Center', 4, 5)]);
    ctx.scene.runManager = { battleInProgress: {} };
    ctx.scene._captureSuspendCheckpoint = ({ commitIntent } = {}) => {
      saves.push({
        commitIntent: Boolean(commitIntent),
        intent:
          ctx.scene._pendingCommittedAction && structuredClone(ctx.scene._pendingCommittedAction),
        hp: ctx.scene.playerUnits[0].currentHP,
      });
      return true;
    };
    const caster = ctx.scene.playerUnits[0];
    await ctx.area.execute(caster, caster.weapon, stormcall, { col: 4, row: 5 });
    expect(saves[0]).toEqual({
      commitIntent: true,
      hp: 32,
      intent: {
        kind: 'area_strike',
        unitId: caster.battleEntityId,
        unitName: 'Sage',
        center: { col: 4, row: 5 },
        weaponArt: { artId: 'legend_stormcall', weaponIndex: 0 },
      },
    });
    expect(readCommittedAction(saves[0].intent)).toEqual(saves[0].intent);
    expect(ctx.scene._pendingCommittedAction).toBeNull();
  });

  it('matches the harness: HP, the cost and the XP', async () => {
    const units = () => [sage(0, 5), foe('Frail', 4, 5, 10), foe('Sturdy', 4, 6)];
    const sceneRun = await fire(units());
    const hUnits = units();
    const harness = new HeadlessBattle(
      { ...data, weaponArts: structuredClone(data.weaponArts) },
      { act: 'act3', objective: 'rout' },
    );
    Object.assign(harness, {
      turnManager: { turnNumber: 1, unitActed() {} },
      battleConfig: { objective: 'rout' },
      turnPar: 99,
      playerUnits: [hUnits[0]],
      enemyUnits: hUnits.slice(1),
      npcUnits: [],
      grid: {
        cols: 12,
        rows: 12,
        fogEnabled: false,
        getTerrainAt: () => ({}),
        getMoveCost: () => 1,
        updateFogOfWar() {},
      },
    });
    const hGranted = [];
    harness._grantScaledXP = (u, xp) => hGranted.push([u.name, xp]);
    expect(harness.executeAreaStrike(hUnits[0], 'legend_stormcall', { col: 4, row: 5 })).toBe(true);
    // Sage 32 − 8; Frail 10 − 19 → 0; Sturdy 30 − 19.
    expect(sceneRun.units.map((u) => u.currentHP)).toEqual([24, 0, 11]);
    expect(hUnits.map((u) => u.currentHP)).toEqual([24, 0, 11]);
    expect(hGranted).toEqual(sceneRun.granted);
    // One of Breachbolt's 3 shots, in both.
    expect(getPerBattleRemainingUses(sceneRun.units[0].weapon, sceneRun.units[0])).toBe(2);
    expect(getPerBattleRemainingUses(hUnits[0].weapon, hUnits[0])).toBe(2);
  });

  it('a failed intent save holds the strike until the retry gate passes', async () => {
    const ctx = battle([sage(0, 5), foe('Center', 4, 5)]);
    ctx.scene.runManager = { battleInProgress: {} }; // a run battle saves its intent
    ctx.scene._captureSuspendCheckpoint = () => false; // and the save fails
    const caster = ctx.scene.playerUnits[0];
    let release;
    ctx.scene._saveRetryGate = () => new Promise((resolve) => (release = resolve));
    const pending = ctx.area.execute(caster, caster.weapon, stormcall, { col: 4, row: 5 });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    // Held: the intent is saved, nothing is spent or struck.
    expect(ctx.scene._pendingCommittedAction?.kind).toBe('area_strike');
    expect([caster.currentHP, caster.weapon._usesSpent ?? 0]).toEqual([32, 0]);
    expect(ctx.scene.enemyUnits[0].currentHP).toBe(30);
    release();
    expect(await pending).toBe(true);
    expect([caster.currentHP, caster.weapon._usesSpent]).toEqual([24, 1]);
    expect(ctx.scene.enemyUnits[0].currentHP).toBe(11);
  });

  it('a battle decided while the gate held never strikes', async () => {
    const ctx = battle([sage(0, 5), foe('Center', 4, 5)]);
    const caster = ctx.scene.playerUnits[0];
    let release;
    ctx.scene._saveRetryGate = () => new Promise((resolve) => (release = resolve));
    const pending = ctx.area.execute(caster, caster.weapon, stormcall, { col: 4, row: 5 });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    ctx.scene._fatalDecision = { kind: 'test' };
    release();
    expect(await pending).toBe(false);
    expect([caster.currentHP, ctx.scene.enemyUnits[0].currentHP]).toEqual([32, 30]);
  });

  it('a strike from a finished battle session does nothing', async () => {
    const ctx = battle([sage(0, 5), foe('Center', 4, 5)]);
    const caster = ctx.scene.playerUnits[0];
    ctx.area.session = -1;
    expect(await ctx.area.execute(caster, caster.weapon, stormcall, { col: 4, row: 5 })).toBe(
      false,
    );
    expect(caster.currentHP).toBe(32);
  });
});

describe("Breachbolt's shots and its counters", () => {
  const ironSword = () => structuredClone(data.weapons.find((w) => w.name === 'Iron Sword'));
  /** A run battle (deeds on), so the tome's counters are kept. */
  function runBattle(units) {
    const ctx = battle(units);
    ctx.scene.runManager = { battleInProgress: {} };
    ctx.saves = [];
    ctx.scene._captureSuspendCheckpoint = ({ commitIntent } = {}) => {
      if (commitIntent)
        ctx.saves.push({
          intent: structuredClone(ctx.scene._pendingCommittedAction),
          units: structuredClone([...ctx.scene.playerUnits, ...ctx.scene.enemyUnits]),
        });
      return true;
    };
    return ctx;
  }
  async function cast(ctx, center = { col: 4, row: 5 }) {
    const caster = ctx.scene.playerUnits[0];
    await ctx.area.execute(caster, caster.weapon, stormcall, center);
    return caster;
  }

  it('a cast spends one shot and is one strike; each foe it drops is one kill', async () => {
    const tome = (ctx) => ctx.scene.playerUnits[0].inventory[0];
    const hit = runBattle([sage(0, 5), foe('Frail', 4, 5, 10), foe('Sturdy', 4, 6)]);
    const caster = await cast(hit);
    expect(getPerBattleRemainingUses(tome(hit), caster)).toBe(2);
    expect([tome(hit)._strikes, tome(hit)._kills]).toEqual([1, 1]);
    expect(caster._battleDeeds.kills).toBe(1);

    // Empty ground: no hit roll and nobody hit, still one shot and one strike.
    const blind = runBattle([sage(0, 5)]);
    const lone = await cast(blind);
    expect(getPerBattleRemainingUses(tome(blind), lone)).toBe(2);
    expect([tome(blind)._strikes, tome(blind)._kills ?? 0]).toEqual([1, 0]);
  });

  it('the last shot puts the tome away only after the blast has settled its deaths', async () => {
    const caster = sage(0, 5);
    const [tome, sword] = [caster.inventory[0], ironSword()];
    tome._usesSpent = 2; // its last shot
    caster.inventory.push(sword);
    caster.proficiencies.push({ type: 'Sword', rank: 'Prof' });
    // A foe outside the blast keeps the battle going (a won battle swaps nothing).
    const ctx = runBattle([caster, foe('Frail', 4, 5, 10), foe('Outside', 8, 5)]);
    await cast(ctx);
    expect(getPerBattleRemainingUses(tome, caster)).toBe(0);
    expect(caster.weapon).toBe(sword); // swapped once the strike was done
    // The kill was the tome's: the deed reads its type and its counter took it.
    expect(caster._battleDeeds.killsByWeapon).toEqual({ Tome: 1 });
    expect([tome._kills, sword._kills ?? 0, sword._strikes ?? 0]).toEqual([1, 0, 0]);
  });

  it("the counters take only the blast's own kills of foes, and only for the army", () => {
    const caster = sage(0, 5);
    const tome = caster.weapon;
    const enemyCaster = foe('Warlock', 0, 0);
    const ally = sage(1, 1, { name: 'Ally' });
    const credits = [
      { source: caster, victim: foe('Dropped', 4, 5), killed: true },
      { source: caster, victim: foe('Wounded', 4, 6), killed: false },
      { source: caster, victim: ally, killed: true }, // not a foe
      { source: enemyCaster, victim: foe('Other', 5, 5), killed: true }, // not this blast's
    ];
    recordAreaStrike(caster, tome, credits);
    expect([tome._strikes, tome._kills]).toEqual([1, 1]);
    const enemyTome = breachbolt();
    recordAreaStrike(enemyCaster, enemyTome, credits);
    expect([enemyTome._strikes, enemyTome._kills]).toEqual([undefined, undefined]);
  });

  it('the harness keeps the same shot and swaps after the deaths too', () => {
    const caster = sage(0, 5);
    const [tome, sword] = [caster.inventory[0], ironSword()];
    tome._usesSpent = 2;
    caster.inventory.push(sword);
    caster.proficiencies.push({ type: 'Sword', rank: 'Prof' });
    const harness = new HeadlessBattle(
      { ...data, weaponArts: structuredClone(data.weaponArts) },
      { act: 'act3', objective: 'rout' },
    );
    Object.assign(harness, {
      turnManager: { turnNumber: 1, unitActed() {} },
      battleConfig: { objective: 'rout' },
      turnPar: 99,
      playerUnits: [caster],
      enemyUnits: [foe('Frail', 4, 5, 10), foe('Outside', 8, 5)],
      npcUnits: [],
      grid: {
        cols: 12,
        rows: 12,
        fogEnabled: false,
        getTerrainAt: () => ({}),
        getMoveCost: () => 1,
        updateFogOfWar() {},
      },
    });
    harness._grantScaledXP = () => {};
    expect(harness.executeAreaStrike(caster, 'legend_stormcall', { col: 4, row: 5 })).toBe(true);
    expect(getPerBattleRemainingUses(tome, caster)).toBe(0);
    expect(caster.weapon).toBe(sword);
    expect(caster._battleDeeds.killsByWeapon).toEqual({ Tome: 1 });
    expect([tome._strikes, tome._kills]).toEqual([1, 1]);
  });

  it('a replay from the saved intent spends the shot once, not twice', async () => {
    const ctx = runBattle([sage(0, 5), foe('Center', 4, 5)]);
    await cast(ctx);
    // The saved intent and the army as it was saved; a crash before the next save
    // resumes from them in a fresh battle.
    const [{ intent, units }] = ctx.saves;
    const resumed = runBattle(units);
    resumed.scene._scheduleSafeDelayedAsync = (_ms, _label, run) => run();
    expect(resumed.scene.resumeCommittedAreaStrike(readCommittedAction(intent))).toBe(true);
    for (let i = 0; i < 20 && resumed.scene.battleState === 'COMBAT_RESOLVING'; i++)
      await new Promise((r) => setTimeout(r, 0));
    const caster = resumed.scene.playerUnits[0];
    expect(resumed.scene.enemyUnits[0].currentHP).toBe(11);
    expect(getPerBattleRemainingUses(caster.weapon, caster)).toBe(2);
    expect(caster.weapon._strikes).toBe(1);
  });
});

describe('a saved strike', () => {
  const intent = (over = {}) => ({
    kind: 'area_strike',
    unitId: 'u1',
    unitName: 'Sage',
    center: { col: 4, row: 5 },
    weaponArt: { artId: 'legend_stormcall', weaponIndex: 0 },
    ...over,
  });

  it.each([
    ['valid', intent(), true],
    [
      'with a weapon uid',
      intent({ weaponArt: { artId: 'legend_stormcall', weaponIndex: 0, weaponUid: 'w1' } }),
      true,
    ],
    ['no unit id', intent({ unitId: 7 }), false],
    ['no name', intent({ unitName: ' ' }), false],
    ['a fractional center', intent({ center: { col: 1.5, row: 2 } }), false],
    ['a negative center', intent({ center: { col: -1, row: 2 } }), false],
    ['no art', intent({ weaponArt: null }), false],
    [
      'a bad weapon index',
      intent({ weaponArt: { artId: 'legend_stormcall', weaponIndex: -2 } }),
      false,
    ],
  ])('%s', (_label, value, ok) => {
    expect(readCommittedAction(value) !== null).toBe(ok);
  });

  it('replays when still legal, and is dropped when not', async () => {
    const ctx = battle([sage(0, 5), foe('Center', 4, 5)]);
    const caster = ctx.scene.playerUnits[0];
    ctx.scene._scheduleSafeDelayedAsync = (_ms, _label, run) => run();
    const saved = intent({ unitId: caster.battleEntityId });
    expect(ctx.scene.resumeCommittedAreaStrike(readCommittedAction(saved))).toBe(true);
    for (let i = 0; i < 20 && ctx.scene.battleState === 'COMBAT_RESOLVING'; i++)
      await new Promise((r) => setTimeout(r, 0));
    expect(ctx.scene.enemyUnits[0].currentHP).toBe(11);

    const spent = battle([sage(0, 5), foe('Center', 4, 5)]);
    const tired = spent.scene.playerUnits[0];
    tired.currentHP = 8; // can no longer pay 8 HP
    spent.scene._pendingCommittedAction = saved;
    expect(
      spent.scene.resumeCommittedAreaStrike(
        readCommittedAction(intent({ unitId: tired.battleEntityId })),
      ),
    ).toBe(false);
    expect(spent.scene._pendingCommittedAction).toBeNull();
    expect(spent.scene.enemyUnits[0].currentHP).toBe(30);
  });
});

describe('the aiming state is registered wherever the Blink tile state is', () => {
  it('cancel, End Turn, the phone context', () => {
    const caster = sage(0, 5);
    const { scene, area } = battle([caster, foe('Center', 4, 5)]);
    area.begin(caster, caster.weapon, stormcall);
    expect(scene.canRequestCancel({ allowPause: false })).toBe(true);
    expect(scene.canForceEndTurn()).toBe(true);
    const emitted = [];
    scene.isMobileInput = true;
    scene.isStoryInputLocked = () => false;
    scene.game = { events: { emit: (name, data) => emitted.push([name, data?.context]) } };
    scene._emitMobileContext();
    expect(emitted).toEqual([['mobile:setContext', 'battle_area_target']]);
  });

  it('every scene list naming SELECTING_ABILITY_TILE names the aiming state beside it', async () => {
    const { readFileSync } = await import('node:fs');
    const lines = readFileSync('src/scenes/BattleScene.js', 'utf8').split('\n');
    const at = lines
      .map((line, i) => (line.includes("'SELECTING_ABILITY_TILE'") ? i : -1))
      .filter((i) => i >= 0);
    expect(at.length).toBeGreaterThan(0);
    for (const i of at)
      expect(
        lines.slice(i - 1, i + 7).some((line) => line.includes('AREA_CENTER_STATE')),
        `BattleScene.js:${i + 1}`,
      ).toBe(true);
  });

  it('End Turn drops the aim first', () => {
    const caster = sage(0, 5);
    const { scene, area } = battle([caster, foe('Center', 4, 5)]);
    area.begin(caster, caster.weapon, stormcall);
    scene.startEnemyPhase = vi.fn();
    scene.turnManager.endPlayerPhase = vi.fn();
    scene._isTutorialStrictGateActive = () => false;
    scene.isStoryInputLocked = () => false;
    scene.forceEndTurn();
    expect(area.pending).toBeNull();
    expect(caster.currentHP).toBe(32);
  });
});
