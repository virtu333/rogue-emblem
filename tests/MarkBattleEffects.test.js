// The five Marks in battle (docs/specs/phase3.md 3C). Every fight runs the real combat and the
// real post-combat generator twice: through BattleScene and through the headless harness, and
// both must agree. Each Mark rolls on the battle's Math.random, which a test stubs to a constant
// `roll` (a proc fires when roll * 100 < its percentage, so 0.1499 fires a 15% Mark and 0.15
// does not). Numbers are worked by hand:
//   Edric: STR 12, Test Blade 8 might, hit 100, SPD 9, SKL 9, RES 3, LCK 5, max HP 40 (20 now).
//   A foe with DEF 4 takes 12 + 8 - 4 = 16 from him; Hunt makes it 21.
//   A foe mage (MAG 5, Test Tome 5 might) hits his 3 RES for 5 + 5 - 3 = 7; halved, 3.
//   An armed foe (STR 5, Test Lance 5 might) has the triangle on his sword: 5 + 5 - 7 + 1 = 4
//   on him and 16 - 1 = 15 back (+5 with Hunt).
//   Ember heals 5. Forge spares an art's HP cost (5 below). Road gives +1 MOV (5 -> 6).
// Ways this goes wrong, each caught below: a Mark rolls at the wrong percentage or at 0;
// fires for a unit that does not bear it; reaches the scene but not the harness (or the other
// way); Hunt adds damage to a strike that deals none; Veil halves a physical strike, or stacks
// with Aegis; Ember fires twice for two kills, on a kill that was not made, or through Wounded;
// Forge makes an unaffordable art usable; Road's MOV outlives its phase or its battle.
import { afterEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { presentationFailureProxy as rendering } from './harness/PresentationFailureProxy.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { registerBattleEntity } from '../src/engine/BattleEntityIdentity.js';
import { applyCondition } from '../src/engine/StatusConditionSystem.js';
import { resolveCombat, getCombatForecast } from '../src/engine/Combat.js';
import { serializeUnit } from '../src/engine/RunManager.js';
import { serializeBattleUnit } from '../src/engine/BattleUnitState.js';
import { applyWeaponArtCost, canUseWeaponArt } from '../src/engine/WeaponArtSystem.js';
import { getTurnStartEffects } from '../src/engine/SkillSystem.js';
import { getPostCombatPipelineSteps } from '../src/engine/WeaponArtPostCombat.js';
import { forecastProjection } from '../src/ui/forecastDisplay.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const marks = data.marks;
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
  hpCost: 1,
  perMapLimit: 3,
  targeting: 'normal_attack',
  area: { shape: 'radius', radius: 1, damage: { kind: 'fixed', amount: 30 } },
  description: 'Test.',
  combatMods: {},
};
// A plain strike that costs 5 HP: Forge's subject.
const costly = {
  id: 'test_costly',
  name: 'Test Costly',
  weaponType: 'Sword',
  tierAffinity: 'Steel',
  unlockAct: 'act1',
  requiredRank: 'Prof',
  hpCost: 5,
  perMapLimit: 3,
  targeting: 'normal_attack',
  description: 'Test.',
  combatMods: {},
};
const arts = [blast, costly];
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
const testTome = () => ({
  name: 'Test Tome',
  type: 'Tome',
  might: 5,
  hit: 300,
  crit: 0,
  weight: 1,
  range: '1-2',
  special: '',
});

function makeEdric({ markId, skills = [], hp = 20, maxHp = 40, extra = {} } = {}) {
  const weapon = testBlade();
  return {
    name: 'Edric',
    level: 5,
    tier: 'base',
    faction: 'player',
    col: 0,
    row: 0,
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
    skills,
    accessory: null,
    affixes: [],
    isCommander: true,
    isLord: true,
    _gambitUsedThisTurn: true,
    ...(markId ? { markId } : {}),
    ...extra,
  };
}
function makeFoe(name, col, hp, { row = 0, kind = 'none', stats = {}, extra = {} } = {}) {
  const weapon = kind === 'lance' ? testLance() : kind === 'tome' ? testTome() : null;
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
    stats: {
      ...body,
      HP: Math.max(hp, 1),
      DEF: 4,
      ...(kind === 'lance' ? { STR: 5 } : {}),
      ...(kind === 'tome' ? { MAG: 5 } : {}),
      ...stats,
    },
    weapon,
    inventory: weapon ? [weapon] : [],
    skills: [],
    accessory: null,
    affixes: [],
    ...extra,
  };
}
// Keeps a rout from ending when the foe under test falls.
const bystander = () => makeFoe('Bystander', 7, 30, { row: 7 });

