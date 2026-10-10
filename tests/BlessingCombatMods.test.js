// Blessing combat mods (engine/BlessingCombatMods.js): Keen Eye's initiating-side bonus, Hold the Line's
// "has not moved this turn" rule, the Act 1 Hit price, and the proof that BattleScene and the headless
// harness read all of it through the one module (docs/specs/blessings-v3.md §4).
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/LevelUpPopup.js', () => ({
  LevelUpPopup: class {
    async show() {}
  },
}));
vi.mock('../src/ui/HintDisplay.js', () => ({
  showImportantHint: vi.fn(async () => {}),
  showMinorHint: vi.fn(),
  showContextualHint: vi.fn(),
}));

import './harness/JourneyTestSetup.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { presentationFailureProxy as rendering } from './harness/PresentationFailureProxy.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import {
  applyBlessingCombatMods,
  blessingCombatModsFor,
  isHoldingGround,
  stampTurnAnchors,
} from '../src/engine/BlessingCombatMods.js';
import { serializeBattleUnit } from '../src/engine/BattleUnitState.js';
import { RunManager, serializeUnit } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const realRandom = Math.random;
afterEach(() => {
  Math.random = realRandom;
  vi.restoreAllMocks();
});

const PROFILE = {
  actHitBonus: 0,
  firstStrikeHitBonus: 10,
  stationary: { defBonus: 2, avoidBonus: 10 },
};
const player = (extra = {}) => ({ faction: 'player', col: 3, row: 4, ...extra });
const holding = (extra = {}) => {
  const unit = player(extra);
  stampTurnAnchors([unit], 5);
  return unit;
};

describe('isHoldingGround (Hold the Line)', () => {
  it('holds from the start of the player phase through a unit that waits', () => {
    expect(isHoldingGround(holding(), 5)).toBe(true);
  });

  it('still holds in the enemy phase that follows (the turn number is the same)', () => {
    const unit = holding({ hasActed: true });
    expect(isHoldingGround(unit, 5)).toBe(true);
  });

  it('stops holding once the unit has moved', () => {
    const unit = holding();
    unit.col = 4;
    unit.hasMoved = true;
    unit._movementSpent = 1;
    expect(isHoldingGround(unit, 5)).toBe(false);
  });

  it('does not hold after walking out and coming back with Canto (movement was spent)', () => {
    const unit = holding();
    unit.col = 5;
    unit.hasMoved = true;
    unit._movementSpent = 2;
    unit.col = 3; // back on the anchor tile
    expect(isHoldingGround(unit, 5)).toBe(false);
    unit.hasMoved = false; // a Canto-style flag reset does not clear the spent movement
    expect(isHoldingGround(unit, 5)).toBe(false);
  });

  it('does not hold for a unit marked as moved even when it ends on its own tile at no cost', () => {
    const unit = holding();
    unit.hasMoved = true;
    expect(isHoldingGround(unit, 5)).toBe(false);
  });

  it('stops holding when the unit is shoved off its tile in the enemy phase', () => {
    const unit = holding();
    unit.col = 2; // a forced move: no hasMoved, no movement spent
    expect(isHoldingGround(unit, 5)).toBe(false);
  });

  it('holds again after the move is undone (position, flag and spent movement restored)', () => {
    const unit = holding();
    unit.col = 5;
    unit.hasMoved = true;
    unit._movementSpent = 2;
    unit.col = 3;
    unit.hasMoved = false;
    unit._movementSpent = 0;
    expect(isHoldingGround(unit, 5)).toBe(true);
  });

  it("does not count last turn's anchor", () => {
    expect(isHoldingGround(holding(), 6)).toBe(false);
  });

  it('does not hold with no anchor (a mid-turn arrival or an older checkpoint)', () => {
    expect(isHoldingGround(player(), 5)).toBe(false);
    expect(isHoldingGround(holding(), undefined)).toBe(false);
  });

  it('stampTurnAnchors records every living unit and skips the fallen', () => {
    const alive = player({ currentHP: 5 });
    const dead = player({ currentHP: 0, col: 1 });
    stampTurnAnchors([alive, dead], 2);
    expect(alive._turnAnchor).toEqual({ turn: 2, col: 3, row: 4 });
    expect(dead._turnAnchor).toBeUndefined();
  });

  it('the anchor survives a suspend checkpoint and a Vision snapshot', () => {
    const unit = holding();
    expect(serializeBattleUnit(unit)._turnAnchor).toEqual({ turn: 5, col: 3, row: 4 });
  });

  it('the anchor never reaches a saved roster', () => {
    const saved = serializeUnit({ ...holding(), inventory: [], consumables: [], stats: {} });
    expect(saved._turnAnchor).toBeUndefined();
  });
});

