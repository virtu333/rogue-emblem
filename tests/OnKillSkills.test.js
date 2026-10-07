// The on-kill trigger and its skills (docs/specs/phase3.md 3B): Lifetaker and Speedtaker.
// Every fight runs the real combat and the real post-combat generator twice: through
// BattleScene (`scene._postCombatWorld()`) and through the headless harness
// (`battle._postCombatWorld()`), and both must agree. Numbers are worked by hand:
//   Edric: STR 12, Test Blade 8 might, hit 100, SPD 9, HP 40 (20 when the fight starts).
//   A foe with DEF 4 takes 12 + 8 - 4 = 16 from him, so 10 or 16 HP dies and 30 survives.
//   Lifetaker heals floor(40 * 25 / 100) = 10. Speedtaker adds 1 SPD per kill, up to +5.
//   An armed foe (STR 5, Test Lance 5 might) has the weapon triangle on Edric's sword: it hits
//   him for 5 + 5 - 7 + 1 = 4, and he hits it for 16 - 1 = 15 (a 10 HP foe still dies).
import { afterEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { presentationFailureProxy as rendering } from './harness/PresentationFailureProxy.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { applyCondition } from '../src/engine/StatusConditionSystem.js';
import { clearBattleScopedDeltas } from '../src/engine/BattleStatDeltas.js';
import { restoreEquippedReference, serializeBattleUnit } from '../src/engine/BattleUnitState.js';
import { serializeUnit } from '../src/engine/RunManager.js';
import { postCombatEffects } from '../src/engine/PostCombatEffects.js';
import { getPostCombatPipelineSteps } from '../src/engine/WeaponArtPostCombat.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const originalRandom = Math.random;
afterEach(() => {
  Math.random = originalRandom;
  vi.restoreAllMocks();
});

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
const pierce = {
  ...blast,
  id: 'test_pierce',
  name: 'Test Pierce',
  hpCost: 0,
  area: { shape: 'line', length: 1, damage: { kind: 'fixed', amount: 30 }, strikes: 'once' },
};
const arts = [blast, pierce];
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

function makeEdric({ skills = ['lifetaker'], hp = 20, maxHp = 40, extra = {} } = {}) {
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
    ...extra,
  };
}
function makeFoe(name, col, hp, { row = 0, armed = false, extra = {} } = {}) {
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
    stats: { ...body, HP: Math.max(hp, 1), DEF: 4, ...(armed ? { STR: 5 } : {}) },
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

/** The battle through BattleScene: real executeCombat / executeEnemyCombat, no drawing. */
function sceneWorld(players, enemies) {
  const scene = journeyBattleScene({}, { ...data, weaponArts: { ...data.weaponArts, arts } });
  scene.runManager = null;
  scene._battleRewindPolicy = 'fixed-v1';
  scene._battleRng = createBattleRng(42);
  Math.random = scene._battleRng;
  Object.assign(scene.grid, {
    fogEnabled: false,
    clearTemporaryTerrainsBySource: () => {},
    getMoveCost: () => 1,
    getTerrainAt: () => data.terrain.find((t) => t.name === 'Plain'),
  });
  scene.battleConfig = { objective: 'rout' };
  scene.goldEarned = 0;
  scene.turnPar = 99;
  scene.turnBonusConfig = data.turnBonus;
  scene.getCurrentTurnNumber = () => 1;
  scene.playerUnits = players;
  scene.enemyUnits = enemies;
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
  return {
    kind: 'scene',
    world: () => scene._postCombatWorld(),
    buildSkillCtx: (a, d) => scene.buildSkillCtx(a, d),
    foes: (list) => {
      scene.enemyUnits = list;
    },
    attack: async (attacker, defender, useArt = null) => {
      art = useArt;
      await scene.executeCombat(attacker, defender);
    },
    enemyAttack: (foe, target) => scene.executeEnemyCombat(foe, target),
  };
}

/** The same battle through the headless harness, which mirrors the scene's state machine. */
function harnessWorld(players, enemies) {
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
  const withRandom = (fn) => {
    const prev = Math.random;
    Math.random = () => 0.01;
    try {
      return fn();
    } finally {
      Math.random = prev;
    }
  };
  return {
    kind: 'harness',
    world: () => battle._postCombatWorld(),
    buildSkillCtx: (a, d) => battle._buildSkillCtx(a, d),
    foes: (list) => {
      battle.enemyUnits = list;
    },
    attack: async (attacker, defender, useArt = null) => {
      battle.selectedUnit = attacker;
      if (useArt) battle._setSelectedWeaponArt(attacker, useArt.id, attacker.weapon);
      withRandom(() => battle._executeCombat(attacker, defender));
    },
    enemyAttack: async (foe, target) => withRandom(() => battle._executeEnemyCombat(foe, target)),
  };
}

const WORLDS = [
  ['the scene', sceneWorld],
  ['the harness', harnessWorld],
];

/** One fight in both worlds from the same starting armies; `act(world, units)` runs it. */
async function inBothWorlds(setup, act) {
  const out = [];
  for (const [, make] of WORLDS) {
    const units = setup();
    const world = make(units.players, units.enemies);
    await act(world, units);
    out.push({ kind: world.kind, ...units });
  }
  return out;
}

// A Necromancer's Skeleton is an ordinary foe to the on-kill step (docs/specs/phase3.md 3I):
// killing one fires Lifetaker once for the combat, as any kill does, and the Necromancer's
// cap of six raises bounds how often that can happen in a battle. (Mark of the Ember is the
// same step; it is not in the game at this point.)
describe.each(WORLDS)(
  'on-kill skills against a raised Skeleton, through %s',
  (_label, makeWorld) => {
    it('Lifetaker heals once for the kill, and the Skeleton pays no gold', async () => {
      const edric = makeEdric();
      const skeleton = makeFoe('Skeleton', 1, 10, {
        extra: { className: 'Skeleton', _raisedBy: 'u9' },
      });
      const world = makeWorld([edric], [skeleton, bystander()]);
      await world.attack(edric, skeleton);
      expect(skeleton.currentHP).toBe(0);
      expect(edric.currentHP).toBe(20 + 10); // one heal of floor(25% of 40), not two
    });

    it('six raised Skeletons felled one a combat heal six times in all: bounded by the cap', async () => {
      const edric = makeEdric({ hp: 1 });
      let heals = 0;
      for (let n = 0; n < 6; n++) {
        const before = edric.currentHP;
        const skeleton = makeFoe('Skeleton', 1, 10, {
          extra: { className: 'Skeleton', _raisedBy: 'u9' },
        });
        const world = makeWorld([edric], [skeleton, bystander()]);
        await world.attack(edric, skeleton);
        if (edric.currentHP > before) heals++;
        edric.currentHP = 1;
      }
      expect(heals).toBe(6);
    });
  },
);

describe.each(WORLDS)('on-kill skills through %s', (_label, makeWorld) => {
  const fight = async ({ edricOpts, primaryHP, art = null, neighbourHP = null, armed = false }) => {
    const edric = makeEdric(edricOpts);
    const primary = makeFoe('Primary', 1, primaryHP, { armed });
    const neighbour = neighbourHP === null ? null : makeFoe('Neighbour', 2, neighbourHP);
    const enemies = [primary, ...(neighbour ? [neighbour] : []), bystander()];
    const world = makeWorld([edric], enemies);
    await world.attack(edric, primary, art);
    return { edric, primary, neighbour, world };
  };

  it('Lifetaker heals floor(25% of max HP) on a kill', async () => {
    const { edric, primary } = await fight({ primaryHP: 10 });
    expect(primary.currentHP).toBe(0);
    expect(edric.currentHP).toBe(20 + 10);
  });

  it('Speedtaker adds 1 SPD and counts a stack on a kill', async () => {
    const { edric, primary } = await fight({
      edricOpts: { skills: ['speedtaker'] },
      primaryHP: 10,
    });
    expect(primary.currentHP).toBe(0);
    expect(edric.stats.SPD).toBe(9 + 1);
    expect(edric._speedtakerStacks).toBe(1);
    expect(edric._battleDeltas).toEqual({ SPD: 1 });
    expect(edric.currentHP).toBe(20); // Speedtaker does not heal
  });

  it('a blow that does not kill fires nothing', async () => {
    const { edric, primary } = await fight({
      edricOpts: { skills: ['lifetaker', 'speedtaker'] },
      primaryHP: 30,
    });
    expect(primary.currentHP).toBe(30 - 16);
    expect(edric.currentHP).toBe(20);
    expect(edric.stats.SPD).toBe(9);
    expect(edric._speedtakerStacks).toBeUndefined();
  });

  it('a unit without the skill gets nothing from the same kill', async () => {
    const { edric, primary } = await fight({ edricOpts: { skills: [] }, primaryHP: 10 });
    expect(primary.currentHP).toBe(0);
    expect(edric.currentHP).toBe(20);
    expect(edric.stats.SPD).toBe(9);
  });

  it('a counter-kill counts: the defender fells its attacker with the counter', async () => {
    const edric = makeEdric({ skills: ['lifetaker', 'speedtaker'] });
    const foe = makeFoe('Raider', 1, 10, { armed: true });
    const world = makeWorld([edric], [foe, bystander()]);
    await world.enemyAttack(foe, edric);
    // The raider hits for 4 (20 -> 16); Edric's counter (15) fells him; Lifetaker +10.
    expect(foe.currentHP).toBe(0);
    expect(edric.currentHP).toBe(16 + 10);
    expect(edric.stats.SPD).toBe(10);
  });

  it('a counter that does not kill fires nothing', async () => {
    const edric = makeEdric({ skills: ['lifetaker', 'speedtaker'] });
    const foe = makeFoe('Raider', 1, 30, { armed: true });
    const world = makeWorld([edric], [foe, bystander()]);
    await world.enemyAttack(foe, edric);
    expect(foe.currentHP).toBe(30 - 15);
    expect(edric.currentHP).toBe(16);
    expect(edric.stats.SPD).toBe(9);
  });

  it('an area art that kills a victim beside the target counts', async () => {
    // The blast fells the Neighbour (5 HP); the Primary survives the plain blow (30 - 16).
    const { edric, primary, neighbour } = await fight({
      edricOpts: { skills: ['lifetaker', 'speedtaker'] },
      primaryHP: 30,
      neighbourHP: 5,
      art: blast,
    });
    expect(primary.currentHP).toBe(14);
    expect(neighbour.currentHP).toBe(0);
    // The art costs 1 HP (20 -> 19), then Lifetaker +10.
    expect(edric.currentHP).toBe(19 + 10);
    expect(edric.stats.SPD).toBe(10);
    expect(edric._speedtakerStacks).toBe(1);
  });

  it('a line strike that kills the foe behind the target counts', async () => {
    const { edric, primary, neighbour } = await fight({
      edricOpts: { skills: ['lifetaker'] },
      primaryHP: 30,
      neighbourHP: 5,
      art: pierce,
    });
    expect(primary.currentHP).toBe(14);
    expect(neighbour.currentHP).toBe(0);
    expect(edric.currentHP).toBe(20 + 10); // pierce costs no HP
  });

  it('an area art that wounds without killing fires nothing', async () => {
    // 40 HP: the blast's 30 leaves the Neighbour at 10.
    const { edric, neighbour } = await fight({
      edricOpts: { skills: ['lifetaker', 'speedtaker'] },
      primaryHP: 30,
      neighbourHP: 40,
      art: blast,
    });
    expect(neighbour.currentHP).toBe(10);
    expect(edric.currentHP).toBe(19);
    expect(edric.stats.SPD).toBe(9);
  });

  it('two kills in one action fire each skill once, not twice', async () => {
    // The blow fells the Primary (10 HP) and the blast the Neighbour (5 HP).
    const { edric, primary, neighbour } = await fight({
      edricOpts: { skills: ['lifetaker', 'speedtaker'] },
      primaryHP: 10,
      neighbourHP: 5,
      art: blast,
    });
    expect(primary.currentHP).toBe(0);
    expect(neighbour.currentHP).toBe(0);
    expect(edric.currentHP).toBe(19 + 10); // one heal of 10, never 20
    expect(edric.stats.SPD).toBe(10);
    expect(edric._speedtakerStacks).toBe(1);
  });

  it('a pierce that kills, when the counter then fells its user, gives that unit nothing', async () => {
    // Edric (1 HP) pierces the Neighbour dead, and the armed Primary counters him down.
    const { edric, primary, neighbour } = await fight({
      edricOpts: { skills: ['lifetaker', 'speedtaker'], hp: 1 },
      primaryHP: 30,
      neighbourHP: 5,
      art: pierce,
      armed: true,
    });
    expect(neighbour.currentHP).toBe(0);
    expect(primary.currentHP).toBe(30 - 15); // the lance has the triangle on the sword
    expect(edric.currentHP).toBe(0);
    expect(edric.stats.SPD).toBe(9);
    expect(edric._speedtakerStacks).toBeUndefined();
  });

  it('Lifetaker never overheals past max HP', async () => {
    const { edric } = await fight({ edricOpts: { hp: 35 }, primaryHP: 10 });
    expect(edric.currentHP).toBe(40);
  });

  it('Wounded blocks the Lifetaker heal, but not Speedtaker', async () => {
    const edric = makeEdric({ skills: ['lifetaker', 'speedtaker'] });
    applyCondition(edric, 'wounded', 3, { recoveryChance: 0 });
    const primary = makeFoe('Primary', 1, 10);
    const world = makeWorld([edric], [primary, bystander()]);
    await world.attack(edric, primary);
    expect(primary.currentHP).toBe(0);
    expect(edric.currentHP).toBe(20);
    expect(edric.stats.SPD).toBe(10);
  });

  it('a skill bound to the weapon fires like an equipped one (effectiveSkills)', async () => {
    const edric = makeEdric({ skills: [] });
    edric.weapon._grantedSkill = 'lifetaker';
    const primary = makeFoe('Primary', 1, 10);
    const world = makeWorld([edric], [primary, bystander()]);
    await world.attack(edric, primary);
    expect(edric.currentHP).toBe(30);
  });

  it('a benched on-kill skill does nothing', async () => {
    const edric = makeEdric({ skills: [], extra: { benchedSkills: ['lifetaker'] } });
    const primary = makeFoe('Primary', 1, 10);
    const world = makeWorld([edric], [primary, bystander()]);
    await world.attack(edric, primary);
    expect(edric.currentHP).toBe(20);
  });
});

describe.each(WORLDS)('Speedtaker across a battle through %s', (_label, makeWorld) => {
  /** Edric fells `count` fresh foes, one per action. */
  const killMany = async (edric, world, count) => {
    for (let i = 0; i < count; i++) {
      const foe = makeFoe(`Foe ${i}`, 1, 10);
      world.foes([foe, bystander()]);
      await world.attack(edric, foe);
      expect(foe.currentHP).toBe(0);
    }
  };

  it('stacks to +5 and no further', async () => {
    const edric = makeEdric({ skills: ['speedtaker'] });
    const world = makeWorld([edric], [bystander()]);
    await killMany(edric, world, 3);
    expect([edric.stats.SPD, edric._speedtakerStacks]).toEqual([12, 3]);
    await killMany(edric, world, 2);
    expect([edric.stats.SPD, edric._speedtakerStacks]).toEqual([14, 5]);
    await killMany(edric, world, 2);
    expect([edric.stats.SPD, edric._speedtakerStacks]).toEqual([14, 5]);
    expect(edric._battleDeltas).toEqual({ SPD: 5 });
  });

  it('the bonus is reverted at battle end and the stacks do not reach the roster', async () => {
    const edric = makeEdric({ skills: ['speedtaker'] });
    const world = makeWorld([edric], [bystander()]);
    await killMany(edric, world, 4);
    expect(edric.stats.SPD).toBe(13);
    clearBattleScopedDeltas([edric]); // what both battle ends run on the player's units
    expect(edric.stats.SPD).toBe(9);
    const saved = serializeUnit(edric);
    expect(saved._speedtakerStacks).toBeUndefined();
    expect(saved._battleDeltas).toBeUndefined();
    expect(saved.stats.SPD).toBe(9);
  });

  it('the stacks survive a suspend and a rewind (serializeBattleUnit) and keep counting', async () => {
    const edric = makeEdric({ skills: ['speedtaker'] });
    const world = makeWorld([edric], [bystander()]);
    await killMany(edric, world, 3);
    const checkpoint = serializeBattleUnit(edric);
    expect(checkpoint._speedtakerStacks).toBe(3);
    expect(checkpoint._battleDeltas).toEqual({ SPD: 3 });
    expect(checkpoint.stats.SPD).toBe(12);
    // Resume from the checkpoint in a new world: two more kills reach the cap, a third does not.
    const resumed = structuredClone(checkpoint);
    restoreEquippedReference(resumed);
    const world2 = makeWorld([resumed], [bystander()]);
    await killMany(resumed, world2, 3);
    expect([resumed.stats.SPD, resumed._speedtakerStacks]).toEqual([14, 5]);
    clearBattleScopedDeltas([resumed]);
    expect(resumed.stats.SPD).toBe(9);
  });
});

describe('the on-kill step in the real pipeline', () => {
  const strike = (attackerSide) => ({ type: 'strike', attackerSide, miss: false, damage: 5 });
  const hero = (skills, hp = 20, maxHp = 40) =>
    makeEdric({ skills, hp, maxHp, extra: { col: 0, row: 0 } });

  it('is built from each side’s effective skills only when there are any', () => {
    const attacker = hero(['lifetaker']);
    const defender = makeFoe('Raider', 1, 5, { extra: { skills: ['speedtaker', 'sol'] } });
    const steps = getPostCombatPipelineSteps({
      attacker,
      defender,
      result: { events: [strike('attacker')] },
      skillsData: data.skills,
    });
    expect(steps.filter((s) => s.type === 'skill_on_kill')).toEqual([
      {
        type: 'skill_on_kill',
        sourceSide: 'attacker',
        targetSide: 'defender',
        skillIds: ['lifetaker'],
      },
      {
        type: 'skill_on_kill',
        sourceSide: 'defender',
        targetSide: 'attacker',
        skillIds: ['speedtaker'],
      },
    ]);
    const without = getPostCombatPipelineSteps({
      attacker,
      defender,
      result: { events: [strike('attacker')] },
    });
    expect(without.some((s) => s.type === 'skill_on_kill')).toBe(false);
  });

  it('runs after the art kill buff and every area step', () => {
    for (const art of [blast, pierce]) {
      const attacker = hero(['lifetaker']);
      const defender = makeFoe('Primary', 1, 5);
      const steps = getPostCombatPipelineSteps({
        attacker,
        defender,
        result: { events: [strike('attacker')] },
        attackerWeaponArt: { ...art, killBuff: { durationPhases: 1, stats: { STR: 2 } } },
        skillsData: data.skills,
      });
      const types = steps.map((s) => s.type);
      expect(types).toContain('area_damage');
      expect(types.at(-1)).toBe('skill_on_kill');
      expect(types.lastIndexOf('area_damage')).toBeLessThan(types.indexOf('skill_on_kill'));
    }
  });

  it.each(WORLDS)(
    'Lifetaker heals at least 1 on a tiny max HP (%s world shape)',
    async (_label, makeWorld) => {
      const attacker = hero(['lifetaker'], 1, 3); // floor(3 * 25 / 100) = 0, so 1
      const defender = makeFoe('Primary', 1, 0);
      const shaped = makeWorld([attacker], [defender]).world();
      const beats = [
        ...postCombatEffects(
          { attacker, defender, result: { events: [strike('attacker')] } },
          shaped,
        ),
      ];
      expect(attacker.currentHP).toBe(2);
      expect(beats).toContainEqual({ kind: 'hp', unit: attacker });
      expect(beats).toContainEqual({
        kind: 'hint',
        unit: attacker,
        text: 'Lifetaker +1',
        tone: 'heal',
      });
    },
  );

  it.each(WORLDS)('both worlds hand the generator the skill catalog (%s)', (_label, makeWorld) => {
    const shaped = makeWorld([hero([])], [bystander()]).world();
    expect(shaped.skillsData.some((s) => s.id === 'lifetaker')).toBe(true);
    expect(shaped.skillsData.some((s) => s.id === 'speedtaker')).toBe(true);
  });

  it('a kill credited to another unit, or an area victim that lived, is not this side’s kill', () => {
    const attacker = hero(['lifetaker']);
    const defender = makeFoe('Primary', 1, 20);
    const other = makeFoe('Other', 2, 0);
    const world = { skillsData: data.skills, alliesOf: () => [], hostilesOf: () => [defender] };
    const result = {
      events: [strike('attacker')],
      areaCredits: [
        { source: other, victim: other, damage: 5, hpBefore: 5, killed: true },
        { source: attacker, victim: defender, damage: 5, hpBefore: 25, killed: false },
      ],
    };
    [...postCombatEffects({ attacker, defender, result }, world)];
    expect(attacker.currentHP).toBe(20);
  });

  it('an area strike with no combat (a chosen-center cast) never fires it', async () => {
    const edric = makeEdric({ skills: ['lifetaker', 'speedtaker'] });
    const gameData = structuredClone(data);
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
    gameData.weaponArts.arts.push(cast);
    const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout' });
    const tome = {
      ...structuredClone(data.weapons.find((w) => w.name === 'Breachbolt')),
      weaponArtIds: [cast.id],
    };
    Object.assign(edric, {
      weapon: tome,
      inventory: [tome],
      proficiencies: [{ type: 'Tome', rank: 'Mast' }],
      stats: { ...edric.stats, MAG: 22 },
    });
    const victim = makeFoe('Victim', 4, 5, { row: 0 });
    battle.turnManager = { turnNumber: 1, unitActed() {} };
    battle.battleConfig = { objective: 'rout' };
    battle.turnPar = 99;
    battle.playerUnits = [edric];
    battle.enemyUnits = [victim, bystander()];
    battle.npcUnits = [];
    battle.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      getTerrainAt: () => ({}),
      getMoveCost: () => 1,
      updateFogOfWar() {},
    };
    expect(battle.executeAreaStrike(edric, cast.id, { col: 4, row: 0 })).toBe(true);
    expect(victim.currentHP).toBe(0);
    expect(edric.currentHP).toBe(20);
    expect(edric.stats.SPD).toBe(9);
  });
});