/** The battle through BattleScene: real executeCombat / executeEnemyCombat, no drawing. */
function sceneWorld(players, enemies, roll) {
  const scene = journeyBattleScene({}, { ...data, weaponArts: { ...data.weaponArts, arts } });
  scene.runManager = null;
  scene._battleRewindPolicy = 'fixed-v1';
  scene._battleRng = createBattleRng(42);
  Object.assign(scene.grid, {
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
    buildSkillCtx: (a, d) => scene.buildSkillCtx(a, d),
    attack: async (attacker, defender, useArt = null) => {
      art = useArt;
      stub();
      await scene.executeCombat(attacker, defender);
    },
    enemyAttack: async (foe, target) => {
      stub();
      await scene.executeEnemyCombat(foe, target);
    },
    turnStart: async (units) => {
      stub();
      scene.turnManager.turnNumber = 1;
      await scene.processTurnStartEffects(units);
    },
    expire: (phase, turn) => scene._expireTimedWeaponArtBuffs(phase, turn),
  };
}

/** The same battle through the headless harness, which mirrors the scene's state machine. */
function harnessWorld(players, enemies, roll) {
  const gameData = structuredClone(data);
  gameData.weaponArts.arts.push(...arts);
  const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout' });
  battle.turnManager = { turnNumber: 1, unitActed() {} };
  battle.battleConfig = { objective: 'rout' };
  battle.turnPar = 99;
  battle.playerUnits = players;
  battle.enemyUnits = enemies;
  battle.npcUnits = [];
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
    buildSkillCtx: (a, d) => battle._buildSkillCtx(a, d),
    attack: async (attacker, defender, useArt = null) => {
      battle.selectedUnit = attacker;
      if (useArt) battle._setSelectedWeaponArt(attacker, useArt.id, attacker.weapon);
      withRoll(() => battle._executeCombat(attacker, defender));
    },
    enemyAttack: async (foe, target) => withRoll(() => battle._executeEnemyCombat(foe, target)),
    turnStart: async (units) => withRoll(() => battle._processTurnStartEffects(units)),
    expire: (phase, turn) => battle._expireTimedWeaponArtBuffs(phase, turn),
  };
}

const WORLDS = [
  ['the scene', sceneWorld],
  ['the harness', harnessWorld],
];

describe.each(WORLDS)('Mark of the Hunt through %s', (_label, makeWorld) => {
  const strike = async ({ markId = 'hunt', roll, foeHP = 40, foeStats = {} }) => {
    const edric = makeEdric({ markId });
    const foe = makeFoe('Foe', 1, foeHP, { stats: foeStats });
    const world = makeWorld([edric], [foe, bystander()], roll);
    await world.attack(edric, foe);
    return { edric, foe, world };
  };

  it('adds 5 damage to a strike on a fired roll: 21, not 16', async () => {
    expect((await strike({ roll: 0.01 })).foe.currentHP).toBe(40 - 21);
  });

  it('fires below 15 and not at it', async () => {
    expect((await strike({ roll: 0.1499 })).foe.currentHP).toBe(40 - 21);
    expect((await strike({ roll: 0.15 })).foe.currentHP).toBe(40 - 16);
    expect((await strike({ roll: 0.9 })).foe.currentHP).toBe(40 - 16);
  });

  it('a unit without the Mark never gets the 5, whatever the roll', async () => {
    expect((await strike({ markId: null, roll: 0 })).foe.currentHP).toBe(40 - 16);
    // an id the catalog does not know is no Mark
    expect((await strike({ markId: 'a_mark_from_the_future', roll: 0 })).foe.currentHP).toBe(
      40 - 16,
    );
    // another Mark's strike is its own
    expect((await strike({ markId: 'ember', roll: 0 })).foe.currentHP).toBe(40 - 16);
  });

  it('adds nothing to a strike that deals no damage, and says nothing about it', async () => {
    // DEF 20 against 12 + 8 = 20: 0 damage.
    const { foe, world } = await strike({ roll: 0.01, foeStats: { DEF: 20 } });
    expect(foe.currentHP).toBe(40);
    const edric = makeEdric({ markId: 'hunt' });
    const stout = makeFoe('Stout', 1, 40, { stats: { DEF: 20 } });
    Math.random = () => 0.01;
    const result = resolveCombat(
      edric,
      edric.weapon,
      stout,
      null,
      1,
      plain,
      plain,
      world.buildSkillCtx(edric, stout),
    );
    const strikes = result.events.filter((e) => e.type === 'strike');
    expect(strikes.map((e) => e.damage)).toEqual([0]);
    expect(strikes[0].skillActivations).toEqual([]);
  });

  it('is reported in the strike’s skillActivations for the proc banner', () => {
    // resolveCombat with this world's own context (so its marksData wiring is the subject)
    const edric = makeEdric({ markId: 'hunt' });
    const foe = makeFoe('Foe', 1, 40);
    const world = makeWorld([edric], [foe, bystander()], 0.01);
    Math.random = () => 0.01;
    const result = resolveCombat(
      edric,
      edric.weapon,
      foe,
      null,
      1,
      plain,
      plain,
      world.buildSkillCtx(edric, foe),
    );
    const hit = result.events.find((e) => e.type === 'strike');
    expect(hit.damage).toBe(21);
    expect(hit.skillActivations).toEqual([
      { id: 'mark_hunt', name: 'Mark of the Hunt', mark: true },
    ]);
  });

  it('works on a counter too: the defender’s Mark', async () => {
    const edric = makeEdric({ markId: 'hunt', hp: 40 });
    const foe = makeFoe('Raider', 1, 40, { kind: 'lance' });
    const world = makeWorld([edric], [foe, bystander()], 0.01);
    await world.enemyAttack(foe, edric);
    // the raider hits for 4; Edric's counter is 15 + 5
    expect(edric.currentHP).toBe(40 - 4);
    expect(foe.currentHP).toBe(40 - 20);
  });
});

