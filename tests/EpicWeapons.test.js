// Epic weapons' rules, card words and loot (docs/specs/epic-weapons.md). The battle wiring
// (push, pull, heal, Silence, toll, Daybreak) is played through the scene and the harness in
// EpicWeaponsBattle.test.js; this file holds the pure rules and the draw.
import { afterEach, describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import {
  epicAfterCombatSteps,
  epicCombatMods,
  recordEpicCombat,
  tallyKill,
  tallyOf,
  unlockedTrophyNames,
  validateWeaponRules,
} from '../src/engine/EpicWeapons.js';
import { getSkillCombatMods, getTurnStartEffects } from '../src/engine/SkillSystem.js';
import { cantoAllowance, cantoRuleFor } from '../src/engine/CantoRule.js';
import { unitVisionRange } from '../src/engine/Grid.js';
import {
  weaponChangeBlocked,
  weaponSwapLockReason,
  weaponSwapLocked,
} from '../src/engine/WeaponSwapLock.js';
import { stampArmyBattleRules } from '../src/engine/TradeBoons.js';
import { getAttackWeapons } from '../src/engine/AttackOptions.js';
import { swapSpentWeapons } from '../src/engine/PerBattleWeapons.js';
import { serializeUnit } from '../src/engine/UnitSerialization.js';
import { applyTimedBuffEntry, expireTimedBuffs } from '../src/engine/TimedWeaponArtBuffs.js';
import { getEffectivenessMultiplier } from '../src/engine/Combat.js';
import { stampTurnAnchors } from '../src/engine/TurnAnchor.js';
import { generateLootChoices, generateShopInventory } from '../src/engine/LootSystem.js';
import { itemBaseLine, itemKeywords } from '../src/engine/ItemKeywords.js';
import { ownedLegendaryNames } from '../src/engine/LegendaryOwnership.js';
import { rewardDrawParams, rollBattleRewardChoices } from '../src/engine/PendingBattleRewards.js';
import { RunManager } from '../src/engine/RunManager.js';
import { validateCrossReferences } from '../tools/validateCrossReferences.js';
import { createSeededRng } from '../src/engine/SeededRng.js';

const data = loadGameData();
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));
const epics = data.weapons.filter((w) => w.tier === 'Epic');
const originalRandom = Math.random;
afterEach(() => {
  Math.random = originalRandom;
});

function unit(weaponName, extra = {}) {
  const w = weaponName ? weapon(weaponName) : null;
  return {
    name: 'U',
    faction: 'player',
    className: 'Myrmidon',
    col: 3,
    row: 3,
    currentHP: 30,
    stats: { HP: 30, STR: 10, MAG: 10, SKL: 10, SPD: 10, DEF: 5, RES: 5, LCK: 5, MOV: 5 },
    weapon: w,
    inventory: w ? [w] : [],
    skills: [],
    accessory: null,
    affixes: [],
    ...extra,
  };
}
const foe = (extra = {}) => unit('Iron Sword', { name: 'Foe', faction: 'enemy', ...extra });
const mods = (me, them, { initiating = true, allies = [], terrain = null, turn = 1 } = {}) =>
  getSkillCombatMods(me, them, allies, [them], data.skills, terrain, initiating, null, { turn });

