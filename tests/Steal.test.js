// Steal (docs/specs/phase3.md 3G, engine/Steal.js + the finder in ActionAbilitySystem.js).
// Ways it can go wrong, one test each:
//   - it offers a foe that is not adjacent, carries nothing, or is one the fog hides, or its
//     refusal tells the player what the fog hides;
//   - speed: an equal-speed thief is refused, or a slower foe is not; the weapon's weight is
//     ignored; "too slow" is said when the real trouble is room;
//   - room: the convoy is tried before the bag, a full bag and convoy still steal, or a
//     refusal moves or loses something;
//   - the transfer is not one thing: the item ends in two places, or in none, or is another
//     object (uid, uses, forge and wear fields differ);
//   - a second Steal takes something from the same carrier;
//   - the skill is not the Thief's (and its promotions'), a scroll does not teach it, an
//     accessory can lend it, or an enemy Thief can use it.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  abilityHasTargets,
  canUseAbility,
  findStealTargets,
  getActionAbilities,
  stealStatus,
} from '../src/engine/ActionAbilitySystem.js';
import {
  STEAL_REASONS,
  carriedItemOf,
  isFastEnoughToSteal,
  settleSteal,
  stealBlockReason,
  stealDestination,
  stealReasonLabel,
  stealSpeed,
} from '../src/engine/Steal.js';
import { isBindableSkill } from '../src/engine/AccessorySkills.js';
import { applyCondition } from '../src/engine/StatusConditionSystem.js';
import { RunManager } from '../src/engine/RunManager.js';
import {
  createUnit,
  getClassInnateSkills,
  learnSkill,
  parseWeaponProficiencies,
  promoteUnit,
} from '../src/engine/UnitManager.js';
import { CONSUMABLE_MAX, INVENTORY_MAX } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const skill = data.skills.find((s) => s.id === 'steal');
const ability = skill.actionAbility;
const catalog = (name) => structuredClone(data.consumables.find((c) => c.name === name));
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));

const STATS = { HP: 20, STR: 4, MAG: 0, SKL: 7, SPD: 9, DEF: 2, RES: 2, LCK: 7, MOV: 5 };
function unit(name, col, row, extra = {}) {
  return {
    name,
    faction: 'player',
    col,
    row,
    currentHP: 20,
    stats: { ...STATS },
    mov: 5,
    moveType: 'Infantry',
    weapon: null,
    inventory: [],
    consumables: [],
    skills: [],
    proficiencies: [],
    _conditions: [],
    ...extra,
  };
}
const thiefAt = (col, row, extra = {}) => unit('Thief', col, row, { skills: ['steal'], ...extra });
const carrier = (name, col, row, item = 'Vulnerary', extra = {}) =>
  unit(name, col, row, {
    faction: 'enemy',
    carriedItem: { ...catalog(item), uid: `itm_${name}` },
    ...extra,
  });

/** A real run, so the convoy's capacity is the game's own. */
function run() {
  return new RunManager(data);
}
function fillConvoy(r, bucket = 'consumables') {
  const filler = bucket === 'consumables' ? catalog('Herb') : weapon('Iron Sword');
  while (r.addToConvoy(filler));
  return r;
}
const probe = (r) => ({ canAddToConvoy: (item) => r.canAddToConvoy(item) });
const world = (r, ...units) =>
  structuredClone({ convoy: r.convoy, units: units.map((u) => ({ ...u })) });

describe('who can be robbed', () => {
  it('only an adjacent carrier: four neighbours, not a diagonal, not two tiles off', () => {
    const t = thiefAt(5, 5);
    const near = [carrier('N', 5, 4), carrier('S', 5, 6), carrier('W', 4, 5), carrier('E', 6, 5)];
    const far = [carrier('NE', 6, 4), carrier('Far', 5, 8), carrier('Two', 7, 5)];
    const found = findStealTargets(t, ability, { enemies: [...near, ...far], ...probe(run()) });
    expect(found.map((e) => e.unit.name).sort()).toEqual(['E', 'N', 'S', 'W']);
    expect(found.find((e) => e.unit.name === 'N')).toMatchObject({ dc: 0, dr: -1, destination: 'bag' }); // prettier-ignore
  });

  it('skips a foe with nothing to take, and a unit with no item field at all', () => {
    const t = thiefAt(5, 5);
    const empty = unit('Empty', 6, 5, { faction: 'enemy' });
    const bare = unit('Bare', 4, 5, { faction: 'enemy', carriedItem: {} });
    expect(findStealTargets(t, ability, { enemies: [empty, bare], ...probe(run()) })).toEqual([]);
    expect(carriedItemOf(empty)).toBeNull();
    expect(carriedItemOf(bare)).toBeNull();
  });

  it('is offered through the menu check only with a target', () => {
    const t = thiefAt(5, 5);
    const r = run();
    expect(abilityHasTargets(t, skill, { enemies: [carrier('A', 6, 5)], ...probe(r) })).toBe(true);
    expect(abilityHasTargets(t, skill, { enemies: [carrier('A', 8, 5)], ...probe(r) })).toBe(false);
    expect(abilityHasTargets(t, skill, { enemies: [], ...probe(r) })).toBe(false);
  });

  it('a downed carrier is not robbed', () => {
    const t = thiefAt(5, 5);
    const down = carrier('Down', 6, 5, 'Vulnerary', { currentHP: 0 });
    expect(findStealTargets(t, ability, { enemies: [down], ...probe(run()) })).toEqual([]);
  });
});

