// Bond Rings: accessories that lend a skill (docs/specs/phase3.md 3H).
//
// Ways this goes wrong, each caught below:
//   data       a pool names a skill that does not exist, is personal or a class innate by
//              accident, belongs to an enemy-only class, or is one a ring can never lend
//              (Dance, Shove, Pull, Lethality, Steal, Goddess Dance); Act I rolls above C
//   roll       a rarity table that ignores the act; a skill outside its rarity's pool; a
//              price that is not the rarity's; a catalog entry changed by a roll; a roll that
//              is not on the stream it was handed; an excluded skill that can still roll
//   drops      a ring in Act I boss rewards; a shop that stocks two, or one in Act I; loot
//              category weights moved; a loot roll that spends draws when no ring comes up
//   use        a lent skill dead on a battle path; one that stays after the ring is taken off
//              or traded; one that counts toward MAX_SKILLS or is "known"; one counted twice
//   saves      the rarity, the skill or the price lost across a save
//   display    the identity name changed (icons, lookups); a display name off the grammar
// Expected numbers are worked out by hand from the spec's tables and the skill data, never by
// re-running the code under test.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BOND_RARITIES,
  BOND_RING_NAME,
  bondRingDisplayName,
  bondRingText,
  isBondRing,
  lentSkillLine,
  ringSkillAlreadyKnown,
  rollBondRing,
  validateBondRingData,
} from '../src/engine/BondRings.js';
import { boundSkillOf, effectiveSkills } from '../src/engine/EffectiveSkills.js';
import {
  generateLootChoices,
  generateShopInventory,
  getSellPrice,
} from '../src/engine/LootSystem.js';
import { actShopPrice } from '../src/engine/ShopEconomy.js';
import { equipAccessory, knowsSkill, unequipAccessory } from '../src/engine/UnitManager.js';
import { applyTrade, unitHolder } from '../src/engine/ItemTrade.js';
import {
  checkAstra,
  getSkillCombatMods,
  getTerrainCostReduction,
  getTurnStartEffects,
  getWeaponRangeBonus,
  rollDefenseSkills,
  rollStrikeSkills,
} from '../src/engine/SkillSystem.js';
import { getActionAbilities } from '../src/engine/ActionAbilitySystem.js';
import { cantoRuleFor } from '../src/engine/CantoRule.js';
import { RunManager } from '../src/engine/RunManager.js';
import { chooseEventOption } from '../src/engine/EventCommands.js';
import { MAX_SKILLS } from '../src/utils/constants.js';
import { itemDisplayName, stripItemNameSuffix } from '../src/utils/itemNames.js';
import { formatAccessoryDetail } from '../src/utils/accessoryText.js';
import { resolveItemIconId } from '../src/ui/itemIconIds.js';
import { readFileSync } from 'node:fs';
import { arriveAs, newRun, runWithEvents, soloEvent } from './eventKit.js';
import { loadGameData } from './testData.js';

const iconManifest = JSON.parse(
  readFileSync(new URL('../src/ui/itemIconManifest.json', import.meta.url), 'utf8'),
);
const data = loadGameData();
const skills = data.skills;

// The spec's pool table (docs/specs/phase3.md 3H), written out here on purpose. Pass is the
// fifth S skill: it arrives with Phase 3E, so the data holds four S skills until then.
const SPEC_POOLS = {
  C: ['uncanny_blow', 'warding_blow', 'armored_blow', 'darting_blow', 'death_blow', 'pathfinder'],
  B: ['vantage', 'wrath', 'defiant', 'guard', 'skirmisher', 'foresight', 'canto'],
  A: ['luna', 'sol', 'lifetaker', 'speedtaker', 'pavise', 'aegis', 'renewal'],
  S: ['astra', 'aether', 'miracle', 'blink'],
};
const PRICES = { C: 800, B: 1500, A: 2500, S: 4000 };

/** Seeded stream, so a roll never touches Math.random. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rollWith = (act, rng, over = {}) => rollBondRing(act, rng, { ...data, ...over });

/**
 * A real ring lending `skillId`, made by the real roll: the first draw is chosen to land on the
 * skill's rarity in the act that offers it (by the weights in the spec's act table), the second
 * to land on the skill's place in its pool.
 */
function ringLending(skillId) {
  const rarity = BOND_RARITIES.find((r) => SPEC_POOLS[r].includes(skillId));
  const act = { C: 'act1', B: 'act2', A: 'act3', S: 'act4' }[rarity];
  // act1 C100 | act2 C70 B30 | act3 B55 A40 S5 | act4 A70 S30
  const first = { C: 0.01, B: 0.9, A: 0.8, S: 0.95 }[rarity];
  const pool = SPEC_POOLS[rarity];
  const draws = [first, (pool.indexOf(skillId) + 0.5) / pool.length];
  const ring = rollWith(act, () => draws.shift());
  expect(boundSkillOf(ring), skillId).toBe(skillId);
  return ring;
}

const sword = { name: 'Iron Sword', type: 'Sword', range: '1', might: 5, hit: 90, crit: 0 };
const tome = { name: 'Fire', type: 'Tome', range: '1-2', might: 5, hit: 90, crit: 0 };

function unit(overrides = {}) {
  return {
    name: 'Unit',
    faction: 'player',
    className: 'Myrmidon',
    skills: [],
    weapon: { ...sword },
    inventory: [],
    consumables: [],
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    accessory: null,
    col: 4,
    row: 4,
    currentHP: 20,
    stats: { HP: 20, STR: 8, MAG: 4, SKL: 20, SPD: 10, DEF: 4, RES: 3, LCK: 10, MOV: 5 },
    ...overrides,
  };
}