describe('the Epic tier in data', () => {
  it('has twenty-three Epic weapons, each with a price and either rules or a range of its own', () => {
    expect(epics.map((w) => w.name).sort()).toEqual(
      [
        'Cinderstring',
        'Frightened Acclaim',
        'Futuresold',
        'Gorgemaw',
        'Holder of the Breach',
        'Hollowsong',
        'Second Push',
        'Tallyblade',
        'Wakelight',
        'Haulhook',
        'Mirrorglass',
        'Parrying Blade',
        'Phalanx Pike',
        "Pilgrim's Lamp",
        'Prodding Spear',
        'Proof of the Halls',
        "Rook's Bow",
        'Sealed Orders',
        'The Middle Pages',
        'Thornwood Bow',
        "Tollkeeper's Knife",
        'Treatybreaker',
        'Unrelieved Line',
      ].sort(),
    );
    for (const w of epics) {
      expect(w.price, w.name).toBeGreaterThan(0);
      expect(validateWeaponRules(w), w.name).toEqual([]);
    }
  });

  it('refuses a rule it cannot play', () => {
    const bad = (rules) => validateWeaponRules({ name: 'Bad', rules });
    expect(bad([{ kind: 'nonsense' }])).toHaveLength(1);
    expect(bad([{ kind: 'mods', tag: 'X', mods: { atkBonus: 2 }, when: 'raining' }])[0]).toMatch(
      /unknown condition/,
    );
    expect(bad([{ kind: 'mods', mods: { atkBonus: 2 } }])[0]).toMatch(/tag/);
    expect(bad([{ kind: 'mods', tag: 'X', mods: { stealBonus: 2 } }])[0]).toMatch(/combat mod/);
    expect(bad([{ kind: 'afterCombat', effect: 'pull', onlyWhen: 'always' }])[0]).toMatch(/starts/);
    expect(bad([{ kind: 'effective', classNames: ['Dragon'], multiplier: 3 }])[0]).toMatch(/label/);
    expect(bad([{ kind: 'slowAdjacentFoes', mov: 2 }])[0]).toMatch(/below 0/);
    expect(bad([{ kind: 'turnStartToll', percent: 100 }])[0]).toMatch(/1 to 99/);
    expect(bad([{ kind: 'grows', every: 4, gains: { weight: 1 } }])[0]).toMatch(/gains/);
    expect(bad([{ kind: 'canto', tiles: 0 }])[0]).toMatch(/tiles/);
    expect(bad([{ kind: 'victoryUpkeep', gold: 200, extra: 1 }])[0]).toMatch(/unknown key/);
    expect(bad([{ kind: 'mods', tag: 'X', per: 'battleKill', mods: { atkBonus: 3 } }])[0]).toMatch(
      /cap/,
    );
  });

  it('the data check refuses an Epic weapon in a shop pool and an unknown class or boss', () => {
    const datasets = {
      ...data,
      lootTables: structuredClone(data.lootTables),
      weapons: structuredClone(data.weapons),
    };
    datasets.lootTables.act1.weapons.push('Prodding Spear');
    datasets.weapons.find((w) => w.name === 'Treatybreaker').trophyOf = 'Nobody';
    datasets.weapons.find((w) => w.name === 'Daybreak').rules[0].classNames.push('Gryphon');
    datasets.lootTables.act2.epicWeapons.push('Treatybreaker');
    const errors = validateCrossReferences(datasets).errors.join('\n');
    expect(errors).toMatch(/act1\.weapons lists Epic weapon "Prodding Spear"/);
    expect(errors).toMatch(/unknown boss "Nobody"/);
    expect(errors).toMatch(/unknown class "Gryphon"/);
    expect(errors).toMatch(/act2\.epicWeapons lists trophy "Treatybreaker"/);
    expect(validateCrossReferences(data).errors).toEqual([]);
  });
});

