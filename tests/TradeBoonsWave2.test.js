// The act boss rework's second wave of trade cards (engine/TradeBoons.js; docs/specs/blessings-v3.md
// §6.8): Standard of the Sun with a cost, Oathbound Steel, Siegebreaker and Smith's Exile. Real
// runs and real data; each card is taken the way the act boss's pick takes it (its boons, then its
// twist as its held price).
//
// Ways this can fail, a test each:
//   - a card's data is wrong-signed or a new effect type is in the wrong role, and ships;
//   - a card's flags are lost (or doubled) by a save and a load;
//   - the battle params carry a card's rule without the card (or drop it with the card);
//   - Oathbound Steel's counter rule reads the wrong side, never reaches the resolution (the
//     forecast says "no counter" but the foe strikes back), or differs between scene and harness;
//   - the weapon lock leaves a way to change weapons in battle (attack weapon cycle, an art
//     carried by another weapon, Trade, reorder, the per-battle swap), or a heal keeps the staff;
//   - Siegebreaker's reach misses a reader (targeting, counters, the move preview, area centre),
//     reaches a sword or a foe, or rides out of the battle on the roster;
//   - Siegebreaker's -2 Might reaches a bow or a foe;
//   - Smith's Exile forges the catalog's own rows, leaves a forge open (shop, whetstone, event),
//     or closes repair;
//   - Standard of the Sun's foes never prefer (or never chase) the commander;
//   - a unit joining mid-battle misses the stamps.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/LevelUpPopup.js', () => ({
  LevelUpPopup: class {
    async show() {}
  },
}));
vi.mock('../src/ui/HintDisplay.js', () => ({
  showImportantHint: vi.fn(async () => {}),
  showMinorHint: vi.fn(),
  showContextualHint: vi.fn(),
}));

import './harness/JourneyTestSetup.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { presentationFailureProxy as rendering } from './harness/PresentationFailureProxy.js';
import { RunManager } from '../src/engine/RunManager.js';
import { validateBlessingsConfig } from '../src/engine/BlessingEngine.js';
import { twistPriceOf } from '../src/engine/EarnedBlessings.js';
import {
  TRIANGLE_COUNTER_REASON,
  canCounter,
  getCombatForecast,
  resolveCombat,
} from '../src/engine/Combat.js';
import {
  TRADE_BOON_TYPES,
  TRADE_TWIST_TYPES,
  applyTradeBattleParams,
  sanitizeTradeBoonModifiers,
  stampArmyBattleRules,
  tradeBoonModifierDefaults,
} from '../src/engine/TradeBoons.js';
import { RANGED_REACH_FIELD, rangedReachBonusOf } from '../src/engine/WeaponReach.js';
import {
  WEAPON_SWAP_LOCK_FIELD,
  WEAPON_SWAP_LOCK_REASON,
  weaponChangeBlocked,
} from '../src/engine/WeaponSwapLock.js';
import {
  FORGE_FORBIDDEN_REASON,
  FORGE_FORBIDDEN_TAG,
  arrivalCopy,
  whetstoneTag,
} from '../src/engine/SmithsExile.js';
import { getAttackRange, getAttackWeapons } from '../src/engine/AttackOptions.js';
import { canUseWeaponArt } from '../src/engine/WeaponArtSystem.js';
import { swapSpentWeapons } from '../src/engine/PerBattleWeapons.js';
import { planReorder, planTrade, unitHolder } from '../src/engine/ItemTrade.js';
import { unitReach } from '../src/engine/ThreatForecast.js';
import { areaStrikeRange } from '../src/engine/AreaStrike.js';
import { serializeUnit } from '../src/engine/UnitSerialization.js';
import { settleRecruitJoin } from '../src/engine/BattleRecruits.js';
import { AIController, COMMANDER_PRIORITY_SCORE } from '../src/engine/AIController.js';
import { Grid } from '../src/engine/Grid.js';
import { rewardDrawParams, rollBattleRewardChoices } from '../src/engine/PendingBattleRewards.js';
import { purchaseShopItem, shopForgeBlock, shopRepairBlock } from '../src/engine/ShopCommands.js';
import { applyRewardForge } from '../src/engine/LootRewardCommands.js';
import { applyWear } from '../src/engine/WeaponWear.js';
import { chooseEventOption } from '../src/engine/EventCommands.js';
import { addUnit, arriveAs, runWithEvents, soloEvent } from './eventKit.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const realRandom = Math.random;
let store;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
});
afterEach(() => {
  Math.random = realRandom;
  vi.unstubAllGlobals();
  restoreMathRandom();
});

const WAVE_TWO = ['standard_of_the_sun_ii', 'oathbound_steel', 'siegebreaker', 'smiths_exile'];
const card = (id) => data.blessings.blessings.find((b) => b.id === id);
const catalogWeapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));

