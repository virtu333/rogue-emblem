// Override (docs/specs/phase3.md 3F): a Lance art that strikes the target and every foe in
// the 2 tiles behind it (Skewer's line, ×0.6 per landed strike), then drives each foe it hit
// one tile back along the line. The new afterCombat mode is `pushAreaVictims`.
//
// Every fight runs the real combat and the real post-combat generator twice: through
// BattleScene (executeCombat) and through the headless harness (_executeCombat), and both
// must agree. Numbers are worked by hand:
//   Lancer: STR 12, Test Lance 8 might, Hit 300, so a sure hit; HP 40 and the art costs 5.
//   A foe with DEF 4 and no weapon takes 12 + 8 - 4 = 16 from the strike, so the primary
//   (30 HP) keeps 14. The line's blow is floor(0.6 x 16) = 9, so a foe behind keeps 21.
//   The row is 3: the Lancer stands on col 1, the primary on col 2, then Near on col 3 and
//   Far on col 4 (the line's two tiles). Pushed back one tile: primary 3, Near 4, Far 5.
import { afterEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { presentationFailureProxy as rendering } from './harness/PresentationFailureProxy.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { applyCondition } from '../src/engine/StatusConditionSystem.js';
import { serializeBattleUnit } from '../src/engine/BattleUnitState.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const override = data.weaponArts.arts.find((a) => a.id === 'lance_override');
const originalRandom = Math.random;
afterEach(() => {
  Math.random = originalRandom;
  vi.restoreAllMocks();
});

const body = { HP: 30, STR: 12, MAG: 0, SKL: 9, SPD: 9, DEF: 7, RES: 3, LCK: 5, MOV: 5 };
const lance = (range = '1') => ({
  name: 'Test Lance',
  type: 'Lance',
  might: 8,
  hit: 300,
  crit: 0,
  weight: 1,
  range,
  special: '',
  weaponArtIds: ['lance_override'],
  weaponArtSources: ['scroll'],
});

function makeLancer({ col = 1, range = '1' } = {}) {
  const weapon = lance(range);
  return {
    name: 'Lancer',
    level: 5,
    tier: 'base',
    faction: 'player',
    col,
    row: 3,
    xp: 0,
    currentHP: 40,
    stats: { ...body, HP: 40 },
    moveType: 'Infantry',
    className: 'Soldier',
    growths: {},
    weaponRank: 'Mast',
    weapon,
    inventory: [weapon],
    proficiencies: [{ type: 'Lance', rank: 'Mast' }],
    skills: [],
    accessory: null,
    affixes: [],
    isCommander: true,
    isLord: true,
    _gambitUsedThisTurn: true,
  };
}
function makeFoe(name, col, hp = 30, extra = {}) {
  return {
    name,
    level: 5,
    tier: 'base',
    faction: 'enemy',
    className: 'Soldier',
    col,
    row: 3,
    currentHP: hp,
    moveType: 'Infantry',
    stats: { ...body, HP: Math.max(hp, 30), DEF: 4 },
    weapon: null,
    inventory: [],
    skills: [],
    accessory: null,
    affixes: [],
    ...extra,
  };
}
// Keeps a rout from ending when the foes under test fall.
const bystander = () => ({ ...makeFoe('Bystander', 7), row: 7 });

const plain = data.terrain.find((t) => t.name === 'Plain');
const iceTerrain = data.terrain.find((t) => t.name === 'Ice');
/** A board of plains with walls (impassable) and Ice at the listed "col,row" tiles. */
function board({ walls = [], ice = [] } = {}) {
  return {
    moveCost: (col, row) => (walls.includes(`${col},${row}`) ? Infinity : 1),
    terrainAt: (col, row) => (ice.includes(`${col},${row}`) ? iceTerrain : plain),
  };
}

/** The battle through BattleScene: real executeCombat, no drawing. */
function sceneWorld(players, enemies, { moveCost, terrainAt }) {
  const scene = journeyBattleScene({}, data);
  scene.runManager = null;
  scene._battleRewindPolicy = 'fixed-v1';
  scene._battleRng = createBattleRng(42);
  Math.random = scene._battleRng;
  Object.assign(scene.grid, {
    cols: 8,
    rows: 8,
    fogEnabled: false,
    clearTemporaryTerrainsBySource: () => {},
    getMoveCost: moveCost,
    getTerrainAt: terrainAt,
  });
  scene.battleConfig = { objective: 'rout' };
  scene.goldEarned = 0;
  scene.turnPar = 99;
  scene.turnBonusConfig = data.turnBonus;
  scene.getCurrentTurnNumber = () => 1;
  scene.playerUnits = players;
  scene.enemyUnits = enemies;
  rendering(scene, 0);
  scene._getSelectedWeaponArtForUnit = () => override;
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
    attack: (attacker, defender) => scene.executeCombat(attacker, defender),
  };
}

/** The same battle through the headless harness, which mirrors the scene's state machine. */
function harnessWorld(players, enemies, { moveCost, terrainAt }) {
  const battle = new HeadlessBattle(structuredClone(data), { act: 'act1', objective: 'rout' });
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
    getTerrainAt: terrainAt,
    getMoveCost: moveCost,
    updateFogOfWar() {},
  };
  battle._grantScaledXP = () => {};
  return {
    kind: 'harness',
    attack: async (attacker, defender) => {
      battle.selectedUnit = attacker;
      battle._setSelectedWeaponArt(attacker, override.id, attacker.weapon);
      Math.random = () => 0.01;
      battle._executeCombat(attacker, defender);
    },
  };
}