// A Necromancer's Skeleton is an ordinary foe to the on-kill step (docs/specs/phase3.md 3I):
// the Mark fires at most once for a combat's kill, and the Necromancer's cap of six raises
// bounds how many such kills a battle holds.
describe.each(WORLDS)(
  'Mark of the Ember against a raised Skeleton, through %s',
  (_l, makeWorld) => {
    const skeleton = () =>
      makeFoe('Skeleton', 1, 10, { extra: { className: 'Skeleton', _raisedBy: 'u9' } });

    it('fires once for the kill (+5), not twice', async () => {
      const edric = makeEdric({ markId: 'ember' });
      const foe = skeleton();
      const world = makeWorld([edric], [foe, bystander()], 0.01);
      await world.attack(edric, foe);
      expect(foe.currentHP).toBe(0);
      expect(edric.currentHP).toBe(20 + 5);
    });

    it('six Skeletons felled one a combat heal at most six times in all: the cap bounds it', async () => {
      const edric = makeEdric({ markId: 'ember' });
      let heals = 0;
      for (let n = 0; n < 6; n++) {
        edric.currentHP = 20;
        const foe = skeleton();
        const world = makeWorld([edric], [foe, bystander()], 0.01);
        await world.attack(edric, foe);
        if (edric.currentHP === 25) heals++;
      }
      expect(heals).toBe(6);
    });
  },
);

