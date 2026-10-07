// Revival Stones in a battle (docs/specs/phase3.md 3D): the scene and the headless harness
// give the same result for a real combat, every non-combat lethal source breaks a stone,
// the fall's consequences fire once and only on the last bar, and a stone spent survives a
// suspend (and comes back on a rewind). Expected numbers are worked by hand:
//   Edric (STR 10, Iron Sword Might 5, sword beats axe +1) v the boss's 4 DEF: 12 a hit;
//   the boss (axe Might 8, STR 9, axe loses to sword -1) v Edric's 6 DEF: 10 a counter.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
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
    show() {}
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { GameDriver } from './harness/GameDriver.js';
import { areaDamage, postCombatEffects } from '../src/engine/PostCombatEffects.js';
import { resolveCombat } from '../src/engine/Combat.js';
import { getWeaponArtCombatMods } from '../src/engine/WeaponArtSystem.js';
import { captureBattleState } from '../src/ui/BattleCheckpointAdapter.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { serializeBattleUnit, restoreEquippedReference } from '../src/engine/BattleUnitState.js';
import { registerBattleEntity, resetBattleIdentities } from '../src/engine/BattleEntityIdentity.js';
import { validateBattleState } from '../src/engine/BattleStateSnapshot.js';
import { computeLavaCrackHp } from '../src/engine/TerrainHazards.js';
import RevivalStoneController from '../src/ui/RevivalStoneController.js';
import { loadGameData } from './testData.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';

const data = loadGameData();
const plain = { name: 'Plain', avoidBonus: 0, defBonus: 0 };

beforeEach(() => vi.restoreAllMocks());
afterEach(() => {
  restoreMathRandom();
  vi.restoreAllMocks();
});

const SWORD = {
  name: 'Iron Sword',
  type: 'Sword',
  tier: 'Iron',
  rankRequired: 'Prof',
  might: 5,
  hit: 90,
  crit: 0,
  weight: 5,
  range: '1',
  special: '',
};
const AXE = {
  name: 'Iron Axe',
  type: 'Axe',
  tier: 'Iron',
  rankRequired: 'Prof',
  might: 8,
  hit: 75,
  crit: 0,
  weight: 8,
  range: '1',
  special: '',
};

/** A unit carrying `weapon` as its equipped inventory item (the shape a saved battle keeps). */
function armed(unit, weapon) {
  unit.inventory = [structuredClone(weapon)];
  unit.weapon = unit.inventory[0];
  return unit;
}

function edric(extra = {}) {
  return armed(
    {
      name: 'Edric',
      faction: 'player',
      isLord: true,
      isCommander: true,
      col: 2,
      row: 2,
      level: 5,
      moveType: 'Infantry',
      className: 'Myrmidon',
      hasMoved: false,
      hasActed: false,
      currentHP: 25,
      consumables: [],
      skills: [],
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      stats: { HP: 25, STR: 10, MAG: 2, SKL: 8, SPD: 9, DEF: 6, RES: 3, LCK: 5, MOV: 5 },
      accessory: null,
      ...extra,
    },
    SWORD,
  );
}

/** The boss: 22 max HP, 4 DEF, an axe; `hp` now and `stones` Revival Stones. */
function boss({ hp = 10, stones = 1, extra = {} } = {}) {
  const b = armed(
    {
      name: 'Warchief',
      faction: 'enemy',
      isBoss: true,
      col: 3,
      row: 2,
      level: 5,
      moveType: 'Infantry',
      className: 'Fighter',
      hasMoved: false,
      hasActed: false,
      currentHP: hp,
      consumables: [],
      skills: [],
      proficiencies: [{ type: 'Axe', rank: 'Prof' }],
      stats: { HP: 22, STR: 9, MAG: 0, SKL: 5, SPD: 6, DEF: 4, RES: 3, LCK: 3, MOV: 5 },
      accessory: null,
      ...extra,
    },
    AXE,
  );
  if (stones > 0) Object.assign(b, { revivalStones: stones, revivalStonesMax: stones });
  return b;
}

