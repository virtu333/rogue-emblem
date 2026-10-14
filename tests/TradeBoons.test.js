// The act boss's trade cards (engine/TradeBoons.js; docs/specs/blessings-v3.md §6.8): every act
// boss but the last offers three earned cards, each a boon taken with a real cost. Real runs and
// real data throughout; each card is taken the way the pick takes it (its boons, then its twist
// as its held price).
//
// Ways this can fail, a test each:
//   - a card's data is wrong-signed (a cost that helps, a boon that hurts) and ships;
//   - a card's numbers never reach the system it rides on (combat, Move, affixes, loot, XP,
//     church), or reach it twice after a load;
//   - a conditional number (player phase, enemy phase, plain attack, beside an ally, alone) fires
//     on the wrong side or condition;
//   - foes or green allies take a card's numbers;
//   - the scene and the harness read a different combat for one board;
//   - the damage cut rounds a blow that did damage down to 0, or touches one that did none;
//   - proc odds pass 100, or Gambler's Edge reaches a foe;
//   - a unit that joins mid-battle misses the army's Move;
//   - Collector's Eye reaches past Act IV or leaves no loot card;
//   - Chronicle gives a role to two units (or to a lone unit), or a promoted unit is ranked low;
//   - Kingmaker's Oath's level floor or visit limit is skipped.
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
import { createSeededRng, validateBlessingsConfig } from '../src/engine/BlessingEngine.js';
import { twistPriceOf } from '../src/engine/EarnedBlessings.js';
import { getCombatForecast, scaleDealtDamage, strikeDamage } from '../src/engine/Combat.js';
import { getActivationChance } from '../src/engine/SkillSystem.js';
import {
  ARMY_MOVE_SOURCE,
  TRADE_BOON_TYPES,
  TRADE_TWIST_TYPES,
  lootActAheadOf,
  sanitizeTradeBoonModifiers,
  tradeBoonModifierDefaults,
  tradeEffectErrors,
  xpRoleMultiplierFor,
} from '../src/engine/TradeBoons.js';
import { battleJoinBoons } from '../src/engine/BattleJoinBoons.js';
import { assignAffixesToEnemySpawns } from '../src/engine/AffixEngine.js';
import { rewardChoiceCount, rewardDrawParams } from '../src/engine/PendingBattleRewards.js';
import { scaledXp } from '../src/engine/BattleXp.js';
import { churchPromotionBlock, promoteAtChurch } from '../src/engine/ChurchCommands.js';
import { getEffectiveWeaponArtHpCost, weaponArtRunOptions } from '../src/engine/WeaponArtSystem.js';
import { huntedWaveFor } from '../src/engine/Burdens.js';
import { createUnit, resolvePromotionTargets } from '../src/engine/UnitManager.js';
import { loadFixture } from './fixtures/battles/index.js';
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

const TRADE_CARDS = [
  'chronicle_ii',
  'kingmakers_oath_ii',
  'hollow_sun_favor_ii',
  'forced_march',
  'bulwark',
  'way_of_the_art',
  'gamblers_edge',
  'the_chosen_few',
  'the_levy',
  'stone_vow',
  'collectors_eye',
  'featherweight',
  'reckless_edge',
  'shield_wall',
];
const card = (id) => data.blessings.blessings.find((b) => b.id === id);

function freshRun({ seed = 41, difficultyId = 'dusk', gameData = data } = {}) {
  const rm = new RunManager(gameData);
  rm.startRun({ runSeed: seed, difficultyId, applyBlessingsAtStart: false });
  rm.blessingHistory = [];
  return rm;
}
/** Take a card the way the act boss's pick does: its boons, then its twist as its held price. */
function take(rm, ...ids) {
  for (const id of ids)
    expect(
      rm.addBlessingMidRun(id, {
        earned: true,
        price: twistPriceOf(card(id)),
        source: 'act_boss',
      }),
      id,
    ).toBe(true);
  return rm;
}
const roundTrip = (rm) => RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), rm.gameData);
const mods = (rm) => rm.blessingRuntimeModifiers;

// ── The data and its validator ──────────────────────────────────────────────