describe('speed: the thief must be at least as fast', () => {
  it('an equal attack speed is allowed, one slower is refused ("Too slow")', () => {
    const r = run();
    const t = thiefAt(5, 5); // SPD 9, no weapon: attack speed 9
    const equal = carrier('Equal', 6, 5, 'Vulnerary', { stats: { ...STATS, SPD: 9 } });
    const quicker = carrier('Quicker', 4, 5, 'Vulnerary', { stats: { ...STATS, SPD: 10 } });
    expect(stealSpeed(t)).toBe(9);
    expect(isFastEnoughToSteal(t, equal)).toBe(true);
    expect(isFastEnoughToSteal(t, quicker)).toBe(false);
    expect(stealBlockReason(t, equal, probe(r))).toBeNull();
    expect(stealBlockReason(t, quicker, probe(r))).toBe(STEAL_REASONS.tooSlow);
    const found = findStealTargets(t, ability, { enemies: [equal, quicker], ...probe(r) });
    expect(found.map((e) => e.unit.name)).toEqual(['Equal']);
  });

  it('counts the weapon: Iron Sword weighs 3, and STR 5 per point takes it off', () => {
    const r = run();
    const sword = weapon('Iron Sword');
    expect(sword.weight).toBe(3);
    // STR 4: floor(4 / 5) = 0 off the weight, so SPD 9 - 3 = 6.
    const heavy = thiefAt(5, 5, { weapon: sword, inventory: [sword] });
    expect(stealSpeed(heavy)).toBe(6);
    const foe = carrier('Foe', 6, 5, 'Vulnerary', { stats: { ...STATS, SPD: 7 } }); // bare: 7
    expect(stealBlockReason(heavy, foe, probe(r))).toBe(STEAL_REASONS.tooSlow);
    // STR 15: floor(15 / 5) = 3 off, so the sword weighs nothing: 9 against 7.
    const strong = thiefAt(5, 5, { weapon: sword, inventory: [sword], stats: { ...STATS, STR: 15 } }); // prettier-ignore
    expect(stealSpeed(strong)).toBe(9);
    expect(stealBlockReason(strong, foe, probe(r))).toBeNull();
    // The foe's weapon weighs on it too: SPD 7 - 3 = 4 loses to the heavy thief's 6.
    const armed = carrier('Armed', 6, 5, 'Vulnerary', { stats: { ...STATS, SPD: 7 }, weapon: sword }); // prettier-ignore
    expect(stealSpeed(armed)).toBe(4);
    expect(stealBlockReason(heavy, armed, probe(r))).toBeNull();
  });

  it('says "Too slow" when every adjacent carrier is faster, and settles nothing', () => {
    const r = run();
    const t = thiefAt(5, 5);
    const quick = carrier('Quick', 6, 5, 'Vulnerary', { stats: { ...STATS, SPD: 12 } });
    const status = stealStatus(t, ability, { enemies: [quick], ...probe(r) });
    expect(status).toEqual({ targets: [], reason: STEAL_REASONS.tooSlow });
    expect(stealReasonLabel(status.reason)).toBe('Too slow');
    const before = world(r, t, quick);
    expect(settleSteal(t, quick, { run: r })).toBeNull();
    expect(world(r, t, quick)).toEqual(before);
  });
});