const WORLDS = [
  ['the scene', sceneWorld],
  ['the harness', harnessWorld],
];
const cols = (...units) => units.map((u) => u.col);

describe.each(WORLDS)('Override through %s', (_label, makeWorld) => {
  /** Lancer on col 1; Primary 2, Near 3, Far 4 unless `foes` changes them. */
  const fight = async ({
    primary = {},
    near = {},
    far = {},
    primaryHP = 30,
    nearHP = 30,
    farHP = 30,
    land = {},
    lancerCol = 1,
    range = '1',
  } = {}) => {
    const lancer = makeLancer({ col: lancerCol, range });
    const p = makeFoe('Primary', 2, primaryHP, primary);
    const n = makeFoe('Near', 3, nearHP, near);
    const f = makeFoe('Far', 4, farHP, far);
    const world = makeWorld([lancer], [p, n, f, bystander()], board(land));
    await world.attack(lancer, p);
    return { lancer, p, n, f };
  };

  it('strikes every foe in the line, then drives each one back a tile, farthest first', async () => {
    const { lancer, p, n, f } = await fight();
    // The blows: 30 - 16, and 30 - 9 behind it. The art cost the Lancer 5 HP.
    expect([p.currentHP, n.currentHP, f.currentHP, lancer.currentHP]).toEqual([14, 21, 21, 35]);
    // Far went first (4 -> 5), so Near could follow (3 -> 4), and then the primary (2 -> 3).
    // Pushed nearest-first, only Far would have moved.
    expect(cols(p, n, f)).toEqual([3, 4, 5]);
    expect(lancer.col).toBe(1);
    expect([p.row, n.row, f.row]).toEqual([3, 3, 3]);
  });

  it('leaves everyone in place when a wall stands behind the last foe', async () => {
    const { p, n, f } = await fight({ land: { walls: ['5,3'] } });
    expect([p.currentHP, n.currentHP, f.currentHP]).toEqual([14, 21, 21]);
    expect(cols(p, n, f)).toEqual([2, 3, 4]);
  });

  it('a boss in the line stays, the foe behind it moves, the target in front is held by it', async () => {
    const { p, n, f } = await fight({ near: { isBoss: true } });
    expect(n.currentHP).toBe(21);
    expect(cols(p, n, f)).toEqual([2, 3, 5]);
  });

  it('an Anchored foe stays put; the foes it blocks stay too', async () => {
    const anchored = await fight({ far: { affixes: ['anchored'] } });
    expect(cols(anchored.p, anchored.n, anchored.f)).toEqual([2, 3, 4]);
    // Anchored in the middle: only the one behind it moves.
    const middle = await fight({ near: { affixes: ['anchored'] } });
    expect(cols(middle.p, middle.n, middle.f)).toEqual([2, 3, 5]);
  });

  it('a rooted foe is not pushed', async () => {
    const lancer = makeLancer();
    const p = makeFoe('Primary', 2);
    const n = makeFoe('Near', 3);
    const f = makeFoe('Far', 4);
    applyCondition(n, 'root', 3, { recoveryChance: 0 });
    const world = makeWorld([lancer], [p, n, f, bystander()], board());
    await world.attack(lancer, p);
    expect(cols(p, n, f)).toEqual([2, 3, 5]);
  });

  it('slides a foe pushed onto Ice on to the first tile that is not Ice', async () => {
    // Far is driven onto the Ice at col 5 and slides on to col 6, a plain: still one push.
    const { p, n, f } = await fight({ land: { ice: ['5,3'] } });
    expect(cols(p, n, f)).toEqual([3, 4, 6]);
  });

  it('a foe the line kills is not pushed, and the one in front of it can step in', async () => {
    // Near has 9 HP: the blow (9) fells it where it stands.
    const { p, n, f } = await fight({ nearHP: 9 });
    expect(n.currentHP).toBe(0);
    expect(n.col).toBe(3);
    expect(cols(p, f)).toEqual([3, 5]);
  });

  it('a target the strike kills is not pushed, but the line still is', async () => {
    const { p, n, f } = await fight({ primaryHP: 10 });
    expect(p.currentHP).toBe(0);
    expect(p.col).toBe(2);
    expect(cols(n, f)).toEqual([4, 5]);
    expect([n.currentHP, f.currentHP]).toEqual([21, 21]);
  });

  it('from two tiles the line still strikes, but nothing is pushed', async () => {
    // A 1-2 range lance from col 0: the target is on col 2, so the line is still cols 3 and 4.
    const { lancer, p, n, f } = await fight({ lancerCol: 0, range: '1-2' });
    expect([p.currentHP, n.currentHP, f.currentHP]).toEqual([14, 21, 21]);
    expect(cols(p, n, f)).toEqual([2, 3, 4]);
    expect(lancer.col).toBe(0);
  });

  it('what a suspend or a rewind keeps is the pushed board', async () => {
    const lancer = makeLancer();
    const p = makeFoe('Primary', 2);
    const n = makeFoe('Near', 3);
    const f = makeFoe('Far', 4);
    const before = JSON.parse(JSON.stringify([p, n, f].map(serializeBattleUnit)));
    const world = makeWorld([lancer], [p, n, f, bystander()], board());
    await world.attack(lancer, p);
    const after = JSON.parse(JSON.stringify([p, n, f].map(serializeBattleUnit)));
    // The saved copies carry the tiles the live units stand on, and the earlier copy the old ones.
    expect(after.map((u) => [u.col, u.row])).toEqual([p, n, f].map((u) => [u.col, u.row]));
    expect(after.map((u) => u.col)).toEqual([3, 4, 5]);
    expect(before.map((u) => u.col)).toEqual([2, 3, 4]);
  });
});