describe('the trade cards in the data', () => {
  it('are act boss cards with a twist, drawn (weight above 0), and the catalog validates', () => {
    // Failure: a card ships with no cost, outside the act boss's pool, or retired by mistake.
    const result = validateBlessingsConfig(data.blessings);
    expect(result.errors).toEqual([]);
    for (const id of TRADE_CARDS) {
      const b = card(id);
      expect(b?.earned, id).toBe(true);
      expect(b.weight, id).toBeGreaterThan(0);
      expect(
        b.sources.every((s) => s.kind === 'act_boss'),
        id,
      ).toBe(true);
      expect(b.twist?.effects?.length, id).toBeGreaterThan(0);
      expect(b.twist.label.length, id).toBeGreaterThan(0);
    }
  });

  it('Ember Lantern is retired: kept for old saves, never drawn', () => {
    expect(card('ember_lantern').weight).toBe(0);
  });

  const withRow = (mutate) => {
    const copy = structuredClone(data.blessings);
    mutate((id) => copy.blessings.find((b) => b.id === id));
    return validateBlessingsConfig(copy).errors.join('\n');
  };

  it.each([
    ['a boon that lowers', (row) => (row('bulwark').boons[0].params.def = -2), /boon only raises/],
    [
      'a cost that raises',
      (row) => (row('bulwark').twist.effects[0].params.value = 1),
      /below 0 as a cost/,
    ],
    [
      'a boon-only type as a cost',
      (row) =>
        (row('featherweight').twist.effects = [
          { type: 'weapon_weight_delta', params: { value: -1 } },
        ]),
      /is not a twist effect/,
    ],
    [
      'a cost-only type as a boon',
      (row) => (row('the_levy').boons = [{ type: 'damage_dealt_scale', params: { value: 0.9 } }]),
      /never a boon/,
    ],
    [
      'a deploy cut that raises',
      (row) => (row('the_chosen_few').twist.effects[0].params.value = 2),
      /below 0 as a cost/,
    ],
    [
      'a radius on a condition that has none',
      (row) => (row('shield_wall').boons[0].params.radius = 2),
      /radius belongs/,
    ],
    [
      'an unknown combat number',
      (row) => (row('reckless_edge').boons[0].params.speed = 2),
      /params\.speed/,
    ],
  ])('refuses %s', (_label, mutate, pattern) => {
    expect(withRow(mutate)).toMatch(pattern);
  });

  it('every type is a boon, a cost or both, and the lists agree with the roles', () => {
    expect(TRADE_BOON_TYPES).toContain('weapon_art_hp_free');
    expect(TRADE_BOON_TYPES).not.toContain('damage_dealt_scale');
    expect(TRADE_TWIST_TYPES).toContain('damage_dealt_scale');
    expect(TRADE_TWIST_TYPES).not.toContain('loot_act_ahead');
    expect(tradeEffectErrors({ type: 'not_a_trade', params: {} }, 'boon')).toEqual([]);
  });
});

// ── Taken, saved, loaded ────────────────────────────────────────────────────