describe('combat rules', () => {
  it('Phalanx Pike counts adjacent allies, up to two', () => {
    const me = unit('Phalanx Pike');
    const near = (col, row) => unit(null, { name: `A${col}${row}`, col, row });
    const allies = [me, near(2, 3), near(4, 3), near(3, 2), near(5, 5)];
    const got = mods(me, foe({ col: 3, row: 4 }), { allies });
    expect(got.atkBonus).toBe(2);
    expect(got.defBonus).toBe(4);
    const alone = mods(me, foe({ col: 3, row: 4 }), { allies: [me] });
    expect(alone.defBonus).toBe(0);
  });

  it("Rook's Bow aims only while its wielder holds the tile it began the turn on", () => {
    const me = unit("Rook's Bow");
    stampTurnAnchors([me], 2);
    expect(mods(me, foe(), { turn: 2 }).hitBonus).toBe(15);
    expect(mods(me, foe(), { turn: 2 }).atkBonus).toBe(5);
    me.col = 4;
    expect(mods(me, foe(), { turn: 2 }).hitBonus).toBe(0);
  });

  it('Unrelieved Line braces when attacked unmoved and weakens after a move', () => {
    const me = unit('Unrelieved Line');
    stampTurnAnchors([me], 3);
    const held = mods(me, foe(), { initiating: false, turn: 3 });
    expect([held.defBonus, held.resBonus]).toEqual([4, 4]);
    expect(mods(me, foe(), { initiating: true, turn: 3 }).defBonus).toBe(0);
    me.hasMoved = true;
    const moved = mods(me, foe(), { initiating: true, turn: 3 });
    expect(moved.atkBonus).toBe(-2);
  });

  it('Proof of the Halls strikes first only at full HP', () => {
    const me = unit('Proof of the Halls');
    expect(mods(me, foe(), { initiating: false }).vantage).toBe(true);
    me.currentHP = 29;
    expect(Boolean(mods(me, foe(), { initiating: false }).vantage)).toBe(false);
  });

  it('Parrying Blade parries swords and lances, not axes', () => {
    const me = unit('Parrying Blade');
    expect(mods(me, foe()).avoidBonus).toBe(15);
    expect(mods(me, foe({ weapon: weapon('Iron Lance') })).avoidBonus).toBe(15);
    expect(mods(me, foe({ weapon: weapon('Iron Axe') })).avoidBonus).toBe(0);
  });

  it('Thornwood Bow and Cinderstring read the tile and the wielder', () => {
    const forest = data.terrain.find((t) => t.name === 'Forest');
    const plain = data.terrain.find((t) => t.name === 'Plain');
    const bow = unit('Thornwood Bow');
    expect(mods(bow, foe(), { terrain: forest }).hitBonus).toBe(15);
    expect(mods(bow, foe(), { terrain: plain }).hitBonus).toBe(0);
    const cinder = unit('Cinderstring');
    expect(mods(cinder, foe()).critBonus).toBe(0);
    expect(mods(cinder, foe()).avoidBonus).toBe(-10);
    cinder.currentHP = 15;
    expect(mods(cinder, foe()).critBonus).toBe(30);
  });

  it('the forecast names a rule only when its condition held', () => {
    const named = (name, opp = foe()) =>
      epicCombatMods(weapon(name), unit(name), opp, { isInitiating: true }).activated.map(
        (a) => a.name,
      );
    expect(named('Treatybreaker')).toEqual(['Fresh foe: +5 Atk']);
    expect(named('Treatybreaker', foe({ currentHP: 1 }))).toEqual([]);
    expect(named('Cinderstring')).toEqual([]);
  });

  it("Mirrorglass hits with the foe's weapon Might, at least 5", () => {
    const glass = weapon('Mirrorglass');
    const me = unit('Mirrorglass');
    const silver = weapon('Silver Sword');
    expect(epicCombatMods(glass, me, foe({ weapon: silver })).mods.atkBonus).toBe(silver.might);
    expect(epicCombatMods(glass, me, foe({ weapon: weapon('Heal') })).mods.atkBonus).toBe(5);
    expect(epicCombatMods(glass, me, foe({ weapon: null })).mods.atkBonus).toBe(5);
  });

  it('Daybreak is x3 against dragons, wyverns and the undead, x2 against the Entity', () => {
    const blade = weapon('Daybreak');
    const vs = (className) => getEffectivenessMultiplier(blade, { className, stats: {} });
    for (const name of ['Wyvern Rider', 'Wyvern Lord', 'Dragon', 'Zombie', 'Revenant', 'Skeleton'])
      expect(vs(name), name).toBe(3);
    expect(vs('Entity')).toBe(2);
    expect(vs('Fighter')).toBe(1);
  });

  it('a push or pull follows only a combat its wielder started and hit in', () => {
    const hook = weapon('Haulhook');
    expect(epicAfterCombatSteps(hook, 'attacker', { landed: true })).toEqual([
      expect.objectContaining({ type: 'tier2_move', mode: 'pull', targetSide: 'defender' }),
    ]);
    expect(epicAfterCombatSteps(hook, 'attacker', { landed: false })).toEqual([]);
    expect(epicAfterCombatSteps(hook, 'defender', { landed: true })).toEqual([]);
    // Sealed Orders: the Silence lands on a counter too, the HP cost only on its own attack.
    const orders = weapon('Sealed Orders');
    expect(epicAfterCombatSteps(orders, 'defender', { landed: true }).map((s) => s.type)).toEqual([
      'tier2_status',
    ]);
  });
});