describe('blessingCombatModsFor', () => {
  const side = (unit, extra = {}) => ({
    unit,
    foe: {},
    initiating: false,
    turn: 5,
    terrain: { name: 'Plain' },
    allies: [],
    ...extra,
  });

  it('gives enemies and NPC allies nothing, whatever the profile', () => {
    for (const faction of ['enemy', 'npc']) {
      const unit = { ...holding(), faction };
      expect(
        blessingCombatModsFor({ ...PROFILE, actHitBonus: 5 }, side(unit, { initiating: true })),
      ).toEqual({ hitBonus: 0, avoidBonus: 0, defBonus: 0, critBonus: 0, firstStrikeHitBonus: 0 });
    }
  });

  it('gives Keen Eye to the side that starts the combat only', () => {
    expect(
      blessingCombatModsFor(PROFILE, side(player(), { initiating: true })).firstStrikeHitBonus,
    ).toBe(10);
    expect(
      blessingCombatModsFor(PROFILE, side(player(), { initiating: false })).firstStrikeHitBonus,
    ).toBe(0);
  });

  it('gives Hold the Line only to a unit that is holding ground', () => {
    expect(blessingCombatModsFor(PROFILE, side(holding()))).toMatchObject({
      defBonus: 2,
      avoidBonus: 10,
    });
    expect(blessingCombatModsFor(PROFILE, side(player()))).toMatchObject({
      defBonus: 0,
      avoidBonus: 0,
    });
  });

  it('ignores a retired terrain list on a profile: Forest and Fort give nothing now', () => {
    // The terrain boon was retired once saves migrated (BlessingBoonMigration); a stray
    // legacyTerrainBonuses key must not bring it back.
    const stale = {
      ...PROFILE,
      legacyTerrainBonuses: [{ terrains: ['Forest'], avoidBonus: 10, defBonus: 1 }],
    };
    expect(
      blessingCombatModsFor(stale, side(player(), { terrain: { name: 'Forest' } })),
    ).toMatchObject({ avoidBonus: 0, defBonus: 0 });
  });

  it('applies the act Hit to a player on either side of the combat', () => {
    const profile = { ...PROFILE, actHitBonus: -8, firstStrikeHitBonus: 0 };
    const atk = { hitBonus: 1, avoidBonus: 0, defBonus: 0, critBonus: 0 };
    const def = { hitBonus: 2, avoidBonus: 0, defBonus: 0, critBonus: 0 };
    applyBlessingCombatMods(atk, def, {
      profile,
      attacker: player(),
      defender: player({ col: 4 }),
      atkTerrain: null,
      defTerrain: null,
      turn: 1,
    });
    expect([atk.hitBonus, def.hitBonus]).toEqual([-7, -6]);
  });

  it('does nothing without a profile (no run, a test double)', () => {
    const atk = { hitBonus: 1, avoidBonus: 0, defBonus: 0, critBonus: 0 };
    applyBlessingCombatMods(atk, atk, { profile: null, attacker: player(), defender: player() });
    expect(atk).toEqual({ hitBonus: 1, avoidBonus: 0, defBonus: 0, critBonus: 0 });
  });
});