/** A unit wearing `ring` the way a roster does (through equipAccessory). */
function wearing(ring, overrides = {}) {
  const u = unit(overrides);
  equipAccessory(u, ring);
  return u;
}

const foe = (over = {}) => unit({ faction: 'enemy', col: 5, ...over });

afterEach(() => vi.restoreAllMocks());

// ── Data ────────────────────────────────────────────────────────────────

describe('the ring data', () => {
  const config = data.lootTables.bondRings;

  it('the pools are the spec’s tables, and the prices are 800 / 1500 / 2500 / 4000', () => {
    expect(config.pools).toEqual(SPEC_POOLS);
    expect(config.priceByRarity).toEqual(PRICES);
  });

  it('the shipped data passes the validator', () => {
    expect(validateBondRingData(data)).toEqual([]);
  });

  it('no pool skill is one a ring can never lend', () => {
    const never = ['dance', 'shove', 'pull', 'lethality', 'steal', 'goddess_dance'];
    const pooled = new Set(Object.values(config.pools).flat());
    for (const id of never) expect(pooled.has(id), id).toBe(false);
    for (const id of never) expect(config.neverBound, id).toContain(id);
  });

  it('every pool skill exists, is no lord’s personal skill and is no enemy-only innate', () => {
    const lordPersonal = new Set(
      data.lords.map((l) =>
        l.personalSkill.split(':')[0].trim().toLowerCase().replace(/\s+/g, '_'),
      ),
    );
    const enemyOnly = new Set(['Zombie', 'Revenant', 'Dragon', 'Dragon Lord']);
    for (const id of Object.values(config.pools).flat()) {
      const skill = skills.find((s) => s.id === id);
      expect(skill, id).toBeTruthy();
      // Kira's Foresight is the one lord skill a pool lends by name (spec table, B).
      if (id !== 'foresight')
        expect(lordPersonal.has(id), `${id} is a lord's personal skill`).toBe(false);
      const innate = [skill.classInnate].flat().filter(Boolean);
      expect(innate.length > 0 && innate.every((c) => enemyOnly.has(c)), id).toBe(false);
    }
  });

  it('every personal or class-innate pool skill is one lentInnates names, and nothing else is', () => {
    const innateInPools = Object.values(config.pools)
      .flat()
      .filter((id) => {
        const s = skills.find((x) => x.id === id);
        return s.personal === true || s.classInnate;
      });
    expect([...innateInPools].sort()).toEqual([...config.lentInnates].sort());
  });

  it('the family is one accessory with no stat or combat effect and no instance fields', () => {
    const family = data.accessories.filter((a) => a.name === BOND_RING_NAME);
    expect(family).toHaveLength(1);
    expect(family[0].type).toBe('Accessory');
    expect(family[0].effects).toEqual({});
    expect(family[0].combatEffects).toBeUndefined();
    expect(family[0]._boundSkill).toBeUndefined();
    expect(family[0]._rarity).toBeUndefined();
    expect(family[0].lore.length).toBeLessThanOrEqual(85);
  });

  it('every act but the finale lists the ring once among its accessories; Act I boss rewards never', () => {
    for (const act of ['act1', 'act2', 'act3', 'act4'])
      expect(data.lootTables[act].accessories.filter((n) => n === BOND_RING_NAME)).toHaveLength(1);
    expect(data.lootTables.act1.bossRewards.accessories).not.toContain(BOND_RING_NAME);
  });

  describe('the validator catches each way the data can be wrong', () => {
    const broken = (mutate, extraSkills = []) => {
      const d = structuredClone(data);
      mutate(d.lootTables.bondRings, d);
      return validateBondRingData({ ...d, skills: [...d.skills, ...extraSkills] });
    };

    it('an unknown skill', () => {
      expect(broken((c) => c.pools.C.push('no_such_skill')).join('\n')).toMatch(/unknown skill/);
    });

    it('a skill a ring can never lend', () => {
      for (const id of ['dance', 'shove', 'pull', 'lethality'])
        expect(broken((c) => c.pools.A.push(id)).join('\n'), id).toMatch(/can never lend/);
    });

    it('Steal and Goddess Dance are barred before they exist, and once they do', () => {
      const steal = { id: 'steal', name: 'Steal', trigger: 'action' };
      const dance = { id: 'goddess_dance', name: 'Goddess Dance', trigger: 'action' };
      // Not in skills.json yet: listing one is an unknown skill.
      expect(broken((c) => c.pools.S.push('steal')).join('\n')).toMatch(/unknown skill "steal"/);
      // Added to skills.json: still barred by neverBound.
      expect(broken((c) => c.pools.S.push('steal'), [steal]).join('\n')).toMatch(/never lend/);
      expect(broken((c) => c.pools.S.push('goddess_dance'), [dance]).join('\n')).toMatch(
        /never lend/,
      );
    });

    it('an enemy-only skill', () => {
      expect(broken((c) => c.pools.A.push('zombie_drain')).join('\n')).toMatch(/enemy-only/);
      expect(broken((c) => c.pools.A.push('dragon_scale')).join('\n')).toMatch(/enemy-only/);
    });

    it('a personal skill, or a class innate, no one named a loan', () => {
      expect(broken((c) => c.pools.B.push('charisma')).join('\n')).toMatch(/not in lentInnates/);
      expect(broken((c) => c.pools.B.push('sure_shot')).join('\n')).toMatch(/not in lentInnates/);
      expect(
        broken((c) => c.lentInnates.splice(c.lentInnates.indexOf('canto'), 1)).join('\n'),
      ).toMatch(/"canto" that is not in lentInnates/);
    });

    it('a lentInnates entry that is no innate, is barred, or no pool uses', () => {
      expect(broken((c) => c.lentInnates.push('sol')).join('\n')).toMatch(/neither personal nor/);
      expect(broken((c) => c.lentInnates.push('lethality')).join('\n')).toMatch(/lethality/);
      expect(broken((c) => c.lentInnates.push('sure_shot')).join('\n')).toMatch(/no pool uses/);
    });

    it('a skill in two pools, or a pool left empty', () => {
      expect(broken((c) => c.pools.S.push('sol')).join('\n')).toMatch(/both the A and S pools/);
      expect(broken((c) => (c.pools.S = [])).join('\n')).toMatch(/pools.S must be a non-empty/);
    });

    it('Act I above rarity C, a weightless act, and a ring in Act I boss rewards', () => {
      expect(broken((c) => (c.rarityByAct.act1.B = 5)).join('\n')).toMatch(/act1 must be rarity C/);
      expect(broken((c) => (c.rarityByAct.act3 = { C: 0 })).join('\n')).toMatch(
        /act3 has no weight/,
      );
      expect(
        broken((c, d) => d.lootTables.act1.bossRewards.accessories.push('Bond Ring')).join('\n'),
      ).toMatch(/bossRewards/);
    });
  });
});