function makeScene() {
  const scene = new BattleScene();
  Object.assign(scene, {
    grid: {
      fogEnabled: false,
      getTerrainAt: vi.fn(() => plain),
      clearHighlights: vi.fn(),
      clearAttackHighlights: vi.fn(),
      clearPath: vi.fn(),
      isVisible: vi.fn(() => true),
      getMovementRange: vi.fn(() => new Map()),
      gridToPixel: () => ({ x: 64, y: 64 }),
      cols: 10,
      rows: 10,
    },
    gameData: { skills: [], affixes: [], weaponArts: { arts: [] }, classes: [] },
    playerUnits: [],
    enemyUnits: [],
    npcUnits: [],
    battleParams: {},
    battleState: 'PLAYER_IDLE',
    selectedUnit: null,
    turnManager: { endPlayerPhase: vi.fn(), unitActed: vi.fn(), turnNumber: 1 },
    runManager: {
      getActHitBonusForUnit: vi.fn(() => 0),
      getTerrainCombatBonuses: vi.fn(() => []),
      blessingRuntimeModifiers: {},
    },
    registry: { get: vi.fn(() => null) },
  });
  Object.assign(scene, {
    animateStrike: vi.fn(async () => {}),
    animateSkillActivation: vi.fn(async () => {}),
    updateHPBar: vi.fn(),
    _applyResolvedCombatPostEffects: vi.fn(async () => {}),
    _checkPhoenixBrooch: vi.fn(async () => {}),
    _applyRecoilGuardAfterArtUse: vi.fn(),
    isDevToolsEnabled: () => false,
    resetFortHealStreak: vi.fn(),
    awardXP: vi.fn(async () => {}),
    // As the real one leaves the field (the sweep after a combat finds no one left to remove).
    removeUnit: vi.fn(async (unit) => {
      for (const list of [scene.playerUnits, scene.enemyUnits, scene.npcUnits]) {
        const at = list.indexOf(unit);
        if (at !== -1) list.splice(at, 1);
      }
    }),
    checkBattleEnd: vi.fn(() => false),
    finishUnitAction: vi.fn(),
    _clearCombatRollSession: vi.fn(),
    _clearSelectedWeaponArt: vi.fn(),
    _getSelectedWeaponArtForUnit: vi.fn(() => null),
    _selectEnemyWeaponArt: vi.fn(() => null),
  });
  return scene;
}

/** What a combat leaves, for the scene and the harness to be compared on. */
const outcome = (hero, foe, xp, removed) => ({
  bossHP: foe.currentHP,
  bossStones: foe.revivalStones ?? 0,
  heroHP: hero.currentHP,
  xp,
  removed,
});

async function sceneFight(hero, foe, { random = 0.5 } = {}) {
  const scene = makeScene();
  scene.playerUnits = [hero];
  scene.enemyUnits = [foe];
  vi.spyOn(Math, 'random').mockReturnValue(random);
  await scene.executeCombat(hero, foe);
  vi.restoreAllMocks();
  const call = scene.awardXP.mock.calls[0];
  return outcome(
    hero,
    foe,
    call && { opponentDied: call[2], damageDealt: call[3], opponentHpAtStart: call[4] },
    scene.removeUnit.mock.calls.map(([unit]) => unit.name),
  );
}

function harness() {
  installSeed(11);
  const driver = new GameDriver(data, { act: 'act1', objective: 'seize', battleSeed: 11 });
  driver.init();
  const b = driver.battle;
  b.battleConfig.reinforcements = null;
  b.grid.getTerrainAt = () => plain;
  return b;
}