describe('room: the bag, then the convoy, then a refusal', () => {
  it('goes to the bag when it fits, even with convoy room', () => {
    const r = run();
    const t = thiefAt(5, 5);
    const foe = carrier('Foe', 6, 5);
    expect(stealDestination(t, foe.carriedItem, probe(r))).toBe('bag');
    expect(settleSteal(t, foe, { run: r })).toMatchObject({ destination: 'bag' });
    expect(r.convoy.consumables).toEqual([]);
  });

  it('goes to the convoy when the bag is full', () => {
    const r = run();
    const t = thiefAt(5, 5, { consumables: [catalog('Herb'), catalog('Herb'), catalog('Herb')] });
    expect(t.consumables).toHaveLength(CONSUMABLE_MAX);
    const foe = carrier('Foe', 6, 5);
    const done = settleSteal(t, foe, { run: r });
    expect(done).toMatchObject({ destination: 'convoy', uid: 'itm_Foe' });
    expect(t.consumables).toHaveLength(CONSUMABLE_MAX);
    expect(r.convoy.consumables.map((i) => i.uid)).toEqual(['itm_Foe']);
    expect(foe.carriedItem).toBeUndefined();
  });

  it('is refused when neither has room: "Bag and convoy full", and nothing changes', () => {
    const r = fillConvoy(run());
    const t = thiefAt(5, 5, { consumables: [catalog('Herb'), catalog('Herb'), catalog('Herb')] });
    const foe = carrier('Foe', 6, 5);
    expect(r.canAddToConvoy(foe.carriedItem)).toBe(false);
    const status = stealStatus(t, ability, { enemies: [foe], ...probe(r) });
    expect(status).toEqual({ targets: [], reason: STEAL_REASONS.full });
    expect(stealReasonLabel(status.reason)).toBe('Bag and convoy full');
    expect(abilityHasTargets(t, skill, { enemies: [foe], ...probe(r) })).toBe(false);
    const before = world(r, t, foe);
    expect(settleSteal(t, foe, { run: r })).toBeNull();
    expect(world(r, t, foe)).toEqual(before); // deep-equal: the refusal moved nothing
    expect(foe.carriedItem.uid).toBe('itm_Foe');
  });

  it('if the convoy refuses the add after saying yes, the carrier keeps its item', () => {
    const t = thiefAt(5, 5, { consumables: [catalog('Herb'), catalog('Herb'), catalog('Herb')] });
    const liar = { canAddToConvoy: () => true, addToConvoy: () => false };
    const foe = carrier('Foe', 6, 5);
    const before = structuredClone({ t, foe });
    expect(settleSteal(t, foe, { run: liar })).toBeNull();
    expect(structuredClone({ t, foe })).toEqual(before);
    // And if the add throws, the carrier still holds it: it lets go only after the item landed.
    const thrower = {
      canAddToConvoy: () => true,
      addToConvoy: () => {
        throw new Error('storage refused');
      },
    };
    expect(() => settleSteal(t, foe, { run: thrower })).toThrow('storage refused');
    expect(structuredClone({ t, foe })).toEqual(before);
  });

  it('with no run at all, a full bag is a refusal', () => {
    const t = thiefAt(5, 5, { consumables: [catalog('Herb'), catalog('Herb'), catalog('Herb')] });
    const foe = carrier('Foe', 6, 5);
    expect(stealBlockReason(t, foe, {})).toBe(STEAL_REASONS.full);
    expect(settleSteal(t, foe, {})).toBeNull();
    expect(foe.carriedItem).toBeTruthy();
  });

  it('a weapon looks for a weapon slot, a consumable for a consumable slot', () => {
    const r = fillConvoy(run(), 'weapons');
    const bagFull = Array.from({ length: INVENTORY_MAX }, () => weapon('Iron Sword'));
    const t = thiefAt(5, 5, { inventory: bagFull });
    // Full of swords but empty of consumables: a Vulnerary still fits the bag...
    expect(stealDestination(t, catalog('Vulnerary'), probe(r))).toBe('bag');
    // ...and a sword goes nowhere, the weapon convoy being full too.
    expect(stealDestination(t, weapon('Steel Sword'), probe(r))).toBeNull();
  });

  it('"too slow" wins over "full": the speed is the first word', () => {
    const r = fillConvoy(run());
    const t = thiefAt(5, 5, { consumables: [catalog('Herb'), catalog('Herb'), catalog('Herb')] });
    const quick = carrier('Quick', 6, 5, 'Vulnerary', { stats: { ...STATS, SPD: 12 } });
    expect(stealBlockReason(t, quick, probe(r))).toBe(STEAL_REASONS.tooSlow);
    // With two foes, one too slow and one with no room, the picker names the room: the
    // player can do something about that.
    const slowOnly = stealStatus(t, ability, { enemies: [quick], ...probe(r) });
    expect(slowOnly.reason).toBe(STEAL_REASONS.tooSlow);
    const both = stealStatus(t, ability, { enemies: [quick, carrier('Slow', 4, 5)], ...probe(r) });
    expect(both.reason).toBe(STEAL_REASONS.full);
  });
});