// ── The roll ────────────────────────────────────────────────────────────

describe('rollBondRing', () => {
  const sample = (act, n, seed = 7) => {
    const rng = mulberry32(seed);
    return Array.from({ length: n }, () => rollWith(act, rng));
  };
  const share = (rings, rarity) => rings.filter((r) => r._rarity === rarity).length / rings.length;

  it('Act I rolls C only', () => {
    expect(new Set(sample('act1', 600).map((r) => r._rarity))).toEqual(new Set(['C']));
  });

  it('Act II rolls C and B, about 70 / 30', () => {
    const rings = sample('act2', 6000);
    expect(new Set(rings.map((r) => r._rarity))).toEqual(new Set(['C', 'B']));
    expect(share(rings, 'B')).toBeGreaterThan(0.27);
    expect(share(rings, 'B')).toBeLessThan(0.33);
  });

  it('Act III rolls B and A with a little S: about 55 / 40 / 5, never C', () => {
    const rings = sample('act3', 8000);
    expect(new Set(rings.map((r) => r._rarity))).toEqual(new Set(['B', 'A', 'S']));
    expect(share(rings, 'B')).toBeGreaterThan(0.52);
    expect(share(rings, 'B')).toBeLessThan(0.58);
    expect(share(rings, 'A')).toBeGreaterThan(0.37);
    expect(share(rings, 'A')).toBeLessThan(0.43);
    expect(share(rings, 'S')).toBeGreaterThan(0.03);
    expect(share(rings, 'S')).toBeLessThan(0.07);
  });

  it('Act IV rolls A and S, about 70 / 30', () => {
    const rings = sample('act4', 6000);
    expect(new Set(rings.map((r) => r._rarity))).toEqual(new Set(['A', 'S']));
    expect(share(rings, 'S')).toBeGreaterThan(0.27);
    expect(share(rings, 'S')).toBeLessThan(0.33);
  });

  it('acts after IV read Act IV’s table; an unknown act reads Act I’s', () => {
    for (const act of ['postAct', 'finalBoss'])
      expect(new Set(sample(act, 400).map((r) => r._rarity))).toEqual(new Set(['A', 'S']));
    expect(new Set(sample('nowhere', 200).map((r) => r._rarity))).toEqual(new Set(['C']));
  });

  it('the skill comes from its rarity’s pool, every pool skill comes up, and the price is the rarity’s', () => {
    for (const [act, rarities] of [
      ['act2', ['C', 'B']],
      ['act3', ['B', 'A', 'S']],
      ['act4', ['A', 'S']],
    ]) {
      const seen = Object.fromEntries(BOND_RARITIES.map((r) => [r, new Set()]));
      for (const ring of sample(act, 6000, 99)) {
        expect(SPEC_POOLS[ring._rarity]).toContain(ring._boundSkill);
        expect(ring.price).toBe(PRICES[ring._rarity]);
        seen[ring._rarity].add(ring._boundSkill);
      }
      // Not S in Act III (5%: 6000 draws still see every one of its four skills).
      for (const rarity of rarities)
        expect([...seen[rarity]].sort(), `${act} ${rarity}`).toEqual(
          [...SPEC_POOLS[rarity]].sort(),
        );
    }
  });

  it('is an instance of the catalog ring: the same name and no stats, the catalog untouched', () => {
    const catalogBefore = structuredClone(data.accessories);
    const ring = rollWith('act2', mulberry32(3));
    expect(ring).toMatchObject({ name: 'Bond Ring', type: 'Accessory', effects: {} });
    expect(Object.keys(ring.effects)).toEqual([]);
    expect(ring.combatEffects).toBeUndefined();
    expect(data.accessories).toEqual(catalogBefore);
    expect(data.accessories.find((a) => a.name === 'Bond Ring')._boundSkill).toBeUndefined();
    expect(ring).not.toBe(data.accessories.find((a) => a.name === 'Bond Ring'));
  });

  it('draws exactly twice from the stream it is given, and never from Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    let calls = 0;
    const ring = rollWith('act3', () => {
      calls += 1;
      return 0.5;
    });
    expect(calls).toBe(2);
    expect(spy).not.toHaveBeenCalled();
    // 0.5 -> 50 of 100: B (55 covers it) -> index floor(0.5 * 7) = 3 of the B pool: guard.
    expect(ring._rarity).toBe('B');
    expect(ring._boundSkill).toBe('guard');
  });

  it('is the same ring from the same stream, and a different one from another', () => {
    const a = rollWith('act4', mulberry32(11));
    const b = rollWith('act4', mulberry32(11));
    expect(b).toEqual(a);
    const others = new Set(
      Array.from({ length: 30 }, (_, i) => rollWith('act4', mulberry32(i + 100))._boundSkill),
    );
    expect(others.size).toBeGreaterThan(3);
  });

  it('never rolls a skill that cannot be lent, even if the data lists one', () => {
    const polluted = structuredClone(data.lootTables);
    // Barred ids, an enemy-only innate, a personal skill nobody lent and a missing id.
    polluted.bondRings.pools.A.push('dance', 'shove', 'pull', 'lethality', 'zombie_drain');
    polluted.bondRings.pools.A.push('charisma', 'no_such_skill', 'steal', 'goddess_dance');
    const catalog = [
      ...skills,
      { id: 'steal', name: 'Steal', trigger: 'action' },
      { id: 'goddess_dance', name: 'Goddess Dance', trigger: 'action' },
    ];
    const barred = new Set([
      'dance',
      'shove',
      'pull',
      'lethality',
      'zombie_drain',
      'charisma',
      'no_such_skill',
      'steal',
      'goddess_dance',
    ]);
    const rng = mulberry32(5);
    const rolled = new Set();
    for (let i = 0; i < 3000; i++) {
      const ring = rollBondRing('act3', rng, {
        lootTables: polluted,
        accessories: data.accessories,
        skills: catalog,
      });
      rolled.add(ring._boundSkill);
    }
    for (const id of barred) expect(rolled.has(id), id).toBe(false);
    expect(rolled.has('sol')).toBe(true);
    // With no skill catalog the id list alone still bars them.
    const bare = new Set();
    for (let i = 0; i < 2000; i++)
      bare.add(
        rollBondRing('act3', rng, { lootTables: polluted, accessories: data.accessories })
          ._boundSkill,
      );
    for (const id of ['dance', 'shove', 'pull', 'lethality', 'steal', 'goddess_dance'])
      expect(bare.has(id), id).toBe(false);
  });

  it('gives nothing when there is no ring family, no table, or nothing left to roll', () => {
    expect(
      rollBondRing('act1', Math.random, { lootTables: {}, accessories: data.accessories }),
    ).toBe(null);
    expect(
      rollBondRing('act1', Math.random, { lootTables: data.lootTables, accessories: [] }),
    ).toBe(null);
    const empty = structuredClone(data.lootTables);
    empty.bondRings.pools.C = ['dance'];
    expect(rollBondRing('act1', Math.random, { ...data, lootTables: empty })).toBe(null);
  });
});