describe('Edric and Lifetaker agree in both worlds on the same fight', () => {
  it('ends in the same state whichever world ran it', async () => {
    const results = await inBothWorlds(
      () => {
        const edric = makeEdric({ skills: ['lifetaker', 'speedtaker'] });
        const primary = makeFoe('Primary', 1, 10);
        const neighbour = makeFoe('Neighbour', 2, 5);
        return { players: [edric], enemies: [primary, neighbour, bystander()], edric, primary };
      },
      (world, { edric, primary }) => world.attack(edric, primary, blast),
    );
    const [scene, harness] = results;
    expect([scene.edric.currentHP, scene.edric.stats.SPD, scene.edric._speedtakerStacks]).toEqual([
      19 + 10,
      10,
      1,
    ]);
    expect([
      harness.edric.currentHP,
      harness.edric.stats.SPD,
      harness.edric._speedtakerStacks,
    ]).toEqual([scene.edric.currentHP, scene.edric.stats.SPD, scene.edric._speedtakerStacks]);
  });
});

// --- The passive and opening skills of 3B: Uncanny Blow, Warding Blow, Defiant ---
// All three ride the generic on-combat-start path (SkillSystem.getSkillCombatMods).

describe.each(WORLDS)('Uncanny Blow, Warding Blow and Defiant through %s', (_label, makeWorld) => {
  const mods = (attacker, defender) => {
    const world = makeWorld([attacker], [defender, bystander()]);
    return world.buildSkillCtx(attacker, defender);
  };

  it('Uncanny Blow: +30 Hit when initiating, nothing when defending', () => {
    const edric = makeEdric({ skills: ['uncanny_blow'] });
    const foe = makeFoe('Foe', 1, 30);
    expect(mods(edric, foe).atkMods.hitBonus).toBe(30);
    // The same unit as the defender of an enemy's attack.
    const raider = makeFoe('Raider', 1, 30);
    const defended = mods(raider, edric);
    expect(defended.defMods.hitBonus).toBe(0);
    expect(defended.atkMods.hitBonus).toBe(0);
  });

  it('Warding Blow: +6 RES when initiating, nothing when defending', () => {
    const edric = makeEdric({ skills: ['warding_blow'] });
    const foe = makeFoe('Foe', 1, 30);
    expect(mods(edric, foe).atkMods.resBonus).toBe(6);
    const raider = makeFoe('Raider', 1, 30);
    expect(mods(raider, edric).defMods.resBonus).toBe(0);
  });

  it('Defiant holds at a quarter of max HP and below, not above (HP 10: 2 holds, 3 does not)', () => {
    const foe = makeFoe('Foe', 1, 30);
    for (const [current, holds] of [
      [2, true],
      [3, false],
    ]) {
      const edric = makeEdric({ skills: ['defiant'], hp: current, maxHp: 10 });
      const ctx = mods(edric, foe);
      expect([current, ctx.atkMods.defBonus, ctx.atkMods.resBonus]).toEqual(
        holds ? [current, 4, 4] : [current, 0, 0],
      );
    }
  });

  it('Defiant turns a lethal blow into a survivable one when defending', async () => {
    // Edric at 10/40 HP (a quarter). The raider (STR 12, lance 5, triangle +1) hits him for
    // 12 + 5 - 7 + 1 = 11, which fells him; with Defiant's +4 DEF it is 7, so he lives on 3.
    const fightWith = async (skills) => {
      const edric = makeEdric({ skills, hp: 10 });
      const raider = makeFoe('Raider', 1, 30, { armed: true });
      raider.stats.STR = 12;
      const world = makeWorld([edric], [raider, bystander()]);
      await world.enemyAttack(raider, edric);
      return edric.currentHP;
    };
    expect(await fightWith([])).toBe(0);
    expect(await fightWith(['defiant'])).toBe(10 - 7);
  });
});