async function harnessFight(hero, foe, { random = 0.5 } = {}) {
  const b = harness();
  Object.assign(hero, { col: 2, row: 2 });
  b.playerUnits.splice(0, b.playerUnits.length, hero);
  b.enemyUnits.splice(0, b.enemyUnits.length, foe);
  const xp = [];
  const original = b._awardCombatXP.bind(b);
  b._awardCombatXP = (unit, opponent, died, dealt, start, extra) => {
    xp.push({ opponentDied: died, damageDealt: dealt, opponentHpAtStart: start });
    return original(unit, opponent, died, dealt, start, extra);
  };
  const removed = [];
  const remove = b._removeUnit.bind(b);
  b._removeUnit = (unit, options) => {
    removed.push(unit.name);
    return remove(unit, options);
  };
  b._checkBattleEnd = () => false;
  vi.spyOn(Math, 'random').mockReturnValue(random);
  b._executeCombat(hero, foe);
  vi.restoreAllMocks();
  return outcome(hero, foe, xp[0], removed);
}

describe('a real combat through the scene and the harness', () => {
  // Edric 12 a hit on 10 HP: the first strike breaks the bar (22 HP again) and the
  // exchange ends (no counter), so Edric is untouched. The damage paid for is the bar's 10.
  const BREAK = {
    bossHP: 22,
    bossStones: 0,
    heroHP: 25,
    xp: { opponentDied: false, damageDealt: 10, opponentHpAtStart: 10 },
    removed: [],
  };
  // No stones: the same blow fells it, kill XP, and the boss is removed.
  const FALL = {
    bossHP: 0,
    bossStones: 0,
    heroHP: 25,
    xp: { opponentDied: true, damageDealt: 10, opponentHpAtStart: 10 },
    removed: ['Warchief'],
  };

  it('the scene breaks a bar: refilled, one stone spent, nobody removed, damage XP', async () => {
    expect(await sceneFight(edric(), boss({ hp: 10, stones: 1 }))).toEqual(BREAK);
  });

  it('the harness breaks the same bar the same way', async () => {
    expect(await harnessFight(edric(), boss({ hp: 10, stones: 1 }))).toEqual(BREAK);
  });

  it('with no stones the blow falls the boss in both, kill XP and one removal', async () => {
    expect(await sceneFight(edric(), boss({ hp: 10, stones: 0 }))).toEqual(FALL);
    expect(await harnessFight(edric(), boss({ hp: 10, stones: 0 }))).toEqual(FALL);
  });

  it('the last bar falls for real, and its consequences fire once, on that blow only', async () => {
    // One stone, 10 HP. Blow one breaks it (22 HP). Blow two: 12 (22 -> 10), Edric's
    // follow-up 12 more (10 -> 0, with the counter 10 in between): the boss falls.
    for (const run of [sceneFight, harnessFight]) {
      const hero = edric();
      const foe = boss({ hp: 10, stones: 1 });
      const first = await run(hero, foe);
      expect(first.removed, run.name).toEqual([]);
      const second = await run(hero, foe);
      expect(second, run.name).toMatchObject({
        bossHP: 0,
        bossStones: 0,
        removed: ['Warchief'],
        xp: { opponentDied: true, damageDealt: 22, opponentHpAtStart: 22 },
      });
    }
  });

  it('an enemy-phase attack by the stoned boss that its counter breaks ends there', async () => {
    // The boss (SPD 6 v 9) attacks Edric: 10 to Edric, then Edric's 12 counter breaks the
    // 8 HP bar; the boss's own follow-up/second strike is never rolled.
    const hero = edric();
    const foe = boss({ hp: 8, stones: 1 });
    const scene = makeScene();
    scene.playerUnits = [hero];
    scene.enemyUnits = [foe];
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    await scene.executeEnemyCombat(foe, hero);
    vi.restoreAllMocks();
    expect([foe.currentHP, foe.revivalStones, hero.currentHP]).toEqual([22, 0, 15]);
    expect(scene.removeUnit).not.toHaveBeenCalled();
    // XP for the player who survived is the damage it dealt in the counter: the 8-HP bar.
    expect(scene.awardXP.mock.calls[0].slice(2, 5)).toEqual([false, 8, 8]);
  });
});