// ── Where rings come from ───────────────────────────────────────────────

describe('loot', () => {
  const only = (names, extra = {}) => {
    const tables = structuredClone(data.lootTables);
    tables.act2 = {
      ...tables.act2,
      accessories: names,
      weights: { accessory: 1, gold: 0 },
      ...extra,
    };
    return tables;
  };
  const loot = (tables, act = 'act2', boss = false) =>
    generateLootChoices(
      act,
      tables,
      data.weapons,
      data.consumables,
      1,
      0,
      data.accessories,
      data.whetstones,
      null,
      boss,
    );

  it('the loot category weights are exactly the ones the game had (the ring joined a pool, not a table)', () => {
    // Copied from data/lootTables.json on main before 3H.
    const before = {
      act1: { weapon: 20, healing: 12, statBooster: 0, promotion: 3, skillScroll: 0, weaponArtScroll: 0, legendaryWeapon: 0, accessory: 15, forge: 15, gold: 35 }, // prettier-ignore
      act2: { weapon: 20, healing: 3, statBooster: 10, promotion: 2, skillScroll: 4, weaponArtScroll: 6, legendaryWeapon: 0, accessory: 15, forge: 20, gold: 20 }, // prettier-ignore
      act3: { weapon: 25, healing: 2, statBooster: 11, promotion: 2, skillScroll: 5, weaponArtScroll: 5, legendaryWeapon: 7, accessory: 15, forge: 15, gold: 15 }, // prettier-ignore
      act4: { weapon: 15, healing: 2, statBooster: 10, promotion: 1, skillScroll: 5, weaponArtScroll: 10, legendaryWeapon: 18, accessory: 12, forge: 20, gold: 7 }, // prettier-ignore
      finalBoss: { gold: 100 },
    };
    for (const [act, weights] of Object.entries(before))
      expect(data.lootTables[act].weights, act).toEqual(weights);
    expect(data.lootTables.act1.bossRewards.weights).toEqual({ weapon: 25, healing: 0, statBooster: 25, promotion: 10, skillScroll: 0, weaponArtScroll: 0, legendaryWeapon: 0, accessory: 20, forge: 20, gold: 0 }); // prettier-ignore
  });

  it('an accessory draw that lands on the ring hands out a rolled instance with a uid', () => {
    const choices = loot(only([BOND_RING_NAME]));
    expect(choices).toHaveLength(1);
    expect(choices[0].type).toBe('accessory');
    const ring = choices[0].item;
    expect(ring.name).toBe('Bond Ring');
    expect(typeof ring.uid).toBe('string');
    expect(['C', 'B']).toContain(ring._rarity);
    expect(SPEC_POOLS[ring._rarity]).toContain(ring._boundSkill);
    expect(ring.price).toBe(PRICES[ring._rarity]);
  });

  it('the ring rolls on Math.random: a fixed stream gives a fixed ring', () => {
    const run = () => {
      let seed = 12345;
      vi.spyOn(Math, 'random').mockImplementation(() => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      });
      const ring = loot(only([BOND_RING_NAME]))[0].item;
      vi.restoreAllMocks();
      return [ring._rarity, ring._boundSkill, ring.price];
    };
    expect(run()).toEqual(run());
  });

  it('the roll adds exactly two draws, and only when the ring is the item drawn', () => {
    const draws = (names) => {
      let calls = 0;
      vi.spyOn(Math, 'random').mockImplementation(() => {
        calls += 1;
        return 0.1;
      });
      const choices = loot(only(names));
      vi.restoreAllMocks();
      return { calls, name: choices[0].item.name };
    };
    const plain = draws(['Power Ring']);
    const ring = draws([BOND_RING_NAME]);
    // category, the pick, the uid: the same for both. The ring spends two more.
    expect(plain).toEqual({ calls: 3, name: 'Power Ring' });
    expect(ring).toEqual({ calls: 5, name: 'Bond Ring' });
  });

  it('a ring that cannot be rolled (no ring tables) is skipped, never offered bare', () => {
    const tables = only([BOND_RING_NAME]);
    delete tables.bondRings;
    const choices = loot(tables);
    expect(choices.every((c) => c.type === 'gold' || c.item?.name !== BOND_RING_NAME)).toBe(true);
  });

  it('Act I boss rewards never carry a ring, over many draws', () => {
    let seed = 99;
    vi.spyOn(Math, 'random').mockImplementation(() => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    });
    let sawRingElsewhere = false;
    for (let i = 0; i < 300; i++) {
      const boss = generateLootChoices(
        'act1',
        data.lootTables,
        data.weapons,
        data.consumables,
        3,
        0,
        data.accessories,
        data.whetstones,
        null,
        true,
      );
      expect(boss.some((c) => c.item?.name === BOND_RING_NAME)).toBe(false);
      const plain = generateLootChoices(
        'act1',
        data.lootTables,
        data.weapons,
        data.consumables,
        3,
        0,
        data.accessories,
        data.whetstones,
      );
      for (const c of plain)
        if (c.item?.name === BOND_RING_NAME) {
          sawRingElsewhere = true;
          expect(c.item._rarity).toBe('C');
        }
    }
    // The ring does drop in ordinary Act I loot (rarity C), so the boss check is not vacuous.
    expect(sawRingElsewhere).toBe(true);
  });

  it('a later act’s boss loot can carry a ring of that act’s rarities', () => {
    let seed = 7;
    vi.spyOn(Math, 'random').mockImplementation(() => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    });
    const rarities = new Set();
    for (let i = 0; i < 600; i++)
      for (const c of generateLootChoices(
        'act4',
        data.lootTables,
        data.weapons,
        data.consumables,
        3,
        0,
        data.accessories,
        data.whetstones,
        null,
        true,
      ))
        if (c.item?.name === BOND_RING_NAME) rarities.add(c.item._rarity);
    expect([...rarities].sort()).toEqual(['A', 'S']);
  });
});

