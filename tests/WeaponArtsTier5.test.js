import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { loadGameData } from './testData.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { getWeaponArtTier5Effects } from '../src/engine/WeaponArtSystem.js';
import { getFirstLandedStrikeDamage, getPostCombatPipelineSteps } from '../src/engine/WeaponArtPostCombat.js';

const gameData = loadGameData();
const artById = new Map(gameData.weaponArts.arts.map((art) => [art.id, art]));

function makeUnit(overrides = {}) {
  const stats = overrides.stats || {
    HP: 30,
    STR: 10,
    MAG: 8,
    SKL: 8,
    SPD: 8,
    DEF: 8,
    RES: 8,
    LCK: 8,
    MOV: 5,
  };
  return {
    name: 'Unit',
    faction: 'player',
    col: 0,
    row: 0,
    currentHP: stats.HP,
    stats: { ...stats },
    mov: stats.MOV,
    ...overrides,
  };
}

function removeUnitFromPools(unit, pools) {
  for (const pool of pools) {
    const idx = pool.indexOf(unit);
    if (idx >= 0) pool.splice(idx, 1);
  }
}

function createSceneHarness() {
  const scene = new BattleScene();
  scene.turnManager = { turnNumber: 1 };
  scene.playerUnits = [];
  scene.enemyUnits = [];
  scene.npcUnits = [];
  scene.grid = {
    gridToPixel: (col, row) => ({ x: col * 16, y: row * 16 }),
  };
  scene.updateHPBar = vi.fn();
  scene.showMinorHintAt = vi.fn();
  scene.removeUnit = vi.fn(async (unit) => {
    removeUnitFromPools(unit, [scene.playerUnits, scene.enemyUnits, scene.npcUnits]);
  });
  return scene;
}

function createHeadlessHarness() {
  const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout' });
  battle.turnManager = { turnNumber: 1 };
  battle.battleConfig = { objective: 'rout' };
  battle.grid = {
    cols: 10,
    rows: 10,
    getTerrainAt: () => null,
    getMoveCost: () => 1,
    fogEnabled: false,
  };
  battle.playerUnits = [];
  battle.enemyUnits = [];
  battle.npcUnits = [];
  return battle;
}

describe('Tier 5 weapon art data + parsing', () => {
  it('normalizes all 10 mapped Tier 5 arts', () => {
    const mapped = [
      'axe_war_cry',
      'axe_rallying_blow',
      'magic_burning_quake',
      'magic_radiant_burst',
      'legend_blood_lance',
      'legend_cataclysm',
      'legend_tempest',
      'legend_cataclysm_bolt',
      'legend_barrage',
      'legend_galeforce_assault',
    ];
    for (const id of mapped) {
      const art = artById.get(id);
      expect(art).toBeTruthy();
      const effects = getWeaponArtTier5Effects(art);
      expect(Boolean(effects.aoeSplash || effects.allyBuff)).toBe(true);
    }
  });

  it('standard Tier 5 arts have balance-pass combat bonuses (no crit)', () => {
    const ids = [
      'axe_war_cry',
      'axe_rallying_blow',
      'magic_burning_quake',
      'magic_radiant_burst',
    ];
    for (const id of ids) {
      const combatMods = artById.get(id)?.combatMods || {};
      expect(combatMods.critBonus || 0).toBe(0);
    }
  });
});

describe('Tier 5 post-combat steps', () => {
  it('hit-gates Tier 5 steps and captures first landed strike basis damage', () => {
    const attacker = makeUnit({ name: 'Atk', faction: 'player' });
    const defender = makeUnit({ name: 'Def', faction: 'enemy', col: 1 });
    const art = {
      id: 'test_t5',
      effects: {
        aoeSplash: { radius: 1, damageKind: 'scaled', damageMultiplier: 0.5, basis: 'first_landed_strike' },
        allyBuff: { range: 2, durationPhases: 1, stats: { STR: 3 }, includeSelf: false },
      },
    };
    const landed = getPostCombatPipelineSteps({
      attacker,
      defender,
      attackerWeaponArt: art,
      result: {
        events: [
          { type: 'strike', attackerSide: 'attacker', miss: false, damage: 11 },
          { type: 'strike', attackerSide: 'attacker', miss: false, damage: 18 },
        ],
      },
    });
    expect(landed.some((step) => step.type === 'tier5_aoe_splash')).toBe(true);
    expect(landed.some((step) => step.type === 'tier5_ally_buff')).toBe(true);
    const splash = landed.find((step) => step.type === 'tier5_aoe_splash');
    expect(splash?.basisDamage).toBe(11);

    const missed = getPostCombatPipelineSteps({
      attacker,
      defender,
      attackerWeaponArt: art,
      result: {
        events: [{ type: 'strike', attackerSide: 'attacker', miss: true, damage: 11 }],
      },
    });
    expect(missed.some((step) => step.type.startsWith('tier5_'))).toBe(false);
  });

  it('finds first landed strike damage deterministically by side', () => {
    const events = [
      { type: 'strike', attackerSide: 'attacker', miss: true, damage: 20 },
      { type: 'strike', attackerSide: 'defender', miss: false, damage: 7 },
      { type: 'strike', attackerSide: 'attacker', miss: false, damage: 13 },
    ];
    expect(getFirstLandedStrikeDamage(events, 'attacker')).toBe(13);
    expect(getFirstLandedStrikeDamage(events, 'defender')).toBe(7);
  });
});

