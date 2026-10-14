// Epic weapons' rules, card words and loot (docs/specs/epic-weapons.md). The battle wiring
// (push, pull, heal, Silence, toll, Daybreak) is played through the scene and the harness in
// EpicWeaponsBattle.test.js; this file holds the pure rules and the draw.
import { afterEach, describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import {
  epicAfterCombatSteps,
  epicCombatMods,
  unlockedTrophyNames,
  validateWeaponRules,
} from '../src/engine/EpicWeapons.js';
import { getSkillCombatMods } from '../src/engine/SkillSystem.js';
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
  it('has fifteen Epic weapons, each with a price and either rules or a range of its own', () => {
    expect(epics.map((w) => w.name).sort()).toEqual(
      [
        'Cinderstring',
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
    expect(texts('Treatybreaker')).toEqual(['Fresh foe: +5 Atk', 'Attacked: -15 Hit']);
    expect(texts('Daybreak')).toEqual(['x3 vs Dragons, Undead', 'x2 vs the Entity']);
    expect(texts('The Middle Pages')).toEqual(['6 a battle']);
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