describe('shops', () => {
  const stock = (act, seed) => {
    let s = seed;
    vi.spyOn(Math, 'random').mockImplementation(() => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    });
    const inv = generateShopInventory(
      act,
      data.lootTables,
      data.weapons,
      data.consumables,
      data.accessories,
    );
    vi.restoreAllMocks();
    return inv;
  };

  it('an Act I shop never stocks a ring', () => {
    for (let seed = 1; seed <= 400; seed++)
      expect(stock('act1', seed).some((e) => e.item.name === BOND_RING_NAME)).toBe(false);
  });

  it('Act II and later shops stock at most one ring, and some do', () => {
    for (const act of ['act2', 'act3', 'act4', 'finalBoss']) {
      let withRing = 0;
      for (let seed = 1; seed <= 400; seed++) {
        const rings = stock(act, seed).filter((e) => e.item.name === BOND_RING_NAME);
        expect(rings.length, `${act} seed ${seed}`).toBeLessThanOrEqual(1);
        withRing += rings.length;
      }
      expect(withRing, act).toBeGreaterThan(0);
    }
  });

  it('a stocked ring is a rolled instance priced by its rarity (and sells for half of that)', () => {
    const actRarities = { act2: ['C', 'B'], act3: ['B', 'A', 'S'], act4: ['A', 'S'] };
    let seen = 0;
    for (const [act, rarities] of Object.entries(actRarities))
      for (let seed = 1; seed <= 300; seed++)
        for (const entry of stock(act, seed)) {
          if (entry.item.name !== BOND_RING_NAME) continue;
          seen += 1;
          const ring = entry.item;
          expect(rarities).toContain(ring._rarity);
          expect(SPEC_POOLS[ring._rarity]).toContain(ring._boundSkill);
          expect(typeof ring.uid).toBe('string');
          expect(entry.type).toBe('accessory');
          // The shop quotes the rarity's price at the act's markup; selling reads the item.
          expect(ring.price).toBe(PRICES[ring._rarity]);
          expect(entry.price).toBe(actShopPrice(PRICES[ring._rarity], act));
          expect(getSellPrice(ring)).toBe(Math.floor(PRICES[ring._rarity] / 2));
        }
    expect(seen).toBeGreaterThan(20);
  });
});