describe('card words', () => {
  it('says Epic on the base line and names each rule in a chip', () => {
    expect(itemBaseLine(weapon('Treatybreaker'))).toBe('Epic Axe');
    expect(itemBaseLine(weapon('Mirrorglass'))).toBe('Epic Tome');
    const texts = (name) => itemKeywords(weapon(name)).map((t) => t.text);
    expect(texts('Treatybreaker')).toEqual([
      'Fresh foe: +5 Atk',
      'Attacked: -15 Hit',
      'One per run',
    ]);
    expect(texts('Daybreak')).toEqual(['x3 vs Dragons, Undead', 'x2 vs the Entity', 'One per run']);
    expect(texts('The Middle Pages')).toEqual(['6 a battle', 'One per run']);
    for (const w of epics) expect(texts(w.name).length, w.name).toBeGreaterThan(0);
  });
});

describe('boss trophies', () => {
  it('unlock once their boss has fallen on the save, from their boss act on', () => {
    const slain = { Warchief: 1, Archmage: 2, 'Blade Lord': 0 };
    expect(unlockedTrophyNames(data.weapons, slain, 'act1', data.enemies)).toEqual([
      'Treatybreaker',
    ]);
    expect(unlockedTrophyNames(data.weapons, slain, 'act2', data.enemies)).toEqual([
      'Treatybreaker',
      'The Middle Pages',
    ]);
    expect(unlockedTrophyNames(data.weapons, {}, 'act4', data.enemies)).toEqual([]);
    expect(unlockedTrophyNames(data.weapons, null, 'act4', data.enemies)).toEqual([]);
  });

  it("are frozen into a reward's draw only when there is one", () => {
    const run = new RunManager(data);
    run.startRun();
    expect(rewardDrawParams(run, {})).not.toHaveProperty('epicTrophies');
    expect(rewardDrawParams(run, { bossSlain: { Archmage: 1 } })).not.toHaveProperty(
      'epicTrophies',
    );
    expect(rewardDrawParams(run, { bossSlain: { Warchief: 1 } }).epicTrophies).toEqual([
      'Treatybreaker',
    ]);
  });

  it("the saved draw's trophies, never the save's, decide what a reroll can offer", () => {
    const tables = structuredClone(data.lootTables);
    tables.act1 = {
      ...tables.act1,
      epicWeapons: [],
      epicChance: 1,
      weights: { weapon: 100 },
    };
    const run = new RunManager({ ...data, lootTables: tables });
    run.startRun();
    run.roster = [unit('Iron Sword', { proficiencies: [{ type: 'Sword', rank: 'Mast' }] })];
    const names = (draw) => {
      Math.random = createSeededRng(7);
      return rollBattleRewardChoices(run, { ...data, lootTables: tables }, draw).map(
        (c) => c.item?.name,
      );
    };
    const withTrophy = names({ actId: 'act1', epicTrophies: ['Proof of the Halls'] });
    expect(withTrophy.filter((n) => n === 'Proof of the Halls')).toHaveLength(1);
    expect(names({ actId: 'act1' })).not.toContain('Proof of the Halls');
  });
});