describe('the transfer is one thing', () => {
  const worn = () => ({
    ...weapon('Iron Sword'),
    uid: 'itm_blade',
    _forgeBonus: { Mt: 2 },
    forgeLevel: 2,
    _wear: 1,
    _usesSpent: 3,
    _strikes: 9,
  });

  it('into the bag: the very same object, with its uid and uses, and the carrier lets go', () => {
    const t = thiefAt(5, 5);
    const foe = carrier('Foe', 6, 5, 'Elixir');
    const item = foe.carriedItem;
    const snapshot = structuredClone(item);
    const done = settleSteal(t, foe, { run: run() });
    expect(done.item).toBe(item);
    expect(t.consumables).toHaveLength(1);
    expect(t.consumables[0]).toBe(item); // the same instance
    expect(t.consumables[0]).toEqual(snapshot);
    expect('carriedItem' in foe).toBe(false);
    expect(done).toMatchObject({ thief: t, carrier: foe, destination: 'bag', uid: item.uid });
  });

  it('into the convoy: the same uid and every field, in exactly one place', () => {
    const r = run();
    const t = thiefAt(5, 5, { inventory: Array.from({ length: INVENTORY_MAX }, () => weapon('Iron Sword')) }); // prettier-ignore
    const foe = unit('Foe', 6, 5, { faction: 'enemy', carriedItem: worn() });
    const snapshot = structuredClone(foe.carriedItem);
    const done = settleSteal(t, foe, { run: r });
    expect(done.destination).toBe('convoy');
    const copies = [...r.convoy.weapons, ...r.convoy.consumables].filter((i) => i.uid === 'itm_blade'); // prettier-ignore
    expect(copies).toHaveLength(1);
    expect(copies[0]).toEqual(snapshot); // uid, forge, wear, uses, counters
    expect(t.inventory).toHaveLength(INVENTORY_MAX); // the thief's own bag untouched
    expect(foe.carriedItem).toBeUndefined();
    // The rewind pattern: the village's uid removal takes exactly this item back out.
    expect(r.removeFromConvoyByUid('itm_blade')).toEqual(snapshot);
    expect(r.convoy.weapons).toEqual([]);
  });

  it('an item that had no uid gets one before it can reach the convoy', () => {
    const r = run();
    const t = thiefAt(5, 5, { consumables: [catalog('Herb'), catalog('Herb'), catalog('Herb')] });
    const foe = unit('Foe', 6, 5, { faction: 'enemy', carriedItem: catalog('Vulnerary') });
    expect(foe.carriedItem.uid).toBeUndefined();
    const done = settleSteal(t, foe, { run: r });
    expect(done.uid).toMatch(/^itm_/);
    expect(r.convoy.consumables[0].uid).toBe(done.uid);
  });

  it('one Steal per target: the carrier has nothing left', () => {
    const r = run();
    const t = thiefAt(5, 5);
    const other = thiefAt(5, 7);
    const foe = carrier('Foe', 5, 6);
    expect(settleSteal(t, foe, { run: r })).toBeTruthy();
    expect(findStealTargets(other, ability, { enemies: [foe], ...probe(r) })).toEqual([]);
    expect(findStealTargets(t, ability, { enemies: [foe], ...probe(r) })).toEqual([]);
    expect(settleSteal(other, foe, { run: r })).toBeNull();
    expect(other.consumables).toEqual([]);
    expect(t.consumables).toHaveLength(1);
  });

  it("takes only the carried item: never an equipped weapon or the foe's other gear", () => {
    const t = thiefAt(5, 5);
    const sword = weapon('Iron Sword');
    const foe = carrier('Foe', 6, 5, 'Vulnerary', {
      weapon: sword,
      inventory: [sword],
      consumables: [catalog('Herb')],
      accessory: { name: 'Boots', type: 'Accessory' },
    });
    settleSteal(t, foe, { run: run() });
    expect(foe.weapon).toBe(sword);
    expect(foe.inventory).toEqual([sword]);
    expect(foe.consumables).toHaveLength(1);
    expect(foe.accessory.name).toBe('Boots');
    expect(t.consumables.map((i) => i.name)).toEqual(['Vulnerary']);
  });

  it("the carried item is never in the foe's bag, so no other path finds it twice", () => {
    const foe = carrier('Foe', 6, 5);
    expect(foe.consumables).toEqual([]);
    expect(foe.inventory).toEqual([]);
    const all = JSON.stringify([foe.consumables, foe.inventory]);
    expect(all).not.toContain(foe.carriedItem.uid);
  });
});

