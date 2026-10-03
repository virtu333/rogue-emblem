// Playtest 2026-10-03: a poisoning enemy poisoned its target even when every one of
// its strikes missed. Poison of every source (the Venomous affix, an Adder weapon, a
// Venomous imbue) now lands only when its side hit at least once; a single landed
// strike is enough, and it never kills.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveCombat } from '../src/engine/Combat.js';
import { applyImbue, getImbueById } from '../src/engine/ImbueSystem.js';
import { postCombatEffects } from '../src/engine/PostCombatEffects.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const plain = data.terrain.find((t) => t.name === 'Plain');
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));

function unit(name, faction, w, extra = {}) {
  return {
    name,
    className: 'Myrmidon',
    tier: 'base',
    level: 5,
    isLord: false,
    // DEF 30: no strike ever hurts, so only poison can move HP.
    stats: { HP: 40, STR: 8, MAG: 0, SKL: 10, SPD: 10, DEF: 30, RES: 30, LCK: 5 },
    currentHP: 40,
    faction,
    weapon: w,
    inventory: [w],
    proficiencies: [
      { type: 'Sword', rank: 'Prof' },
      { type: 'Bow', rank: 'Prof' },
    ],
    skills: [],
    moveType: 'Infantry',
    col: 0,
    row: 0,
    ...extra,
  };
}

const world = {
  affixes: data.affixes,
  cols: 10,
  rows: 10,
  getMoveCost: () => 1,
  getUnitAt: () => null,
  hostilesOf: () => [],
  alliesOf: () => [],
  turnNumber: 1,
};

/**
 * One enemy-phase combat: the poisoner attacks Edric at range 1 and Edric counters
 * (equal speed: one strike each, no doubles). The poisoner's strike hits or misses as
 * asked; the counter always misses. `landed` reads the outcome back from the events,
 * so a draw that went astray fails the test instead of passing it by accident.
 */
function fight(poisoner, { poisonerHits }) {
  const target = unit('Edric', 'player', weapon('Iron Sword'));
  poisoner.col = 1;
  // A 2RN hit roll is two draws: 0 hits, 0.99 misses (hit 90 here). Every other draw
  // (crit, skill procs) is 0.99: none of them fire.
  const rolls = [];
  vi.spyOn(Math, 'random').mockImplementation(() => (rolls.length ? rolls.shift() : 0.99));
  const hitDraws = (hit) => (hit ? [0, 0] : [0.99, 0.99]);
  // Poisoner's strike: two hit draws, then a crit draw only if it hit.
  rolls.push(...hitDraws(poisonerHits));
  if (poisonerHits) rolls.push(0.99);
  // The counter always misses.
  rolls.push(...hitDraws(false));
  const result = resolveCombat(poisoner, poisoner.weapon, target, target.weapon, 1, plain, plain, {
    affixData: data.affixes,
    imbuesData: data.imbues,
  });
  target.currentHP = result.defenderHP;
  poisoner.currentHP = result.attackerHP;
  for (const _beat of postCombatEffects({ attacker: poisoner, defender: target, result }, world));
  const landed = result.events.filter(
    (e) => e.type === 'strike' && e.attackerSide === 'attacker' && !e.miss,
  ).length;
  return { target, result, landed };
}

const poisoners = {
  'the Venomous affix': () =>
    unit('Cutthroat', 'enemy', weapon('Iron Sword'), { affixes: ['venomous'] }),
  'an Adder Blade': () => unit('Cutthroat', 'enemy', weapon('Adder Blade')),
  'a Venomous imbue': () => {
    const w = weapon('Iron Sword');
    applyImbue(w, getImbueById(data.imbues, 'venom'));
    return unit('Cutthroat', 'enemy', w);
  },
};
const expected = { 'the Venomous affix': 5, 'an Adder Blade': 5, 'a Venomous imbue': 7 };

describe('post-combat poison needs a landed hit', () => {
  afterEach(() => vi.restoreAllMocks());

  for (const [source, make] of Object.entries(poisoners)) {
    it(`${source}: every strike missed, no poison`, () => {
      const { target, result, landed } = fight(make(), { poisonerHits: false });
      expect(landed).toBe(0);
      expect(target.currentHP).toBe(40);
      expect(result.poisonEffects || []).toEqual([]);
    });

    it(`${source}: a hit that deals no damage still poisons`, () => {
      const { target, landed } = fight(make(), { poisonerHits: true });
      expect(landed).toBe(1);
      expect(target.currentHP).toBe(40 - expected[source]);
    });
  }
});