describe('Epic weapons in the loot', () => {
  it("a weapon card at the act's epicChance draws from the act's finds and the trophies", () => {
    const tables = structuredClone(data.lootTables);
    tables.act2 = { ...tables.act2, epicChance: 1, weights: { weapon: 100 } };
    Math.random = createSeededRng(3);
    const choices = generateLootChoices('act2', tables, data.weapons, data.consumables, 3);
    const allowed = new Set(tables.act2.epicWeapons);
    for (const choice of choices) {
      expect(choice.type).toBe('weapon');
      expect(allowed.has(choice.item.name), choice.item.name).toBe(true);
    }
    expect(new Set(choices.map((c) => c.item.name)).size).toBe(3);
  });

  it('never offers an Epic weapon the run already holds', () => {
    const tables = structuredClone(data.lootTables);
    tables.act1 = {
      ...tables.act1,
      epicWeapons: ['Prodding Spear'],
      epicChance: 1,
      weights: { weapon: 100 },
    };
    const run = new RunManager(data);
    run.startRun();
    run.roster[0].inventory.push(weapon('Prodding Spear'));
    const owned = [...ownedLegendaryNames(run)];
    expect(owned).toContain('Prodding Spear');
    for (let seed = 1; seed <= 20; seed++) {
      Math.random = createSeededRng(seed);
      const choices = generateLootChoices(
        'act1',
        tables,
        data.weapons,
        data.consumables,
        3,
        0,
        null,
        null,
        null,
        false,
        null,
        false,
        null,
        { excludeLegendaryNames: owned },
      );
      expect(choices.map((c) => c.item?.name)).not.toContain('Prodding Spear');
    }
  });

  it('the real tables offer finds now and then, and shops never sell one', () => {
    const epicNames = new Set(epics.map((w) => w.name));
    let found = 0;
    for (let seed = 1; seed <= 400; seed++) {
      for (const act of ['act1', 'act2', 'act3', 'act4']) {
        Math.random = createSeededRng(seed * 10 + act.length);
        const loot = generateLootChoices(act, data.lootTables, data.weapons, data.consumables, 3);
        found += loot.filter((c) => epicNames.has(c.item?.name)).length;
        const shop = generateShopInventory(act, data.lootTables, data.weapons, data.consumables, [
          ...data.accessories,
        ]);
        for (const entry of shop)
          expect(epicNames.has(entry.item.name), entry.item.name).toBe(false);
      }
    }
    // 1600 battles' worth of cards: a find is an event, not a staple.
    expect(found).toBeGreaterThan(0);
    expect(found).toBeLessThan(1600 * 0.2);
  });
});

