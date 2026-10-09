// The earned blessings that act in battle (docs/specs/blessings-v3.md §6; engine/BattleBlessings.js),
// driven through BattleScene (real executeCombat / executeEnemyCombat / processTurnStartEffects,
// no drawing) and through the headless harness, which must agree: one engine, no copies.
//
//   Ember Lantern: the army's first kill each battle heals the killer 10 HP (healUnit), and is
//     spent by that kill even when it heals nothing (Wounded, full HP).
//   Captain's Whistle: +1 MOV to the army on turn 1's player phase, until that turn's enemy
//     phase; strongest-per-stat with Mark of the Road; never on the saved unit.
//   Unbroken Banner (the rule is tests/UnbrokenBanner.test.js): here, held in both worlds, and
//     in the scene's own lethal paths (Deathburst, a ballista bolt, the Entity's splash).
//   The spent state rides the battle world snapshot: a suspend keeps it, a rewind to before a
//     hold readies it again, a fresh battle (Continue from Map) starts with nothing spent.
//
// Numbers worked by hand (OnKillSkills.test.js's fixture):
//   Edric: STR 12, Test Blade 8 might, hit 100, max HP 40 (20 when the fight starts).
//   A DEF 4 foe takes 12 + 8 - 4 = 16 from him: 10 HP dies, 30 survives.
//   An armed foe (STR 5, Test Lance 5 might, hit 300) has the triangle on his sword: it hits
//   him for 5 + 5 - 7 + 1 = 4, and he hits it for 16 - 1 = 15.
//   A brute (STR 30, Test Lance) hits Edric for 30 + 5 - 7 + 1 = 29.
import { afterEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { presentationFailureProxy as rendering } from './harness/PresentationFailureProxy.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { registerBattleEntity } from '../src/engine/BattleEntityIdentity.js';
import { applyCondition } from '../src/engine/StatusConditionSystem.js';
import { serializeUnit } from '../src/engine/RunManager.js';
import { serializeBattleUnit } from '../src/engine/BattleUnitState.js';
import { postCombatEffects } from '../src/engine/PostCombatEffects.js';
import {
  captureBattleWorldState,
  restoreBattleWorldState,
} from '../src/engine/BattleSnapshotState.js';
import {
  BANNER,
  LANTERN,
  bannerReadyFor,
  battleBlessingsAtStart,
  blessingTurnStartEffects,
  createBattleBlessings,
  lanternReady,
} from '../src/engine/BattleBlessings.js';
import { applyTimedBuffEntry, expireTimedBuffs } from '../src/engine/TimedWeaponArtBuffs.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const originalRandom = Math.random;
afterEach(() => {
  Math.random = originalRandom;
  vi.restoreAllMocks();
});

const plain = data.terrain.find((t) => t.name === 'Plain');
const blast = {
  id: 'test_blast',
  name: 'Test Blast',
  weaponType: 'Sword',
  tierAffinity: 'Steel',
  unlockAct: 'act1',
  requiredRank: 'Prof',
  hpCost: 0,
  perMapLimit: 3,
  targeting: 'normal_attack',
  area: { shape: 'radius', radius: 1, damage: { kind: 'fixed', amount: 30 } },
  description: 'Test.',
  combatMods: {},
};
const arts = [blast];
const body = { HP: 30, STR: 12, MAG: 0, SKL: 9, SPD: 9, DEF: 7, RES: 3, LCK: 5, MOV: 5 };
const testBlade = () => ({
  name: 'Test Blade',
  type: 'Sword',
  might: 8,
  hit: 100,
  crit: 0,
  weight: 5,
  range: '1',
  special: '',
  weaponArtIds: arts.map((a) => a.id),
  weaponArtSources: arts.map(() => 'scroll'),
});
const testLance = () => ({
  name: 'Test Lance',
  type: 'Lance',
  might: 5,
  hit: 300,
  crit: 0,
  weight: 1,
  range: '1',
  special: '',
});

function makeAlly(name, { hp = 20, maxHp = 40, col = 0, row = 0, extra = {} } = {}) {
  const weapon = testBlade();
  return {
    name,
    level: 5,
    tier: 'base',
    faction: 'player',
    col,
    row,
    xp: 0,
    currentHP: hp,
    stats: { ...body, HP: maxHp },
    mov: body.MOV,
    moveType: 'Infantry',
    className: 'Myrmidon',
    growths: {},
    weaponRank: 'Mast',
    weapon,
    inventory: [weapon],
    proficiencies: [{ type: 'Sword', rank: 'Mast' }],
    skills: [],
    accessory: null,
    affixes: [],
    _gambitUsedThisTurn: true,
    ...extra,
  };
}
const makeEdric = (opts = {}) =>
  makeAlly('Edric', { ...opts, extra: { isCommander: true, isLord: true, ...opts.extra } });
function makeFoe(name, col, hp, { row = 0, armed = false, stats = {}, extra = {} } = {}) {
  const lance = armed ? testLance() : null;
  return {
    name,
    level: 5,
    tier: 'base',
    faction: 'enemy',
    className: 'Soldier',
    col,
    row,
    currentHP: hp,
    moveType: 'Infantry',
    stats: { ...body, HP: Math.max(hp, 1), DEF: 4, ...(armed ? { STR: 5 } : {}), ...stats },
    weapon: lance,
    inventory: lance ? [lance] : [],
    skills: [],
    accessory: null,
    affixes: [],
    ...extra,
  };
}
// Keeps a rout from ending when the foe under test falls.
const bystander = () => makeFoe('Bystander', 7, 30, { row: 7 });

/** The battle through BattleScene, holding `state` as its earned blessings. */
function sceneWorld(players, enemies, state, roll = 0.01) {
  const scene = journeyBattleScene({}, { ...data, weaponArts: { ...data.weaponArts, arts } });
  scene.runManager = null;
  scene._battleRewindPolicy = 'fixed-v1';
  scene._battleRng = createBattleRng(42);
  Object.assign(scene.grid, {
    cols: 8,
    rows: 8,
    fogEnabled: false,
    clearTemporaryTerrainsBySource: () => {},
    getMoveCost: () => 1,
    getTerrainAt: () => plain,
  });
  scene.battleConfig = { objective: 'rout' };
  scene.goldEarned = 0;
  scene.turnPar = 99;
  scene.turnBonusConfig = data.turnBonus;
  scene.getCurrentTurnNumber = () => 1;
  scene.playerUnits = players;
  scene.enemyUnits = enemies;
  scene._battleBlessings = state;
  for (const u of [...players, ...enemies]) registerBattleEntity(scene, u);
  rendering(scene, 0);
  let art = null;
  scene._getSelectedWeaponArtForUnit = () => art;
  scene.animateStrike = async () => {};
  scene.animateSkillActivation = async () => {};
  scene._battleBeats.checkBossHalfHealth = async () => {};
  scene._battleBeats.onChipLance = () => {};
  scene._battleBeats.onLowHealth = () => {};
  scene.sys = { isActive: () => true };
  scene.scene = { isActive: () => true };
  scene.onVictory = () => {
    scene.battleState = 'BATTLE_END';
  };
  scene.onDefeat = () => {
    scene.result = 'defeat';
    scene.battleState = 'BATTLE_END';
  };
  scene.awardScaledXP = async () => {};
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const stub = () => {
    Math.random = () => roll;
  };
  return {
    kind: 'scene',
    scene,
    stub,
    attack: async (attacker, defender, useArt = null) => {
      art = useArt;
      stub();
      await scene.executeCombat(attacker, defender);
    },
    enemyAttack: async (foe, target) => {
      stub();
      await scene.executeEnemyCombat(foe, target);
    },
    turnStart: async (units, turn = 1) => {
      stub();
      scene.turnManager.turnNumber = turn;
      await scene.processTurnStartEffects(units);
    },
    expire: (phase, turn) => scene._expireTimedWeaponArtBuffs(phase, turn),
  };
}

/** The same battle through the headless harness. */
function harnessWorld(players, enemies, state, roll = 0.01) {
  const gameData = structuredClone(data);
  gameData.weaponArts.arts.push(...arts);
  const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout' });
  battle.turnManager = { turnNumber: 1, unitActed() {} };
  battle.battleConfig = { objective: 'rout' };
  battle.turnPar = 99;
  battle.playerUnits = players;
  battle.enemyUnits = enemies;
  battle.npcUnits = [];
  battle._battleBlessings = state;
  battle.grid = {
    cols: 8,
    rows: 8,
    fogEnabled: false,
    getTerrainAt: () => ({}),
    getMoveCost: () => 1,
    updateFogOfWar() {},
  };
  battle._grantScaledXP = () => {};
  const withRoll = (fn) => {
    const prev = Math.random;
    Math.random = () => roll;
    try {
      return fn();
    } finally {
      Math.random = prev;
    }
  };
  return {
    kind: 'harness',
    battle,
    withRoll,
    attack: async (attacker, defender, useArt = null) => {
      battle.selectedUnit = attacker;
      if (useArt) battle._setSelectedWeaponArt(attacker, useArt.id, attacker.weapon);
      withRoll(() => battle._executeCombat(attacker, defender));
    },
    enemyAttack: async (foe, target) => withRoll(() => battle._executeEnemyCombat(foe, target)),
    turnStart: async (units, turn = 1) => {
      battle.turnManager.turnNumber = turn;
      withRoll(() => battle._processTurnStartEffects(units));
    },
    expire: (phase, turn) => battle._expireTimedWeaponArtBuffs(phase, turn),
  };
}

const WORLDS = [
  ['the scene', sceneWorld],
  ['the harness', harnessWorld],
];
const lantern = () => createBattleBlessings({ firstKillHeal: 10 });
const whistle = () => createBattleBlessings({ firstTurnMov: 1 });
const banner = () => createBattleBlessings({ lastStand: 1 });

describe.each(WORLDS)('Ember Lantern through %s', (_label, makeWorld) => {
  it("heals the army's first kill 10 HP, and no later kill", async () => {
    const edric = makeEdric();
    const a = makeFoe('A', 1, 10);
    const b = makeFoe('B', 1, 10);
    const state = lantern();
    const world = makeWorld([edric], [a, bystander()], state);
    await world.attack(edric, a);
    expect(a.currentHP).toBe(0);
    expect(edric.currentHP).toBe(30);
    expect(state.spent).toEqual([LANTERN]);
    // A second kill in the same battle: nothing.
    world.kind === 'scene' ? world.scene.enemyUnits.push(b) : world.battle.enemyUnits.push(b);
    await world.attack(edric, b);
    expect(b.currentHP).toBe(0);
    expect(edric.currentHP).toBe(30);
    expect(state.spent).toEqual([LANTERN]);
  });

  it('a counter-kill lights it: the defender fells its attacker', async () => {
    // The lance hits Edric 20 -> 16; his counter's 15 fells the 10 HP foe: 16 + 10 = 26.
    const edric = makeEdric();
    const foe = makeFoe('Foe', 1, 10, { armed: true });
    const state = lantern();
    await makeWorld([edric], [foe, bystander()], state).enemyAttack(foe, edric);
    expect(foe.currentHP).toBe(0);
    expect(edric.currentHP).toBe(26);
    expect(lanternReady(state)).toBe(false);
  });

  it('an area art that fells a victim beside the target lights it', async () => {
    // The 30-point blast fells the 20 HP neighbour; the 40 HP target survives the 16.
    const edric = makeEdric();
    const target = makeFoe('Target', 1, 40);
    const beside = makeFoe('Beside', 1, 20, { row: 1 });
    const state = lantern();
    await makeWorld([edric], [target, beside, bystander()], state).attack(edric, target, blast);
    expect([target.currentHP > 0, beside.currentHP]).toEqual([true, 0]);
    expect(edric.currentHP).toBe(30);
  });

  it('a blow that kills nothing, or only breaks a Revival Stone, leaves it lit', async () => {
    const edric = makeEdric();
    const tough = makeFoe('Tough', 1, 30);
    const stoned = makeFoe('Boss', 1, 10, {
      stats: { HP: 30 },
      extra: { revivalStones: 1, revivalStonesMax: 1 },
    });
    const state = lantern();
    const world = makeWorld([edric], [tough, stoned, bystander()], state);
    await world.attack(edric, tough);
    await world.attack(edric, stoned);
    expect(tough.currentHP).toBe(14);
    expect(stoned.currentHP).toBe(30); // the stone refilled the bar
    expect(edric.currentHP).toBe(20);
    expect(lanternReady(state)).toBe(true);
  });

  it('a Wounded killer heals nothing, and the kill still spends it', async () => {
    const edric = makeEdric();
    applyCondition(edric, 'wounded', 3, { recoveryChance: 0 });
    const foe = makeFoe('Foe', 1, 10);
    const state = lantern();
    await makeWorld([edric], [foe, bystander()], state).attack(edric, foe);
    expect(edric.currentHP).toBe(20);
    expect(state.spent).toEqual([LANTERN]);
  });

  it('a killer at full HP spends it too', async () => {
    const edric = makeEdric({ hp: 40 });
    const foe = makeFoe('Foe', 1, 10);
    const state = lantern();
    await makeWorld([edric], [foe, bystander()], state).attack(edric, foe);
    expect(edric.currentHP).toBe(40);
    expect(state.spent).toEqual([LANTERN]);
  });

  it("a foe's kill never spends it", async () => {
    const edric = makeEdric({ col: 5, row: 5 });
    const sera = makeAlly('Sera', { hp: 3 });
    const foe = makeFoe('Foe', 1, 30, { armed: true });
    const state = lantern();
    await makeWorld([edric, sera], [foe, bystander()], state).enemyAttack(foe, sera);
    expect(sera.currentHP).toBe(0);
    expect(lanternReady(state)).toBe(true);
  });
});

describe('Ember Lantern in the post-combat generator', () => {
  const world = (units, battleBlessings) => ({
    affixes: data.affixes,
    cols: 8,
    rows: 8,
    getMoveCost: () => 1,
    getTerrainAt: () => null,
    getUnitAt: (col, row) =>
      units.find((u) => u.col === col && u.row === row && u.currentHP > 0) || null,
    hostilesOf: (u) => units.filter((o) => o.faction !== u.faction && o.faction !== 'npc'),
    alliesOf: (u) => units.filter((o) => o.faction === u.faction),
    turnNumber: 1,
    ...(battleBlessings ? { battleBlessings } : {}),
  });
  const killed = (side) => ({
    events: [{ type: 'strike', attackerSide: side, miss: false, damage: 10 }],
  });

  it("an NPC ally's kill never spends it", () => {
    const npc = makeAlly('Villager', { extra: { faction: 'npc' } });
    const foe = makeFoe('Foe', 1, 0);
    const state = lantern();
    const beats = [
      ...postCombatEffects(
        { attacker: npc, defender: foe, result: killed('attacker') },
        world([npc, foe], state),
      ),
    ];
    expect(beats).toEqual([]);
    expect(lanternReady(state)).toBe(true);
  });

  it('says so in a muted line when the kill heals nothing (Wounded)', () => {
    const edric = makeEdric();
    applyCondition(edric, 'wounded', 3, { recoveryChance: 0 });
    const foe = makeFoe('Foe', 1, 0);
    const beats = [
      ...postCombatEffects(
        { attacker: edric, defender: foe, result: killed('attacker') },
        world([edric, foe], lantern()),
      ),
    ];
    expect(beats).toEqual([{ kind: 'hint', unit: edric, text: 'Ember Lantern +0', tone: 'muted' }]);
  });

  it('a heal yields the HP beat and its line', () => {
    const edric = makeEdric();
    const foe = makeFoe('Foe', 1, 0);
    const beats = [
      ...postCombatEffects(
        { attacker: edric, defender: foe, result: killed('attacker') },
        world([edric, foe], lantern()),
      ),
    ];
    expect(beats).toEqual([
      { kind: 'hp', unit: edric },
      { kind: 'hint', unit: edric, text: 'Ember Lantern +10', tone: 'heal' },
    ]);
  });

  it('a chosen-center cast (no combat) never lights it, though it kills', () => {
    // OnKillSkills.test.js's cast: a 30-point blast from a tome, aimed at a tile.
    const cast = {
      id: 'test_cast',
      name: 'Test Cast',
      weaponType: 'Tome',
      allowedTypes: ['Tome'],
      tierAffinity: 'Silver',
      unlockAct: 'act1',
      requiredRank: 'Prof',
      hpCost: 0,
      perMapLimit: 2,
      targeting: 'chosen_center',
      area: {
        shape: 'radius',
        radius: 1,
        damage: { kind: 'fixed', amount: 30 },
        centerRange: 'weapon',
      },
      allowedFactions: ['player'],
      description: 'Test.',
      combatMods: {},
    };
    const tome = {
      ...structuredClone(data.weapons.find((w) => w.name === 'Breachbolt')),
      weaponArtIds: [cast.id],
    };
    const edric = makeEdric({
      extra: { weapon: tome, inventory: [tome], proficiencies: [{ type: 'Tome', rank: 'Mast' }] },
    });
    edric.stats.MAG = 22;
    const victim = makeFoe('Victim', 4, 5);
    const state = lantern();
    const world = harnessWorld([edric], [victim, bystander()], state);
    world.battle.gameData.weaponArts.arts.push(cast);
    expect(world.battle.executeAreaStrike(edric, cast.id, { col: 4, row: 0 })).toBe(true);
    expect(victim.currentHP).toBe(0);
    expect(edric.currentHP).toBe(20);
    expect(lanternReady(state)).toBe(true);
  });

  it('does nothing without the blessing (no beat at all)', () => {
    const edric = makeEdric();
    const foe = makeFoe('Foe', 1, 0);
    expect([
      ...postCombatEffects(
        { attacker: edric, defender: foe, result: killed('attacker') },
        world([edric, foe], null),
      ),
    ]).toEqual([]);
    expect(edric.currentHP).toBe(20);
  });
});

describe.each(WORLDS)("Captain's Whistle through %s", (_label, makeWorld) => {
  it('+1 MOV to every living army unit on turn 1, ending as turn 1’s enemy phase starts', async () => {
    const edric = makeEdric({ hp: 40 });
    const sera = makeAlly('Sera', { hp: 40, col: 1 });
    const world = makeWorld([edric, sera], [bystander()], whistle());
    await world.turnStart([edric, sera], 1);
    expect([edric.stats.MOV, edric.mov, sera.stats.MOV]).toEqual([6, 6, 6]);
    world.expire('player', 2);
    expect(edric.stats.MOV).toBe(6);
    world.expire('enemy', 1);
    expect([edric.stats.MOV, edric.mov, sera.stats.MOV]).toEqual([5, 5, 5]);
  });

  it('nothing on turn 2 or later', async () => {
    const edric = makeEdric({ hp: 40 });
    const world = makeWorld([edric], [bystander()], whistle());
    await world.turnStart([edric], 2);
    expect(edric.stats.MOV).toBe(5);
  });

  it('an enemy or an NPC ally gets nothing', async () => {
    const foe = makeFoe('Foe', 1, 20);
    const npc = makeAlly('Villager', { extra: { faction: 'npc' } });
    const world = makeWorld([makeEdric()], [foe, bystander()], whistle());
    await world.turnStart([foe, npc], 1);
    expect([foe.stats.MOV, npc.stats.MOV]).toEqual([5, 5]);
  });

  it('does not stack with Mark of the Road: +1, not +2 (strongest per stat)', async () => {
    // Road fires at roll 0.01 (25%).
    const edric = makeEdric({ hp: 40, extra: { markId: 'road' } });
    const world = makeWorld([edric], [bystander()], whistle(), 0.01);
    await world.turnStart([edric], 1);
    expect(edric._battleTimedWeaponArtBuffs.map((b) => b.sourceName).sort()).toEqual([
      "Captain's Whistle",
      'Mark of the Road',
    ]);
    expect(edric.stats.MOV).toBe(6);
  });

  it('without the blessing turn 1 gives nothing', async () => {
    const edric = makeEdric({ hp: 40 });
    const world = makeWorld([edric], [bystander()], null);
    await world.turnStart([edric], 1);
    expect(edric.stats.MOV).toBe(5);
    expect(edric._battleTimedWeaponArtBuffs).toBeUndefined();
  });
});

describe("Captain's Whistle on the saved and the resumed unit", () => {
  it('never reaches the saved roster unit (no permanent MOV after victory)', () => {
    const edric = makeEdric({ hp: 40 });
    for (const e of blessingTurnStartEffects([edric], whistle(), 1))
      applyTimedBuffEntry(e.target, e.entry);
    expect(edric.stats.MOV).toBe(6);
    const saved = serializeUnit(edric);
    expect([saved.stats.MOV, saved.mov]).toEqual([5, 5]);
  });

  it('a turn-1 resume keeps +1 on the checkpoint unit, and a second apply never makes it +2', () => {
    const edric = makeEdric({ hp: 40 });
    const state = whistle();
    for (const e of blessingTurnStartEffects([edric], state, 1))
      applyTimedBuffEntry(e.target, e.entry);
    const resumed = JSON.parse(JSON.stringify(serializeBattleUnit(edric)));
    expect(resumed.stats.MOV).toBe(6);
    for (const e of blessingTurnStartEffects([resumed], state, 1))
      applyTimedBuffEntry(e.target, e.entry);
    expect(resumed.stats.MOV).toBe(6);
    expireTimedBuffs([resumed], 'enemy', 1);
    expect(resumed.stats.MOV).toBe(5);
  });

  it('the harness applies it when its own turn-1 player phase starts, and not on turn 2', () => {
    const edric = makeEdric({ hp: 40 });
    const world = harnessWorld([edric], [bystander()], whistle());
    world.withRoll(() => world.battle._onPhaseChange('player', 1));
    expect(edric.stats.MOV).toBe(6);
    world.battle._onPhaseChange('enemy', 1);
    expect(edric.stats.MOV).toBe(5);
    world.battle.turnManager.turnNumber = 2;
    world.withRoll(() => world.battle._onPhaseChange('player', 2));
    expect(edric.stats.MOV).toBe(5);
  });
});

describe.each(WORLDS)('the Unbroken Banner through %s', (_label, makeWorld) => {
  it('holds the first ally a foe would fell, and the next blow fells', async () => {
    // The brute's 29 on 20 HP: held at 1; then 29 on 1: down.
    const edric = makeEdric({ col: 5, row: 5 });
    const sera = makeAlly('Sera', { hp: 20 });
    const brute = makeFoe('Brute', 1, 30, { armed: true, stats: { STR: 30 } });
    const state = banner();
    const world = makeWorld([edric, sera], [brute, bystander()], state);
    await world.enemyAttack(brute, sera);
    expect(sera.currentHP).toBe(1);
    expect(state.spent).toEqual([BANNER]);
    const players = world.kind === 'scene' ? world.scene.playerUnits : world.battle.playerUnits;
    expect(players).toContain(sera);
    await world.enemyAttack(brute, sera);
    expect(sera.currentHP).toBe(0);
    expect(players).not.toContain(sera);
  });
});

describe('scene and harness agree on the same battle', () => {
  it('a hold, a counter-kill and the whistle leave the same state in both', async () => {
    const outcomes = [];
    for (const [, make] of WORLDS) {
      const edric = makeEdric({ hp: 20 });
      const sera = makeAlly('Sera', { hp: 20, col: 2 });
      const brute = makeFoe('Brute', 3, 30, { armed: true, stats: { STR: 30 } });
      const weak = makeFoe('Weak', 1, 10, { armed: true });
      const state = createBattleBlessings({ lastStand: 1, firstKillHeal: 10, firstTurnMov: 1 });
      const world = make([edric, sera], [brute, weak, bystander()], state);
      await world.turnStart([edric, sera], 1);
      await world.enemyAttack(brute, sera); // held at 1
      await world.enemyAttack(weak, edric); // 20 -> 16, counter-kill: +10
      outcomes.push({
        hp: [edric.currentHP, sera.currentHP, weak.currentHP],
        mov: [edric.stats.MOV, sera.stats.MOV],
        spent: [...state.spent].sort(),
      });
    }
    expect(outcomes[0]).toEqual({ hp: [26, 1, 0], mov: [6, 6], spent: [BANNER, LANTERN] });
    expect(outcomes[1]).toEqual(outcomes[0]);
  });

  it('the harness reads the run’s blessings at its own battle start (no copy of the rule)', () => {
    const battle = new HeadlessBattle(structuredClone(data), { act: 'act1', objective: 'rout' });
    battle.runManager = {
      getBattleBlessingEffects: () => ({ lastStand: 1, firstKillHeal: 10, firstTurnMov: 1 }),
    };
    battle.init();
    expect(battle._battleBlessings).toMatchObject({ lastStand: 1, firstKillHeal: 10, spent: [] });
    expect(battle._buildSkillCtx(battle.playerUnits[0], battle.enemyUnits[0]).battleBlessings).toBe(
      battle._battleBlessings,
    );
    expect(battle._postCombatWorld().battleBlessings).toBe(battle._battleBlessings);
    // Turn 1 started in init: the whistle is on the army already.
    for (const u of battle.playerUnits)
      expect(u._battleTimedWeaponArtBuffs?.some((b) => b.sourceName === "Captain's Whistle")).toBe(
        true,
      );
  });

  it('without the blessings neither world adds a key to the skill context or the world', () => {
    const battle = new HeadlessBattle(structuredClone(data), { act: 'act1', objective: 'rout' });
    battle.init();
    expect(battle._battleBlessings).toBeNull();
    expect(battle._buildSkillCtx(battle.playerUnits[0], battle.enemyUnits[0])).not.toHaveProperty(
      'battleBlessings',
    );
    expect(battle._postCombatWorld()).not.toHaveProperty('battleBlessings');
    const scene = sceneWorld([makeEdric()], [makeFoe('Foe', 1, 10)], null).scene;
    expect(scene.buildSkillCtx(scene.playerUnits[0], scene.enemyUnits[0])).not.toHaveProperty(
      'battleBlessings',
    );
    expect(scene._postCombatWorld()).not.toHaveProperty('battleBlessings');
  });
});

describe('the scene’s own lethal paths hold an ally', () => {
  it('a Deathburst: the burst that would fell an ally beside the dying foe holds it', async () => {
    // Edric fells the 10 HP bomber; its 5-point burst hits Edric (20 -> 15) and Sera (3: held).
    const edric = makeEdric();
    const sera = makeAlly('Sera', { hp: 3, col: 1, row: 1 });
    const bomber = makeFoe('Bomber', 1, 10, { extra: { affixes: ['deathburst'] } });
    const state = banner();
    const world = sceneWorld([edric, sera], [bomber, bystander()], state);
    await world.attack(edric, bomber);
    expect([bomber.currentHP, edric.currentHP, sera.currentHP]).toEqual([0, 15, 1]);
    expect(state.spent).toEqual([BANNER]);
  });

  it('a Deathburst kill is no kill of the army: the Ember Lantern stays lit', async () => {
    // Sera bears the burst; the lance's 4 fells her 3 HP; her burst fells the 3 HP foe beside
    // her. Nobody of the army killed in a combat.
    const edric = makeEdric({ col: 6, row: 6 });
    const sera = makeAlly('Sera', { hp: 3, col: 1, row: 1, extra: { affixes: ['deathburst'] } });
    const lancer = makeFoe('Lancer', 1, 30, { armed: true });
    const frail = makeFoe('Frail', 0, 3, { row: 1 });
    const state = lantern();
    const world = sceneWorld([edric, sera], [lancer, frail, bystander()], state);
    await world.enemyAttack(lancer, sera);
    expect([sera.currentHP, frail.currentHP]).toEqual([0, 0]);
    expect(lanternReady(state)).toBe(true);
  });

  it('an enemy ballista bolt that would fell an ally holds it', async () => {
    const sera = makeAlly('Sera', { hp: 3, col: 2, row: 0 });
    const state = banner();
    const world = sceneWorld([makeEdric({ col: 6, row: 6 }), sera], [bystander()], state, 0);
    world.scene.ballistas = [{ col: 0, row: 0, owner: 'enemy' }];
    world.stub();
    await world.scene.processBallistaFire([sera], 'enemy');
    expect(sera.currentHP).toBe(1);
    expect(state.spent).toEqual([BANNER]);
  });

  it("the Entity's splash that would fell an ally holds it", async () => {
    // Roll 0.99: the splash takes the first two tiles around the target, (2,1) then (1,2),
    // for 5 + floor(0.99 * 6) = 10 each. Sera stands on (2,1) with 4 HP.
    const target = makeEdric({ col: 2, row: 2, hp: 40 });
    const sera = makeAlly('Sera', { hp: 4, col: 2, row: 1 });
    const entity = makeFoe('The Entity', 6, 99, { row: 6, extra: { isEntity: true } });
    const state = banner();
    const world = sceneWorld([target, sera], [entity, bystander()], state, 0.99);
    world.stub();
    await world.scene._applyEntitySplash(entity, target);
    expect(sera.currentHP).toBe(1);
    expect(state.spent).toEqual([BANNER]);
  });
});

describe('the spent state rides the battle world snapshot', () => {
  const sceneOf = (state) => ({
    playerUnits: [],
    enemyUnits: [],
    npcUnits: [],
    _battleBlessings: state,
  });

  it('a suspend keeps the banner spent: a resumed battle holds no second ally', () => {
    const live = sceneOf(createBattleBlessings({ lastStand: 1, firstKillHeal: 10 }));
    live._battleBlessings.spent.push(BANNER, LANTERN);
    const checkpoint = JSON.parse(JSON.stringify(captureBattleWorldState(live)));
    expect(checkpoint.battleBlessingsSpent).toEqual([BANNER, LANTERN]);
    // The resumed scene builds its state from the run at start, then the checkpoint restores.
    const resumed = sceneOf(
      battleBlessingsAtStart({
        run: { getBattleBlessingEffects: () => ({ lastStand: 1, firstKillHeal: 10 }) },
      }),
    );
    restoreBattleWorldState(resumed, checkpoint);
    expect(bannerReadyFor(resumed._battleBlessings, makeAlly('Sera'))).toBe(false);
    expect(lanternReady(resumed._battleBlessings)).toBe(false);
  });

  it('a Vision rewind to before the hold readies the banner again', () => {
    const scene = sceneOf(banner());
    const before = captureBattleWorldState(scene);
    scene._battleBlessings.spent.push(BANNER);
    expect(bannerReadyFor(scene._battleBlessings, makeAlly('Sera'))).toBe(false);
    const state = scene._battleBlessings;
    restoreBattleWorldState(scene, before);
    expect(scene._battleBlessings).toBe(state); // restored in place
    expect(bannerReadyFor(scene._battleBlessings, makeAlly('Sera'))).toBe(true);
  });

  it('Continue from Map starts a fresh battle: nothing spent', () => {
    const run = { getBattleBlessingEffects: () => ({ lastStand: 1, firstKillHeal: 10 }) };
    expect(battleBlessingsAtStart({ run }).spent).toEqual([]);
  });

  it('a battle without the blessings saves no key, and an old snapshot restores nothing spent', () => {
    expect(captureBattleWorldState(sceneOf(null))).not.toHaveProperty('battleBlessingsSpent');
    const scene = sceneOf(banner());
    scene._battleBlessings.spent.push(BANNER);
    restoreBattleWorldState(scene, {});
    expect(scene._battleBlessings.spent).toEqual([]);
  });
});
