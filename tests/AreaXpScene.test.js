// Area XP in the battle scene (docs/specs/aoe-weapon-arts.md slice 4b): executeCombat pays
// an area art's other victims through BattleXp.actionXpAwards, as the harness does, and
// Mentor's Band shares them. The same fight runs through BattleScene and HeadlessBattle;
// the expected base awards are worked by hand:
//   Edric (level 5) hits the Primary (level 5, 30 HP) for 12 STR + 8 might − 4 DEF = 16:
//     floor(25 × 16/30) = 13.
//   The blast (a fixed 30) kills the Neighbour (level 5, 5 HP): 40 × 0.6 = 24, or
//     × 1.3 = 31.2 → 31 when it is elite.
//   Mentor's Band (0.5) shares with the Trainee (level 3): the primary
//     floor(35 × 0.5 × 16/30) = 9; the neighbour 50 × 0.6 × 0.5 = 15 (× 1.3: 19).
import { afterEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { presentationFailureProxy as rendering } from './harness/PresentationFailureProxy.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const originalRandom = Math.random;
afterEach(() => {
  Math.random = originalRandom;
  vi.restoreAllMocks();
});

const art = {
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
  ...art,
  id: 'test_pierce',
  name: 'Test Pierce',
  hpCost: 0, // usable at 1 HP
  area: { shape: 'line', length: 1, damage: { kind: 'fixed', amount: 30 }, strikes: 'once' },
};
const arts = [art, pierce];
const body = { HP: 30, STR: 12, MAG: 0, SKL: 9, SPD: 9, DEF: 7, RES: 3, LCK: 5, MOV: 5 };
const band = data.accessories.find((a) => a.name === "Mentor's Band");

/** The armies, fresh for each run: Edric, an optional Trainee, the Primary, a Neighbour. */
function armies({
  withNeighbour,
  eliteNeighbour = false,
  mentor = false,
  noXpNeighbour = false,
  strongNeighbours = false,
  armedPrimary = false,
  edricHP = 30,
  edricXp = 0,
}) {
  const weapon = {
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
  };
  const player = (name, level, col, row, extra = {}) => ({
    name,
    level,
    tier: 'base',
    faction: 'player',
    col,
    row,
    xp: 0,
    currentHP: 30,
    stats: { ...body },
    moveType: 'Infantry',
    weaponRank: 'Mast',
    weapon: null,
    inventory: [],
    proficiencies: [{ type: 'Sword', rank: 'Mast' }],
    skills: [],
    accessory: null,
    affixes: [],
    ...extra,
  });
  const edric = player('Edric', 5, 0, 0, {
    currentHP: edricHP,
    xp: edricXp,
    className: 'Myrmidon',
    growths: {},
    isCommander: true,
    isLord: true,
    weapon,
    inventory: [weapon],
    accessory: mentor ? structuredClone(band) : null,
    _gambitUsedThisTurn: true,
  });
  const trainee = player('Trainee', 3, 0, 1);
  const enemy = (name, col, hp, extra = {}, row = 0) => ({
    name,
    level: 5,
    tier: 'base',
    faction: 'enemy',
    className: 'Soldier',
    col,
    row,
    currentHP: hp,
    moveType: 'Infantry',
    stats: { ...body, HP: hp, DEF: 4 },
    weapon: null,
    inventory: [],
    skills: [],
    accessory: null,
    affixes: [],
    ...extra,
  });
  // An armed primary counters for 12 STR + 20 might − 7 DEF = 25.
  const lance = {
    name: 'Test Lance',
    type: 'Lance',
    might: 20,
    hit: 300,
    crit: 0,
    weight: 1,
    range: '1',
    special: '',
  };
  const primary = enemy(
    'Primary',
    1,
    30,
    armedPrimary ? { weapon: lance, inventory: [lance] } : {},
  );
  const neighbourExtra = {
    ...(eliteNeighbour ? { isElite: true } : {}),
    ...(noXpNeighbour ? { _noXP: true } : {}),
  };
  const neighbour = enemy('Neighbour', 2, 5, neighbourExtra);
  // Two level-10 elites: 65 × 0.6 × 1.3 = 50.7 each, 101.4 in all, over the 75 cap.
  const strong = [
    enemy('Strong A', 2, 5, { level: 10, isElite: true }),
    enemy('Strong B', 1, 5, { level: 10, isElite: true }, 1),
  ];
  return {
    edric,
    players: mentor ? [edric, trainee] : [edric],
    enemies: strongNeighbours
      ? [primary, ...strong]
      : withNeighbour
        ? [primary, neighbour]
        : [primary],
    primary,
    neighbour,
  };
}

async function sceneFight(options) {
  const { edric, players, enemies, primary, neighbour } = armies(options);
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
  scene.turnBonusConfig = data.turnBonus; // as create() sets it
  scene.getCurrentTurnNumber = () => 1;
  scene.playerUnits = players;
  scene.enemyUnits = enemies;
  rendering(scene, 0); // every presentation call answers; none draws
  scene._getSelectedWeaponArtForUnit = () => options.art || art;
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
  const granted = [];
  const realGain = scene.awardScaledXP.bind(scene);
  scene.awardScaledXP = async (u, xp) => {
    granted.push([u.name, xp]);
    if (options.realGain) await realGain(u, xp);
  };
  const cards = [];
  scene._playLevelUpSfx = (kind) => cards.push(kind);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await scene.executeCombat(edric, primary);
  return { granted, primary, neighbour, edric, cards, scene };
}

function harnessFight(options) {
  const { edric, players, enemies, primary, neighbour } = armies(options);
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
  const granted = [];
  const realGain = battle._grantScaledXP.bind(battle);
  battle._grantScaledXP = (u, xp) => {
    granted.push([u.name, xp]);
    if (options.realGain) realGain(u, xp);
  };
  battle.selectedUnit = edric;
  battle._setSelectedWeaponArt(edric, (options.art || art).id, edric.weapon);
  const prev = Math.random;
  Math.random = () => 0.01;
  try {
    battle._executeCombat(edric, primary);
  } finally {
    Math.random = prev;
  }
  return { granted, primary, neighbour, edric };
}

describe('the scene pays area XP, as the harness does', () => {
  it.each([
    ['alone', { withNeighbour: false }, [['Edric', 13]]],
    ['a blast kill beside the target', { withNeighbour: true }, [['Edric', 37]]],
    ['an elite blast kill', { withNeighbour: true, eliteNeighbour: true }, [['Edric', 44]]],
    [
      "Mentor's Band, alone",
      { withNeighbour: false, mentor: true },
      [
        ['Edric', 13],
        ['Trainee', 9],
      ],
    ],
    [
      "Mentor's Band shares the blast kill",
      { withNeighbour: true, mentor: true },
      [
        ['Edric', 37],
        ['Trainee', 24],
      ],
    ],
    [
      "Mentor's Band shares an elite blast kill",
      { withNeighbour: true, eliteNeighbour: true, mentor: true },
      [
        ['Edric', 44],
        ['Trainee', 28],
      ],
    ],
  ])('%s', async (_label, options, expected) => {
    const scene = await sceneFight(options);
    const harness = harnessFight(options);
    expect(scene.primary.currentHP).toBe(30 - 16);
    if (options.withNeighbour) expect(scene.neighbour.currentHP).toBe(0);
    expect(scene.granted).toEqual(expected);
    expect(harness.granted).toEqual(expected);
  });
});

describe('what area XP never pays, and what it can reach', () => {
  it('an attacker the counter fells earns nothing, though its pierce killed', async () => {
    // Edric (1 HP) strikes, the armed Primary counters him down; the pierce still kills
    // the Neighbour behind it (a line lands even when its user falls).
    const options = { withNeighbour: true, armedPrimary: true, edricHP: 1, art: pierce };
    for (const run of [await sceneFight(options), harnessFight(options)]) {
      expect(run.edric.currentHP).toBe(0);
      expect(run.neighbour.currentHP).toBe(0);
      expect(run.granted).toEqual([]);
    }
  });

  it('a victim that gives no XP (_noXP) adds nothing', async () => {
    const options = { withNeighbour: true, noXpNeighbour: true };
    const scene = await sceneFight(options);
    expect(scene.neighbour.currentHP).toBe(0);
    expect(scene.granted).toEqual([['Edric', 13]]);
    expect(harnessFight(options).granted).toEqual([['Edric', 13]]);
  });

  it('area credits stop at 75 base: 13 for the primary + 75, not + 101', async () => {
    const options = { strongNeighbours: true };
    const scene = await sceneFight(options);
    expect(scene.granted).toEqual([['Edric', 88]]);
    expect(harnessFight(options).granted).toEqual([['Edric', 88]]);
  });

  it('a gain big enough to level queues its level-up card', async () => {
    // 37 base, × 1.25 for a turn-1 finish under par (turnBonus.json S rank): 46.
    // 90 + 46 = 136: one level, 36 left over.
    const options = { withNeighbour: true, edricXp: 90, realGain: true };
    const scene = await sceneFight(options);
    const harness = harnessFight(options);
    expect(scene.granted).toEqual([['Edric', 37]]);
    for (const run of [scene, harness]) expect([run.edric.level, run.edric.xp]).toEqual([6, 36]);
    expect(scene.cards).toHaveLength(1);
  });
});