describe('taking a card', () => {
  it('records each card once and a load never applies it again', () => {
    // Failure: fromJSON re-runs a handler (a second +1 Move), or drops the state.
    const rm = take(freshRun(), ...TRADE_CARDS);
    const before = structuredClone(mods(rm));
    expect(before.armyMovDelta).toBe(1 - 1);
    expect(before.damageDealtScale).toBeCloseTo(0.9);
    expect(before.weaponWeightDelta).toBe(-3);
    expect(before.procChanceMultiplier).toBe(1.5);
    expect(before.enemyAffixChanceMultiplier).toBe(2);
    expect(before.weaponArtHpFree).toBe(true);
    expect(before.lootActAhead).toBe(1);
    expect(before.lootChoiceDelta).toBe(-1);
    expect(before.xpRoleMultipliers).toEqual({ lowest: 2, highest: 0.5 });
    expect(before.churchPromotionTerms).toEqual({ minLevel: 15, perVisit: 2 });
    const twice = roundTrip(roundTrip(rm));
    for (const key of Object.keys(tradeBoonModifierDefaults()))
      expect(mods(twice)[key], key).toEqual(before[key]);
  });

  it('a save from before the rework reads the defaults', () => {
    const rm = freshRun();
    const json = JSON.parse(JSON.stringify(rm.toJSON()));
    for (const key of Object.keys(tradeBoonModifierDefaults()))
      delete json.blessingRuntimeModifiers[key];
    const loaded = RunManager.fromJSON(json, data);
    for (const [key, value] of Object.entries(tradeBoonModifierDefaults()))
      expect(mods(loaded)[key], key).toEqual(value);
  });

  it('a hand-edited save is clamped, never trusted', () => {
    const out = sanitizeTradeBoonModifiers({
      tradeCombatDeltas: [{ hit: 'x' }, { def: 3, when: 'beside_ally' }, null],
      armyMovDelta: 99,
      damageDealtScale: 0,
      procChanceMultiplier: 50,
      lootChoiceDelta: -9,
      xpRoleMultipliers: { lowest: 99, highest: 'no' },
      churchPromotionTerms: { minLevel: 'x' },
    });
    expect(out.tradeCombatDeltas).toEqual([
      { when: 'beside_ally', hit: 0, avoid: 0, crit: 0, might: 0, def: 3, res: 0 },
    ]);
    // A held entry as it is saved (every stat named, zeros too) reads back whole.
    const held = {
      when: 'alone',
      radius: 2,
      hit: -15,
      avoid: -15,
      crit: 0,
      might: 0,
      def: 0,
      res: 0,
    };
    expect(sanitizeTradeBoonModifiers({ tradeCombatDeltas: [held] }).tradeCombatDeltas).toEqual([
      held,
    ]);
    expect(out.armyMovDelta).toBe(4);
    // A share is held at its floor (a quarter: two cuts at their lowest), never 0.
    expect(out.damageDealtScale).toBe(0.25);
    expect(out.procChanceMultiplier).toBe(2);
    expect(out.lootChoiceDelta).toBe(-2);
    expect(out.xpRoleMultipliers).toEqual({ lowest: 3, highest: 1 });
    expect(out.churchPromotionTerms).toBeNull();
  });

  it('The Chosen Few: +2 to every stat but Move, and two fewer deploys; The Levy two more', () => {
    const rm = freshRun();
    const edric = rm.roster[0];
    const stats = { ...edric.stats };
    const deploy = rm.getDeployBonus();
    take(rm, 'the_chosen_few');
    for (const stat of Object.keys(stats))
      expect(edric.stats[stat], stat).toBe(stats[stat] + (stat === 'MOV' ? 0 : 2));
    expect(rm.getDeployBonus()).toBe(deploy - 2);
    take(rm, 'the_levy');
    expect(rm.getDeployBonus()).toBe(deploy);
  });

  it("Hollow Sun's Favor: +30% gold, and a Hunted wave of exactly 3 through the next act", () => {
    const rm = freshRun();
    const gold = rm.getBattleGoldMultiplier();
    take(rm, 'hollow_sun_favor_ii');
    expect(rm.getBattleGoldMultiplier()).toBeCloseTo(gold + 0.3);
    expect(huntedWaveFor(rm)).toMatchObject({ count: [3, 3], turn: 3 });
    expect(huntedWaveFor(rm, { isBoss: true })).toBeNull();
  });
});

// ── Combat ──────────────────────────────────────────────────────────────────