describe('Tier 5 scene/headless parity', () => {
  let scene;
  let headless;

  beforeEach(() => {
    scene = createSceneHarness();
    headless = createHeadlessHarness();
  });

  it('radiant burst single-target splash is deterministic (lowest HP%, tie row/col)', () => {
    const source = makeUnit({ name: 'Caster', faction: 'player', col: 0, row: 0 });
    const primary = makeUnit({ name: 'Primary', faction: 'enemy', col: 1, row: 0, stats: { HP: 30 }, currentHP: 20 });
    const enemyA = makeUnit({ name: 'A', faction: 'enemy', col: 1, row: 1, stats: { HP: 20 }, currentHP: 4 });
    const enemyB = makeUnit({ name: 'B', faction: 'enemy', col: 2, row: 0, stats: { HP: 10 }, currentHP: 2 });
    const step = { radius: 1, maxTargets: 1 };

    scene.playerUnits = [source];
    scene.enemyUnits = [primary, enemyA, enemyB];
    headless.playerUnits = [source];
    headless.enemyUnits = [primary, enemyA, enemyB];

    const sceneTargets = scene._collectTier5SplashTargets(step, source, primary);
    const headlessTargets = headless._collectTier5SplashTargets(step, source, primary);

    expect(sceneTargets.map((u) => u.name)).toEqual(['B']);
    expect(headlessTargets.map((u) => u.name)).toEqual(['B']);
  });

  it('burning quake style splash damage matches scene/headless outcomes', async () => {
    const sourceScene = makeUnit({ name: 'Mage', faction: 'player', col: 0, row: 0 });
    const primaryScene = makeUnit({ name: 'Primary', faction: 'enemy', col: 1, row: 0, stats: { HP: 30 }, currentHP: 20 });
    const splashScene = makeUnit({ name: 'Splash', faction: 'enemy', col: 1, row: 1, stats: { HP: 30 }, currentHP: 19 });
    scene.playerUnits = [sourceScene];
    scene.enemyUnits = [primaryScene, splashScene];

    const sourceHeadless = makeUnit({ name: 'Mage', faction: 'player', col: 0, row: 0 });
    const primaryHeadless = makeUnit({ name: 'Primary', faction: 'enemy', col: 1, row: 0, stats: { HP: 30 }, currentHP: 20 });
    const splashHeadless = makeUnit({ name: 'Splash', faction: 'enemy', col: 1, row: 1, stats: { HP: 30 }, currentHP: 19 });
    headless.playerUnits = [sourceHeadless];
    headless.enemyUnits = [primaryHeadless, splashHeadless];

    const step = {
      radius: 1,
      maxTargets: null,
      damageKind: 'scaled',
      damageMultiplier: 0.5,
      basisDamage: 12,
      nonLethal: false,
    };

    await scene._applyTier5AoeSplashStep(step, sourceScene, primaryScene);
    headless._applyTier5AoeSplashStep(step, sourceHeadless, primaryHeadless);

    expect(splashScene.currentHP).toBe(13);
    expect(splashHeadless.currentHP).toBe(13);
  });

  it('splash still resolves when the primary target is already at 0 HP', async () => {
    const sourceScene = makeUnit({ name: 'Mage', faction: 'player', col: 0, row: 0 });
    const primaryScene = makeUnit({ name: 'Primary', faction: 'enemy', col: 1, row: 0, stats: { HP: 30 }, currentHP: 0 });
    const splashScene = makeUnit({ name: 'Splash', faction: 'enemy', col: 1, row: 1, stats: { HP: 30 }, currentHP: 19 });
    scene.playerUnits = [sourceScene];
    scene.enemyUnits = [primaryScene, splashScene];

    const sourceHeadless = makeUnit({ name: 'Mage', faction: 'player', col: 0, row: 0 });
    const primaryHeadless = makeUnit({ name: 'Primary', faction: 'enemy', col: 1, row: 0, stats: { HP: 30 }, currentHP: 0 });
    const splashHeadless = makeUnit({ name: 'Splash', faction: 'enemy', col: 1, row: 1, stats: { HP: 30 }, currentHP: 19 });
    headless.playerUnits = [sourceHeadless];
    headless.enemyUnits = [primaryHeadless, splashHeadless];

    const step = {
      radius: 1,
      maxTargets: null,
      damageKind: 'scaled',
      damageMultiplier: 0.5,
      basisDamage: 12,
      nonLethal: false,
    };

    await scene._applyTier5AoeSplashStep(step, sourceScene, primaryScene);
    headless._applyTier5AoeSplashStep(step, sourceHeadless, primaryHeadless);

    expect(splashScene.currentHP).toBe(13);
    expect(splashHeadless.currentHP).toBe(13);
  });

  it('ally buff applies, uses strongest stat value, and expires at source faction next phase', async () => {
    const sourceScene = makeUnit({ name: 'Edric', faction: 'player', col: 0, row: 0, stats: { HP: 30, STR: 12, MOV: 5 }, currentHP: 30 });
    const allyScene = makeUnit({ name: 'Ally', faction: 'player', col: 1, row: 0, stats: { HP: 24, STR: 9, MOV: 5 }, currentHP: 24 });
    const enemyScene = makeUnit({ name: 'Enemy', faction: 'enemy', col: 2, row: 2 });
    scene.playerUnits = [sourceScene, allyScene];
    scene.enemyUnits = [enemyScene];
    scene.turnManager.turnNumber = 1;

    const sourceHeadless = makeUnit({ name: 'Edric', faction: 'player', col: 0, row: 0, stats: { HP: 30, STR: 12, MOV: 5 }, currentHP: 30 });
    const allyHeadless = makeUnit({ name: 'Ally', faction: 'player', col: 1, row: 0, stats: { HP: 24, STR: 9, MOV: 5 }, currentHP: 24 });
    const enemyHeadless = makeUnit({ name: 'Enemy', faction: 'enemy', col: 2, row: 2 });
    headless.playerUnits = [sourceHeadless, allyHeadless];
    headless.enemyUnits = [enemyHeadless];
    headless.turnManager.turnNumber = 1;

    const strongStep = {
      artId: 'axe_rallying_blow',
      range: 2,
      durationPhases: 1,
      stats: { STR: 3, CRIT: 10 },
      includeSelf: false,
    };
    const weakStep = {
      artId: 'test_weaker',
      range: 2,
      durationPhases: 1,
      stats: { STR: 2, CRIT: 5 },
      includeSelf: false,
    };

    await scene._applyTier5AllyBuffStep(strongStep, sourceScene);
    await scene._applyTier5AllyBuffStep(weakStep, sourceScene);
    headless._applyTier5AllyBuffStep(strongStep, sourceHeadless);
    headless._applyTier5AllyBuffStep(weakStep, sourceHeadless);

    expect(allyScene.stats.STR).toBe(12);
    expect(headless._getTimedWeaponArtCombatBuffMods(allyHeadless).critBonus).toBe(10);
    expect(scene._getTimedWeaponArtCombatBuffMods(allyScene).critBonus).toBe(10);
    expect(sourceScene.stats.STR).toBe(12);
    expect(sourceHeadless.stats.STR).toBe(12);

    scene._expireTimedWeaponArtBuffs('enemy', 1);
    headless._expireTimedWeaponArtBuffs('enemy', 1);
    expect(allyScene.stats.STR).toBe(12);
    expect(allyHeadless.stats.STR).toBe(12);

    scene._expireTimedWeaponArtBuffs('player', 2);
    headless._expireTimedWeaponArtBuffs('player', 2);
    expect(allyScene.stats.STR).toBe(9);
    expect(allyHeadless.stats.STR).toBe(9);
    expect(scene._getTimedWeaponArtCombatBuffMods(allyScene).critBonus).toBe(0);
    expect(headless._getTimedWeaponArtCombatBuffMods(allyHeadless).critBonus).toBe(0);
  });
});
