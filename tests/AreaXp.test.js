// actionXpAwards: XP for an action that hit several foes (docs/specs/aoe-weapon-arts.md
// §2.5). Expected values are worked by hand from the constants (XP_BASE_COMBAT 25,
// XP_KILL_BONUS 15, XP_LEVEL_DIFF_SCALE 5) and the decided area rates (hit 0.35,
// kill 0.6, area cap 75, all on base XP before the battle's multipliers).
import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { AREA_XP_LIVE, actionXpAwards, combatXpAwards } from '../src/engine/BattleXp.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const unit = (name, level, extra = {}) => ({
  name,
  level,
  tier: 'base',
  faction: 'player',
  col: 0,
  row: 0,
  currentHP: 20,
  xp: 0,
  stats: { HP: 20 },
  ...extra,
});
const foe = (name, level = 5, extra = {}) => ({
  name,
  level,
  tier: 'base',
  faction: 'enemy',
  currentHP: 0,
  ...extra,
});
const awardsOf = (list) => list.map((a) => [a.unit.name, a.baseXp, a.share]);
const band = { name: "Mentor's Band", combatEffects: { xpShare: 0.5 } };

// The primary: a level-5 foe hit for 10 of its 20 HP, not killed: 25 × 0.5 = 12.
const primaryInputs = (hero, extra = {}) => ({
  unit: hero,
  opponent: foe('Primary'),
  opponentDied: false,
  damageDealt: 10,
  opponentHpAtStart: 20,
  ...extra,
});
// Two area victims: A hit for 6 of 20 (25 × 0.3 × 0.35 = 2.625), B killed (40 × 0.6 = 24).
const twoCredits = () => [
  { victim: foe('A'), damage: 6, hpBefore: 20, killed: false },
  { victim: foe('B'), damage: 7, hpBefore: 7, killed: true },
];

describe('actionXpAwards', () => {
  it('with no credits it is exactly combatXpAwards', () => {
    const hero = unit('Hero', 5);
    expect(awardsOf(actionXpAwards({ ...primaryInputs(hero), credits: [] }))).toEqual(
      awardsOf(combatXpAwards(primaryInputs(hero))),
    );
  });

  it('adds area hits at 0.35 and area kills at 0.6, in one award', () => {
    const hero = unit('Hero', 5);
    // 12 + floor(2.625 + 24) = 12 + 26 = 38
    expect(awardsOf(actionXpAwards({ ...primaryInputs(hero), credits: twoCredits() }))).toEqual([
      ['Hero', 38, false],
    ]);
  });

  it('caps the area credits at 75 base, never touching the primary', () => {
    const hero = unit('Hero', 5);
    const kills = ['A', 'B', 'C', 'D'].map((name) => ({
      victim: foe(name),
      damage: 9,
      hpBefore: 9,
      killed: true,
    }));
    // 4 × 24 = 96 → 75; plus the primary's 12.
    expect(awardsOf(actionXpAwards({ ...primaryInputs(hero), credits: kills }))).toEqual([
      ['Hero', 87, false],
    ]);
  });

  it("uses each victim's own reward multiplier, and Training Doctrine for a recruit", () => {
    const hero = unit('Hero', 5);
    const credits = [
      { victim: foe('Elite', 5, { isElite: true }), damage: 5, hpBefore: 5, killed: true },
    ];
    const rewardMultiplierOf = (victim) => (victim.isElite ? 1.5 : 1);
    // 40 × 0.6 × 1.5 = 36. With Training Doctrine +20% both parts grow: the primary
    // floor(12 × 1.2) = 14, the credit 36 × 1.2 = 43.2 → 43.
    expect(
      awardsOf(actionXpAwards({ ...primaryInputs(hero), credits, rewardMultiplierOf })),
    ).toEqual([['Hero', 12 + 36, false]]);
    expect(
      awardsOf(
        actionXpAwards({
          ...primaryInputs(hero),
          credits,
          rewardMultiplierOf,
          recruitXpBonus: 0.2,
        }),
      ),
    ).toEqual([['Hero', 14 + 43, false]]);
  });

  it('skips victims that give no XP', () => {
    const hero = unit('Hero', 5);
    const credits = [
      { victim: foe('Summon', 5, { _noXP: true }), damage: 9, hpBefore: 9, killed: true },
    ];
    expect(awardsOf(actionXpAwards({ ...primaryInputs(hero), credits }))).toEqual([
      ['Hero', 12, false],
    ]);
  });

  it("Mentor's Band shares the area credits once, by the trainee's own formula", () => {
    const holder = unit('Holder', 5, { accessory: band });
    const trainee = unit('Trainee', 3, { col: 1 });
    // Trainee vs level-5 foes: 25 + 2 × 5 = 35 a hit, 50 a kill.
    // Primary share: floor(35 × 0.5 × 0.5 damage ratio) = 8.
    // Area share: (35 × 0.3 × 0.35 + 50 × 0.6) × 0.5 = 33.675 × 0.5 = 16.8 → 16.
    const got = actionXpAwards({
      ...primaryInputs(holder, { allies: [holder, trainee] }),
      credits: twoCredits(),
    });
    expect(awardsOf(got)).toEqual([
      ['Holder', 38, false],
      ['Trainee', 24, true],
    ]);
  });

  it('a chosen-center strike counts its best credit as the primary', () => {
    const hero = unit('Hero', 5);
    // B (a kill, 40) beats A (25 × 0.3 = 7.5): B at the primary rate = 40, A as area = 2.
    expect(awardsOf(actionXpAwards({ unit: hero, opponent: null, credits: twoCredits() }))).toEqual(
      [['Hero', 42, false]],
    );
    expect(actionXpAwards({ unit: hero, opponent: null, credits: [] })).toEqual([]);
  });
});