describe('the trade cards in combat: the scene and the harness', () => {
  const body = { HP: 40, STR: 12, MAG: 0, SKL: 9, SPD: 9, DEF: 7, RES: 3, LCK: 5, MOV: 5 };
  const makeUnit = (name, faction, col, row) => {
    const weapon = {
      name: 'Test Blade',
      type: 'Sword',
      might: 8,
      hit: 80,
      crit: 0,
      weight: 5,
      range: '1',
      special: '',
    };
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
      weapon,
      inventory: [weapon],
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      skills: [],
      accessory: null,
      affixes: [],
    };
  };
  function sceneCtx(run, units) {
    const scene = journeyBattleScene(run, data);
    scene.runManager = run;
    Math.random = () => 0.5;
    Object.assign(scene.grid, {
      fogEnabled: false,
      getMoveCost: () => 1,
      getTerrainAt: () => data.terrain.find((t) => t.name === 'Plain'),
    });
    scene.playerUnits = units.filter((u) => u.faction === 'player');
    scene.enemyUnits = units.filter((u) => u.faction === 'enemy');
    scene.npcUnits = units.filter((u) => u.faction === 'npc');
    rendering(scene, 0);
    return (a, d, art) => scene.buildSkillCtx(a, d, art);
  }
  function harnessCtx(run, units) {
    const battle = new HeadlessBattle(structuredClone(data), { act: 'act1', objective: 'rout' });
    battle.turnManager = { turnNumber: 1 };
    battle.runManager = run;
    battle.playerUnits = units.filter((u) => u.faction === 'player');
    battle.enemyUnits = units.filter((u) => u.faction === 'enemy');
    battle.npcUnits = units.filter((u) => u.faction === 'npc');
    battle.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      getTerrainAt: () => ({ name: 'Plain' }),
      getMoveCost: () => 1,
      updateFogOfWar() {},
    };
    return (a, d, art) => battle._buildSkillCtx(a, d, art);
  }
  const pick = (m) => ({
    hit: m.hitBonus || 0,
    avoid: m.avoidBonus || 0,
    crit: m.critBonus || 0,
    atk: m.atkBonus || 0,
    def: m.defBonus || 0,
    res: m.resBonus || 0,
    spd: m.spdBonus || 0,
    scale: m.damageScale ?? 1,
    procs: m.procChanceMultiplier ?? 1,
  });
  const NONE = { hit: 0, avoid: 0, crit: 0, atk: 0, def: 0, res: 0, spd: 0, scale: 1, procs: 1 };
  const delta = (patch) => ({ ...NONE, ...patch });
  // Edric at (3,3) fights the foe at (4,3); `ally` puts a friend on a cardinal tile (north).
  const board = ({ ally = false, farAlly = false } = {}) => {
    const edric = makeUnit('Edric', 'player', 3, 3);
    const foe = makeUnit('Foe', 'enemy', 4, 3);
    const units = [edric, foe];
    if (ally) units.push(makeUnit('North', 'player', 3, 2));
    if (farAlly) units.push(makeUnit('Far', 'player', 6, 3));
    return { edric, foe, units };
  };
  const ctxFor = (build, ids, opts) => {
    const b = board(opts);
    const run = take(freshRun(), ...ids);
    return { ...b, ctx: build(run, b.units) };
  };

  for (const [label, build] of [
    ['the scene', sceneCtx],
    ['the harness', harnessCtx],
  ]) {
    describe(label, () => {
      it('Forced March: every fight costs 2 DEF and 2 RES, either side', () => {
        const { edric, foe, ctx } = ctxFor(build, ['forced_march'], { ally: true });
        expect(pick(ctx(edric, foe).atkMods)).toEqual(delta({ def: -2, res: -2 }));
        expect(pick(ctx(foe, edric).defMods)).toEqual(delta({ def: -2, res: -2 }));
        expect(pick(ctx(foe, edric).atkMods)).toEqual(NONE);
      });

      it('Stone Vow: +3 DEF and RES defending, -2 Might attacking', () => {
        const { edric, foe, ctx } = ctxFor(build, ['stone_vow'], { ally: true });
        expect(pick(ctx(edric, foe).atkMods)).toEqual(delta({ atk: -2 }));
        expect(pick(ctx(foe, edric).defMods)).toEqual(delta({ def: 3, res: 3 }));
      });

      it('Way of the Art: -2 Might on a plain attack only (a defender never uses an art)', () => {
        const { edric, foe, ctx } = ctxFor(build, ['way_of_the_art'], { ally: true });
        expect(pick(ctx(edric, foe).atkMods)).toEqual(delta({ atk: -2 }));
        const art = data.weaponArts.arts.find((a) => a.weaponType === 'Sword');
        expect(pick(ctx(edric, foe, art).atkMods).atk).toBe(0);
        expect(pick(ctx(foe, edric).defMods)).toEqual(delta({ atk: -2 }));
      });

      it('Shield Wall: +3 DEF/RES beside an ally; -15 Hit/Avoid with no ally within 2', () => {
        const beside = ctxFor(build, ['shield_wall'], { ally: true });
        expect(pick(beside.ctx(beside.edric, beside.foe).atkMods)).toEqual(
          delta({ def: 3, res: 3 }),
        );
        const alone = ctxFor(build, ['shield_wall'], { farAlly: true });
        expect(pick(alone.ctx(alone.edric, alone.foe).atkMods)).toEqual(
          delta({ hit: -15, avoid: -15 }),
        );
        // An ally two tiles off: neither beside nor alone.
        const near = ctxFor(build, ['shield_wall'], { farAlly: true });
        near.units.find((u) => u.name === 'Far').col = 5;
        expect(pick(near.ctx(near.edric, near.foe).atkMods)).toEqual(NONE);
      });

      it('Reckless Edge, Bulwark: their flat numbers', () => {
        const r = ctxFor(build, ['reckless_edge']);
        expect(pick(r.ctx(r.edric, r.foe).atkMods)).toEqual(delta({ crit: 10, hit: -10 }));
        const b = ctxFor(build, ['bulwark']);
        expect(pick(b.ctx(b.edric, b.foe).atkMods)).toEqual(delta({ def: 2, res: 2 }));
      });

      it('Featherweight: 3 less weight is the Attack Speed it gives back, and -2 Might', () => {
        // STR 12 carries 2 of the blade's 5 weight; at 2 it carries all of it: +3 speed.
        const { edric, foe, ctx } = ctxFor(build, ['featherweight']);
        expect(pick(ctx(edric, foe).atkMods)).toEqual(delta({ spd: 3, atk: -2 }));
      });

      it("The Levy and Gambler's Edge: a damage share and the proc odds, the player's only", () => {
        const { edric, foe, ctx } = ctxFor(build, ['the_levy', 'gamblers_edge']);
        expect(pick(ctx(edric, foe).atkMods).scale).toBeCloseTo(0.9);
        expect(pick(ctx(edric, foe).atkMods).procs).toBe(1.5);
        expect(pick(ctx(edric, foe).defMods)).toEqual(NONE);
      });

      it('a green ally beside the unit is no Shield Wall, and does not end its isolation', () => {
        const { edric, foe, units } = board();
        units.push(makeUnit('Villager', 'npc', 3, 2));
        const ctx = build(take(freshRun(), 'shield_wall'), units);
        expect(pick(ctx(edric, foe).atkMods)).toEqual(delta({ hit: -15, avoid: -15 }));
      });
    });
  }

  it('the scene and the harness agree on one board for every card held at once', () => {
    const a = board({ ally: true });
    const b = board({ ally: true });
    const scene = sceneCtx(take(freshRun(), ...TRADE_CARDS), a.units)(a.edric, a.foe);
    const harness = harnessCtx(take(freshRun(), ...TRADE_CARDS), b.units)(b.edric, b.foe);
    expect(pick(scene.atkMods)).toEqual(pick(harness.atkMods));
    expect(pick(scene.defMods)).toEqual(pick(harness.defMods));
  });

  it("the forecast: The Levy cuts Edric's blow to 90% (floored); Forced March adds 2 to the foe's", () => {
    const forecastFrom = (ids) => {
      const { edric, foe, units } = board();
      const ctx = sceneCtx(take(freshRun(), ...ids), units)(edric, foe);
      return getCombatForecast(edric, edric.weapon, foe, foe.weapon, 1, null, null, ctx);
    };
    // STR 12 + Might 8 against DEF 7: 13 a blow.
    const plain = forecastFrom([]);
    expect(plain.attacker.damage).toBe(13);
    expect(forecastFrom(['the_levy']).attacker.damage).toBe(Math.floor(13 * 0.9));
    const march = forecastFrom(['forced_march']);
    expect(march.defender.damage).toBe(plain.defender.damage + 2);
    expect(march.attacker.damage).toBe(plain.attacker.damage);
  });
});