function freshRun({ seed = 41, difficultyId = 'dusk', gameData = data } = {}) {
  const rm = new RunManager(gameData);
  rm.startRun({ runSeed: seed, difficultyId, applyBlessingsAtStart: false });
  rm.blessingHistory = [];
  return rm;
}
function take(rm, ...ids) {
  for (const id of ids)
    expect(
      rm.addBlessingMidRun(id, { earned: true, price: twistPriceOf(card(id)), source: 'act_boss' }),
      id,
    ).toBe(true);
  return rm;
}
const roundTrip = (rm) => RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), rm.gameData);
const firstBattle = (rm) => rm.nodeMap.nodes.find((n) => n.type === 'battle');

const body = { HP: 40, STR: 12, MAG: 6, SKL: 9, SPD: 9, DEF: 7, RES: 3, LCK: 5, MOV: 5 };
function makeUnit(name, faction, col, row, weaponNames = ['Iron Sword'], extra = {}) {
  const inventory = weaponNames.map(catalogWeapon);
  const types = [...new Set(inventory.map((w) => w.type))];
  return {
    name,
    level: 5,
    tier: 'base',
    faction,
    col,
    row,
    xp: 0,
    currentHP: 40,
    stats: { ...body },
    moveType: 'Infantry',
    className: 'Myrmidon',
    growths: {},
    weaponRank: 'Prof',
    weapon: inventory[0] || null,
    inventory,
    consumables: [],
    proficiencies: types.map((type) => ({ type, rank: 'Mast' })),
    skills: [],
    accessory: null,
    affixes: [],
    ...extra,
  };
}

// ── The data, the roles and the save ───────────────────────────────────────

describe('the wave-two cards in the data', () => {
  it('validate, are act boss cards with a twist, and the old Standard is retired at weight 0', () => {
    expect(validateBlessingsConfig(data.blessings).errors).toEqual([]);
    for (const id of WAVE_TWO) {
      const b = card(id);
      expect(b?.earned, id).toBe(true);
      expect(b.weight, id).toBeGreaterThan(0);
      expect(
        b.sources.every((s) => s.kind === 'act_boss'),
        id,
      ).toBe(true);
      expect(b.twist?.effects?.length, id).toBeGreaterThan(0);
    }
    expect(card('standard_of_the_sun')).toMatchObject({ weight: 0 });
    expect(card('standard_of_the_sun').name).toMatch(/\(old\)$/);
    expect(card('smiths_exile').excludes).toEqual(
      expect.arrayContaining(['frugal_smith', 'smiths_covenant']),
    );
  });

  it('each new effect is a boon or a cost, never the other', () => {
    for (const type of [
      'triangle_advantage_no_counter',
      'ranged_range_bonus',
      'weapons_arrive_forged',
    ]) {
      expect(TRADE_BOON_TYPES, type).toContain(type);
      expect(TRADE_TWIST_TYPES, type).not.toContain(type);
    }
    for (const type of [
      'foes_target_commander',
      'triangle_disadvantage_no_counter',
      'weapon_swap_locked',
      'forging_forbidden',
    ]) {
      expect(TRADE_TWIST_TYPES, type).toContain(type);
      expect(TRADE_BOON_TYPES, type).not.toContain(type);
    }
    // A cost written as a boon is refused by the catalog's validator.
    const bad = structuredClone(data.blessings);
    const row = bad.blessings.find((b) => b.id === 'siegebreaker');
    row.boons = [{ type: 'forging_forbidden', params: {} }];
    expect(validateBlessingsConfig(bad).errors.length).toBeGreaterThan(0);
  });

  it('taking all four sets their flags once; a save and a load keep them, never doubled', () => {
    const rm = take(freshRun(), ...WAVE_TWO);
    const expected = {
      foesTargetCommander: true,
      triangleAdvantageNoCounter: true,
      triangleDisadvantageNoCounter: true,
      weaponSwapLocked: true,
      rangedRangeBonus: 1,
      weaponArrivalForge: 1,
      forgingForbidden: true,
    };
    expect(rm.blessingRuntimeModifiers).toMatchObject(expected);
    const loaded = roundTrip(rm);
    expect(loaded.blessingRuntimeModifiers).toMatchObject(expected);
    expect(roundTrip(loaded).blessingRuntimeModifiers).toMatchObject(expected);
    // A run without them reads the defaults.
    expect(freshRun().blessingRuntimeModifiers).toMatchObject({
      foesTargetCommander: false,
      triangleAdvantageNoCounter: false,
      triangleDisadvantageNoCounter: false,
      weaponSwapLocked: false,
      rangedRangeBonus: 0,
      weaponArrivalForge: 0,
      forgingForbidden: false,
    });
  });

  it('a tampered save is clamped on load (no string flags, no reach of 9)', () => {
    const clean = sanitizeTradeBoonModifiers({
      ...tradeBoonModifierDefaults(),
      foesTargetCommander: 'yes',
      weaponSwapLocked: 1,
      rangedRangeBonus: 9,
      weaponArrivalForge: -3,
    });
    expect(clean.foesTargetCommander).toBe(false);
    expect(clean.weaponSwapLocked).toBe(false);
    expect(clean.rangedRangeBonus).toBe(2);
    expect(clean.weaponArrivalForge).toBe(0);
  });
});