describe('RunManager.getBlessingCombatProfile', () => {
  function runWith(ids) {
    const rm = new RunManager(loadGameData());
    rm.startRun();
    rm.activeBlessings = ids;
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();
    return rm;
  }

  it('is empty-handed with no blessings', () => {
    expect(new RunManager(loadGameData()).getBlessingCombatProfile()).toMatchObject({
      actHitBonus: 0,
      firstStrikeHitBonus: 0,
      stationary: { defBonus: 0, avoidBonus: 0 },
    });
  });

  it('carries the Act 1 Hit price (-8) for Act 1 and not for later acts', () => {
    const rm = runWith([]);
    rm._applySingleRunStartBlessingEffect('act1_hit_down', {
      type: 'act_hit_bonus',
      params: { act: 'act1', value: -8 },
    });
    expect(rm.getBlessingCombatProfile().actHitBonus).toBe(-8);
    expect(rm.getBlessingCombatProfile('act2').actHitBonus).toBe(0);
  });

  it('carries Keen Eye and Hold the Line from the data rows', () => {
    const profile = runWith(['steady_hands', 'terrain_mastery']).getBlessingCombatProfile();
    expect(profile.firstStrikeHitBonus).toBe(10);
    expect(profile.stationary).toEqual({ defBonus: 2, avoidBonus: 10 });
  });
});

describe('the scene and the harness agree', () => {
  const body = { HP: 30, STR: 12, MAG: 0, SKL: 9, SPD: 9, DEF: 7, RES: 3, LCK: 5, MOV: 5 };
  const sword = () => ({
    name: 'Test Blade',
    type: 'Sword',
    might: 8,
    hit: 100,
    crit: 0,
    weight: 5,
    range: '1',
    special: '',
  });
  const makeUnit = (name, faction, col) => {
    const weapon = sword();
    return {
      name,
      level: 5,
      tier: 'base',
      faction,
      col,
      row: 0,
      xp: 0,
      currentHP: 30,
      stats: { ...body },
      moveType: 'Infantry',
      className: 'Myrmidon',
      growths: {},
      weaponRank: 'Prof',
      weapon,
      inventory: [weapon],
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      skills: [],
      accessory: null,
      affixes: [],
    };
  };

  function blessedRun() {
    const rm = new RunManager(loadGameData());
    rm.startRun();
    rm.activeBlessings = ['steady_hands', 'terrain_mastery'];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();
    rm._applySingleRunStartBlessingEffect('act1_hit_down', {
      type: 'act_hit_bonus',
      params: { act: 'act1', value: -8 },
    });
    return rm;
  }

  function sceneCtx(run, units) {
    const scene = journeyBattleScene(run, data);
    scene.runManager = run;
    Math.random = () => 0.5;
    Object.assign(scene.grid, {
      fogEnabled: false,
      getMoveCost: () => 1,
      getTerrainAt: () => data.terrain.find((t) => t.name === 'Plain'),
    });
    scene.playerUnits = units.filter((u) => u.faction === 'player');
    scene.enemyUnits = units.filter((u) => u.faction === 'enemy');
    rendering(scene, 0);
    return (a, d) => scene.buildSkillCtx(a, d);
  }

  function harnessCtx(run, units) {
    const battle = new HeadlessBattle(structuredClone(data), { act: 'act1', objective: 'rout' });
    battle.turnManager = { turnNumber: 1 };
    battle.runManager = run;
    battle.playerUnits = units.filter((u) => u.faction === 'player');
    battle.enemyUnits = units.filter((u) => u.faction === 'enemy');
    battle.npcUnits = [];
    battle.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      getTerrainAt: () => ({ name: 'Plain' }),
      getMoveCost: () => 1,
      updateFogOfWar() {},
    };
    return (a, d) => battle._buildSkillCtx(a, d);
  }

  const pick = (mods) => ({
    hit: mods.hitBonus,
    avoid: mods.avoidBonus,
    def: mods.defBonus,
    first: mods.firstStrikeHitBonus || 0,
  });

  for (const [label, build] of [
    ['the scene', sceneCtx],
    ['the harness', harnessCtx],
  ]) {
    it(`${label} gives an unmoved player attacker Keen Eye, Hold the Line and the Act 1 price`, () => {
      const edric = makeUnit('Edric', 'player', 0);
      const foe = makeUnit('Foe', 'enemy', 1);
      stampTurnAnchors([edric], 1);
      const ctx = build(blessedRun(), [edric, foe])(edric, foe);
      expect(pick(ctx.atkMods)).toEqual({ hit: -8, avoid: 10, def: 2, first: 10 });
      expect(pick(ctx.defMods)).toEqual({ hit: 0, avoid: 0, def: 0, first: 0 });
    });

    it(`${label} gives a defending player Hold the Line and the Hit price but no Keen Eye`, () => {
      const edric = makeUnit('Edric', 'player', 0);
      const foe = makeUnit('Foe', 'enemy', 1);
      stampTurnAnchors([edric], 1);
      const ctx = build(blessedRun(), [edric, foe])(foe, edric);
      expect(pick(ctx.atkMods)).toEqual({ hit: 0, avoid: 0, def: 0, first: 0 });
      expect(pick(ctx.defMods)).toEqual({ hit: -8, avoid: 10, def: 2, first: 0 });
    });

    it(`${label} drops Hold the Line for a player who has moved`, () => {
      const edric = makeUnit('Edric', 'player', 0);
      const foe = makeUnit('Foe', 'enemy', 1);
      stampTurnAnchors([edric], 1);
      edric.hasMoved = true;
      edric._movementSpent = 2;
      const ctx = build(blessedRun(), [edric, foe])(edric, foe);
      expect(pick(ctx.atkMods)).toEqual({ hit: -8, avoid: 0, def: 0, first: 10 });
    });
  }
});