describe('events', () => {
  const grant = (tierOffset) => [{ type: 'item', pool: { kind: 'accessory', tierOffset } }];

  /** Play one accessory grant at `act` (0-based) on a run seeded `seed`. */
  function play(seed, { act = 0, tierOffset = 1 } = {}) {
    const run = runWithEvents([soloEvent(grant(tierOffset))], { seed });
    run.actSequence = ['act1', 'act2', 'act3', 'act4'];
    run.actIndex = act;
    const node = arriveAs(
      run,
      'solo',
      run.nodeMap.nodes.find((n) => n.row === 3 && !n.completed),
    );
    const result = chooseEventOption(run, node.id, 'go', { targetUid: null });
    expect(result.ok, result.reason).toBe(true);
    return { run, result };
  }

  /** The first seed whose grant is a Bond Ring (the pool is one name in ~15). */
  function ringSeed(options) {
    for (let seed = 1; seed < 400; seed++) {
      const { run } = play(seed, options);
      if (run.accessories[0]?.name === BOND_RING_NAME) return seed;
    }
    throw new Error('no seed gave a ring');
  }

  it('a ring from an event is rolled from the table the pool reads, seeded and never Math.random', () => {
    // The ring is a function of the run seed and the node, not of Math.random's state.
    const seed = ringSeed({ act: 0, tierOffset: 1 });
    const rolled = (r) => {
      vi.spyOn(Math, 'random').mockReturnValue(r);
      const ring = play(seed, { act: 0, tierOffset: 1 }).run.accessories[0];
      vi.restoreAllMocks();
      return [ring._rarity, ring._boundSkill, ring.price];
    };
    expect(rolled(0.05)).toEqual(rolled(0.95));
    // act1 + 1 tier reads Act II's table (C/B); act3 + 1 reads Act IV's (A/S).
    for (const [options, rarities] of [
      [{ act: 0, tierOffset: 1 }, ['C', 'B']],
      [{ act: 2, tierOffset: 1 }, ['A', 'S']],
      [{ act: 0, tierOffset: 0 }, ['C']],
    ]) {
      const seed = ringSeed(options);
      const { run, result } = play(seed, options);
      const ring = run.accessories[0];
      expect(rarities, JSON.stringify(options)).toContain(ring._rarity);
      expect(SPEC_POOLS[ring._rarity]).toContain(ring._boundSkill);
      expect(ring.price).toBe(PRICES[ring._rarity]);
      expect(typeof ring.uid).toBe('string');
      // The result line shows the display name; the record keeps the identity name.
      const record = result.results[0];
      expect(record.name).toBe('Bond Ring');
      expect(record.display).toBe(
        `Bond Ring (${ring._rarity}) · ${skills.find((s) => s.id === ring._boundSkill).name}`,
      );
      // The same seed gives the same ring.
      const again = play(seed, options).run.accessories[0];
      expect([again._rarity, again._boundSkill]).toEqual([ring._rarity, ring._boundSkill]);
    }
  });

  it('a grant that is not a ring has no display name', () => {
    for (let seed = 1; seed < 40; seed++) {
      const { run, result } = play(seed);
      if (run.accessories[0].name !== BOND_RING_NAME) {
        expect(result.results[0].display).toBeUndefined();
        return;
      }
    }
    throw new Error('every seed gave a ring');
  });
});

// ── In battle ───────────────────────────────────────────────────────────

describe('a ring’s skill applies on the battle paths while it is worn', () => {
  it('combat start: Death Blow adds 6 attack when initiating (STR +6), Wrath adds 30 crit below half HP', () => {
    const u = wearing(ringLending('death_blow'));
    const f = foe();
    expect(getSkillCombatMods(u, f, [u], [f], skills, null, true).atkBonus).toBe(6);
    expect(getSkillCombatMods(u, f, [u], [f], skills, null, false).atkBonus).toBe(0);
    const hurt = wearing(ringLending('wrath'), { currentHP: 5 });
    expect(getSkillCombatMods(hurt, f, [hurt], [f], skills, null, false).critBonus).toBe(30);
  });

  it('on-attack and on-defend: Sol heals on a strike, Pavise halves a blow, Astra triggers', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const f = foe();
    expect(rollStrikeSkills(wearing(ringLending('sol')), 9, f, skills).heal).toBe(9);
    expect(rollDefenseSkills(wearing(ringLending('pavise')), 10, true, skills).modifiedDamage).toBe(
      5,
    );
    expect(checkAstra(wearing(ringLending('astra')), skills).triggered).toBe(true);
  });

  it('aura: a ring that lends an aura reaches an ally within 2 tiles (hand-built; no pool skill is one)', () => {
    const leader = wearing({ ...ringLending('sol'), _boundSkill: 'charisma' });
    leader.col = 4;
    const near = unit({ col: 5 });
    const f = foe({ col: 6, row: 5 });
    expect(getSkillCombatMods(near, f, [leader, near], [f], skills).hitBonus).toBe(10);
  });

  it('turn start: Renewal heals 10% of max HP (3 of 30)', () => {
    const u = wearing(ringLending('renewal'), {
      currentHP: 10,
      stats: { ...unit().stats, HP: 30 },
    });
    expect(getTurnStartEffects([u], skills)).toEqual([
      expect.objectContaining({ type: 'heal', target: u, amount: 3 }),
    ]);
  });

  it('range: Foresight adds 1 to a tome; terrain: Pathfinder cuts cost by 1', () => {
    const mage = wearing(ringLending('foresight'), { weapon: { ...tome } });
    expect(getWeaponRangeBonus(mage, mage.weapon, skills)).toBe(1);
    expect(getTerrainCostReduction(wearing(ringLending('pathfinder')), skills)).toBe(1);
  });

  it('action ability: a ring-only Blink is listed; Canto is a rule', () => {
    expect(getActionAbilities(wearing(ringLending('blink')), skills).map((s) => s.id)).toEqual([
      'blink',
    ]);
    expect(cantoRuleFor(wearing(ringLending('canto')), skills)).toBe('any');
  });

  it('every pool skill is effective for the wearer, and none for a unit without the ring', () => {
    for (const id of Object.values(SPEC_POOLS).flat()) {
      expect(effectiveSkills(wearing(ringLending(id))), id).toEqual([id]);
      expect(effectiveSkills(unit()), id).toEqual([]);
    }
  });

  it('stops when the ring is taken off', () => {
    const u = wearing(ringLending('renewal'), {
      stats: { ...unit().stats, HP: 30 },
      currentHP: 10,
    });
    expect(getTurnStartEffects([u], skills)).toHaveLength(1);
    const ring = unequipAccessory(u);
    expect(boundSkillOf(ring)).toBe('renewal');
    expect(u.accessory).toBe(null);
    expect(getTurnStartEffects([u], skills)).toEqual([]);
    expect(effectiveSkills(u)).toEqual([]);
  });

  it('moves with the ring when it is traded: the giver loses it, the receiver gains it', () => {
    const giver = wearing(ringLending('wrath'), { name: 'Giver', currentHP: 5 });
    const taker = unit({ name: 'Taker', currentHP: 5 });
    const f = foe();
    const crit = (u) => getSkillCombatMods(u, f, [u], [f], skills, null, false).critBonus;
    expect(crit(giver)).toBe(30);
    expect(crit(taker)).toBe(0);
    const ring = giver.accessory;
    const ctx = { context: 'roster', run: { roster: [giver, taker] } };
    const result = applyTrade(
      ctx,
      { holder: unitHolder(giver), bag: 'accessory', item: ring },
      { holder: unitHolder(taker), bag: 'accessory', item: null },
    );
    expect(result.ok, result.reason).toBe(true);
    expect(taker.accessory).toBe(ring);
    expect(giver.accessory).toBe(null);
    expect(crit(giver)).toBe(0);
    expect(crit(taker)).toBe(30);
  });

  it('swapping rings between two units swaps the skills', () => {
    const a = wearing(ringLending('sol'), { name: 'A' });
    const b = wearing(ringLending('luna'), { name: 'B' });
    const ctx = { context: 'roster', run: { roster: [a, b] } };
    const ra = a.accessory;
    const rb = b.accessory;
    const result = applyTrade(
      ctx,
      { holder: unitHolder(a), bag: 'accessory', item: ra },
      { holder: unitHolder(b), bag: 'accessory', item: rb },
    );
    expect(result.ok, result.reason).toBe(true);
    expect(effectiveSkills(a)).toEqual(['luna']);
    expect(effectiveSkills(b)).toEqual(['sol']);
  });
});