describe('the battle params', () => {
  it('carry each rule only while its card is held', () => {
    const plain = freshRun();
    const params = plain.getBattleParams(firstBattle(plain));
    for (const key of ['foesTargetCommander', 'weaponSwapLocked', 'rangedRangeBonus'])
      expect(params, key).not.toHaveProperty(key);
    const held = take(freshRun(), 'standard_of_the_sun_ii', 'oathbound_steel', 'siegebreaker');
    expect(held.getBattleParams(firstBattle(held))).toMatchObject({
      foesTargetCommander: true,
      weaponSwapLocked: true,
      rangedRangeBonus: 1,
    });
  });

  it('stampArmyBattleRules marks player units only, is set not added, and clears a battle without', () => {
    const edric = makeUnit('Edric', 'player', 0, 0, ['Iron Bow']);
    const foe = makeUnit('Foe', 'enemy', 1, 0, ['Iron Bow']);
    const green = makeUnit('Green', 'npc', 2, 0, ['Iron Bow']);
    const params = { rangedRangeBonus: 1, weaponSwapLocked: true };
    stampArmyBattleRules([edric, foe, green], params);
    stampArmyBattleRules([edric, foe, green], params);
    expect(edric[RANGED_REACH_FIELD]).toBe(1);
    expect(edric[WEAPON_SWAP_LOCK_FIELD]).toBe(true);
    for (const u of [foe, green]) {
      expect(u).not.toHaveProperty(RANGED_REACH_FIELD);
      expect(u).not.toHaveProperty(WEAPON_SWAP_LOCK_FIELD);
    }
    stampArmyBattleRules([edric], {});
    expect(edric).not.toHaveProperty(RANGED_REACH_FIELD);
    expect(edric).not.toHaveProperty(WEAPON_SWAP_LOCK_FIELD);
  });

  it('the stamps leave the battle: serializeUnit drops them', () => {
    const edric = makeUnit('Edric', 'player', 0, 0, ['Iron Bow']);
    stampArmyBattleRules([edric], { rangedRangeBonus: 2, weaponSwapLocked: true });
    const saved = serializeUnit(edric);
    expect(saved).not.toHaveProperty(RANGED_REACH_FIELD);
    expect(saved).not.toHaveProperty(WEAPON_SWAP_LOCK_FIELD);
  });

  it('the scene and the harness stamp the army at the battle start', () => {
    const rm = take(freshRun(), 'siegebreaker', 'oathbound_steel');
    installSeed(9);
    const battle = new HeadlessBattle(data, rm.getBattleParams(firstBattle(rm)), rm.getRoster(), {
      runManager: rm,
    });
    battle.init();
    expect(battle.playerUnits.length).toBeGreaterThan(0);
    for (const u of battle.playerUnits) {
      expect(u[RANGED_REACH_FIELD], u.name).toBe(1);
      expect(u[WEAPON_SWAP_LOCK_FIELD], u.name).toBe(true);
    }
    for (const u of battle.enemyUnits) expect(u).not.toHaveProperty(RANGED_REACH_FIELD);
    // The roster itself never carries them.
    for (const u of rm.roster) expect(u).not.toHaveProperty(RANGED_REACH_FIELD);
  });

  it('a recruit joining mid-battle takes the stamps', () => {
    const rm = take(freshRun(), 'siegebreaker', 'oathbound_steel');
    const npc = makeUnit('Joiner', 'npc', 2, 2, ['Iron Bow']);
    const { npc: joined } = settleRecruitJoin({
      npc,
      npcUnits: [npc],
      playerUnits: [],
      runManager: rm,
      battleRecruits: [],
      turn: 2,
    });
    expect(joined.faction).toBe('player');
    expect(joined[RANGED_REACH_FIELD]).toBe(1);
    expect(joined[WEAPON_SWAP_LOCK_FIELD]).toBe(true);
    expect(applyTradeBattleParams(freshRun(), {})).toEqual({});
  });
});

// ── Oathbound Steel ─────────────────────────────────────────────────────────