describe('every non-combat lethal source breaks a stone', () => {
  // A mage's Burning Quake splashes its neighbour for 0.6 x 20 = 12 (the PostCombatEffects
  // and AreaWeaponArts tests work the same numbers).
  const art = data.weaponArts.arts.find((a) => a.id === 'magic_burning_quake');
  const fire = structuredClone(data.weapons.find((w) => w.name === 'Fire'));
  const wizard = {
    name: 'Mage',
    faction: 'player',
    col: 1,
    row: 1,
    level: 5,
    moveType: 'Infantry',
    weaponRank: 'Prof',
    weapon: fire,
    currentHP: 40,
    stats: { HP: 40, STR: 0, MAG: 20, SKL: 20, SPD: 0, DEF: 0, RES: 0, LCK: 0, MOV: 5 },
  };
  const foe = (name, col, hp, extra = {}) => ({
    name,
    faction: 'enemy',
    col,
    row: 1,
    level: 5,
    moveType: 'Infantry',
    weaponRank: 'Prof',
    currentHP: hp,
    stats: { HP: 40, STR: 0, MAG: 0, SKL: 0, SPD: 0, DEF: 0, RES: 4, LCK: 30, MOV: 5 },
    ...extra,
  });
  const world = (units) => ({
    affixes: data.affixes,
    cols: 8,
    rows: 8,
    getMoveCost: () => 1,
    getTerrainAt: () => null,
    getUnitAt: (c, r) => units.find((u) => u.col === c && u.row === r) || null,
    hostilesOf: (u) => units.filter((o) => o.faction !== u.faction && o.faction !== 'npc'),
    alliesOf: (u) => units.filter((o) => o.faction === u.faction),
    turnNumber: 1,
  });
  function splash(twin) {
    const caster = structuredClone(wizard);
    const primary = foe('Primary', 2, 40);
    const units = [caster, primary, twin];
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const result = resolveCombat(caster, caster.weapon, primary, null, 1, null, null, {
      atkWeaponArtMods: getWeaponArtCombatMods(art),
    });
    vi.restoreAllMocks();
    primary.currentHP = result.defenderHP;
    const beats = [
      ...postCombatEffects(
        { attacker: caster, defender: primary, result, attackerWeaponArt: art },
        world(units),
      ),
    ];
    return { beats, result };
  }

  it('an area art that would fell a stoned victim breaks a stone instead, and pays its bar', () => {
    const twin = foe('Twin', 3, 12, { isBoss: true, revivalStones: 1, revivalStonesMax: 1 });
    const { beats, result } = splash(twin);
    expect([twin.currentHP, twin.revivalStones]).toEqual([40, 0]);
    expect(beats.filter((b) => b.kind === 'stone').map((b) => b.unit.name)).toEqual(['Twin']);
    expect(beats.some((b) => b.kind === 'remove')).toBe(false);
    expect(result.areaCredits).toEqual([
      expect.objectContaining({ victim: twin, damage: 12, hpBefore: 12, killed: false }),
    ]);
  });

  it('the same blow with no stone falls the victim (the contrast)', () => {
    const twin = foe('Twin', 3, 12);
    const { beats, result } = splash(twin);
    expect(twin.currentHP).toBe(0);
    expect(beats.filter((b) => b.kind === 'remove').map((b) => b.unit.name)).toEqual(['Twin']);
    expect(result.areaCredits[0]).toMatchObject({ killed: true });
  });

  it('a two-blow area art strikes a broken bar no more (one bar per art)', () => {
    // A fixed 6-damage blast, twice. The victim has 5 HP and a stone: blow one breaks it
    // (20 HP again) and blow two must not touch the new bar (14 HP) nor spend the next stone.
    const blast = {
      area: {
        shape: 'radius',
        radius: 1,
        pick: 'all',
        maxTargets: null,
        damage: { kind: 'fixed', amount: 6 },
        strikes: 'once',
        nonLethal: false,
      },
      blows: 2,
    };
    const caster = structuredClone(wizard);
    const primary = foe('Primary', 2, 40);
    const victim = foe('Victim', 3, 5, {
      stats: { HP: 20, STR: 0, MAG: 0, SKL: 0, SPD: 0, DEF: 0, RES: 0, LCK: 0, MOV: 5 },
      revivalStones: 2,
      revivalStonesMax: 2,
    });
    const result = {};
    const beats = [...areaDamage(blast, caster, primary, world([caster, primary, victim]), result)];
    expect([victim.currentHP, victim.revivalStones]).toEqual([20, 1]);
    expect(beats.filter((b) => b.kind === 'stone')).toHaveLength(1);
    expect(result.areaCredits).toEqual([
      expect.objectContaining({ victim, damage: 5, hpBefore: 5, killed: false }),
    ]);
  });

  it('Deathburst (5 damage to every adjacent unit) breaks a stoned neighbour’s stone', async () => {
    const scene = new BattleScene();
    Object.assign(scene, {
      _battleSession: 1,
      registry: { get: () => null },
      gameData: data,
      runManager: null,
      battleState: 'COMBAT_RESOLVING',
      battleConfig: { objective: 'rout' },
      playerUnits: [],
      goldEarned: 0,
      _combatFx: { deathFade: async () => {} },
      _battleBeats: { onKill: vi.fn() },
      _awaitSceneDelay: async () => {},
      _applyKillRewards: vi.fn(),
      removeUnitGraphic: vi.fn(),
      updateObjectiveText: vi.fn(),
      updateHPBar: vi.fn(),
      checkBattleEnd: vi.fn(),
      grid: {
        gridToPixel: (col, row) => ({ x: col * 32, y: row * 32 }),
        clearTemporaryTerrainsBySource: vi.fn(),
      },
      add: {
        text: () => {
          const text = { setOrigin: () => text, setDepth: () => text, destroy: vi.fn() };
          return text;
        },
        rectangle: () => {
          const r = { setStrokeStyle: () => r, setAngle: () => r, setDepth: () => r, destroy() {} };
          return r;
        },
      },
      tweens: { add: (config) => config.onComplete?.() },
    });
    const unit = (name, faction, col, row, hp, extra = {}) => ({
      name,
      faction,
      col,
      row,
      currentHP: hp,
      stats: { HP: 20 },
      className: 'Soldier',
      level: 1,
      affixes: [],
      ...extra,
    });
    const source = { ...unit('Burst', 'enemy', 2, 2, 0), affixes: ['deathburst'] };
    const bossAlly = unit('Warchief', 'enemy', 3, 2, 5, {
      isBoss: true,
      revivalStones: 1,
      revivalStonesMax: 1,
    });
    const plainAlly = unit('Soldier', 'enemy', 2, 3, 5);
    scene.enemyUnits = [source, bossAlly, plainAlly];
    scene.npcUnits = [];
    await scene.removeUnit(source);
    // The stoned boss took the lethal 5, broke a stone and stands at 20; the soldier fell.
    expect([bossAlly.currentHP, bossAlly.revivalStones]).toEqual([20, 0]);
    expect(scene.enemyUnits).toEqual([bossAlly]);
  });

  it('the ballista breaks a stone, and falls the boss only on the last bar', async () => {
    // 10 Might - 3 RES = 7 a hit; certain at random 0.
    const foeBoss = boss({ hp: 5, stones: 1, extra: { col: 4, row: 2 } });
    const scene = makeScene();
    Object.assign(scene, {
      ballistas: [{ col: 2, row: 2, owner: 'player', range: 5 }],
      _combatFx: { ballistaShot: async () => {} },
      _awaitSceneTween: async () => {},
      _sweepFallenUnits: async () => {},
      _stoneFx: { playBreak: vi.fn() },
      add: {
        text: () => {
          const t = { setOrigin: () => t, setDepth: () => t, destroy() {} };
          return t;
        },
      },
      enemyUnits: [foeBoss],
    });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    await scene.processBallistaFire(scene.enemyUnits, 'player');
    expect([foeBoss.currentHP, foeBoss.revivalStones]).toEqual([22, 0]);
    expect(scene.removeUnit).not.toHaveBeenCalled();
    expect(scene._stoneFx.playBreak).toHaveBeenCalledTimes(1);

    foeBoss.currentHP = 5;
    await scene.processBallistaFire(scene.enemyUnits, 'player');
    expect(foeBoss.currentHP).toBe(0);
    expect(scene.removeUnit).toHaveBeenCalledTimes(1);
  });

  it('terrain never takes a bar: lava and acid cannot kill, so no stone is touched', () => {
    expect(computeLavaCrackHp(3, 5)).toEqual({ nextHP: 1, appliedDamage: 2 });
    expect(computeLavaCrackHp(1, 5)).toEqual({ nextHP: 1, appliedDamage: 0 });
  });
});