describe.each(WORLDS)('Mark of the Ember through %s', (_label, makeWorld) => {
  const fight = async ({
    markId = 'ember',
    roll,
    primaryHP = 10,
    neighbourHP = null,
    art = null,
    hp = 20,
    skills = [],
  }) => {
    const edric = makeEdric({ markId, hp, skills });
    const primary = makeFoe('Primary', 1, primaryHP);
    const neighbour = neighbourHP === null ? null : makeFoe('Neighbour', 2, neighbourHP);
    const world = makeWorld(
      [edric],
      [primary, ...(neighbour ? [neighbour] : []), bystander()],
      roll,
    );
    await world.attack(edric, primary, art);
    return { edric, primary, neighbour };
  };

  it('restores 5 HP on a kill', async () => {
    const { edric, primary } = await fight({ roll: 0.01 });
    expect(primary.currentHP).toBe(0);
    expect(edric.currentHP).toBe(20 + 5);
  });

  it('fires below 20 and not at it', async () => {
    expect((await fight({ roll: 0.1999 })).edric.currentHP).toBe(25);
    expect((await fight({ roll: 0.2 })).edric.currentHP).toBe(20);
  });

  it('never fires on a blow that does not kill, or for a unit without the Mark', async () => {
    const wound = await fight({ roll: 0, primaryHP: 40 });
    expect(wound.primary.currentHP).toBe(40 - 16);
    expect(wound.edric.currentHP).toBe(20);
    expect((await fight({ markId: null, roll: 0 })).edric.currentHP).toBe(20);
    expect((await fight({ markId: 'hunt', roll: 0.9 })).edric.currentHP).toBe(20);
  });

  it('a counter-kill counts', async () => {
    const edric = makeEdric({ markId: 'ember' });
    const foe = makeFoe('Raider', 1, 10, { kind: 'lance' });
    const world = makeWorld([edric], [foe, bystander()], 0.01);
    await world.enemyAttack(foe, edric);
    // the raider hits for 4 (20 -> 16); Edric's counter fells him; Ember +5
    expect(foe.currentHP).toBe(0);
    expect(edric.currentHP).toBe(16 + 5);
  });

  it('two kills in one action fire it once (+5, never +10)', async () => {
    const { edric, primary, neighbour } = await fight({
      roll: 0.01,
      primaryHP: 10,
      neighbourHP: 5,
      art: blast,
    });
    expect([primary.currentHP, neighbour.currentHP]).toEqual([0, 0]);
    // the blast costs 1 HP (20 -> 19), then one Ember heal
    expect(edric.currentHP).toBe(19 + 5);
  });

  it('a kill by the area art alone counts, a blast that kills nobody does not', async () => {
    const kills = await fight({ roll: 0.01, primaryHP: 40, neighbourHP: 5, art: blast });
    expect(kills.neighbour.currentHP).toBe(0);
    expect(kills.edric.currentHP).toBe(19 + 5);
    const none = await fight({ roll: 0.01, primaryHP: 40, neighbourHP: 40, art: blast });
    expect(none.edric.currentHP).toBe(19);
  });

  it('never heals past max HP', async () => {
    expect((await fight({ roll: 0.01, hp: 38 })).edric.currentHP).toBe(40);
  });

  it('Wounded blocks it (UnitHealth.healUnit)', async () => {
    const edric = makeEdric({ markId: 'ember' });
    applyCondition(edric, 'wounded', 3, { recoveryChance: 0 });
    const primary = makeFoe('Primary', 1, 10);
    const world = makeWorld([edric], [primary, bystander()], 0.01);
    await world.attack(edric, primary);
    expect(primary.currentHP).toBe(0);
    expect(edric.currentHP).toBe(20);
  });

  it('Silence does not block it (a Mark is not a skill), though it blocks Lifetaker', async () => {
    const edric = makeEdric({ markId: 'ember', skills: ['lifetaker'] });
    applyCondition(edric, 'silence', 3, { recoveryChance: 0 });
    const primary = makeFoe('Primary', 1, 10);
    const world = makeWorld([edric], [primary, bystander()], 0.01);
    await world.attack(edric, primary);
    expect(primary.currentHP).toBe(0);
    expect(edric.currentHP).toBe(20 + 5);
  });

  it('stacks with an on-kill skill: Lifetaker (+10) and Ember (+5) both fire once', async () => {
    const { edric } = await fight({ roll: 0.01, skills: ['lifetaker'] });
    expect(edric.currentHP).toBe(20 + 10 + 5);
  });
});

describe.each(WORLDS)('Mark of the Veil through %s', (_label, makeWorld) => {
  const volley = async ({ markId = 'veil', skills = [], roll, kind = 'tome', hp = 40 }) => {
    const edric = makeEdric({ markId, skills, hp });
    const foe = makeFoe('Mage', 1, 40, { kind });
    const world = makeWorld([edric], [foe, bystander()], roll);
    await world.enemyAttack(foe, edric);
    return { edric, foe };
  };

  it('halves a magic strike on its bearer: 7 -> 3', async () => {
    expect((await volley({ roll: 0.01 })).edric.currentHP).toBe(40 - 3);
  });

  it('fires below 15 and not at it', async () => {
    expect((await volley({ roll: 0.1499 })).edric.currentHP).toBe(40 - 3);
    expect((await volley({ roll: 0.15 })).edric.currentHP).toBe(40 - 7);
  });

  it('never halves a physical strike, and a unit without the Mark takes all 7', async () => {
    expect((await volley({ roll: 0, kind: 'lance' })).edric.currentHP).toBe(40 - 4);
    expect((await volley({ markId: null, roll: 0 })).edric.currentHP).toBe(40 - 7);
    expect((await volley({ markId: 'hunt', roll: 0 })).edric.currentHP).toBe(40 - 7);
  });

  it('with Aegis it still halves once: 7 -> 3, never 1', async () => {
    // SKL 9: Aegis procs on a 0.01 roll, as Veil does.
    expect((await volley({ roll: 0.01, skills: ['aegis'] })).edric.currentHP).toBe(40 - 3);
    // Aegis alone halves once too, so the Mark adds nothing on top of it.
    expect((await volley({ markId: null, roll: 0.01, skills: ['aegis'] })).edric.currentHP).toBe(
      40 - 3,
    );
  });

  it('is reported as a defender-side activation, and Aegis is not reported over it', () => {
    const edric = makeEdric({ markId: 'veil', skills: ['aegis'] });
    const foe = makeFoe('Mage', 1, 40, { kind: 'tome' });
    const world = makeWorld([edric], [foe, bystander()], 0.01);
    Math.random = () => 0.01;
    const result = resolveCombat(
      foe,
      foe.weapon,
      edric,
      edric.weapon,
      1,
      plain,
      plain,
      world.buildSkillCtx(foe, edric),
    );
    const first = result.events.find((e) => e.type === 'strike' && e.attacker === 'Mage');
    expect(first.damage).toBe(3);
    expect(first.skillActivations).toEqual([
      { id: 'mark_veil', name: 'Mark of the Veil', mark: true, side: 'target' },
    ]);
  });
});