describe('the damage share and the proc odds', () => {
  it('scaleDealtDamage floors, keeps a blow that did damage at 1 or more, and leaves 0 alone', () => {
    expect(scaleDealtDamage(13, { damageScale: 0.9 })).toBe(11);
    expect(scaleDealtDamage(10, { damageScale: 0.9 })).toBe(9);
    expect(scaleDealtDamage(1, { damageScale: 0.9 })).toBe(1);
    expect(scaleDealtDamage(0, { damageScale: 0.9 })).toBe(0);
    expect(scaleDealtDamage(13, null)).toBe(13);
    // A share at or above 1 is no cut.
    expect(scaleDealtDamage(13, { damageScale: 1.5 })).toBe(13);
  });

  it('strikeDamage applies the share last, after a multiplier', () => {
    const unit = { stats: { STR: 12, MAG: 0, SKL: 0, SPD: 0, DEF: 7, RES: 0, LCK: 0 } };
    const weapon = { type: 'Sword', might: 8, hit: 80, weight: 0, range: '1' };
    expect(strikeDamage(unit, weapon, unit, weapon, null)).toBe(13);
    expect(strikeDamage(unit, weapon, unit, weapon, null, { damageScale: 0.9 })).toBe(11);
    expect(
      strikeDamage(unit, weapon, unit, weapon, null, { damageScale: 0.9, damageMultiplier: 2 }),
    ).toBe(Math.floor(26 * 0.9));
  });

  it('the proc odds scale and never pass 100', () => {
    const unit = { stats: { SKL: 40, SPD: 10, LCK: 30 } };
    expect(getActivationChance(unit, 'SKL')).toBe(40);
    expect(getActivationChance(unit, 'SKL', 1.5)).toBe(60);
    expect(getActivationChance(unit, 'LCK_THIRD', 1.5)).toBe(15);
    expect(getActivationChance({ stats: { SKL: 80 } }, 'SKL', 1.5)).toBe(100);
  });
});