describe('Oathbound Steel: the triangle decides counters', () => {
  function sceneCtx(run, units) {
    const scene = journeyBattleScene(run, data);
    scene.runManager = run;
    Math.random = () => 0.3;
    Object.assign(scene.grid, {
      fogEnabled: false,
      getMoveCost: () => 1,
      getTerrainAt: () => data.terrain.find((t) => t.name === 'Plain'),
    });
    scene.playerUnits = units.filter((u) => u.faction === 'player');
    scene.enemyUnits = units.filter((u) => u.faction === 'enemy');
    scene.npcUnits = [];
    rendering(scene, 0);
    return (a, d) => scene.buildSkillCtx(a, d, null);
  }
  function harnessCtx(run, units) {
    const battle = new HeadlessBattle(structuredClone(data), { act: 'act1', objective: 'rout' });
    battle.turnManager = { turnNumber: 1 };
    battle.runManager = run;
    battle.playerUnits = units.filter((u) => u.faction === 'player');
    battle.enemyUnits = units.filter((u) => u.faction === 'enemy');
    battle.npcUnits = [];
    battle.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      getTerrainAt: () => ({ name: 'Plain' }),
      getMoveCost: () => 1,
      updateFogOfWar() {},
    };
    Math.random = () => 0.3;
    return (a, d) => battle._buildSkillCtx(a, d, null);
  }
  const counters = (result) =>
    result.events.filter((e) => e.type === 'strike' && e.attackerSide === 'defender').length;
  // Edric (sword) at (3,3) beside a foe at (4,3) with `foeWeapon`.
  const exchange = (build, ids, foeWeapon, { foeAttacks = false } = {}) => {
    const edric = makeUnit('Edric', 'player', 3, 3, ['Iron Sword']);
    const foe = makeUnit('Foe', 'enemy', 4, 3, [foeWeapon]);
    const ctx = build(take(freshRun(), ...ids), [edric, foe]);
    const [a, d] = foeAttacks ? [foe, edric] : [edric, foe];
    const skillCtx = ctx(a, d);
    const forecast = getCombatForecast(a, a.weapon, d, d.weapon, 1, null, null, skillCtx);
    const result = resolveCombat(a, a.weapon, d, d.weapon, 1, null, null, ctx(a, d));
    return { forecast, result };
  };

  for (const [label, build] of [
    ['the scene', sceneCtx],
    ['the harness', harnessCtx],
  ]) {
    describe(label, () => {
      it('the boon: a sword striking an axe is never countered, in the forecast and the blow', () => {
        const plain = exchange(build, [], 'Iron Axe');
        expect(plain.forecast.defender.canCounter).toBe(true);
        expect(counters(plain.result)).toBeGreaterThan(0);
        const sworn = exchange(build, ['oathbound_steel'], 'Iron Axe');
        expect(sworn.forecast.defender.canCounter).toBe(false);
        expect(sworn.forecast.display.counterReason).toBe(TRIANGLE_COUNTER_REASON);
        expect(counters(sworn.result)).toBe(0);
      });

      it('no advantage, no boon: a sword striking a sword is countered as ever', () => {
        const sworn = exchange(build, ['oathbound_steel'], 'Iron Sword');
        expect(sworn.forecast.defender.canCounter).toBe(true);
        expect(counters(sworn.result)).toBeGreaterThan(0);
      });

      it("the cost: a lance striking Edric's sword goes unanswered", () => {
        const plain = exchange(build, [], 'Iron Lance', { foeAttacks: true });
        expect(plain.forecast.defender.canCounter).toBe(true);
        const sworn = exchange(build, ['oathbound_steel'], 'Iron Lance', { foeAttacks: true });
        expect(sworn.forecast.defender.canCounter).toBe(false);
        expect(sworn.forecast.display.counterReason).toBe(TRIANGLE_COUNTER_REASON);
        expect(counters(sworn.result)).toBe(0);
      });

      it("the boon is the player's only: a lance striking Edric is not spared his counter by it", () => {
        // The foe has the advantage, but the boon is no foe's: only the cost stops the counter.
        // An axe striking Edric (his advantage) is countered as ever.
        const sworn = exchange(build, ['oathbound_steel'], 'Iron Axe', { foeAttacks: true });
        expect(sworn.forecast.defender.canCounter).toBe(true);
        expect(counters(sworn.result)).toBeGreaterThan(0);
      });
    });
  }
});