describe.each(WORLDS)('Mark of the Forge through %s', (_label, makeWorld) => {
  const cast = async ({ markId = 'forge', roll, hp = 20 }) => {
    const edric = makeEdric({ markId, hp });
    const foe = makeFoe('Foe', 1, 40);
    const world = makeWorld([edric], [foe, bystander()], roll);
    await world.attack(edric, foe, costly);
    return { edric, foe };
  };

  it('spares the art’s 5 HP on a fired roll', async () => {
    const { edric, foe } = await cast({ roll: 0.01 });
    expect(edric.currentHP).toBe(20);
    expect(foe.currentHP).toBe(40 - 16); // the art's strike itself is unchanged
  });

  it('fires below 20 and not at it; the cost is paid as always otherwise', async () => {
    expect((await cast({ roll: 0.1999 })).edric.currentHP).toBe(20);
    expect((await cast({ roll: 0.2 })).edric.currentHP).toBe(20 - 5);
    expect((await cast({ markId: null, roll: 0 })).edric.currentHP).toBe(20 - 5);
    expect((await cast({ markId: 'hunt', roll: 0.9 })).edric.currentHP).toBe(20 - 5);
  });
});

describe('Mark of the Forge never makes an unaffordable art usable', () => {
  const edricAt = (hp, markId = 'forge') => makeEdric({ markId, hp });
  const check = (unit) =>
    canUseWeaponArt(unit, unit.weapon, costly, { turnNumber: 1, marksData: marks });

  it('an art whose cost would leave 0 HP stays refused, with or without the Mark', () => {
    // a 5 HP cost needs at least 6 HP
    for (const hp of [1, 5]) {
      expect(check(edricAt(hp)).ok, `${hp} HP, Forge`).toBe(false);
      expect(check(edricAt(hp, null)).ok, `${hp} HP, none`).toBe(false);
    }
    expect(check(edricAt(6)).ok).toBe(true);
    expect(check(edricAt(6, null)).ok).toBe(true);
  });

  it('the roll comes only when a cost is paid: a free art draws nothing', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    const free = { ...costly, hpCost: 0 };
    const result = applyWeaponArtCost(edricAt(20), free, { marksData: marks });
    expect(result).toEqual({ cost: 0, waived: false });
    expect(spy).not.toHaveBeenCalled();
  });

  it('applyWeaponArtCost reports what it did: paid, or waived with the Mark', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const paid = edricAt(20);
    expect(applyWeaponArtCost(paid, costly, { marksData: marks })).toEqual({
      cost: 5,
      waived: false,
    });
    expect(paid.currentHP).toBe(15);
    spy.mockReturnValue(0.01);
    const spared = edricAt(20);
    const outcome = applyWeaponArtCost(spared, costly, { marksData: marks });
    expect(outcome).toMatchObject({ cost: 0, waived: true });
    expect(outcome.mark.name).toBe('Mark of the Forge');
    expect(spared.currentHP).toBe(20);
    // no catalog handed in: no Mark acts
    expect(applyWeaponArtCost(edricAt(20), costly, {}).waived).toBe(false);
  });
});