describe('a lent skill is lent, not learned', () => {
  it('never counts toward MAX_SKILLS, is never known and never joins the list', () => {
    const full = Array.from({ length: MAX_SKILLS }, (_, i) => `skill_${i}`);
    const u = wearing(ringLending('vantage'), { skills: [...full] });
    expect(u.skills).toEqual(full);
    expect(u.skills).toHaveLength(MAX_SKILLS);
    expect(effectiveSkills(u)).toEqual([...full, 'vantage']);
    expect(knowsSkill(u, 'vantage')).toBe(false);
    expect(u.benchedSkills).toBeUndefined();
  });

  it('a scroll can still teach the skill a ring lends', () => {
    const u = wearing(ringLending('vantage'));
    expect(knowsSkill(u, 'vantage')).toBe(false);
    u.skills.push('vantage');
    expect(knowsSkill(u, 'vantage')).toBe(true);
    expect(effectiveSkills(u)).toEqual(['vantage']);
  });

  it('a unit has one accessory slot: a second ring replaces the first, so no skill stacks', () => {
    const first = ringLending('sol');
    const second = ringLending('luna');
    const u = wearing(first);
    expect(equipAccessory(u, second)).toBe(first);
    expect(u.accessory).toBe(second);
    expect(effectiveSkills(u)).toEqual(['luna']);
  });

  it('a ring and a legendary weapon lending the same skill count it once', () => {
    const u = wearing(ringLending('wrath'), {
      currentHP: 5,
      weapon: { ...sword, _grantedSkill: 'wrath' },
    });
    expect(effectiveSkills(u)).toEqual(['wrath']);
    const f = foe();
    expect(getSkillCombatMods(u, f, [u], [f], skills, null, false).critBonus).toBe(30);
  });

  it('a ring skill the unit already has counts once: the ring adds nothing', () => {
    const u = wearing(ringLending('wrath'), { skills: ['wrath'], currentHP: 5 });
    expect(effectiveSkills(u)).toEqual(['wrath']);
    expect(ringSkillAlreadyKnown(u)).toBe(true);
    const f = foe();
    expect(getSkillCombatMods(u, f, [u], [f], skills, null, false).critBonus).toBe(30);
    // The same ring on a unit without the skill is not "already known".
    expect(ringSkillAlreadyKnown(unit({ accessory: u.accessory }))).toBe(false);
    // A benched copy is not equipped, so the ring still lends it.
    const benched = wearing(ringLending('wrath'), { benchedSkills: ['wrath'] });
    expect(ringSkillAlreadyKnown(benched)).toBe(false);
    expect(effectiveSkills(benched)).toEqual(['wrath']);
  });

  it('lentSkillLine names the skill apart from the equipped list, and says when it is known', () => {
    const u = wearing(ringLending('vantage'), { skills: ['wrath'] });
    expect(lentSkillLine(u, skills)).toEqual({
      id: 'vantage',
      name: 'Vantage',
      text: skills.find((s) => s.id === 'vantage').description,
      known: false,
      label: 'Lent by ring',
    });
    const dup = wearing(ringLending('vantage'), { skills: ['vantage'] });
    expect(lentSkillLine(dup, skills)).toMatchObject({ known: true, label: 'Already known' });
    expect(lentSkillLine(unit(), skills)).toBe(null);
    expect(
      lentSkillLine(unit({ accessory: { name: 'Power Ring', type: 'Accessory' } }), skills),
    ).toBe(null);
  });
});