// The second batch's rules (spec §2 "PR B"). Each test names the failure it catches; the numbers
// are the data's (weapons.json), worked by hand.
describe('battle-long rules', () => {
  it('Second Push moves 2 tiles after a fight, never after a plain action or when rooted', () => {
    // Failure: no Canto (the rule unread), Canto after a move with no fight, or past a root.
    const me = unit('Second Push');
    expect(cantoAllowance(me, 0, { afterCombat: true })).toBe(2);
    expect(cantoAllowance(me, 5, { afterCombat: false })).toBe(0);
    expect(cantoRuleFor(me)).toBe('any');
    expect(cantoAllowance(unit('Silver Lance'), 3, { afterCombat: true })).toBe(0);
    me._conditions = [{ id: 'root', turnsRemaining: 2 }];
    expect(cantoAllowance(me, 0, { afterCombat: true })).toBe(0);
    // Its catch: -10 Avoid in every combat.
    expect(mods(unit('Second Push'), foe()).avoidBonus).toBe(-10);
  });

  it('Wakelight sees 2 tiles further in the fog', () => {
    const plain = unitVisionRange(unit('Brilliance'), null);
    expect(unitVisionRange(unit('Wakelight'), null)).toBe(plain + 2);
  });

  it('Frightened Acclaim grows +3 Atk a kill this battle, up to +9', () => {
    // Failure: the count unread, uncapped, or kept past the battle.
    const me = unit('Frightened Acclaim');
    expect(mods(me, foe()).atkBonus).toBe(0);
    me._epicBattleKills = 2;
    expect(mods(me, foe()).atkBonus).toBe(6);
    me._epicBattleKills = 7;
    expect(mods(me, foe()).atkBonus).toBe(9);
    expect(serializeUnit(me)).not.toHaveProperty('_epicBattleKills');
  });

  it('Frightened Acclaim stays in hand in battle, and only there', () => {
    // Failure: the lock leaking to the roster, or a battle lock that lets the axe be put down.
    const me = unit('Frightened Acclaim', { inventory: [] });
    const other = weapon('Iron Axe');
    me.inventory = [me.weapon, other];
    me.proficiencies = [{ type: 'Axe', rank: 'Mast' }];
    expect(weaponSwapLocked(me)).toBe(false);
    expect(getAttackWeapons(me).map((w) => w.name)).toEqual(['Frightened Acclaim', 'Iron Axe']);
    stampArmyBattleRules([me], {});
    expect(weaponSwapLocked(me)).toBe(true);
    expect(weaponChangeBlocked(me, other)).toBe(true);
    expect(weaponSwapLockReason(me)).toMatch(/Frightened Acclaim can't leave/);
    expect(getAttackWeapons(me).map((w) => w.name)).toEqual(['Frightened Acclaim']);
    // Holding the Iron Axe instead, the unit may take the Acclaim up (then it holds).
    me.weapon = other;
    expect(weaponChangeBlocked(me, me.inventory[0])).toBe(false);
    expect(serializeUnit(me)).not.toHaveProperty('_inBattle');
  });

  it('Frightened Acclaim spent for the battle lets go: its bearer takes up a spare', () => {
    // Weapon uses (Dave, 2026-10-17): the lock must never leave a unit unable to fight.
    const me = unit('Frightened Acclaim', { inventory: [] });
    const other = weapon('Iron Axe');
    me.inventory = [me.weapon, other];
    me.proficiencies = [{ type: 'Axe', rank: 'Mast' }];
    stampArmyBattleRules([me], {});
    // Epic: 12 uses a battle (data/weaponUses.json).
    me.weapon._usesSpent = 11;
    expect(weaponSwapLocked(me)).toBe(true);
    me.weapon._usesSpent = 12;
    expect(weaponSwapLocked(me)).toBe(false);
    expect(swapSpentWeapons([me])).toHaveLength(1);
    expect(me.weapon.name).toBe('Iron Axe');
    expect(weaponSwapLocked(me)).toBe(false);
  });

  it('Tallyblade notches every kill and rolls a gain every fourth, the same for the same blade', () => {
    // Failure: a gain off the 4-kill beat, Math.random rolls (a rewind rolls another gain), a cap.
    const blade = { ...weapon('Tallyblade'), uid: 'itm_tally_a' };
    const copy = structuredClone(blade);
    const base = { might: blade.might, crit: blade.crit, hit: blade.hit };
    for (let i = 0; i < 3; i++) expect(tallyKill(blade)).toBeNull();
    Math.random = () => {
      throw new Error('Math.random drawn');
    };
    const gain = tallyKill(blade);
    expect(gain).not.toBeNull();
    expect({ might: 1, crit: 5, hit: 5 }[gain.stat]).toBe(gain.amount);
    for (let i = 0; i < 4; i++) tallyKill(copy);
    expect(copy[gain.stat]).toBe(blade[gain.stat]);
    // Uncapped: 400 kills are 100 gains, spread over the three stats.
    for (let i = 4; i < 400; i++) tallyKill(blade);
    const tally = tallyOf(blade);
    expect(tally.kills).toBe(400);
    expect(tally.might + tally.crit / 5 + tally.hit / 5).toBe(100);
    expect([tally.might, tally.crit, tally.hit].every((n) => n > 0)).toBe(true);
    expect(blade.might - base.might).toBe(tally.might);
    expect(blade.crit - base.crit).toBe(tally.crit);
    expect(blade.hit - base.hit).toBe(tally.hit);
    expect(itemKeywords(blade).map((t) => t.text)).toEqual(['Tally 400 kills', 'One per run']);
  });

  it("Gorgemaw takes 15% of max HP at its wielder's turn start unless it fed last turn", () => {
    // Failure: a toll on turn 1, a toll after a kill, a toll that kills, or a toll from the bag.
    const toll = (u, turn) =>
      getTurnStartEffects([u], data.skills, null, turn).filter((e) => e.type === 'toll');
    const me = unit('Gorgemaw', { currentHP: 30 });
    expect(toll(me, 1)).toEqual([]);
    // 15% of 30 is 4.5: 4.
    expect(toll(me, 3).map((e) => e.amount)).toEqual([4]);
    me._epicFedTurn = 2;
    expect(toll(me, 3)).toEqual([]);
    expect(toll(me, 4).map((e) => e.amount)).toEqual([4]);
    expect(toll(unit('Gorgemaw', { currentHP: 2 }), 3).map((e) => e.amount)).toEqual([1]);
    expect(toll(unit('Gorgemaw', { currentHP: 1 }), 3)).toEqual([]);
    const carried = unit('Iron Axe');
    carried.inventory.push(weapon('Gorgemaw'));
    expect(toll(carried, 3)).toEqual([]);
    // A kill feeds it for the turn it was made in.
    const fed = unit('Gorgemaw');
    recordEpicCombat(fed, { struck: true, killed: true, turn: 5 });
    expect(fed._epicFedTurn).toBe(5);
  });

  it('Holder of the Breach slows the foes beside it for their phase, then lets go', () => {
    // Failure: a slow on a foe two tiles away, a slow that outlives the enemy phase.
    const holder = unit('Holder of the Breach', { col: 3, row: 3 });
    const beside = foe({ name: 'Beside', col: 4, row: 3 });
    const far = foe({ name: 'Far', col: 5, row: 3 });
    const effects = getTurnStartEffects([beside, far], data.skills, null, 2, [holder]);
    const slows = effects.filter((e) => e.slow);
    expect(slows.map((e) => e.target.name)).toEqual(['Beside']);
    applyTimedBuffEntry(beside, slows[0].entry);
    expect(beside.stats.MOV).toBe(3);
    expectTimed([beside], 'enemy', 2, 3);
    expectTimed([beside], 'player', 3, 5);
    // No holder on the other side (the army's own phase): nothing.
    expect(getTurnStartEffects([holder], data.skills, null, 3, [beside]).length).toBe(0);
  });
});

function expectTimed(units, phase, turn, mov) {
  expireTimedBuffs(units, phase, turn);
  expect(units[0].stats.MOV).toBe(mov);
}

describe('victory terms', () => {
  function battleRun() {
    const run = new RunManager(data);
    run.startRun({ runSeed: 21, difficultyId: 'dusk', autoSelectBlessing: false });
    run.chooseBlessing(null);
    return run;
  }
  const firstBattle = (run) => run.getAvailableNodes().find((n) => n.type === 'battle');
  function win(run, arm) {
    const units = run.getRoster().map((u) => structuredClone(u));
    arm?.(units);
    run.gold = 1000;
    expect(run.completeBattle(units, firstBattle(run).id, 0, { turnCount: 4, turnPar: 9 })).toBe(
      true,
    );
    return run;
  }

  it('Futuresold costs 200 gold a victory while the army carries it, convoy included', () => {
    // Failure: the upkeep unpaid, paid twice, or paid past an empty purse.
    const plain = win(battleRun()).gold;
    const carried = win(battleRun(), (units) => units[0].inventory.push(weapon('Futuresold')));
    expect(carried.gold).toBe(plain - 200);
    expect(carried.lastEpicVictory.lines).toEqual(['Futuresold −200 G']);
    const stored = battleRun();
    stored.convoy.weapons.push(weapon('Futuresold'));
    expect(win(stored).gold).toBe(plain - 200);
    expect(win(battleRun()).lastEpicVictory).toBeNull();
  });

  it('Hollowsong adds a shadow for each battle it struck in, once, and the stamp clears', () => {
    // Failure: no shadow, shadow from a carried but unused tome, or a stamp kept into the next battle.
    const shadow = (run) => run.eclipse.shadow;
    const plain = shadow(win(battleRun()));
    const idle = shadow(win(battleRun(), (units) => units[0].inventory.push(weapon('Hollowsong'))));
    expect(idle).toBe(plain);
    const used = win(battleRun(), (units) => {
      const tome = weapon('Hollowsong');
      units[0].inventory.push(tome);
      units[0].weapon = tome;
      recordEpicCombat(units[0], { struck: true, killed: false, turn: 2 });
      expect(tome._epicBattleUsed).toBe(true);
    });
    expect(shadow(used)).toBe(plain + 1);
    expect(used.lastEpicVictory.lines).toEqual(['Hollowsong +1 shadow']);
    const kept = used.roster[0].inventory.find((w) => w.name === 'Hollowsong');
    expect(kept._epicBattleUsed).toBeUndefined();
  });
});