describe('who can use it', () => {
  it('a silenced thief steals: it is a bodily act', () => {
    const t = thiefAt(5, 5);
    expect(canUseAbility(t, skill)).toEqual({ ok: true, reason: null });
    applyCondition(t, 'silence', 2);
    expect(canUseAbility(t, skill)).toEqual({ ok: true, reason: null });
    expect(ability.usableWhileSilenced).toBe(true);
  });

  it("is in the Thief's ability list and nobody else's", () => {
    expect(getActionAbilities(thiefAt(1, 1), data.skills).map((s) => s.id)).toEqual(['steal']);
    expect(getActionAbilities(unit('Fighter', 1, 1), data.skills)).toEqual([]);
  });

  it('the skill is innate to the Thief and its promotions keep it', () => {
    expect(skill.classInnate).toBe('Thief');
    expect(skill.actionAbility.kind).toBe('steal_item');
    expect(getClassInnateSkills('Thief', data.skills)).toContain('steal');
    const thiefClass = data.classes.find((c) => c.name === 'Thief');
    const made = createUnit(thiefClass, 8, data.weapons, { rng: () => 0.5, faction: 'player' });
    for (const sid of getClassInnateSkills('Thief', data.skills)) learnSkill(made, sid);
    expect(made.skills).toContain('steal');
    for (const promoted of data.classes.filter((c) => c.promotesFrom === 'Thief')) {
      const unitCopy = structuredClone(made);
      unitCopy.level = 10;
      promoteUnit(unitCopy, promoted, promoted.promotionBonuses, data.skills);
      expect(unitCopy.className, promoted.name).toBe(promoted.name);
      expect(unitCopy.skills, promoted.name).toContain('steal');
    }
  });

  it('an existing Thief, Assassin or Trickster gains it on load', () => {
    const r = run();
    const classes = data.classes.filter((c) => c.name === 'Thief' || c.promotesFrom === 'Thief');
    expect(classes.map((c) => c.name).sort()).toEqual(['Assassin', 'Thief', 'Trickster']);
    r.roster = classes.map((c, i) => ({
      ...unit(`Old ${c.name}`, i, 0),
      className: c.name,
      tier: c.tier,
      level: c.tier === 'promoted' ? 4 : 6,
      skills: [],
      proficiencies: parseWeaponProficiencies(c.weaponProficiencies),
    }));
    RunManager.migrateClassInnateSkills(r);
    for (const u of r.roster) expect(u.skills, u.className).toContain('steal');
    const fighter = data.classes.find((c) => c.name === 'Fighter');
    r.roster = [{ ...unit('Old Fighter', 0, 0), className: fighter.name, tier: 'base', level: 3 }];
    RunManager.migrateClassInnateSkills(r);
    expect(r.roster[0].skills).not.toContain('steal');
  });

  it('a Steal Scroll teaches it (Act II and later), and an accessory can never lend it', () => {
    const scroll = data.weapons.find((w) => w.name === 'Steal Scroll');
    expect(scroll).toMatchObject({ type: 'Scroll', skillId: 'steal', tier: 'Rare', price: 2500 });
    for (const act of ['act2', 'act3', 'act4'])
      expect(data.lootTables[act].skillScroll, act).toContain('Steal Scroll');
    for (const act of ['act1', 'finalBoss'])
      expect(data.lootTables[act].skillScroll, act).not.toContain('Steal Scroll');
    const config = data.lootTables.accessorySkills;
    expect(config.neverBound).toContain('steal');
    expect(isBindableSkill('steal', skill, config)).toBe(false);
    for (const pool of Object.values(config.poolByAct)) expect(pool).not.toContain('steal');
  });

  it('an enemy Thief never steals: nothing in the AI reads it', () => {
    const ai = readFileSync(new URL('../src/engine/AIController.js', import.meta.url), 'utf8');
    expect(ai).not.toMatch(/Steal|steal_item|carriedItem/);
  });
});