describe('the harness pays area credits', () => {
  // A full harness combat with a fixed 30-damage blast of radius 1: the neighbour (5 HP,
  // level 5 like the attacker) falls to the blast, a kill credit worth 40 × 0.6 = 24
  // base XP on top of whatever the primary combat earns.
  function fight({ withNeighbour, live = true }) {
    const gameData = structuredClone(data);
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
    gameData.weaponArts.arts.push(art);
    const weapon = {
      name: 'Test Blade',
      type: 'Sword',
      might: 8,
      hit: 100,
      crit: 0,
      weight: 5,
      range: '1',
      special: '',
      weaponArtIds: [art.id],
      weaponArtSources: ['scroll'],
    };
    const body = { HP: 30, STR: 12, MAG: 0, SKL: 9, SPD: 9, DEF: 7, RES: 3, LCK: 5, MOV: 5 };
    const attacker = unit('Edric', 5, {
      stats: { ...body },
      currentHP: 30,
      moveType: 'Infantry',
      weaponRank: 'Mast',
      weapon,
      inventory: [weapon],
      proficiencies: [{ type: 'Sword', rank: 'Mast' }],
      skills: [],
      accessory: null,
      _gambitUsedThisTurn: true,
    });
    const enemy = (name, col, hp) => ({
      ...foe(name, 5),
      col,
      row: 0,
      currentHP: hp,
      moveType: 'Infantry',
      stats: { ...body, HP: hp, DEF: 4 },
      weapon: null,
      inventory: [],
      skills: [],
      accessory: null,
    });
    const primary = enemy('Primary', 1, 30);
    const neighbour = enemy('Neighbour', 2, 5);
    const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout' });
    battle.turnManager = { turnNumber: 1, unitActed() {} };
    battle.battleConfig = { objective: 'rout' };
    battle.playerUnits = [attacker];
    battle.enemyUnits = withNeighbour ? [primary, neighbour] : [primary];
    battle.npcUnits = [];
    battle.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      getTerrainAt: () => ({}),
      getMoveCost: () => 1,
      updateFogOfWar() {},
    };
    battle.areaXpLive = live;
    const granted = [];
    battle._grantScaledXP = (u, xp) => granted.push([u.name, xp]);
    battle.selectedUnit = attacker;
    battle._setSelectedWeaponArt(attacker, art.id, weapon);
    const prev = Math.random;
    Math.random = () => 0.01;
    try {
      battle._executeCombat(attacker, primary);
    } finally {
      Math.random = prev;
    }
    return { granted, neighbour };
  }

  it('until the scene pays area XP, the harness pays none either (AREA_XP_LIVE)', () => {
    expect(AREA_XP_LIVE).toBe(false);
    expect(new HeadlessBattle(data, { act: 'act1', objective: 'rout' }).areaXpLive).toBe(false);
    const alone = fight({ withNeighbour: false, live: false });
    const flanked = fight({ withNeighbour: true, live: false });
    expect(flanked.neighbour.currentHP).toBe(0);
    expect(flanked.granted).toEqual(alone.granted);
  });

  it('with area XP live, a full harness combat pays the blast kill on top of the primary', () => {
    const alone = fight({ withNeighbour: false });
    const flanked = fight({ withNeighbour: true });
    expect(flanked.neighbour.currentHP).toBe(0);
    expect(alone.granted).toHaveLength(1);
    expect(flanked.granted).toEqual([['Edric', alone.granted[0][1] + 24]]);
  });

  it('a Burning Quake that fells a neighbour pays its kill credit with the primary', () => {
    const battle = new HeadlessBattle(data, { act: 'act1', objective: 'rout' });
    battle.turnPar = 99;
    const hero = unit('Mage', 5, { xp: 0 });
    const primary = foe('Primary');
    const granted = [];
    battle._grantScaledXP = (u, xp) => granted.push([u.name, xp]);
    battle._awardCombatXP(hero, primary, false, 10, 20, {
      credits: [{ victim: foe('Neighbour'), damage: 7, hpBefore: 7, killed: true }],
    });
    // 12 for the primary + 40 × 0.6 = 24 for the neighbour.
    expect(granted).toEqual([['Mage', 36]]);
  });
});