describe.each(WORLDS)('Mark of the Road through %s', (_label, makeWorld) => {
  const setup = (roll, markId = 'road', extra = {}) => {
    const edric = makeEdric({ markId, hp: 40, extra });
    const world = makeWorld([edric], [bystander()], roll);
    return { edric, world };
  };

  it('gives +1 MOV at the start of the player phase, turn 1 included', async () => {
    const { edric, world } = setup(0.01);
    await world.turnStart([edric]);
    expect(edric.stats.MOV).toBe(6);
    expect(edric.mov).toBe(6);
  });

  it('fires below 25 and not at it', async () => {
    const fired = setup(0.2499);
    await fired.world.turnStart([fired.edric]);
    expect(fired.edric.stats.MOV).toBe(6);
    const held = setup(0.25);
    await held.world.turnStart([held.edric]);
    expect(held.edric.stats.MOV).toBe(5);
  });

  it('never fires for a unit without the Mark, or with another Mark', async () => {
    for (const markId of [null, 'hunt', 'a_mark_from_the_future']) {
      const { edric, world } = setup(0, markId);
      await world.turnStart([edric]);
      expect(edric.stats.MOV, String(markId)).toBe(5);
    }
  });

  it('is the army’s: an enemy or an NPC ally bearing the id gets nothing', async () => {
    const foe = makeFoe('Foe', 1, 20, { extra: { markId: 'road' } });
    const npc = makeEdric({
      markId: 'road',
      extra: { name: 'Villager', faction: 'npc', isLord: false },
    });
    const world = makeWorld([makeEdric()], [foe, bystander()], 0);
    await world.turnStart([foe, npc]);
    expect(foe.stats.MOV).toBe(5);
    expect(npc.stats.MOV).toBe(5);
  });

  it('ends as the enemy phase of the same turn begins, not before', async () => {
    const { edric, world } = setup(0.01);
    await world.turnStart([edric]);
    expect(edric.stats.MOV).toBe(6);
    world.expire('player', 2); // another phase's start: nothing yet
    expect(edric.stats.MOV).toBe(6);
    world.expire('enemy', 1);
    expect(edric.stats.MOV).toBe(5);
    expect(edric.mov).toBe(5);
    expect(edric._battleTimedWeaponArtBuffs).toBeUndefined();
    expect(edric._battleTimedWeaponArtAppliedStats).toBeUndefined();
  });

  it('a later turn rolls again: the buff does not stack with itself', async () => {
    const { edric, world } = setup(0.01);
    await world.turnStart([edric]);
    await world.turnStart([edric]);
    expect(edric.stats.MOV).toBe(6); // one entry, refreshed, never +2
    world.expire('enemy', 1);
    expect(edric.stats.MOV).toBe(5);
  });

  it('is gone from the saved unit while it is live, and rides a suspend checkpoint', async () => {
    const { edric, world } = setup(0.01);
    await world.turnStart([edric]);
    expect(edric.stats.MOV).toBe(6);
    const saved = serializeUnit(edric);
    expect(saved.stats.MOV).toBe(5);
    expect(saved.mov).toBe(5);
    for (const key of Object.keys(saved)) expect(key).not.toMatch(/TimedWeaponArt/);
    // a suspend checkpoint keeps the live buff, so a resume still ends it on schedule
    const checkpoint = serializeBattleUnit(edric);
    expect(checkpoint.stats.MOV).toBe(6);
    expect(checkpoint._battleTimedWeaponArtBuffs).toHaveLength(1);
  });
});

describe('the harness’s own phase changes roll Mark of the Road, turn 1 included', () => {
  it('+1 MOV when the player phase starts, gone when the enemy phase starts, rolled again next turn', () => {
    const edric = makeEdric({ markId: 'road', hp: 40 });
    const { battle, withRoll } = harnessWorld([edric], [bystander()], 0.01);
    withRoll(() => battle._onPhaseChange('player', 1));
    expect(edric.stats.MOV).toBe(6);
    battle.turnManager.turnNumber = 1;
    battle._onPhaseChange('enemy', 1);
    expect(edric.stats.MOV).toBe(5);
    battle.turnManager.turnNumber = 2;
    withRoll(() => battle._onPhaseChange('player', 2));
    expect(edric.stats.MOV).toBe(6);
    battle._onPhaseChange('enemy', 2);
    expect(edric.stats.MOV).toBe(5);
    // a roll that misses gives nothing, on turn 1 or after
    const unlucky = makeEdric({ markId: 'road', hp: 40 });
    const world = harnessWorld([unlucky], [bystander()], 0.9);
    world.withRoll(() => world.battle._onPhaseChange('player', 1));
    expect(unlucky.stats.MOV).toBe(5);
  });
});

