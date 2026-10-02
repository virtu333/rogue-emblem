import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { loadGameData } from './testData.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { getWeaponArtArea, getWeaponArtTier5Effects } from '../src/engine/WeaponArtSystem.js';
import { getPostCombatPipelineSteps } from '../src/engine/WeaponArtPostCombat.js';
import { planAreaBlows } from '../src/engine/AreaDamage.js';
import { allyBuff, areaDamage, runPostCombatEffectsSync } from '../src/engine/PostCombatEffects.js';

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
    cols: 10,
    rows: 10,
    getMoveCost: () => 1,
    getTerrainAt: () => null,
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
  it('maps all 10 Tier 5 arts: six areas and four ally buffs', () => {
    const areas = {
      magic_burning_quake: { shape: 'radius', radius: 1 },
      magic_radiant_burst: { shape: 'radius', radius: 1, pick: 'lowest_hp_pct', maxTargets: 1 },
      legend_cataclysm: { shape: 'radius', radius: 2, damage: { kind: 'fixed', amount: 5 } },
      legend_tempest: { shape: 'radius', radius: 1 },
      legend_cataclysm_bolt: { shape: 'radius', radius: 2 },
      legend_barrage: { shape: 'radius', radius: 1 },
    };
    for (const [id, area] of Object.entries(areas))
      expect(getWeaponArtArea(artById.get(id)), id).toMatchObject(area);
    for (const id of [
      'axe_war_cry',
      'axe_rallying_blow',
      'legend_blood_lance',
      'legend_galeforce_assault',
    ])
      expect(getWeaponArtTier5Effects(artById.get(id)).allyBuff, id).toBeTruthy();
  });

  it('standard Tier 5 arts have balance-pass combat bonuses (no crit)', () => {
    const ids = ['axe_war_cry', 'axe_rallying_blow', 'magic_burning_quake', 'magic_radiant_burst'];
    for (const id of ids) {
      const combatMods = artById.get(id)?.combatMods || {};
      expect(combatMods.critBonus || 0).toBe(0);
    }
  });
});