// ── Move ────────────────────────────────────────────────────────────────────

describe('the army Move', () => {
  const firstBattle = (rm) => rm.nodeMap.nodes.find((n) => n.type === 'battle');
  function battleOf(rm) {
    installSeed(9);
    const params = {
      ...loadFixture('act1_village_race').battleParams,
      ...rm.getBattleParams(firstBattle(rm)),
    };
    const battle = new HeadlessBattle(data, params, rm.getRoster(), { runManager: rm });
    battle.init();
    return battle;
  }

  it('Forced March gives every unit +1 Move in battle and takes it back after', () => {
    // Failure: the delta is written to the roster's own stats, or never reaches the battle.
    const rm = take(freshRun(), 'forced_march');
    const params = rm.getBattleParams(firstBattle(rm));
    const moves = params.battleDebuffs.filter((d) => d.source === ARMY_MOVE_SOURCE);
    expect(moves).toHaveLength(rm.roster.length);
    for (const d of moves) expect(d).toMatchObject({ stat: 'MOV', value: 1 });
    const plain = battleOf(freshRun());
    const marched = battleOf(rm);
    expect(marched.playerUnits.map((u) => u.stats.MOV)).toEqual(
      plain.playerUnits.map((u) => u.stats.MOV + 1),
    );
    // The roster's own Move is untouched.
    expect(rm.roster.map((u) => u.stats.MOV)).toEqual(freshRun().roster.map((u) => u.stats.MOV));
  });

  it('Bulwark beside Forced March: the Moves cancel and no delta is written', () => {
    const rm = take(freshRun(), 'forced_march', 'bulwark');
    expect(
      (rm.getBattleParams(firstBattle(rm)).battleDebuffs || []).filter(
        (d) => d.source === ARMY_MOVE_SOURCE,
      ),
    ).toEqual([]);
  });

  it('a unit joining mid-battle is owed the Move once', () => {
    const rm = take(freshRun(), 'bulwark');
    const joiner = createUnit(
      data.classes.find((c) => c.name === 'Fighter'),
      3,
      data.weapons,
      {
        name: 'Joiner',
        rng: createSeededRng(3),
      },
    );
    joiner.faction = 'player';
    rm.assignUnitUid(joiner);
    expect(battleJoinBoons({ unit: joiner, run: rm, turn: 2 }).deltas).toEqual([
      { unitUid: joiner.unitUid, stat: 'MOV', value: -1, source: ARMY_MOVE_SOURCE },
    ]);
    joiner._battleDeltaSources = [ARMY_MOVE_SOURCE];
    joiner._battleDeltas = [{ stat: 'MOV', value: -1, source: ARMY_MOVE_SOURCE }];
    expect(
      battleJoinBoons({ unit: joiner, run: freshRun(), turn: 2 }).deltas.filter(
        (d) => d.source === ARMY_MOVE_SOURCE,
      ),
    ).toEqual([]);
  });
});