describe('suspend and rewind carry the stones', () => {
  function checkpointScene(units) {
    const scene = {
      _battleSession: 1,
      playerUnits: [],
      enemyUnits: [],
      npcUnits: [],
      escapedUnits: [],
      nonDeployedUnits: [],
      battleState: 'PLAYER_IDLE',
      turnManager: { currentPhase: 'player', turnNumber: 3 },
      grid: {
        mapLayout: Array.from({ length: 16 }, () => Array(20).fill(0)),
        temporaryTerrains: [],
      },
      runManager: {
        convoy: { weapons: [], consumables: [] },
        accessories: [],
        gold: 0,
        visionChargesRemaining: 2,
      },
      addUnitGraphic() {},
      dimUnit() {},
      gameData: {},
    };
    resetBattleIdentities(scene);
    for (const u of units.players) (scene.playerUnits.push(u), registerBattleEntity(scene, u));
    for (const u of units.enemies) (scene.enemyUnits.push(u), registerBattleEntity(scene, u));
    return scene;
  }

  it('a checkpoint taken after a break restores the unit with the stone spent', async () => {
    const hero = edric();
    const foe = boss({ hp: 10, stones: 2 });
    await sceneFight(hero, foe); // breaks one: 22 HP, 1 stone left
    expect([foe.currentHP, foe.revivalStones, foe.revivalStonesMax]).toEqual([22, 1, 2]);

    const scene = checkpointScene({ players: [hero], enemies: [foe] });
    const state = JSON.parse(JSON.stringify(captureBattleState(scene, { rngSeed: 7 })));
    expect(validateBattleState(state)).toBe(true);
    const restored = checkpointScene({ players: [], enemies: [] });
    new BattleSuspendController(restored).applyUnits(state);
    const back = restored.enemyUnits[0];
    expect([back.currentHP, back.revivalStones, back.revivalStonesMax]).toEqual([22, 1, 2]);

    // The resumed battle plays on from the spent stone: the next lethal blow breaks the last.
    back.currentHP = 6;
    const result = await sceneFight(restored.playerUnits[0], back);
    expect([result.bossHP, result.bossStones, result.removed]).toEqual([22, 0, []]);
  });

  it('a rewind to before the break brings the stone and the old bar back', async () => {
    const hero = edric();
    const foe = boss({ hp: 10, stones: 1 });
    const snapshot = serializeBattleUnit(foe); // what VisionRewindController keeps
    await sceneFight(hero, foe);
    expect([foe.currentHP, foe.revivalStones]).toEqual([22, 0]);
    const restored = structuredClone(snapshot);
    restoreEquippedReference(restored);
    expect([restored.currentHP, restored.revivalStones, restored.revivalStonesMax]).toEqual([
      10, 1, 1,
    ]);
  });

  it('the live display objects of a stoned unit never reach a save', () => {
    const foe = boss({ hp: 10, stones: 1 });
    foe.affixPips = [
      {
        destroy() {
          throw new Error('live display object');
        },
      },
    ];
    expect(serializeBattleUnit(foe).affixPips).toBeNull();
    expect(serializeBattleUnit(foe).revivalStones).toBe(1);
  });
});