describe('Oathbound Steel: no weapon changes in battle', () => {
  const locked = (names, extra) => {
    const u = makeUnit('Edric', 'player', 0, 0, names, extra);
    stampArmyBattleRules([u], { weaponSwapLocked: true });
    return u;
  };

  it('the attack offers only the weapon held; an unlocked unit is offered both', () => {
    const free = makeUnit('Edric', 'player', 0, 0, ['Iron Sword', 'Steel Sword']);
    expect(getAttackWeapons(free).map((w) => w.name)).toEqual(['Iron Sword', 'Steel Sword']);
    const unit = locked(['Iron Sword', 'Steel Sword']);
    expect(getAttackWeapons(unit)).toEqual([unit.weapon]);
    // A foe is never locked, whatever it carries.
    const foe = makeUnit('Foe', 'enemy', 0, 0, ['Iron Sword', 'Steel Sword']);
    foe[WEAPON_SWAP_LOCK_FIELD] = true;
    expect(getAttackWeapons(foe)).toHaveLength(2);
  });

  it("an art carried by another weapon is out ('weapon_locked'); the held weapon's arts are not", () => {
    const art = data.weaponArts.arts.find(
      (a) => a.weaponType === 'Sword' && !a.legendaryWeapon && !a.requiredWeapon,
    );
    const unit = locked(['Iron Sword', 'Steel Sword']);
    const other = unit.inventory[1];
    expect(canUseWeaponArt(unit, other, art, {}).reason).toBe('weapon_locked');
    expect(canUseWeaponArt(unit, unit.weapon, art, {}).reason).not.toBe('weapon_locked');
  });

  it('in-battle Trade cannot take the held weapon out of its hands; a spare still moves', () => {
    const unit = locked(['Iron Sword', 'Steel Sword']);
    const friend = makeUnit('Kai', 'player', 1, 0, ['Iron Sword']);
    const battle = { context: 'battle' };
    const out = planTrade(
      battle,
      { holder: unitHolder(unit), bag: 'inventory', item: unit.weapon },
      { holder: unitHolder(friend), bag: 'inventory', item: null },
    );
    expect(out).toEqual({ ok: false, reason: WEAPON_SWAP_LOCK_REASON });
    const spare = planTrade(
      battle,
      { holder: unitHolder(unit), bag: 'inventory', item: unit.inventory[1] },
      { holder: unitHolder(friend), bag: 'inventory', item: null },
    );
    expect(spare.ok).toBe(true);
    // A swap that hands the held weapon over is refused from either side.
    const swap = planTrade(
      battle,
      { holder: unitHolder(friend), bag: 'inventory', item: friend.weapon },
      { holder: unitHolder(unit), bag: 'inventory', item: unit.weapon },
    );
    expect(swap.reason).toBe(WEAPON_SWAP_LOCK_REASON);
  });

  it('a reorder that would change the held weapon is refused in battle, allowed between battles', () => {
    const unit = locked(['Iron Sword', 'Steel Sword']);
    const from = { holder: unitHolder(unit), bag: 'inventory', item: unit.inventory[1] };
    const to = { holder: unitHolder(unit), bag: 'inventory', item: unit.weapon };
    expect(planReorder({ context: 'battle' }, from, to)).toEqual({
      ok: false,
      reason: WEAPON_SWAP_LOCK_REASON,
    });
    expect(planReorder({ context: 'roster', run: { roster: [unit] } }, from, to).ok).toBe(true);
  });

  it('a spent per-battle weapon is not swapped for another while locked', () => {
    const make = () => {
      const u = makeUnit('Sage', 'player', 0, 0, ['Breachbolt', 'Fire']);
      u.weapon._usesSpent = 99;
      return u;
    };
    const free = make();
    expect(swapSpentWeapons([free])).toHaveLength(1);
    expect(free.weapon.name).toBe('Fire');
    const held = make();
    stampArmyBattleRules([held], { weaponSwapLocked: true });
    expect(swapSpentWeapons([held])).toEqual([]);
    expect(held.weapon.name).toBe('Breachbolt');
  });

  it('a unit holding a staff (no combat weapon) may take one up; the lock then holds it', () => {
    const unit = locked(['Heal', 'Iron Sword']);
    expect(weaponChangeBlocked(unit, unit.inventory[1])).toBe(false);
    unit.weapon = unit.inventory[1];
    expect(weaponChangeBlocked(unit, unit.inventory[0])).toBe(true);
  });

  it('the harness: a locked healer heals with its staff and takes back the weapon it held', () => {
    // Failure: the staff taken up for the cast stays in hand (and the lock then holds it).
    const rm = take(freshRun(), 'oathbound_steel');
    installSeed(9);
    const battle = new HeadlessBattle(data, rm.getBattleParams(firstBattle(rm)), rm.getRoster(), {
      runManager: rm,
    });
    battle.init();
    const healer = battle.playerUnits[0];
    const heal = catalogWeapon('Heal');
    const lance = catalogWeapon('Iron Lance');
    healer.inventory = [catalogWeapon('Iron Sword'), lance, heal];
    healer.proficiencies = ['Sword', 'Lance', 'Staff'].map((type) => ({ type, rank: 'Mast' }));
    healer.weapon = lance;
    expect(healer[WEAPON_SWAP_LOCK_FIELD]).toBe(true);
    // A hurt ally on an open tile beside the healer.
    const taken = new Set(
      [...battle.playerUnits, ...battle.enemyUnits].map((u) => `${u.col},${u.row}`),
    );
    const beside = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
      .map(([dc, dr]) => ({ col: healer.col + dc, row: healer.row + dr }))
      .find(
        (t) =>
          !taken.has(`${t.col},${t.row}`) &&
          Number.isFinite(battle.grid.getMoveCost(t.col, t.row, 'Infantry')),
      );
    expect(beside).toBeTruthy();
    const hurt = makeUnit('Hurt', 'player', beside.col, beside.row, ['Iron Sword']);
    hurt.currentHP = 20;
    battle.playerUnits.push(hurt);
    battle.selectUnit(healer.name);
    battle.moveTo(healer.col, healer.row);
    battle.chooseAction('Heal');
    expect(healer.weapon).toBe(heal);
    battle.chooseHealTarget('Hurt');
    expect(hurt.currentHP).toBeGreaterThan(20);
    expect(healer.weapon).toBe(lance);
    expect(healer).not.toHaveProperty('_heldBeforeStaff');
  });
});