// ── Affixes, loot, XP, church, arts ─────────────────────────────────────────

describe("Gambler's Edge's cost: foes carry affixes twice as often", () => {
  const spawns = () =>
    Array.from({ length: 8 }, (_, i) => ({ className: 'Fighter', level: 8, col: i, row: 0 }));
  const roll = (multiplier) => {
    // Nightfall's Act III chance is 12%; a roll of 0.2 misses it and lands under 24%.
    Math.random = () => 0.2;
    return assignAffixesToEnemySpawns(spawns(), {
      affixConfig: data.affixes,
      difficultyId: 'hard',
      act: 'act3',
      chanceMultiplier: multiplier,
    }).filter((s) => (s.affixes || []).length > 0).length;
  };

  it('a roll between the plain chance and the doubled one lands only with the card', () => {
    expect(roll(1)).toBe(0);
    expect(roll(2)).toBe(8);
  });

  it('the run hands the battle its multiplier only while the card is held', () => {
    const rm = freshRun();
    const node = rm.nodeMap.nodes.find((n) => n.type === 'battle');
    expect(rm.getBattleParams(node).affixChanceMultiplier).toBeUndefined();
    take(rm, 'gamblers_edge');
    expect(rm.getBattleParams(node).affixChanceMultiplier).toBe(2);
  });
});

describe("Collector's Eye: the next act's loot, one card fewer", () => {
  it('draws from the act ahead, never past Act IV', () => {
    const rm = take(freshRun(), 'collectors_eye');
    expect(lootActAheadOf(rm, 'act1')).toBe('act2');
    expect(lootActAheadOf(rm, 'act3')).toBe('act4');
    expect(lootActAheadOf(rm, 'act4')).toBe('act4');
    expect(lootActAheadOf(rm, 'finalBoss')).toBe('finalBoss');
    expect(lootActAheadOf(freshRun(), 'act1')).toBe('act1');
  });

  it('the draw is saved with the act and the cut; a draw from before has three cards', () => {
    const rm = take(freshRun(), 'collectors_eye');
    const draw = rewardDrawParams(rm, { nodeId: 'x' });
    expect(draw).toMatchObject({ actId: 'act2', choiceCountDelta: -1 });
    expect(rewardChoiceCount(draw)).toBe(2);
    expect(rewardChoiceCount({ ...draw, isElite: true })).toBe(3);
    expect(rewardChoiceCount({})).toBe(3);
    expect(rewardChoiceCount({ choiceCountDelta: -9 })).toBe(1);
    expect(rewardDrawParams(freshRun(), { nodeId: 'x' })).not.toHaveProperty('choiceCountDelta');
  });
});