describe('Tier 5 post-combat steps', () => {
  it('hit-gates the area and ally-buff steps', () => {
    const attacker = makeUnit({ name: 'Atk', faction: 'player' });
    const defender = makeUnit({ name: 'Def', faction: 'enemy', col: 1 });
    const art = {
      id: 'test_t5',
      targeting: 'normal_attack',
      area: { shape: 'radius', radius: 1, damage: { kind: 'scaled', multiplier: 0.5 } },
      effects: {
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
    // A radius blast lands once however many strikes landed.
    expect(landed.find((step) => step.type === 'area_damage')).toMatchObject({ blows: 1 });
    expect(landed.some((step) => step.type === 'tier5_ally_buff')).toBe(true);

    const missed = getPostCombatPipelineSteps({
      attacker,
      defender,
      attackerWeaponArt: art,
      result: {
        events: [{ type: 'strike', attackerSide: 'attacker', miss: true, damage: 11 }],
      },
    });
    expect(missed.some((s) => s.type === 'area_damage' || s.type.startsWith('tier5_'))).toBe(false);
  });
});

// One implementation (engine/PostCombatEffects.js), two drivers: the scene awaits each
// beat with presentation, the harness acts only on the required ones. Same outcome.
const runHeadless = (battle, beats) =>
  runPostCombatEffectsSync(beats, { remove: (unit, options) => battle._removeUnit(unit, options) });

const fire = () => structuredClone(gameData.weapons.find((w) => w.name === 'Fire'));
const mageStats = { HP: 30, STR: 0, MAG: 20, SKL: 8, SPD: 8, DEF: 5, RES: 5, LCK: 5, MOV: 5 };

/** The Burning Quake area step for one landed strike, as the pipeline builds it. */
function quakeStep(source, primary) {
  return getPostCombatPipelineSteps({
    attacker: source,
    defender: primary,
    attackerWeaponArt: artById.get('magic_burning_quake'),
    result: { events: [{ type: 'strike', attackerSide: 'attacker', miss: false, damage: 1 }] },
  }).find((step) => step.type === 'area_damage');
}

describe('Tier 5 scene/headless parity', () => {
  let scene;
  let headless;

  beforeEach(() => {
    scene = createSceneHarness();
    headless = createHeadlessHarness();
  });

  it('radiant burst hits the most wounded foe beside the target (lowest HP%, tie row/col)', () => {
    const source = makeUnit({ name: 'Caster', faction: 'player', col: 0, row: 0 });
    const primary = makeUnit({ name: 'Primary', faction: 'enemy', col: 1, row: 0, currentHP: 20 });
    // A at 4/20 = 20%, B at 2/10 = 20%: a tie on HP%, broken by row (B is on row 0).
    const enemyA = makeUnit({
      name: 'A',
      faction: 'enemy',
      col: 1,
      row: 1,
      stats: { HP: 20 },
      currentHP: 4,
    });
    const enemyB = makeUnit({
      name: 'B',
      faction: 'enemy',
      col: 2,
      row: 0,
      stats: { HP: 10 },
      currentHP: 2,
    });
    const area = getWeaponArtArea(artById.get('magic_radiant_burst'));
    for (const world of [scene._postCombatWorld(), headless._postCombatWorld()]) {
      const plan = planAreaBlows({
        source,
        primary,
        area,
        units: [primary, enemyA, enemyB],
        world,
      });
      expect(plan.map((p) => p.unit.name)).toEqual(['B']);
    }
  });

  it('burning quake hits each neighbour with its own blow, the same in both drivers', async () => {
    const build = () => {
      const mage = makeUnit({ name: 'Mage', faction: 'player', stats: mageStats, weapon: fire() });
      const primary = makeUnit({
        name: 'Primary',
        faction: 'enemy',
        col: 1,
        row: 0,
        currentHP: 20,
      });
      // RES 8 (makeUnit default) and RES 2 neighbours.
      const warded = makeUnit({ name: 'Warded', faction: 'enemy', col: 1, row: 1, currentHP: 19 });
      const frail = makeUnit({
        name: 'Frail',
        faction: 'enemy',
        col: 2,
        row: 0,
        stats: { ...mageStats, RES: 2 },
        currentHP: 30,
      });
      return { mage, primary, warded, frail };
    };
    const a = build();
    const b = build();
    scene.playerUnits = [a.mage];
    scene.enemyUnits = [a.primary, a.warded, a.frail];
    headless.playerUnits = [b.mage];
    headless.enemyUnits = [b.primary, b.warded, b.frail];

    await scene._playPostCombatBeats(
      areaDamage(quakeStep(a.mage, a.primary), a.mage, a.primary, scene._postCombatWorld()),
    );
    runHeadless(
      headless,
      areaDamage(quakeStep(b.mage, b.primary), b.mage, b.primary, headless._postCombatWorld()),
    );

    // Fire 4 might, MAG 20: vs RES 8 → 16 × 0.6 = 9; vs RES 2 → 22 × 0.6 = 13.
    expect([a.warded.currentHP, a.frail.currentHP]).toEqual([10, 17]);
    expect([b.warded.currentHP, b.frail.currentHP]).toEqual([10, 17]);
    expect(a.primary.currentHP).toBe(20);
  });

  it('splash still resolves when the primary target is already at 0 HP', async () => {
    const mage = makeUnit({ name: 'Mage', faction: 'player', stats: mageStats, weapon: fire() });
    const primary = makeUnit({ name: 'Primary', faction: 'enemy', col: 1, row: 0, currentHP: 0 });
    const neighbour = makeUnit({ name: 'Splash', faction: 'enemy', col: 1, row: 1, currentHP: 19 });
    scene.playerUnits = [mage];
    scene.enemyUnits = [primary, neighbour];
    await scene._playPostCombatBeats(
      areaDamage(quakeStep(mage, primary), mage, primary, scene._postCombatWorld()),
    );
    expect(neighbour.currentHP).toBe(10);
  });

  it('ally buff applies, uses strongest stat value, and expires at source faction next phase', async () => {
    const sourceScene = makeUnit({
      name: 'Edric',
      faction: 'player',
      col: 0,
      row: 0,
      stats: { HP: 30, STR: 12, MOV: 5 },
      currentHP: 30,
    });
    const allyScene = makeUnit({
      name: 'Ally',
      faction: 'player',
      col: 1,
      row: 0,
      stats: { HP: 24, STR: 9, MOV: 5 },
      currentHP: 24,
    });
    const enemyScene = makeUnit({ name: 'Enemy', faction: 'enemy', col: 2, row: 2 });
    scene.playerUnits = [sourceScene, allyScene];
    scene.enemyUnits = [enemyScene];
    scene.turnManager.turnNumber = 1;

    const sourceHeadless = makeUnit({
      name: 'Edric',
      faction: 'player',
      col: 0,
      row: 0,
      stats: { HP: 30, STR: 12, MOV: 5 },
      currentHP: 30,
    });
    const allyHeadless = makeUnit({
      name: 'Ally',
      faction: 'player',
      col: 1,
      row: 0,
      stats: { HP: 24, STR: 9, MOV: 5 },
      currentHP: 24,
    });
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
    runHeadless(headless, allyBuff(strongStep, sourceHeadless, headless._postCombatWorld()));
    runHeadless(headless, allyBuff(weakStep, sourceHeadless, headless._postCombatWorld()));

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