// ── Siegebreaker ────────────────────────────────────────────────────────────

describe('Siegebreaker: bows and tomes reach a tile further, melee loses 2 Might', () => {
  const stamped = (names, faction = 'player') => {
    const u = makeUnit('Archer', faction, 3, 3, names);
    stampArmyBattleRules([u], { rangedRangeBonus: 1 });
    if (faction !== 'player') u[RANGED_REACH_FIELD] = 1;
    return u;
  };

  it("a bow reaches 3 and a tome 3; a sword, a staff and a foe's bow do not change", () => {
    const bow = stamped(['Iron Bow']);
    expect(getAttackRange(bow, bow.weapon)).toMatchObject({ min: 2, max: 3 });
    const tome = stamped(['Fire']);
    expect(getAttackRange(tome, tome.weapon)).toMatchObject({ min: 1, max: 3 });
    const sword = stamped(['Iron Sword']);
    expect(getAttackRange(sword, sword.weapon)).toMatchObject({ min: 1, max: 1 });
    expect(rangedReachBonusOf(stamped(['Heal']), catalogWeapon('Heal'))).toBe(0);
    const foe = stamped(['Iron Bow'], 'enemy');
    expect(getAttackRange(foe, foe.weapon)).toMatchObject({ min: 2, max: 2 });
    const plain = makeUnit('Plain', 'player', 3, 3, ['Iron Bow']);
    expect(getAttackRange(plain, plain.weapon)).toMatchObject({ min: 2, max: 2 });
  });

  it('a stamped bow counters from 3 tiles, an unstamped one does not', () => {
    const bow = stamped(['Iron Bow']);
    expect(canCounter(bow, bow.weapon, 3)).toBe(true);
    expect(canCounter(bow, bow.weapon, 4)).toBe(false);
    expect(canCounter(bow, bow.weapon, 1)).toBe(false);
    const plain = makeUnit('Plain', 'player', 3, 3, ['Iron Bow']);
    expect(canCounter(plain, plain.weapon, 3)).toBe(false);
  });

  it("the move preview's reach and an area art's weapon-range centre take the bonus", () => {
    const grid = {
      cols: 12,
      rows: 12,
      getMovementRange: () => new Map([['5,5', { cost: 0 }]]),
      getAttackRange(col, row, weapon) {
        const [min, max] = String(weapon.range).split('-').map(Number);
        const hi = Number.isFinite(max) ? max : min;
        const out = [];
        for (let c = 0; c < 12; c++)
          for (let r = 0; r < 12; r++) {
            const d = Math.abs(c - col) + Math.abs(r - row);
            if (d >= min && d <= hi) out.push({ col: c, row: r });
          }
        return out;
      },
    };
    const reachOf = (u) => unitReach(grid, Object.assign(u, { col: 5, row: 5 }), { mov: 0 });
    const far = reachOf(stamped(['Iron Bow']));
    const near = reachOf(makeUnit('Plain', 'player', 5, 5, ['Iron Bow']));
    const hits = (r) => r.attackTiles.some((t) => t.col === 8 && t.row === 5);
    expect(hits(far)).toBe(true);
    expect(hits(near)).toBe(false);
    // Stormcall aims as far as its tome reaches: Breachbolt's 3-10, one further.
    const art = data.weaponArts.arts.find((a) => a.id === 'legend_stormcall');
    const sage = stamped(['Breachbolt']);
    expect(areaStrikeRange(sage, art, sage.weapon)).toEqual({ min: 3, max: 11 });
    const plainSage = makeUnit('Plain', 'player', 5, 5, ['Breachbolt']);
    expect(areaStrikeRange(plainSage, art, plainSage.weapon)).toEqual({ min: 3, max: 10 });
  });

  it("the cost: a sword's or axe's blow loses 2 Might, a bow's does not, a foe's does not", () => {
    const run = take(freshRun(), 'siegebreaker');
    const ctxOf = (attacker, defender) => {
      const battle = new HeadlessBattle(structuredClone(data), { act: 'act1', objective: 'rout' });
      battle.turnManager = { turnNumber: 1 };
      battle.runManager = run;
      battle.playerUnits = [attacker, defender].filter((u) => u.faction === 'player');
      battle.enemyUnits = [attacker, defender].filter((u) => u.faction === 'enemy');
      battle.npcUnits = [];
      battle.grid = {
        cols: 8,
        rows: 8,
        fogEnabled: false,
        getTerrainAt: () => ({ name: 'Plain' }),
        getMoveCost: () => 1,
        updateFogOfWar() {},
      };
      return battle._buildSkillCtx(attacker, defender, null);
    };
    const might = (weapon, faction = 'player') => {
      const a = makeUnit('A', faction, 3, 3, [weapon]);
      const d = makeUnit('D', faction === 'player' ? 'enemy' : 'player', 4, 3, ['Iron Sword']);
      return ctxOf(a, d).atkMods.atkBonus || 0;
    };
    expect(might('Iron Sword')).toBe(-2);
    expect(might('Iron Axe')).toBe(-2);
    expect(might('Iron Lance')).toBe(-2);
    expect(might('Iron Bow')).toBe(0);
    expect(might('Fire')).toBe(0);
    expect(might('Iron Sword', 'enemy')).toBe(0);
  });
});