describe('Chronicle: the lowest-level unit doubles, the highest halves', () => {
  const unit = (name, level, extra = {}) => ({
    name,
    level,
    tier: 'base',
    faction: 'player',
    currentHP: 10,
    xp: 0,
    ...extra,
  });
  const roles = { lowest: 2, highest: 0.5 };

  it('exactly one unit holds each role; ties go by XP, then order', () => {
    const a = unit('A', 3);
    const b = unit('B', 3, { xp: 50 });
    const c = unit('C', 9);
    const field = [a, b, c];
    expect(field.map((u) => xpRoleMultiplierFor(u, field, roles))).toEqual([2, 1, 0.5]);
    const twins = [unit('X', 4), unit('Y', 4)];
    expect(twins.map((u) => xpRoleMultiplierFor(u, twins, roles))).toEqual([2, 0.5]);
  });

  it('a promoted unit ranks above any base unit; a lone unit or a fallen one holds none', () => {
    // Promoted level 1 counts as 13 (UnitManager.getXpEffectiveLevel), above a base level 12.
    const promoted = unit('P', 1, { tier: 'promoted' });
    const base = unit('B', 12);
    expect(xpRoleMultiplierFor(promoted, [promoted, base], roles)).toBe(0.5);
    expect(xpRoleMultiplierFor(base, [promoted, base], roles)).toBe(2);
    expect(xpRoleMultiplierFor(base, [base], roles)).toBe(1);
    const fallen = unit('F', 1, { currentHP: 0 });
    expect(xpRoleMultiplierFor(base, [fallen, base, promoted], roles)).toBe(2);
    expect(xpRoleMultiplierFor(base, [base, promoted], null)).toBe(1);
  });

  it('scaledXp applies the share, and the battle gets it only with the card', () => {
    expect(scaledXp(30, { unitXpMultiplier: 2 })).toBe(60);
    expect(scaledXp(30, { unitXpMultiplier: 0.5 })).toBe(15);
    expect(scaledXp(30)).toBe(30);
    const rm = freshRun();
    const node = rm.nodeMap.nodes.find((n) => n.type === 'battle');
    expect(rm.getBattleParams(node).xpRoleMultipliers).toBeUndefined();
    take(rm, 'chronicle_ii');
    expect(rm.getBattleParams(node).xpRoleMultipliers).toEqual(roles);
  });
});

describe("Kingmaker's Oath: from level 15, two a visit", () => {
  function recruit(rm, level, name) {
    const unit = createUnit(
      data.classes.find((c) => c.name === 'Fighter'),
      level,
      data.weapons,
      {
        name,
        rng: createSeededRng(level + name.length),
      },
    );
    unit.level = level;
    unit.faction = 'player';
    rm.assignUnitUid(unit);
    rm.roster.push(unit);
    return unit;
  }

  it('refuses a unit below 15 and a third promotion at one church', () => {
    const rm = take(freshRun({ difficultyId: 'normal' }), 'kingmakers_oath_ii');
    rm.gold = 0;
    const young = recruit(rm, 14, 'Young');
    expect(churchPromotionBlock(rm, young, 'church-a', data)).toBe(
      "Kingmaker's Oath: promotes from level 15.",
    );
    const units = [recruit(rm, 15, 'One'), recruit(rm, 16, 'Two'), recruit(rm, 18, 'Three')];
    for (const u of units.slice(0, 2)) {
      expect(churchPromotionBlock(rm, u, 'church-a', data), u.name).toBe('');
      const target = resolvePromotionTargets(u, data.classes, data.lords)[0];
      expect(promoteAtChurch(rm, u, 'church-a', target, data).ok, u.name).toBe(true);
    }
    expect(churchPromotionBlock(rm, units[2], 'church-a', data)).toBe('Promotion limit reached.');
    // Another church: the limit is a visit's.
    expect(churchPromotionBlock(rm, units[2], 'church-b', data)).toBe('');
  });

  it('without the card, level 14 promotes as ever', () => {
    const rm = freshRun({ difficultyId: 'normal' });
    rm.gold = 5000;
    const young = recruit(rm, 14, 'Young');
    expect(churchPromotionBlock(rm, young, 'church-a', data)).toBe('');
  });
});

describe('Way of the Art: player arts cost no HP', () => {
  it("a player's art is free with the card; a foe's never", () => {
    const art = { hpCost: 5 };
    const rm = take(freshRun(), 'way_of_the_art');
    const options = weaponArtRunOptions(rm);
    expect(options.playerArtHpFree).toBe(true);
    expect(getEffectiveWeaponArtHpCost({ faction: 'player' }, art, options)).toBe(0);
    expect(getEffectiveWeaponArtHpCost({ faction: 'enemy' }, art, options)).toBe(5);
    expect(
      getEffectiveWeaponArtHpCost({ faction: 'player' }, art, weaponArtRunOptions(freshRun())),
    ).toBe(5);
  });
});