// ── Saves ───────────────────────────────────────────────────────────────

describe('saving', () => {
  const reload = (run) =>
    RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), run.gameData);

  it('keeps a ring’s rarity, skill, price and uid: worn, in the pool, and on a fallen unit', () => {
    const run = newRun({ seed: 41 });
    const worn = { ...ringLending('luna'), uid: 'ring-worn' };
    const pooled = { ...ringLending('astra'), uid: 'ring-pool' };
    const lost = { ...ringLending('defiant'), uid: 'ring-lost' };
    equipAccessory(run.roster[0], worn);
    run.accessories.push(pooled);
    const fallen = { ...structuredClone(run.roster[1]), name: 'Fallen', unitUid: 'fallen-1' };
    fallen.accessory = lost;
    run.fallenUnits.push(fallen);

    const back = reload(run);
    const wornBack = back.roster[0].accessory;
    expect(wornBack).toMatchObject({
      name: 'Bond Ring',
      _rarity: 'A',
      _boundSkill: 'luna',
      price: 2500,
      uid: 'ring-worn',
    });
    expect(effectiveSkills(back.roster[0])).toContain('luna');
    expect(back.accessories).toEqual([
      expect.objectContaining({
        _rarity: 'S',
        _boundSkill: 'astra',
        price: 4000,
        uid: 'ring-pool',
      }),
    ]);
    const lostBack = back.fallenUnits.find((u) => u.name === 'Fallen').accessory;
    expect(lostBack).toMatchObject({ _rarity: 'B', _boundSkill: 'defiant', price: 1500 });
  });

  it('a second save and load changes nothing', () => {
    const run = newRun({ seed: 42 });
    equipAccessory(run.roster[0], ringLending('guard'));
    const once = reload(run);
    const twice = reload(once);
    expect(twice.roster[0].accessory).toEqual(once.roster[0].accessory);
  });

  it('a ring a unit wears is lent in a rebuilt run, and the catalog ring is not changed by it', () => {
    const run = newRun({ seed: 43 });
    equipAccessory(run.roster[0], ringLending('pathfinder'));
    const back = reload(run);
    expect(getTerrainCostReduction(back.roster[0], skills)).toBe(1);
    expect(
      back.gameData.accessories.find((a) => a.name === 'Bond Ring')._boundSkill,
    ).toBeUndefined();
  });
});

// ── Names ───────────────────────────────────────────────────────────────

describe('names', () => {
  it('a ring shows "Bond Ring (B) · Vantage" and keeps the identity name "Bond Ring"', () => {
    const ring = ringLending('vantage');
    expect(ring.name).toBe('Bond Ring');
    expect(bondRingDisplayName(ring, skills)).toBe('Bond Ring (B) · Vantage');
    expect(itemDisplayName(ring, skills)).toBe('Bond Ring (B) · Vantage');
    expect(itemDisplayName(ringLending('death_blow'), skills)).toBe('Bond Ring (C) · Death Blow');
    expect(itemDisplayName(ringLending('lifetaker'), skills)).toBe('Bond Ring (A) · Lifetaker');
    expect(itemDisplayName(ringLending('miracle'), skills)).toBe('Bond Ring (S) · Miracle');
  });

  it('without the skill catalog the id is set in words', () => {
    expect(itemDisplayName(ringLending('uncanny_blow'))).toBe('Bond Ring (C) · Uncanny Blow');
  });

  it('the family entry, a ring with no skill and other items show their own name', () => {
    expect(
      itemDisplayName(
        data.accessories.find((a) => a.name === 'Bond Ring'),
        skills,
      ),
    ).toBe('Bond Ring');
    expect(itemDisplayName({ name: 'Power Ring', type: 'Accessory' }, skills)).toBe('Power Ring');
    expect(itemDisplayName({ name: 'Iron Sword +2', type: 'Sword' }, skills)).toBe('Iron Sword +2');
    expect(itemDisplayName(null)).toBe('');
    // A Sword that happens to be named like the ring is not a ring.
    expect(isBondRing({ name: 'Bond Ring', type: 'Sword' })).toBe(false);
  });

  it('the display name is never an identity: lookups read the base name', () => {
    const ring = ringLending('wrath');
    // Icons, weapon-art and migration lookups key on item.name, which a roll never changes.
    const has = (id) => id in iconManifest.icons;
    expect(resolveItemIconId(ring, has)).toBe('bond-ring');
    expect(has('bond-ring')).toBe(true);
    expect(stripItemNameSuffix(ring.name)).toBe('Bond Ring');
    // The display name would not survive a suffix strip as identity (it is for display only).
    expect(stripItemNameSuffix(bondRingDisplayName(ring, skills))).not.toBe('Bond Ring');
    expect(ring.name).toBe(data.accessories.find((a) => a.name === 'Bond Ring').name);
  });

  it('the card text says the rank, the skill and what it does', () => {
    const ring = ringLending('vantage');
    const description = skills.find((s) => s.id === 'vantage').description;
    expect(bondRingText(ring, skills)).toBe(`Rank B · lends Vantage: ${description}`);
    expect(formatAccessoryDetail(ring, { skills })).toBe(`Rank B · lends Vantage: ${description}`);
    expect(formatAccessoryDetail(ring)).toBe('Rank B · lends Vantage');
    expect(formatAccessoryDetail(data.accessories.find((a) => a.name === 'Bond Ring'))).toBe(
      'Lends a skill, rolled when the ring is found',
    );
    expect(bondRingText({ name: 'Power Ring', type: 'Accessory' }, skills)).toBe('');
  });
});