// ── Standard of the Sun ─────────────────────────────────────────────────────

describe('Standard of the Sun: foes go for the commander first', () => {
  const T = Object.fromEntries(data.terrain.map((t, i) => [t.name, i]));
  const stub = new Proxy({}, { get: (_, key) => (key === 'destroy' ? () => {} : () => stub) });
  const scene = {
    cameras: { main: { width: 640, height: 480 } },
    add: { rectangle: () => stub, image: () => stub, text: () => stub, container: () => stub },
    textures: { exists: () => false },
  };
  const grid = () =>
    new Grid(
      scene,
      9,
      3,
      data.terrain,
      Array.from({ length: 3 }, () => Array(9).fill(T.Plain)),
      false,
    );
  const STATS = { HP: 24, STR: 12, MAG: 0, SKL: 8, SPD: 6, LCK: 5, DEF: 6, RES: 4, MOV: 5 };
  const foe = (col) => ({
    name: 'Foe',
    col,
    row: 1,
    mov: 5,
    moveType: 'Infantry',
    faction: 'enemy',
    className: 'Fighter',
    weapon: { name: 'Iron Sword', range: '1', type: 'Sword', might: 5, hit: 90 },
    stats: { ...STATS },
    currentHP: STATS.HP,
  });
  const player = (name, col, extra = {}) => ({
    name,
    col,
    row: 1,
    faction: 'player',
    className: 'Soldier',
    weapon: { name: 'Iron Lance', range: '1', type: 'Lance', might: 5, hit: 80 },
    stats: { ...STATS },
    currentHP: STATS.HP,
    ...extra,
  });

  it('with both in reach, a foe strikes the commander over a wounded easy kill', () => {
    const e = foe(4);
    // The commander is fresh on the left; a near-dead soldier is on the right.
    const commander = player('Edric', 3, { isCommander: true });
    const weak = player('Weak', 5, { currentHP: 3 });
    const plain = new AIController(grid(), data, { objective: 'rout' });
    expect(plain._decideAction(e, [e], [commander, weak], []).target).toBe(weak);
    const sun = new AIController(grid(), data, { objective: 'rout', commanderPriority: true });
    expect(sun._decideAction(e, [e], [commander, weak], []).target).toBe(commander);
    expect(
      sun._scoreAttackTarget(e, commander) - plain._scoreAttackTarget(e, commander),
    ).toBeCloseTo(COMMANDER_PRIORITY_SCORE);
  });

  it('with no one in reach, a foe closes on the commander, not the nearest unit', () => {
    const e = foe(0);
    const near = player('Near', 7);
    const commander = player('Edric', 8, { isCommander: true });
    // Move 5 from col 0: neither is in reach this turn.
    const plain = new AIController(grid(), data, { objective: 'rout' });
    const sun = new AIController(grid(), data, { objective: 'rout', commanderPriority: true });
    expect(plain._findPriorityTarget(e, [near, commander])).not.toBe(commander);
    expect(sun._findPriorityTarget(e, [near, commander])).toBe(commander);
    // A fallen commander is no target.
    commander.currentHP = 0;
    expect(sun._findPriorityTarget(e, [near, commander])).not.toBe(commander);
  });
});

// ── Smith's Exile ───────────────────────────────────────────────────────────

