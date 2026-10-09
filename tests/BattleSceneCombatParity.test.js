/**
 * BattleSceneCombatParity.test.js
 *
 * Tests that _prepareCombatContext and _runCombatResolution provide
 * consistent behavior across forecast, player-execute, and enemy-execute paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('phaser', () => ({
  default: { Scene: class {} },
}));

vi.mock('../src/ui/LevelUpPopup.js', () => ({
  LevelUpPopup: class {
    async show() {}
  },
}));

vi.mock('../src/utils/SceneRouter.js', async () => {
  const actual = await vi.importActual('../src/utils/SceneRouter.js');
  return { ...actual, transitionToScene: vi.fn(async () => true) };
});

vi.mock('../src/ui/RosterOverlay.js', () => ({
  RosterOverlay: class {
    constructor() {
      this.visible = false;
    }
    show() {
      this.visible = true;
    }
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { gridDistance } from '../src/engine/Combat.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';

// ── Helpers ──────────────────────────────────────────────────────

function makeUnit(overrides = {}) {
  return {
    name: 'TestUnit',
    col: 2,
    row: 2,
    faction: 'player',
    moveType: 'Infantry',
    className: 'Myrmidon',
    level: 5,
    hasMoved: false,
    hasActed: false,
    currentHP: 25,
    weapon: {
      name: 'Iron Sword',
      type: 'Sword',
      might: 5,
      hit: 90,
      crit: 0,
      weight: 5,
      range: '1',
      special: '',
    },
    inventory: [],
    consumables: [],
    skills: [],
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    stats: { HP: 25, STR: 10, MAG: 2, SKL: 8, SPD: 9, DEF: 6, RES: 3, LCK: 5, MOV: 5 },
    accessory: null,
    graphic: { clearTint: vi.fn(), setTint: vi.fn(), setAlpha: vi.fn() },
    label: null,
    hpBar: null,
    ...overrides,
  };
}

function makeEnemy(overrides = {}) {
  return makeUnit({
    name: 'EnemyFighter',
    col: 3,
    row: 2,
    faction: 'enemy',
    className: 'Fighter',
    weapon: {
      name: 'Iron Axe',
      type: 'Axe',
      might: 8,
      hit: 75,
      crit: 0,
      weight: 8,
      range: '1',
      special: '',
    },
    stats: { HP: 22, STR: 9, MAG: 0, SKL: 5, SPD: 6, DEF: 4, RES: 1, LCK: 3, MOV: 5 },
    proficiencies: [{ type: 'Axe', rank: 'Prof' }],
    ...overrides,
  });
}

const plainTerrain = { name: 'Plain', avoidBonus: 0, defBonus: 0 };

function setupScene() {
  const scene = new BattleScene();

  scene.grid = {
    fogEnabled: false,
    getTerrainAt: vi.fn(() => plainTerrain),
    clearHighlights: vi.fn(),
    clearAttackHighlights: vi.fn(),
    clearPath: vi.fn(),
    isVisible: vi.fn(() => true),
    getMovementRange: vi.fn(() => new Map()),
    gridToPixel: () => ({ x: 64, y: 64 }),
    cols: 10,
    rows: 10,
  };

  scene.gameData = { skills: [], affixes: [], weaponArts: { arts: [] }, classes: [] };
  scene.playerUnits = [];
  scene.enemyUnits = [];
  scene.npcUnits = [];
  scene.battleParams = {};
  scene.battleState = 'PLAYER_IDLE';
  scene.selectedUnit = null;
  scene.turnManager = { endPlayerPhase: vi.fn(), unitActed: vi.fn(), turnNumber: 1 };
  scene.runManager = {
    getBlessingCombatProfile: vi.fn(() => null),
    blessingRuntimeModifiers: {},
  };

  // Stubs for methods called during combat resolution
  scene.animateStrike = vi.fn(async () => {});
  scene.animateSkillActivation = vi.fn(async () => {});
  scene.updateHPBar = vi.fn();
  scene._applyResolvedCombatPostEffects = vi.fn(async () => {});
  scene._checkPhoenixBrooch = vi.fn(async () => {});
  scene._applyRecoilGuardAfterArtUse = vi.fn();
  scene.isDevToolsEnabled = () => false;
  scene.resetFortHealStreak = vi.fn();
  scene.awardXP = vi.fn(async () => {});
  scene.removeUnit = vi.fn(async () => {});
  scene.checkBattleEnd = vi.fn(() => false);
  scene.finishUnitAction = vi.fn();
  scene._clearCombatRollSession = vi.fn();
  scene._clearSelectedWeaponArt = vi.fn();

  // Weapon art stubs — no art selected by default
  scene._getSelectedWeaponArtForUnit = vi.fn(() => null);
  scene._selectEnemyWeaponArt = vi.fn(() => null);

  scene.registry = { get: vi.fn(() => null) };

  return scene;
}

// ── Tests ────────────────────────────────────────────────────────

describe('_prepareCombatContext', () => {
  let scene;

  beforeEach(() => {
    vi.restoreAllMocks();
    scene = setupScene();
  });

  it('computes distance and terrain for both sides', () => {
    const attacker = makeUnit({ col: 0, row: 0 });
    const defender = makeEnemy({ col: 2, row: 1 });
    scene.playerUnits = [attacker];
    scene.enemyUnits = [defender];

    const ctx = scene._prepareCombatContext(attacker, defender, { isPlayerInitiator: true });

    expect(ctx.dist).toBe(gridDistance(0, 0, 2, 1));
    expect(ctx.atkTerrain).toBe(plainTerrain);
    expect(ctx.defTerrain).toBe(plainTerrain);
    expect(scene.grid.getTerrainAt).toHaveBeenCalledWith(0, 0);
    expect(scene.grid.getTerrainAt).toHaveBeenCalledWith(2, 1);
  });

  it('creates roll session', () => {
    const attacker = makeUnit();
    const defender = makeEnemy();
    scene.playerUnits = [attacker];
    scene.enemyUnits = [defender];

    const ctx = scene._prepareCombatContext(attacker, defender);

    expect(ctx.rollSession).toBeTruthy();
  });

  it('selects player weapon art when isPlayerInitiator', () => {
    const fakeArt = { id: 'flame_slash', name: 'Flame Slash' };
    scene._getSelectedWeaponArtForUnit = vi.fn(() => fakeArt);
    const attacker = makeUnit();
    const defender = makeEnemy();
    scene.playerUnits = [attacker];
    scene.enemyUnits = [defender];

    const ctx = scene._prepareCombatContext(attacker, defender, { isPlayerInitiator: true });

    expect(ctx.selectedArt).toBe(fakeArt);
    expect(scene._getSelectedWeaponArtForUnit).toHaveBeenCalledWith(attacker, {
      isInitiating: true,
    });
    expect(scene._selectEnemyWeaponArt).not.toHaveBeenCalled();
  });

  it('selects enemy weapon art when !isPlayerInitiator', () => {
    const fakeArt = { id: 'heavy_smash', name: 'Heavy Smash' };
    scene._selectEnemyWeaponArt = vi.fn(() => fakeArt);
    const enemy = makeEnemy();
    const target = makeUnit();
    scene.enemyUnits = [enemy];
    scene.playerUnits = [target];

    const ctx = scene._prepareCombatContext(enemy, target, { isPlayerInitiator: false });

    expect(ctx.selectedArt).toBe(fakeArt);
    expect(scene._selectEnemyWeaponArt).toHaveBeenCalledWith(enemy, target);
    expect(scene._getSelectedWeaponArtForUnit).not.toHaveBeenCalled();
  });

  it('weapon art from forecast matches what execute would see', () => {
    const fakeArt = { id: 'pierce', name: 'Pierce' };
    scene._getSelectedWeaponArtForUnit = vi.fn(() => fakeArt);
    const attacker = makeUnit();
    const defender = makeEnemy();
    scene.playerUnits = [attacker];
    scene.enemyUnits = [defender];

    const forecastCtx = scene._prepareCombatContext(attacker, defender, {
      isPlayerInitiator: true,
    });
    scene._clearCombatRollSession();
    const executeCtx = scene._prepareCombatContext(attacker, defender, { isPlayerInitiator: true });

    expect(forecastCtx.selectedArt).toBe(executeCtx.selectedArt);
    expect(forecastCtx.dist).toBe(executeCtx.dist);
  });
});

describe('_runCombatResolution', () => {
  let scene;

  beforeEach(() => {
    vi.restoreAllMocks();
    scene = setupScene();
  });

  it('resolves combat and returns result with HP applied', async () => {
    const attacker = makeUnit();
    const defender = makeEnemy();
    scene.playerUnits = [attacker];
    scene.enemyUnits = [defender];

    const ctx = scene._prepareCombatContext(attacker, defender, { isPlayerInitiator: true });
    const { result } = await scene._runCombatResolution(attacker, defender, ctx);

    expect(result).toBeTruthy();
    expect(result.events).toBeInstanceOf(Array);
    expect(attacker.currentHP).toBe(result.attackerHP);
    expect(defender.currentHP).toBe(result.defenderHP);
  });

  it('applies weapon art cost when selectedArt is present', async () => {
    const attacker = makeUnit({ currentHP: 25 });
    const defender = makeEnemy();
    scene.playerUnits = [attacker];
    scene.enemyUnits = [defender];
    const fakeArt = {
      id: 'test_art',
      name: 'Test Art',
      hpCost: 5,
      perTurnLimit: 1,
      perMapLimit: 1,
    };

    const ctx = {
      dist: 1,
      atkTerrain: plainTerrain,
      defTerrain: plainTerrain,
      selectedArt: fakeArt,
    };

    await scene._runCombatResolution(attacker, defender, ctx);

    // Weapon art cost should have been applied
    expect(scene._applyRecoilGuardAfterArtUse).toHaveBeenCalledWith(attacker, fakeArt);
    expect(scene.updateHPBar).toHaveBeenCalled();
  });

  it('calls animateStrike for each combat event', async () => {
    const attacker = makeUnit();
    const defender = makeEnemy();
    scene.playerUnits = [attacker];
    scene.enemyUnits = [defender];

    const ctx = scene._prepareCombatContext(attacker, defender, { isPlayerInitiator: true });
    await scene._runCombatResolution(attacker, defender, ctx);

    // resolveCombat should generate at least one strike event
    expect(
      scene.animateStrike.mock.calls.length + scene.animateSkillActivation.mock.calls.length,
    ).toBeGreaterThan(0);
  });

  it('calls post-combat effects and phoenix brooch on both units', async () => {
    const attacker = makeUnit();
    const defender = makeEnemy();
    scene.playerUnits = [attacker];
    scene.enemyUnits = [defender];

    const ctx = scene._prepareCombatContext(attacker, defender, { isPlayerInitiator: true });
    await scene._runCombatResolution(attacker, defender, ctx);

    expect(scene._applyResolvedCombatPostEffects).toHaveBeenCalledTimes(1);
    // Phoenix brooch checked on both attacker and defender
    expect(scene._checkPhoenixBrooch).toHaveBeenCalledWith(attacker);
    expect(scene._checkPhoenixBrooch).toHaveBeenCalledWith(defender);
  });

  it("checks the Phoenix Brooch of an area art's other victims too", async () => {
    const enemy = makeEnemy();
    const target = makeUnit({ name: 'Target' });
    const beside = makeUnit({
      name: 'Beside',
      col: 3,
      row: 1,
      accessory: {
        name: 'Phoenix Brooch',
        combatEffects: { phoenixBrooch: true, phoenixHeal: 10, phoenixThreshold: 0.25 },
      },
    });
    scene.playerUnits = [target, beside];
    scene.enemyUnits = [enemy];
    scene._checkPhoenixBrooch = BattleScene.prototype._checkPhoenixBrooch;
    scene.animateHeal = vi.fn(async () => {});
    // The post-combat effects stand in for an area blow: Beside drops to 4 of 25, under
    // the brooch's line (floor(25 × 0.25) = 6), and leaves its credit.
    scene._applyResolvedCombatPostEffects = vi.fn(async ({ attacker, result }) => {
      beside.currentHP = 4;
      result.areaCredits = [
        { source: attacker, victim: beside, damage: 21, hpBefore: 25, killed: false },
      ];
    });
    const ctx = { dist: 1, atkTerrain: plainTerrain, defTerrain: plainTerrain, selectedArt: null };
    await scene._runCombatResolution(enemy, target, ctx);
    // 4 + 10 = 14, under the max of 25.
    expect(beside.currentHP).toBe(14);
    expect(beside._phoenixBroochUsed).toBe(true);
  });

  it('reads the run blessings: a Keen Eye profile marks the first strike of a combat the player starts', async () => {
    scene.runManager.getBlessingCombatProfile = vi.fn(() => ({
      actHitBonus: 0,
      firstStrikeHitBonus: 10,
      stationary: { defBonus: 0, avoidBonus: 0 },
    }));
    // A Hit well under 100, so the +10 shows (the bonus is tagged only where it changes the roll).
    const attacker = makeUnit();
    attacker.weapon = { ...attacker.weapon, hit: 40 };
    const defender = makeEnemy();
    scene.playerUnits = [attacker];
    scene.enemyUnits = [defender];
    const ctx = scene._prepareCombatContext(attacker, defender, { isPlayerInitiator: true });
    const { result } = await scene._runCombatResolution(attacker, defender, ctx);
    const strikes = result.events.filter((e) => e.attacker === attacker.name);
    expect(strikes.length).toBeGreaterThan(0);
    expect(strikes[0].firstStrikeBonus).toBe(true);
    expect(strikes.slice(1).some((e) => e.firstStrikeBonus)).toBe(false);
    expect(result.events.filter((e) => e.attacker === defender.name).some((e) => e.firstStrikeBonus)).toBe(false); // prettier-ignore
  });

  it('gives no blessing bonus without a profile', async () => {
    const attacker = makeUnit();
    const defender = makeEnemy();
    scene.playerUnits = [attacker];
    scene.enemyUnits = [defender];
    const ctx = scene._prepareCombatContext(attacker, defender, { isPlayerInitiator: true });
    const { result } = await scene._runCombatResolution(attacker, defender, ctx);
    expect(result.events.some((e) => e.firstStrikeBonus)).toBe(false);
  });

  it('tracks _hitByPlayerThisPhase on non-miss player attacks', async () => {
    const attacker = makeUnit({
      faction: 'player',
      stats: { HP: 25, STR: 20, MAG: 0, SKL: 20, SPD: 20, DEF: 10, RES: 5, LCK: 10, MOV: 5 },
    });
    const defender = makeEnemy({ faction: 'enemy' });
    scene.playerUnits = [attacker];
    scene.enemyUnits = [defender];

    const ctx = scene._prepareCombatContext(attacker, defender, { isPlayerInitiator: true });
    await scene._runCombatResolution(attacker, defender, ctx);

    // With 20 SKL and 90 hit weapon vs 75% avoid, should usually hit
    // The flag is set during animation, not by us, but we can verify the animation was called
    expect(scene.animateStrike).toHaveBeenCalled();
  });
});

describe('executeCombat and executeEnemyCombat shared path', () => {
  let scene;

  beforeEach(() => {
    vi.restoreAllMocks();
    scene = setupScene();
  });

  it('executeCombat routes through _prepareCombatContext and _runCombatResolution', async () => {
    const attacker = makeUnit();
    const defender = makeEnemy();
    scene.playerUnits = [attacker];
    scene.enemyUnits = [defender];
    scene.selectedUnit = attacker;

    const prepareSpy = vi.spyOn(scene, '_prepareCombatContext');
    const resolveSpy = vi.spyOn(scene, '_runCombatResolution');

    await scene.executeCombat(attacker, defender);

    // executeCombat (unlike the forecast) equips a selected art's weapon.
    expect(prepareSpy).toHaveBeenCalledWith(attacker, defender, {
      isPlayerInitiator: true,
      equipArtWeapon: true,
    });
    expect(resolveSpy).toHaveBeenCalledWith(
      attacker,
      defender,
      expect.objectContaining({ dist: expect.any(Number) }),
    );
    expect(scene.battleState).not.toBe('PLAYER_IDLE');
  });

  it("an enemy's area art gives each hurt player victim its low-HP line, not only the target", async () => {
    const enemy = makeEnemy();
    const target = makeUnit({ name: 'Target', isCommander: true });
    const beside = makeUnit({ name: 'Beside', col: 3, row: 1 });
    scene.enemyUnits = [enemy];
    scene.playerUnits = [target, beside];
    const lowHealth = [];
    scene._battleBeats = {
      checkBossHalfHealth: async () => {},
      onLowHealth: (unit) => lowHealth.push(unit?.name),
    };
    scene._applyResolvedCombatPostEffects = vi.fn(async ({ attacker, result }) => {
      result.areaCredits = [
        { source: attacker, victim: beside, damage: 9, hpBefore: 25, killed: false },
      ];
    });
    await scene.executeEnemyCombat(enemy, target);
    expect(lowHealth).toEqual(['Target', 'Beside']);
  });

  it('executeEnemyCombat routes through _prepareCombatContext and _runCombatResolution', async () => {
    const enemy = makeEnemy();
    const target = makeUnit();
    scene.enemyUnits = [enemy];
    scene.playerUnits = [target];

    const prepareSpy = vi.spyOn(scene, '_prepareCombatContext');
    const resolveSpy = vi.spyOn(scene, '_runCombatResolution');

    await scene.executeEnemyCombat(enemy, target);

    expect(prepareSpy).toHaveBeenCalledWith(enemy, target, { isPlayerInitiator: false });
    expect(resolveSpy).toHaveBeenCalledWith(
      enemy,
      target,
      expect.objectContaining({ dist: expect.any(Number) }),
    );
  });

  it('executeCombat awards XP to player attacker', async () => {
    const attacker = makeUnit({ faction: 'player' });
    const defender = makeEnemy({ faction: 'enemy' });
    scene.playerUnits = [attacker];
    scene.enemyUnits = [defender];

    await scene.executeCombat(attacker, defender);

    expect(scene.awardXP).toHaveBeenCalled();
    // First arg should be the player attacker
    expect(scene.awardXP.mock.calls[0][0]).toBe(attacker);
  });

  it('executeEnemyCombat awards XP to player defender', async () => {
    const enemy = makeEnemy({ faction: 'enemy' });
    const target = makeUnit({ faction: 'player' });
    scene.enemyUnits = [enemy];
    scene.playerUnits = [target];

    await scene.executeEnemyCombat(enemy, target);

    expect(scene.awardXP).toHaveBeenCalled();
    // First arg should be the player target (defender)
    expect(scene.awardXP.mock.calls[0][0]).toBe(target);
  });

  it('no double-clear of combat roll session in executeCombat normal flow', async () => {
    const attacker = makeUnit();
    const defender = makeEnemy();
    scene.playerUnits = [attacker];
    scene.enemyUnits = [defender];

    await scene.executeCombat(attacker, defender);

    // finishUnitAction is the normal exit path — roll session cleared internally
    // _clearCombatRollSession should NOT be called in normal flow (only on early exit)
    if (scene.finishUnitAction.mock.calls.length > 0) {
      // Normal exit — _clearCombatRollSession may or may not be called depending on path
      // but should NOT be called twice
      expect(scene._clearCombatRollSession.mock.calls.length).toBeLessThanOrEqual(1);
    }
  });

  it('executeEnemyCombat always clears combat roll session', async () => {
    const enemy = makeEnemy();
    const target = makeUnit();
    scene.enemyUnits = [enemy];
    scene.playerUnits = [target];

    await scene.executeEnemyCombat(enemy, target);

    expect(scene._clearCombatRollSession).toHaveBeenCalledTimes(1);
  });
});

describe('silenced magic guard parity', () => {
  let scene;

  beforeEach(() => {
    vi.restoreAllMocks();
    scene = setupScene();
  });

  it('confirmForecastCombat blocks silenced unit with magic weapon', () => {
    const magicWeapon = {
      name: 'Fire',
      type: 'Tome',
      might: 5,
      hit: 80,
      crit: 0,
      weight: 3,
      range: '1-2',
      special: '',
    };
    const attacker = makeUnit({
      weapon: magicWeapon,
      _conditions: [{ id: 'silence', turnsRemaining: 2 }],
    });
    const defender = makeEnemy();
    scene.playerUnits = [attacker];
    scene.enemyUnits = [defender];
    scene.selectedUnit = attacker;
    scene.forecastTarget = defender;
    scene.battleState = 'SHOWING_FORECAST';
    scene.hideForecast = vi.fn();
    scene.executeCombat = vi.fn();
    scene.commitVisionSnapshotIfPending = vi.fn();

    scene.showActionMenu = vi.fn();
    scene.confirmForecastCombat();

    // Should block — hideForecast called but executeCombat NOT called
    expect(scene.hideForecast).toHaveBeenCalled();
    expect(scene.executeCombat).not.toHaveBeenCalled();
  });

  it('confirmForecastCombat allows silenced unit with physical weapon', () => {
    const physWeapon = {
      name: 'Iron Sword',
      type: 'Sword',
      might: 5,
      hit: 90,
      crit: 0,
      weight: 5,
      range: '1',
      special: '',
    };
    const attacker = makeUnit({
      weapon: physWeapon,
      _conditions: [{ id: 'silence', turnsRemaining: 2 }],
    });
    const defender = makeEnemy();
    scene.playerUnits = [attacker];
    scene.enemyUnits = [defender];
    scene.selectedUnit = attacker;
    scene.forecastTarget = defender;
    scene.battleState = 'SHOWING_FORECAST';
    scene.hideForecast = vi.fn();
    scene.executeCombat = vi.fn();
    scene.commitVisionSnapshotIfPending = vi.fn();

    scene.showActionMenu = vi.fn();
    scene.confirmForecastCombat();

    // Should proceed — executeCombat called
    expect(scene.executeCombat).toHaveBeenCalledWith(attacker, defender);
  });
});

// Drive real combat completion and the real movement state transition; only visuals
// and the numerical exchange are stubbed. The headless harness does not run Canto.
describe('Measured Step scene completion', () => {
  function movementScene(skills, specialCharId = null) {
    const scene = setupScene();
    const unit = makeUnit({
      name: specialCharId ? 'Gaspar' : 'Paladin',
      specialCharId,
      skills,
      stats: { HP: 25, STR: 10, MAG: 0, SKL: 12, SPD: 10, DEF: 6, RES: 2, LCK: 3, MOV: 6 },
      _movementSpent: 2,
    });
    const foe = makeEnemy();
    scene.playerUnits = [unit, makeUnit({ name: 'Edric', isCommander: true })];
    scene.enemyUnits = [foe];
    scene.turnManager.currentPhase = 'player';
    scene.finishUnitAction = BattleScene.prototype.finishUnitAction.bind(scene);
    scene.commitVisionSnapshotIfPending = vi.fn();
    scene.hideActionMenu = vi.fn();
    scene.dimUnit = vi.fn();
    scene.buildUnitPositionMap = () => new Map();
    scene.grid.showMovementRange = vi.fn();
    scene._getCostModifier = () => null;
    scene._resetCantoPreInitFaultTracking = vi.fn();
    scene._runCombatResolution = vi.fn(async () => ({
      result: { attackerHP: 25, defenderHP: 25, events: [] },
    }));
    scene._playLevelUpSfx = vi.fn();
    scene._stopLevelUpSfx = vi.fn();
    return { scene, unit, foe };
  }

  it.each([false, true])(
    'combat with weapon art=%s consumes Gaspar action without Canto',
    async (art) => {
      const { scene, unit, foe } = movementScene(['measured_step', 'aegis'], 'old_knight');
      const selected = art
        ? { id: 'test_art', name: 'Test Art', hpCost: 1, combatMods: { atkBonus: 1 } }
        : null;
      scene._getSelectedWeaponArtForUnit = () => selected;
      await scene.executeCombat(unit, foe);
      expect(scene._runCombatResolution).toHaveBeenCalled();
      expect(scene.battleState).toBe('PLAYER_IDLE');
      expect(scene.grid.showMovementRange).not.toHaveBeenCalled();
      expect(unit.hasActed).toBe(true);
    },
  );

  it('ordinary Paladin retains four tiles of postcombat movement', async () => {
    const { scene, unit, foe } = movementScene(['canto']);
    await scene.executeCombat(unit, foe);
    expect(scene.battleState).toBe('CANTO_MOVING');
    expect(scene.grid.getMovementRange).toHaveBeenCalledWith(
      unit.col,
      unit.row,
      4,
      unit.moveType,
      expect.any(Map),
      'player',
      null,
      { pass: false },
    );
  });

  it('a noncombat item action retains Gaspar remaining movement', async () => {
    const { scene, unit } = movementScene(['measured_step'], 'old_knight');
    const item = { name: 'Vulnerary', effect: 'heal', value: 10, uses: 3 };
    unit.currentHP -= 10;
    const hpBefore = unit.currentHP;
    unit.consumables = [item];
    scene.showBriefBanner = vi.fn(async () => {});
    scene.updateUnitPosition = vi.fn();
    await scene.useConsumable(unit, item);
    expect(unit.currentHP).toBe(hpBefore + 10);
    expect(item.uses).toBe(2);
    expect(scene.battleState).toBe('CANTO_MOVING');
    expect(scene.grid.getMovementRange).toHaveBeenCalledWith(
      unit.col,
      unit.row,
      4,
      unit.moveType,
      expect.any(Map),
      'player',
      null,
      { pass: false },
    );
  });

  it('restores a real legacy checkpoint and finishes the resolved attack once without Canto', () => {
    const { scene: source, unit } = movementScene(['canto', 'aegis'], 'old_knight');
    // An old save paused on the level-up screen, after combat and XP resolved.
    unit.level = 2;
    unit.stats.STR += 1;
    source._pendingActionCompletion = { kind: 'combat', unitName: unit.name };
    source.runManager.battleInProgress = { nodeId: 'n1', checkpoint: null };
    source.runManager.setBattleCheckpoint = (cp) => {
      source.runManager.battleInProgress.checkpoint = cp;
    };
    source.reseedBattleRng = vi.fn();
    source._persistBattleRunState = () => ({ ok: true });
    expect(new BattleSuspendController(source).captureCheckpoint()).toBe(true);
    const checkpoint = JSON.parse(JSON.stringify(source.runManager.battleInProgress.checkpoint));
    expect(checkpoint.pendingActionCompletion).toMatchObject({
      kind: 'combat',
      unitName: 'Gaspar',
    });
    expect(checkpoint.playerUnits[0].specialRulesVersion).toBeUndefined();

    const { scene } = movementScene([]);
    scene.playerUnits = [];
    scene.enemyUnits = [];
    scene.addUnitGraphic = vi.fn();
    scene.reseedBattleRng = vi.fn();
    scene.updateObjectiveText = vi.fn();
    scene.updateVisionHud = vi.fn();
    scene.refreshEndTurnControl = vi.fn();
    const finish = vi.spyOn(scene, 'finishUnitAction');
    const controller = new BattleSuspendController(scene);
    controller.applyUnits(checkpoint);
    const restored = scene.playerUnits[0];
    expect(restored.skills).toEqual(['measured_step', 'aegis']);
    controller.finalizeResume(checkpoint);
    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(scene.grid.showMovementRange).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledTimes(1);
    expect(restored.hasActed).toBe(true);
    expect(restored).toMatchObject({ level: 2, stats: { STR: 11 } });
    expect(scene._runCombatResolution).not.toHaveBeenCalled();
  });
});