describe('anchors are stamped when a player phase begins', () => {
  it('the scene stamps every player unit and resets last turn’s flags (turn 3)', () => {
    const scene = new BattleScene();
    scene.scene = { isActive: () => true };
    scene.battleParams = {};
    scene.battleState = 'PLAYER_IDLE';
    scene.enemyUnits = [];
    scene.npcUnits = [];
    scene.turnPar = null;
    scene.grid = { fogEnabled: false, updateFogOfWar: vi.fn() };
    scene.showPhaseBanner = vi.fn();
    scene.dangerZone = { hide: vi.fn() };
    scene._clearCombatRollSession = vi.fn();
    scene.undimUnit = vi.fn();
    scene.dimUnit = vi.fn();
    scene.getTurnPressureState = vi.fn(() => ({ active: false }));
    scene.getTurnPressureSummary = vi.fn(() => '');
    scene._expireTimedWeaponArtBuffs = vi.fn();
    scene.registry = { get: vi.fn(() => null) };
    scene.time = { delayedCall: vi.fn(() => ({ remove: vi.fn() })) };
    scene.turnManager = { currentPhase: 'player', turnNumber: 3, endPlayerPhase: vi.fn() };
    const unit = { ...makeBare('Edric'), col: 6, row: 2, hasMoved: true, _movementSpent: 4 };
    scene.playerUnits = [unit];

    scene.onPhaseChange('player', 3);

    expect(unit._turnAnchor).toEqual({ turn: 3, col: 6, row: 2 });
    expect(isHoldingGround(unit, 3)).toBe(true);
  });

  it('the harness stamps them at the same point', () => {
    const battle = new HeadlessBattle(structuredClone(data), { act: 'act1', objective: 'rout' });
    const unit = { ...makeBare('Edric'), col: 6, row: 2, hasMoved: true, _movementSpent: 4 };
    battle.playerUnits = [unit];
    battle.enemyUnits = [];
    battle.npcUnits = [];
    battle.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      getTerrainAt: () => ({ name: 'Plain' }),
      updateFogOfWar() {},
    };
    battle._refreshFogVisibility = () => {};
    battle._onPhaseChange('player', 3);
    expect(unit._turnAnchor).toEqual({ turn: 3, col: 6, row: 2 });
    expect(isHoldingGround(unit, 3)).toBe(true);
  });
});

function makeBare(name) {
  return {
    name,
    faction: 'player',
    currentHP: 20,
    stats: { HP: 20, STR: 5, MAG: 0, SKL: 5, SPD: 5, DEF: 5, RES: 5, LCK: 5, MOV: 5 },
    inventory: [],
    consumables: [],
    skills: [],
    proficiencies: [],
  };
}