describe("Smith's Exile: every weapon arrives forged, and no forge is made", () => {
  it('arrivalCopy forges a copy; the original row is untouched; no card, no change', () => {
    const row = catalogWeapon('Iron Sword');
    const before = structuredClone(row);
    const exiled = take(freshRun(), 'smiths_exile');
    const got = arrivalCopy(exiled, row);
    expect(got).not.toBe(row);
    expect(row).toEqual(before);
    expect(got).toMatchObject({ name: 'Iron Sword +1', might: before.might + 1, _forgeLevel: 1 });
    expect(got.price).toBe(before.price); // a free forge: it sells as the catalog's
    expect(arrivalCopy(freshRun(), row)).toBe(row);
    // A worn weapon arrives worn, unforged.
    const worn = catalogWeapon('Iron Sword');
    applyWear(worn, 'might');
    expect(arrivalCopy(exiled, worn)).toBe(worn);
  });

  it('battle loot: a drawn weapon card arrives +1, and the weapons catalog is never touched', () => {
    const catalog = JSON.stringify(data.weapons);
    let checked = 0;
    for (let seed = 1; seed <= 40 && checked < 3; seed++) {
      const plain = freshRun({ seed });
      const exiled = take(freshRun({ seed }), 'smiths_exile');
      const draw = rewardDrawParams(plain, {});
      const exiledDraw = rewardDrawParams(exiled, {});
      expect(exiledDraw.arrivalForge).toBe(1);
      expect(draw).not.toHaveProperty('arrivalForge');
      installSeed(seed);
      const a = rollBattleRewardChoices(plain, data, draw);
      installSeed(seed);
      const b = rollBattleRewardChoices(exiled, data, exiledDraw);
      expect(b.length).toBe(a.length);
      a.forEach((choice, i) => {
        const item = choice.item;
        if (!item || item.type === 'Staff' || !data.weapons.some((w) => w.name === item.name))
          return;
        if (['Scroll', 'Consumable', 'Accessory', 'Whetstone'].includes(item.type)) return;
        if (item.tier === 'Legend' || item.weaponArtIds) return;
        expect(b[i].item.name).toBe(`${item.name} +1`);
        expect(b[i].item.might).toBe(item.might + 1);
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(0);
    expect(JSON.stringify(data.weapons)).toBe(catalog);
  });

  it('a shop weapon arrives forged; the stock row stays as listed', () => {
    const run = take(freshRun(), 'smiths_exile');
    run.gold = 5000;
    const unit = run.roster[0];
    unit.inventory = unit.inventory.slice(0, 1);
    const entry = { item: catalogWeapon('Iron Lance'), price: 500, type: 'weapon' };
    const stock = [entry];
    expect(purchaseShopItem(run, stock, entry, unit).ok).toBe(true);
    const bought = unit.inventory.at(-1);
    expect(bought.name).toBe('Iron Lance +1');
    expect(entry.item.name).toBe('Iron Lance');
    expect(run.gold).toBe(4500);
  });

  it("an event's weapon arrives forged and the result names it so", () => {
    const run = runWithEvents([soloEvent([{ type: 'item', name: 'Iron Sword' }])]);
    take(run, 'smiths_exile');
    const node = arriveAs(run, 'solo');
    const result = chooseEventOption(run, node.id, 'go');
    expect(result.ok, result.reason).toBe(true);
    expect(result.results.find((r) => r.kind === 'item').name).toBe('Iron Sword +1');
  });

  it("a shop's forge is refused; its repair is not", () => {
    const run = take(freshRun(), 'smiths_exile');
    run.gold = 5000;
    const weapon = run.roster[0].weapon;
    const opts = { forgesUsed: 0, forgeLimit: 3, discount: 0 };
    expect(shopForgeBlock(run, weapon, 'might', opts)).toBe(FORGE_FORBIDDEN_REASON);
    expect(shopForgeBlock(freshRun(), freshRun().roster[0].weapon, 'might', opts)).not.toBe(
      FORGE_FORBIDDEN_REASON,
    );
    applyWear(weapon, 'might');
    expect(shopRepairBlock(run, weapon, opts)).toBe('');
  });

  it("a loot whetstone forges nothing and is marked; an Imbuing Stone's tag is clear", () => {
    const run = take(freshRun(), 'smiths_exile');
    const stone = structuredClone(data.whetstones.find((w) => w.forgeStat === 'might'));
    const unit = run.roster[0];
    const before = structuredClone(unit.weapon);
    const res = applyRewardForge(run, data, stone, unit, unit.weapon, 'might');
    expect(res).toEqual({ ok: false, reason: FORGE_FORBIDDEN_REASON });
    expect(unit.weapon).toEqual(before);
    expect(whetstoneTag(run, stone)).toBe(FORGE_FORBIDDEN_TAG);
    expect(whetstoneTag(freshRun(), stone)).toBe('');
    expect(whetstoneTag(run, { ...stone, imbueId: 'frost' })).toBe('');
  });

  it("an event's forge step does nothing under the exile", () => {
    const run = runWithEvents([
      soloEvent([{ type: 'forge', stat: 'might' }], {
        choice: { target: { prompt: 'Who?', filter: { living: true } } },
      }),
    ]);
    take(run, 'smiths_exile');
    const brant = addUnit(run, 'Fighter', { name: 'Brant' });
    const before = structuredClone(brant.weapon);
    const node = arriveAs(run, 'solo');
    chooseEventOption(run, node.id, 'go', { targetUid: brant.unitUid });
    expect(brant.weapon).toEqual(before);
  });
});