describe('what a break looks like', () => {
  function fakeScene({ reduced = false } = {}) {
    const fills = [];
    const hints = [];
    const counters = [];
    const unit = boss({ hp: 22, stones: 0 });
    unit.revivalStonesMax = 1;
    unit.hpBar = { fill: {} };
    const scene = {
      grid: { gridToPixel: () => ({ x: 10, y: 20 }) },
      registry: { get: () => null },
      _reduceMotion: () => reduced,
      updateAffixPips: vi.fn(),
      updateHPBar: vi.fn((u, opts) => fills.push(opts?.ratio ?? 'real')),
      showMinorHintAt: vi.fn((x, y, text) => hints.push(text)),
      tweens: {
        addCounter: vi.fn((config) => {
          const tween = { stop: vi.fn(), config };
          counters.push(tween);
          return tween;
        }),
      },
      _bossPresence: { playRefill: vi.fn() },
    };
    return { scene, unit, fills, hints, counters };
  }

  it('refills the bar from empty over about 400 ms, says the line, redraws the pips', () => {
    const { scene, unit, fills, hints, counters } = fakeScene();
    const fx = new RevivalStoneController(scene).create();
    fx.playBreak(unit);
    expect(hints).toEqual(['The stone breaks.']);
    expect(scene.updateAffixPips).toHaveBeenCalledWith(unit);
    expect(scene._bossPresence.playRefill).toHaveBeenCalled();
    expect(fills).toEqual([0]); // starts empty
    expect(counters[0].config.duration).toBe(400);
    counters[0].config.onUpdate({ getValue: () => 0.5 }); // half-way: half of the real fill (1)
    counters[0].config.onComplete();
    expect(fills).toEqual([0, 0.5, 'real']); // and ends on the real bar
  });

  it('motion-reduced play shows the full bar at once', () => {
    const { scene, unit, fills, hints, counters } = fakeScene({ reduced: true });
    new RevivalStoneController(scene).create().playBreak(unit);
    expect(fills).toEqual(['real']);
    expect(counters).toEqual([]);
    expect(hints).toEqual(['The stone breaks.']);
  });

  it('a presentation that throws never reaches the battle', () => {
    const { scene, unit } = fakeScene();
    scene.updateAffixPips = () => {
      throw new Error('no display');
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => new RevivalStoneController(scene).create().playBreak(unit)).not.toThrow();
  });

  it('stops its tween when the scene goes', () => {
    const { scene, unit, counters } = fakeScene();
    const fx = new RevivalStoneController(scene).create();
    fx.playBreak(unit);
    fx.destroy();
    expect(counters[0].stop).toHaveBeenCalled();
  });
});