describe('the Mark effects are data-driven by the catalog', () => {
  const road = () => makeEdric({ markId: 'road' });

  it('Road reads its MOV from the data and the turn it is handed', () => {
    const tweaked = structuredClone(marks);
    tweaked.find((m) => m.id === 'road').effect.movBonus = 2;
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const effects = getTurnStartEffects([road()], data.skills, tweaked, 4);
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({ type: 'buff', source: 'Mark of the Road', markId: 'road' });
    expect(effects[0].entry).toMatchObject({
      stats: { MOV: 2 },
      expiryPhase: 'enemy',
      expiryTurn: 4,
    });
  });

  it('with no catalog handed in, no turn-start Mark acts', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(getTurnStartEffects([road()], data.skills)).toEqual([]);
    expect(getTurnStartEffects([road()], data.skills, null, 1)).toEqual([]);
  });
});

describe('the on-kill step is built for a Mark as well as for skills', () => {
  const hero = (markId, skills = []) => makeEdric({ markId, skills });
  const strikeEvent = { type: 'strike', attackerSide: 'attacker', miss: false, damage: 5 };

  it('an Ember bearer with no on-kill skill still gets the step, carrying its id', () => {
    const steps = getPostCombatPipelineSteps({
      attacker: hero('ember'),
      defender: makeFoe('Foe', 1, 10),
      result: { events: [strikeEvent] },
      skillsData: data.skills,
      marksData: marks,
    });
    expect(steps.filter((s) => s.type === 'skill_on_kill')).toEqual([
      {
        type: 'skill_on_kill',
        sourceSide: 'attacker',
        targetSide: 'defender',
        skillIds: [],
        markId: 'ember',
      },
    ]);
  });

  it('no step without a Mark or a skill, for another Mark, or without the catalog', () => {
    const stepsFor = (attacker, marksData = marks) =>
      getPostCombatPipelineSteps({
        attacker,
        defender: makeFoe('Foe', 1, 10),
        result: { events: [strikeEvent] },
        skillsData: data.skills,
        marksData,
      }).filter((s) => s.type === 'skill_on_kill');
    expect(stepsFor(hero(undefined))).toEqual([]);
    expect(stepsFor(hero('hunt'))).toEqual([]);
    expect(stepsFor(hero('ember'), null)).toEqual([]);
  });

  it('a skill-only step keeps the shape 3B gave it (no markId key)', () => {
    const steps = getPostCombatPipelineSteps({
      attacker: hero(undefined, ['lifetaker']),
      defender: makeFoe('Foe', 1, 10),
      result: { events: [strikeEvent] },
      skillsData: data.skills,
      marksData: marks,
    });
    expect(steps.filter((s) => s.type === 'skill_on_kill')).toEqual([
      {
        type: 'skill_on_kill',
        sourceSide: 'attacker',
        targetSide: 'defender',
        skillIds: ['lifetaker'],
      },
    ]);
  });
});

describe('the forecast does not promise what a Mark could change', () => {
  const forecastFor = (attackerMark, defenderMark) => {
    const edric = makeEdric({ markId: attackerMark, hp: 40 });
    const foe = makeFoe('Raider', 1, 40, {
      kind: 'lance',
      extra: defenderMark ? { markId: defenderMark } : {},
    });
    const world = sceneWorld([edric], [foe, bystander()], 0.5);
    const ctx = world.buildSkillCtx(edric, foe);
    return getCombatForecast(edric, edric.weapon, foe, foe.weapon, 1, plain, plain, ctx);
  };

  it('a plain exchange keeps its projection', () => {
    const forecast = forecastFor(undefined, undefined);
    expect(forecast.display.simpleExchange).toBe(true);
    expect(forecastProjection(forecast)).not.toBeNull();
  });

  it.each(['hunt', 'veil'])('%s on either side hides the HP projection', (id) => {
    for (const [a, d] of [
      [id, undefined],
      [undefined, id],
    ]) {
      const forecast = forecastFor(a, d);
      expect(forecast.display.simpleExchange, `${a}/${d}`).toBe(false);
      expect(forecastProjection(forecast)).toBeNull();
    }
  });

  it.each(['forge', 'ember', 'road'])(
    '%s never acts inside the exchange: the projection stays',
    (id) => {
      for (const [a, d] of [
        [id, undefined],
        [undefined, id],
      ]) {
        expect(forecastFor(a, d).display.simpleExchange, `${a}/${d}`).toBe(true);
      }
    },
  );

  it('a counterattacker with Hunt is flagged as able to change the counter’s damage', () => {
    expect(forecastFor(undefined, 'hunt').display.counterHasDamageProc).toBe(true);
    expect(forecastFor(undefined, 'veil').display.counterHasDamageProc).toBe(false);
    expect(forecastFor(undefined, undefined).display.counterHasDamageProc).toBe(false);
  });

  it('an unknown id hides nothing, and so does a missing catalog', () => {
    expect(forecastFor('a_mark_from_the_future', undefined).display.simpleExchange).toBe(true);
    const edric = makeEdric({ markId: 'hunt', hp: 40 });
    const foe = makeFoe('Raider', 1, 40, { kind: 'lance' });
    const ctx = {
      ...sceneWorld([edric], [foe, bystander()], 0.5).buildSkillCtx(edric, foe),
      marksData: null,
    };
    const forecast = getCombatForecast(edric, edric.weapon, foe, foe.weapon, 1, plain, plain, ctx);
    expect(forecast.display.simpleExchange).toBe(true);
  });
});