describe('the pips over a unit’s tile', () => {
  function pipScene() {
    const made = [];
    const scene = {
      grid: { gridToPixel: () => ({ x: 100, y: 100 }) },
      gameData: { affixes: { affixes: [{ id: 'thorns', tier: 1 }] } },
      add: {
        rectangle: (x, y, w, h, color) => {
          const r = { x, y, color, angle: 0 };
          r.setStrokeStyle = () => r;
          r.setAngle = (a) => ((r.angle = a), r);
          r.setDepth = () => r;
          r.setVisible = () => r;
          r.destroy = vi.fn();
          made.push(r);
          return r;
        },
      },
    };
    return { scene, made };
  }

  it('draws a gem for each stone left, spent ones gone, beside the affix pips', () => {
    const { scene, made } = pipScene();
    const foe = boss({ hp: 10, stones: 2 });
    foe.affixes = ['thorns'];
    BattleScene.prototype.updateAffixPips.call(scene, foe);
    expect(foe.affixPips).toHaveLength(3); // two gems and the Thorns square
    expect(made.filter((r) => r.angle === 45)).toHaveLength(2);
    foe.revivalStones = 1;
    BattleScene.prototype.updateAffixPips.call(scene, foe);
    expect(foe.affixPips).toHaveLength(2);
    expect(made.slice(0, 3).every((r) => r.destroy.mock.calls.length === 1)).toBe(true);
    foe.revivalStones = 0;
    foe.affixes = [];
    BattleScene.prototype.updateAffixPips.call(scene, foe);
    expect(foe.affixPips).toEqual([]);
  });

  it('a unit with neither draws nothing', () => {
    const { scene, made } = pipScene();
    const foe = boss({ hp: 10, stones: 0 });
    BattleScene.prototype.updateAffixPips.call(scene, foe);
    expect(foe.affixPips).toEqual([]);
    expect(made).toEqual([]);
  });
});