describe('Mark of the Forge on an area art (AreaTargetingController and the harness)', () => {
  // Stormcall on Breachbolt costs 8 HP; a Sage at 32 HP is at 24 after paying it.
  const stormcall = data.weaponArts.arts.find((a) => a.id === 'legend_stormcall');
  const sage = (markId) => {
    const tome = structuredClone(data.weapons.find((w) => w.name === 'Breachbolt'));
    return {
      name: 'Sage',
      faction: 'player',
      level: 10,
      tier: 'base',
      className: 'Sage',
      col: 0,
      row: 5,
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
      ...(markId ? { markId } : {}),
    };
  };
  const target = () => ({
    name: 'Center',
    faction: 'enemy',
    level: 10,
    tier: 'base',
    className: 'Soldier',
    col: 4,
    row: 5,
    currentHP: 30,
    stats: { HP: 30, STR: 8, MAG: 0, SKL: 5, SPD: 5, DEF: 5, RES: 6, LCK: 0, MOV: 5 },
    moveType: 'Infantry',
    weapon: structuredClone(data.weapons.find((w) => w.name === 'Iron Lance')),
    inventory: [],
    skills: [],
    accessory: null,
    affixes: [],
  });

  const throughScene = async (markId, roll) => {
    const units = [sage(markId), target()];
    const scene = journeyBattleScene({ battleInProgress: {} }, data);
    scene.runManager = null;
    scene._battleRewindPolicy = 'fixed-v1';
    scene._battleRng = createBattleRng(42);
    Object.assign(scene.grid, {
      cols: 12,
      rows: 12,
      fogEnabled: false,
      isVisible: () => true,
      clearTemporaryTerrainsBySource: () => {},
      getMoveCost: () => 1,
      getTerrainAt: () => plain,
    });
    scene.battleConfig = { objective: 'rout' };
    scene.goldEarned = 0;
    scene.turnPar = 99;
    scene.turnBonusConfig = data.turnBonus;
    scene.getCurrentTurnNumber = () => 1;
    scene.playerUnits = [units[0]];
    scene.enemyUnits = [units[1]];
    scene.npcUnits = [];
    rendering(scene, 0);
    for (const u of units) registerBattleEntity(scene, u);
    scene.sys = { isActive: () => true };
    scene.scene = { isActive: () => true };
    scene.showActionMenu = vi.fn();
    scene.selectedUnit = units[0];
    scene.awardScaledXP = async () => {};
    Math.random = () => roll;
    await scene._areaTargeting().execute(units[0], units[0].weapon, stormcall, { col: 4, row: 5 });
    return units[0];
  };

  const throughHarness = async (markId, roll) => {
    const units = [sage(markId), target()];
    const battle = new HeadlessBattle(
      { ...data, weaponArts: structuredClone(data.weaponArts) },
      { act: 'act3', objective: 'rout' },
    );
    Object.assign(battle, {
      turnManager: { turnNumber: 1, unitActed() {} },
      battleConfig: { objective: 'rout' },
      turnPar: 99,
      playerUnits: [units[0]],
      enemyUnits: [units[1]],
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
    battle._grantScaledXP = () => {};
    Math.random = () => roll;
    expect(battle.executeAreaStrike(units[0], 'legend_stormcall', { col: 4, row: 5 })).toBe(true);
    return units[0];
  };

  it.each([
    ['the scene', throughScene],
    ['the harness', throughHarness],
  ])('spares the 8 HP on a fired roll and pays it otherwise, through %s', async (_label, run) => {
    expect((await run('forge', 0.01)).currentHP).toBe(32);
    expect((await run('forge', 0.2)).currentHP).toBe(32 - 8);
    expect((await run(null, 0.01)).currentHP).toBe(32 - 8);
  });
});
