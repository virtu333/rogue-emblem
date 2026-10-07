// Accessories that can roll a bound skill (docs/specs/phase3.md 3H, as the owner reshaped it:
// any ordinary accessory made by loot, a shop or an event grant may, rarely, carry a skill).
//
// Ways this goes wrong, each caught below:
//   data       a pool names a skill that does not exist, is personal or a class innate by
//              accident, belongs to an enemy-only class, or is one that can never be lent
//              (Dance, Shove, Pull, Lethality, Steal, Goddess Dance); a legendary left unmarked;
//              dead data from the abandoned Bond Ring family
//   roll       a chance that ignores the act; a skill outside the act's pool; a legendary, a
//              weapon or an already-bound item that rolls; a price that is not +50%; a roll
//              that spends the creating stream's draws; an excluded skill that can roll
//   sources    a starting, meta-granted or blessing-granted accessory that rolls; Act I boss
//              rewards that roll; a loot, shop or event result that moves for any reason other
//              than the skill
//   use        a lent skill dead on a battle path; one that stays after the accessory is taken
//              off or traded; one that counts toward MAX_SKILLS or is "known"; one counted twice;
//              a per-battle limit that follows the item instead of the unit
//   saves      the skill or the price lost across a save
//   display    the identity name changed (icons, lookups); a display name off the grammar
// Expected numbers are worked out by hand from the data and the skill descriptions, never by
// re-running the code under test.
import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  accessoryDisplayName,
  accessorySkillAlreadyKnown,
  accessorySkillPool,
  accessorySkillRng,
  accessorySkillText,
  bindAccessorySkill,
  canRollAccessorySkill,
  lentSkillLine,
  validateAccessorySkillData,
} from '../src/engine/AccessorySkills.js';
import { boundSkillOf, effectiveSkills } from '../src/engine/EffectiveSkills.js';
import {
  generateLootChoices,
  generateShopInventory,
  getSellPrice,
} from '../src/engine/LootSystem.js';
import { actShopPrice } from '../src/engine/ShopEconomy.js';
import {
  equipAccessory,
  grantRecruitStartingAccessory,
  knowsSkill,
  unequipAccessory,
} from '../src/engine/UnitManager.js';
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
import { canUseAbility, getActionAbilities, markUsed } from '../src/engine/ActionAbilitySystem.js';
import { cantoRuleFor } from '../src/engine/CantoRule.js';
import { RunManager } from '../src/engine/RunManager.js';
import { chooseEventOption } from '../src/engine/EventCommands.js';
import { MAX_SKILLS } from '../src/utils/constants.js';
import { itemDisplayName, stripItemNameSuffix } from '../src/utils/itemNames.js';
import { formatAccessoryDetail } from '../src/utils/accessoryText.js';
import { resolveItemIconId } from '../src/ui/itemIconIds.js';
import { arriveAs, newRun, runWithEvents, soloEvent } from './eventKit.js';
import { loadGameData } from './testData.js';

const iconManifest = JSON.parse(
  readFileSync(new URL('../src/ui/itemIconManifest.json', import.meta.url), 'utf8'),
);
const data = loadGameData();
const skills = data.skills;
const config = data.lootTables.accessorySkills;

// The pools by act as the owner set them (written out here on purpose): Acts I and II the
// old C and B skills, Act III B and A, Act IV A and S. Pass is not listed: it arrives with
// Phase 3E.
const C = [
  'uncanny_blow',
  'warding_blow',
  'armored_blow',
  'darting_blow',
  'death_blow',
  'pathfinder',
];
const B = ['vantage', 'wrath', 'defiant', 'guard', 'skirmisher', 'foresight', 'canto'];
const A = ['luna', 'sol', 'lifetaker', 'speedtaker', 'pavise', 'aegis', 'renewal'];
const S = ['astra', 'aether', 'miracle', 'blink'];
const POOLS = { act1: [...C, ...B], act2: [...C, ...B], act3: [...B, ...A], act4: [...A, ...S] };
const CHANCES = { act1: 0.03, act2: 0.05, act3: 0.06, act4: 0.08 };
const LEGENDARY = ["Mentor's Band", 'Mercury Sandals', 'Phalanx Band', 'Pursuit Ring'];
const NEVER = ['dance', 'shove', 'pull', 'lethality', 'steal', 'goddess_dance'];

const catalog = (name) => structuredClone(data.accessories.find((a) => a.name === name));

/** A throwaway stream, so nothing here touches Math.random. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** An accessory instance with a uid whose suffix is `n` (the keyed stream's input). */
const accessoryWithUid = (name, n) => ({ ...catalog(name), uid: `itm_1_${n.toString(36)}` });

/**
 * A real accessory instance lending `skillId`, made by the real binder: the first draw is 0
 * (under any chance), the second lands on the skill's place in the pool of an act that holds it.
 */
function accessoryLending(skillId, name = 'Power Ring') {
  const act = ['act1', 'act3', 'act4'].find((a) => POOLS[a].includes(skillId));
  const pool = POOLS[act];
  const draws = [0, (pool.indexOf(skillId) + 0.5) / pool.length];
  const item = bindAccessorySkill(catalog(name), act, data, () => draws.shift());
  expect(boundSkillOf(item), skillId).toBe(skillId);
  return item;
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

/** A unit wearing `accessory` the way a roster does (through equipAccessory). */
function wearing(accessory, overrides = {}) {
  const u = unit(overrides);
  equipAccessory(u, accessory);
  return u;
}

const foe = (over = {}) => unit({ faction: 'enemy', col: 5, ...over });

/** The data with the accessory-skill block set to a chance of 1 in every act. */
function alwaysData() {
  const tables = structuredClone(data.lootTables);
  for (const act of Object.keys(CHANCES)) tables.accessorySkills.chanceByAct[act] = 1;
  return { ...data, lootTables: tables };
}

/** The data with the block removed: what the game produced before this feature. */
function plainData() {
  const tables = structuredClone(data.lootTables);
  delete tables.accessorySkills;
  return { ...data, lootTables: tables };
}

// Sweeps over thousands of seeds are slow on a busy machine, never flaky.
vi.setConfig({ testTimeout: 120000 });

const ALWAYS = alwaysData();
const PLAIN = plainData();

afterEach(() => vi.restoreAllMocks());

// ── Data ────────────────────────────────────────────────────────────────

describe('the data', () => {
  it('has the owner’s chances and pools by act', () => {
    expect(config.chanceByAct).toEqual(CHANCES);
    for (const [act, pool] of Object.entries(POOLS))
      expect([...config.poolByAct[act]].sort(), act).toEqual([...pool].sort());
    expect(config.priceMultiplier).toBe(1.5);
  });

  it('passes the validator', () => {
    expect(validateAccessorySkillData(data)).toEqual([]);
  });

  it('no pool holds a skill that can never be lent', () => {
    const pooled = new Set(Object.values(config.poolByAct).flat());
    for (const id of NEVER) {
      expect(pooled.has(id), id).toBe(false);
      expect(config.neverBound, id).toContain(id);
    }
  });

  it('every pool skill exists, is no lord’s personal skill and is no enemy-only innate', () => {
    const lordPersonal = new Set(
      data.lords.map((l) =>
        l.personalSkill.split(':')[0].trim().toLowerCase().replace(/\s+/g, '_'),
      ),
    );
    const enemyOnly = new Set(['Zombie', 'Revenant', 'Dragon', 'Dragon Lord']);
    for (const id of Object.values(config.poolByAct).flat()) {
      const skill = skills.find((s) => s.id === id);
      expect(skill, id).toBeTruthy();
      // Kira's Foresight is the one lord skill a pool lends by name.
      if (id !== 'foresight') expect(lordPersonal.has(id), `${id} is a lord's skill`).toBe(false);
      const innate = [skill.classInnate].flat().filter(Boolean);
      expect(innate.length > 0 && innate.every((c) => enemyOnly.has(c)), id).toBe(false);
    }
  });

  it('every personal or class-innate pool skill is one lentInnates names, and nothing else is', () => {
    const innateInPools = new Set(
      Object.values(config.poolByAct)
        .flat()
        .filter((id) => {
          const s = skills.find((x) => x.id === id);
          return s.personal === true || s.classInnate;
        }),
    );
    expect([...innateInPools].sort()).toEqual([...config.lentInnates].sort());
  });

  it('the four legendary accessories are marked, and only they', () => {
    expect(
      data.accessories
        .filter((a) => a.legendary)
        .map((a) => a.name)
        .sort(),
    ).toEqual([...LEGENDARY].sort());
  });

  it('leaves nothing of the abandoned Bond Ring family behind', () => {
    expect(data.accessories.some((a) => /bond/i.test(a.name))).toBe(false);
    expect(data.lootTables.bondRings).toBeUndefined();
    for (const act of ['act1', 'act2', 'act3', 'act4', 'finalBoss']) {
      const table = data.lootTables[act];
      for (const list of [table.accessories, table.bossRewards?.accessories])
        expect((list || []).some((n) => /bond/i.test(n))).toBe(false);
    }
    expect(JSON.stringify(data.lootTables)).not.toMatch(/rarity/i);
    expect('bond-ring' in iconManifest.icons).toBe(false);
    // The catalog is a catalog: no accessory carries an instance field.
    for (const a of data.accessories) {
      expect(a._boundSkill, a.name).toBeUndefined();
      expect(a._rarity, a.name).toBeUndefined();
    }
  });

  describe('the validator catches each way the data can be wrong', () => {
    const broken = (mutate, extraSkills = []) => {
      const d = structuredClone(data);
      mutate(d.lootTables.accessorySkills, d);
      return validateAccessorySkillData({ ...d, skills: [...d.skills, ...extraSkills] }).join('\n');
    };

    it('an unknown skill', () => {
      expect(broken((c) => c.poolByAct.act1.push('no_such_skill'))).toMatch(/unknown skill/);
    });

    it('a skill that can never be lent', () => {
      for (const id of ['dance', 'shove', 'pull', 'lethality'])
        expect(
          broken((c) => c.poolByAct.act3.push(id)),
          id,
        ).toMatch(/can never be lent/);
    });

    it('Steal and Goddess Dance are barred before they exist, and once they do', () => {
      const steal = { id: 'steal', name: 'Steal', trigger: 'action' };
      const dance = { id: 'goddess_dance', name: 'Goddess Dance', trigger: 'action' };
      expect(broken((c) => c.poolByAct.act4.push('steal'))).toMatch(/unknown skill "steal"/);
      expect(broken((c) => c.poolByAct.act4.push('steal'), [steal])).toMatch(/never be lent/);
      expect(broken((c) => c.poolByAct.act4.push('goddess_dance'), [dance])).toMatch(
        /never be lent/,
      );
    });

    it('an enemy-only skill', () => {
      expect(broken((c) => c.poolByAct.act3.push('zombie_drain'))).toMatch(/enemy-only/);
      expect(broken((c) => c.poolByAct.act3.push('dragon_scale'))).toMatch(/enemy-only/);
    });

    it('a personal skill, or a class innate, no one named a loan', () => {
      expect(broken((c) => c.poolByAct.act2.push('charisma'))).toMatch(/not in lentInnates/);
      expect(broken((c) => c.poolByAct.act2.push('sure_shot'))).toMatch(/not in lentInnates/);
      expect(broken((c) => c.lentInnates.splice(c.lentInnates.indexOf('canto'), 1))).toMatch(
        /"canto" that is not in lentInnates/,
      );
    });

    it('a lentInnates entry that is no innate, is barred, or no pool uses', () => {
      expect(broken((c) => c.lentInnates.push('sol'))).toMatch(/neither personal nor/);
      expect(broken((c) => c.lentInnates.push('lethality'))).toMatch(/lethality/);
      expect(broken((c) => c.lentInnates.push('sure_shot'))).toMatch(/no pool uses/);
    });

    it('a repeated skill, an empty pool, a chance out of range, a price that cuts', () => {
      expect(broken((c) => c.poolByAct.act2.push('sol', 'sol'))).toMatch(/lists a skill twice/);
      expect(broken((c) => (c.poolByAct.act4 = []))).toMatch(/act4 must be a non-empty/);
      expect(broken((c) => (c.chanceByAct.act1 = 1.5))).toMatch(/chanceByAct.act1/);
      expect(broken((c) => (c.priceMultiplier = 0.5))).toMatch(/priceMultiplier/);
    });

    it('a legendary accessory left unmarked, and an instance field on the catalog', () => {
      expect(
        broken((c, d) => delete d.accessories.find((a) => a.name === 'Mercury Sandals').legendary),
      ).toMatch(/Mercury Sandals must be marked legendary/);
      expect(
        broken((c, d) => (d.accessories.find((a) => a.name === 'Power Ring')._boundSkill = 'sol')),
      ).toMatch(/must not carry an instance field/);
    });
  });
});

// ── The roll ────────────────────────────────────────────────────────────

describe('bindAccessorySkill', () => {
  /** How often a Power Ring binds in an act, over `n` distinct keyed streams. */
  function rate(act, n = 30000) {
    let bound = 0;
    for (let i = 0; i < n; i++)
      if (bindAccessorySkill(accessoryWithUid('Power Ring', i * 7919), act, data)._boundSkill)
        bound += 1;
    return bound / n;
  }

  it('binds at the act’s chance: 3%, 5%, 6%, 8%', () => {
    for (const [act, chance] of Object.entries(CHANCES)) {
      const got = rate(act);
      expect(got, act).toBeGreaterThan(chance - 0.008);
      expect(got, act).toBeLessThan(chance + 0.008);
    }
  });

  it('acts after IV roll as Act IV; an unknown act as Act I', () => {
    for (const act of ['postAct', 'finalBoss']) expect(rate(act, 20000)).toBeGreaterThan(0.06);
    expect(rate('nowhere', 20000)).toBeLessThan(0.05);
  });

  it('the skill comes from the act’s pool, and every pool skill comes up', () => {
    for (const [act, pool] of Object.entries(POOLS)) {
      const seen = new Set();
      for (let i = 0; i < 4000; i++) {
        const item = bindAccessorySkill(accessoryWithUid('Speed Ring', i + 1), act, ALWAYS);
        expect(pool, act).toContain(item._boundSkill);
        seen.add(item._boundSkill);
      }
      expect([...seen].sort(), act).toEqual([...pool].sort());
    }
  });

  it('Act III never binds a C skill; Act IV never a B or C skill; Act I never an A or S skill', () => {
    const seen = (act) =>
      new Set(
        Array.from(
          { length: 3000 },
          (_, i) =>
            bindAccessorySkill(accessoryWithUid('Skill Ring', i + 1), act, ALWAYS)._boundSkill,
        ),
      );
    for (const id of C) expect(seen('act3').has(id), id).toBe(false);
    for (const id of [...B, ...C]) expect(seen('act4').has(id), id).toBe(false);
    for (const id of [...A, ...S]) expect(seen('act1').has(id), id).toBe(false);
  });

  it('never binds a legendary accessory, a weapon, or an item that already carries a skill', () => {
    const always = alwaysData();
    for (const name of LEGENDARY) {
      const item = bindAccessorySkill(
        { ...catalog(name), uid: 'itm_1_aaaa' },
        'act4',
        always,
        () => 0,
      );
      expect(item._boundSkill, name).toBeUndefined();
      expect(canRollAccessorySkill(item), name).toBe(false);
    }
    const weapon = bindAccessorySkill({ ...sword, uid: 'itm_1_aaaa' }, 'act4', always, () => 0);
    expect(weapon._boundSkill).toBeUndefined();
    const bound = { ...catalog('Power Ring'), _boundSkill: 'sol', price: 2250 };
    expect(bindAccessorySkill(bound, 'act4', always, () => 0)).toMatchObject({
      _boundSkill: 'sol',
      price: 2250,
    });
    expect(canRollAccessorySkill(null)).toBe(false);
  });

  it('spends one draw to decide and a second only to pick; an ineligible item spends none', () => {
    let calls = 0;
    const count = (value) => () => {
      calls += 1;
      return value;
    };
    bindAccessorySkill(catalog('Power Ring'), 'act2', data, count(0.99));
    expect(calls).toBe(1);
    calls = 0;
    const item = bindAccessorySkill(catalog('Power Ring'), 'act2', data, count(0));
    expect(calls).toBe(2);
    // 0 under the chance, then pool index floor(0 * 13) = 0: the Act II pool's first skill.
    expect(item._boundSkill).toBe('uncanny_blow');
    calls = 0;
    bindAccessorySkill(catalog("Mentor's Band"), 'act2', data, count(0));
    expect(calls).toBe(0);
  });

  it('raises the price by 50%, once: 1500 to 2250, 2000 to 3000, 1000 to 1500', () => {
    for (const [name, base, after] of [
      ['Power Ring', 1500, 2250],
      ['Speed Ring', 2000, 3000],
      ['Goddess Icon', 1000, 1500],
    ]) {
      const item = catalog(name);
      expect(item.price, name).toBe(base);
      bindAccessorySkill(item, 'act3', data, () => 0);
      expect(item.price, name).toBe(after);
      bindAccessorySkill(item, 'act3', data, () => 0);
      expect(item.price, name).toBe(after);
      expect(getSellPrice(item), name).toBe(Math.floor(after / 2));
    }
    // An item that is not unlocked at a price stays unpriced.
    const free = { ...catalog('Power Ring'), price: 0 };
    bindAccessorySkill(free, 'act3', data, () => 0);
    expect(free.price).toBe(0);
  });

  it('the catalog entry is never touched, and a roll never uses Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    const before = structuredClone(data.accessories);
    bindAccessorySkill({ ...catalog('Power Ring'), uid: 'itm_3_x1y2' }, 'act4', alwaysData());
    expect(spy).not.toHaveBeenCalled();
    expect(data.accessories).toEqual(before);
  });

  it('the keyed stream is a function of the uid suffix, name and act, not the uid counter', () => {
    const a = accessorySkillRng({ name: 'Power Ring', uid: 'itm_1_q9z8' }, 'act2');
    const b = accessorySkillRng({ name: 'Power Ring', uid: 'itm_88_q9z8' }, 'act2');
    const c = accessorySkillRng({ name: 'Power Ring', uid: 'itm_1_q9z9' }, 'act2');
    const d = accessorySkillRng({ name: 'Speed Ring', uid: 'itm_1_q9z8' }, 'act2');
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect([c(), c(), c()]).not.toEqual(first);
    expect([d(), d(), d()]).not.toEqual(first);
  });

  it('never binds a skill that cannot be lent, even if the data lists one', () => {
    const polluted = alwaysData();
    const block = polluted.lootTables.accessorySkills;
    block.poolByAct.act3.push('dance', 'shove', 'pull', 'lethality', 'zombie_drain', 'charisma');
    block.poolByAct.act3.push('no_such_skill', 'steal', 'goddess_dance');
    const withCatalog = {
      ...polluted,
      skills: [
        ...skills,
        { id: 'steal', name: 'Steal', trigger: 'action' },
        { id: 'goddess_dance', name: 'Goddess Dance', trigger: 'action' },
      ],
    };
    const barred = [...NEVER, 'zombie_drain', 'charisma', 'no_such_skill'];
    for (const source of [withCatalog, { lootTables: polluted.lootTables }]) {
      const rolled = new Set();
      for (let i = 0; i < 2500; i++)
        rolled.add(
          bindAccessorySkill(accessoryWithUid('Magic Ring', i + 1), 'act3', source)._boundSkill,
        );
      for (const id of NEVER) expect(rolled.has(id), id).toBe(false);
      // Only the catalog can tell an enemy-only or personal skill from a plain one.
      if (source === withCatalog) for (const id of barred) expect(rolled.has(id), id).toBe(false);
      expect(rolled.has('sol')).toBe(true);
    }
    expect(accessorySkillPool(block, 'act3', skills)).not.toContain('charisma');
  });

  it('does nothing when there is no config, or nothing left to bind', () => {
    const item = bindAccessorySkill(catalog('Power Ring'), 'act4', { lootTables: {} }, () => 0);
    expect(item._boundSkill).toBeUndefined();
    const emptied = alwaysData();
    emptied.lootTables.accessorySkills.poolByAct.act4 = ['dance'];
    expect(bindAccessorySkill(catalog('Power Ring'), 'act4', emptied, () => 0)._boundSkill).toBe(
      undefined,
    );
  });
});

// ── Where accessories come from ─────────────────────────────────────────

/** Run `fn` with Math.random replaced by a seeded stream; returns the result and the call count. */
function withSeed(seed, fn) {
  const next = lcg(seed);
  let calls = 0;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    calls += 1;
    return next();
  });
  try {
    return { value: fn(), calls };
  } finally {
    vi.restoreAllMocks();
  }
}

/** What an accessory is without its skill: the skill and the price raised for it removed. */
function plainOf(item, base) {
  if (item?.type !== 'Accessory' || !item._boundSkill) return item;
  const { _boundSkill, ...rest } = item;
  return { ...rest, price: base.get(item.name) };
}

/** A uid's random part: the leading counter is process state and differs between two runs. */
const suffix = (uid) => (typeof uid === 'string' ? uid.slice(uid.lastIndexOf('_') + 1) : uid);

const basePrices = new Map(data.accessories.map((a) => [a.name, a.price]));

describe('loot', () => {
  const loot = (source, act, { boss = false, count = 3 } = {}) =>
    generateLootChoices(
      act,
      source.lootTables,
      data.weapons,
      data.consumables,
      count,
      0,
      data.accessories,
      data.whetstones,
      null,
      boss,
    );

  it('the category weights are exactly the ones the game had', () => {
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
  });

  it('for a fixed seed every loot result is what it was, apart from the skill and its price', () => {
    let skilled = 0;
    for (const act of ['act1', 'act2', 'act3', 'act4'])
      for (const boss of [false, true])
        for (let seed = 1; seed <= 250; seed++) {
          const withSkills = withSeed(seed, () => loot(ALWAYS, act, { boss }));
          const without = withSeed(seed, () => loot(PLAIN, act, { boss }));
          // The same number of draws from the creating stream: nothing downstream moves.
          expect(withSkills.calls, `${act} boss=${boss} seed ${seed}`).toBe(without.calls);
          const strip = (choices) =>
            JSON.parse(
              JSON.stringify(choices, (key, value) => (key === 'uid' ? undefined : value)),
            );
          const expected = strip(without.value);
          const got = strip(
            withSkills.value.map((c) => ({ ...c, item: plainOf(c.item, basePrices) })),
          );
          expect(got, `${act} boss=${boss} seed ${seed}`).toEqual(expected);
          // The uids are the same too (they come from the same draws).
          expect(withSkills.value.map((c) => suffix(c.item?.uid))).toEqual(
            without.value.map((c) => suffix(c.item?.uid)),
          );
          skilled += withSkills.value.filter((c) => c.item?._boundSkill).length;
        }
    // With the chance at 1 an accessory always binds, so the comparison is not vacuous.
    expect(skilled).toBeGreaterThan(100);
  });

  it('a loot accessory binds at about the act’s chance, from the act’s pool, with a +50% price', () => {
    for (const act of ['act2', 'act4']) {
      let accessories = 0;
      let bound = 0;
      for (let seed = 1; seed <= 1500; seed++) {
        const { value } = withSeed(seed, () => loot(data, act, { count: 3 }));
        for (const c of value) {
          if (c.type !== 'accessory') continue;
          accessories += 1;
          if (!c.item._boundSkill) {
            expect(c.item.price).toBe(basePrices.get(c.item.name));
            continue;
          }
          bound += 1;
          expect(POOLS[act]).toContain(c.item._boundSkill);
          expect(c.item.price).toBe(Math.round(basePrices.get(c.item.name) * 1.5));
          expect(c.item.legendary).not.toBe(true);
        }
      }
      expect(accessories, act).toBeGreaterThan(400);
      expect(bound / accessories, act).toBeGreaterThan(CHANCES[act] - 0.03);
      expect(bound / accessories, act).toBeLessThan(CHANCES[act] + 0.04);
    }
  });

  it('a legendary accessory in loot never binds, even at a chance of 1', () => {
    const always = alwaysData();
    always.lootTables.act3 = {
      ...always.lootTables.act3,
      accessories: [...LEGENDARY],
      weights: { accessory: 1, gold: 0 },
    };
    for (let seed = 1; seed <= 60; seed++) {
      const { value } = withSeed(seed, () => loot(always, 'act3', { count: 2 }));
      for (const c of value) {
        if (c.type !== 'accessory') continue;
        expect(LEGENDARY).toContain(c.item.name);
        expect(c.item._boundSkill, c.item.name).toBeUndefined();
        expect(c.item.price).toBe(basePrices.get(c.item.name));
      }
    }
  });

  it('Act I boss rewards never bind; Act II’s boss loot, and ordinary Act I loot, can', () => {
    const always = alwaysData();
    let ordinaryAct1 = 0;
    let actTwoBoss = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const boss1 = withSeed(seed, () => loot(always, 'act1', { boss: true })).value;
      for (const c of boss1) expect(c.item?._boundSkill, `seed ${seed}`).toBeUndefined();
      const plain1 = withSeed(seed, () => loot(always, 'act1')).value;
      ordinaryAct1 += plain1.filter((c) => c.item?._boundSkill).length;
      const boss2 = withSeed(seed, () => loot(always, 'act2', { boss: true })).value;
      actTwoBoss += boss2.filter((c) => c.item?._boundSkill).length;
    }
    expect(ordinaryAct1).toBeGreaterThan(20);
    expect(actTwoBoss).toBeGreaterThan(20);
  });
});

describe('shops', () => {
  const stock = (source, act, seed) =>
    withSeed(seed, () =>
      generateShopInventory(
        act,
        source.lootTables,
        data.weapons,
        data.consumables,
        data.accessories,
      ),
    );

  it('for a fixed seed every shop result is what it was, apart from the skill and its price', () => {
    let skilled = 0;
    for (const act of ['act1', 'act2', 'act3', 'act4', 'finalBoss'])
      for (let seed = 1; seed <= 250; seed++) {
        const a = stock(ALWAYS, act, seed);
        const b = stock(PLAIN, act, seed);
        expect(a.calls, `${act} seed ${seed}`).toBe(b.calls);
        expect(a.value.length).toBe(b.value.length);
        a.value.forEach((entry, i) => {
          const was = b.value[i];
          expect(entry.type).toBe(was.type);
          expect(suffix(entry.item.uid)).toBe(suffix(was.item.uid));
          expect({ ...plainOf(entry.item, basePrices), uid: 0 }).toEqual({ ...was.item, uid: 0 });
          if (entry.item._boundSkill) {
            skilled += 1;
            // The quote is the raised price at the act's markup.
            expect(entry.price).toBe(actShopPrice(entry.item.price, act));
            expect(entry.item.price).toBe(Math.round(was.item.price * 1.5));
          } else expect(entry.price).toBe(was.price);
        });
      }
    expect(skilled).toBeGreaterThan(100);
  });

  it('a stocked accessory binds at about the act’s chance, and sells for the raised price’s half', () => {
    let accessories = 0;
    let bound = 0;
    for (let seed = 1; seed <= 1500; seed++)
      for (const entry of stock(data, 'act3', seed).value) {
        if (entry.type !== 'accessory') continue;
        accessories += 1;
        if (!entry.item._boundSkill) continue;
        bound += 1;
        expect(POOLS.act3).toContain(entry.item._boundSkill);
        expect(getSellPrice(entry.item)).toBe(
          Math.floor(Math.round(basePrices.get(entry.item.name) * 1.5) / 2),
        );
        expect(entry.item.legendary).not.toBe(true);
      }
    expect(accessories).toBeGreaterThan(500);
    expect(bound / accessories).toBeGreaterThan(CHANCES.act3 - 0.03);
    expect(bound / accessories).toBeLessThan(CHANCES.act3 + 0.04);
  });

  it('a legendary in stock never binds, even at a chance of 1; Act I stock can bind others', () => {
    let legendarySeen = 0;
    let actOneBound = 0;
    for (const act of ['act2', 'act3', 'act4'])
      for (let seed = 1; seed <= 200; seed++)
        for (const entry of stock(ALWAYS, act, seed).value) {
          if (LEGENDARY.includes(entry.item.name)) {
            legendarySeen += 1;
            expect(entry.item._boundSkill, entry.item.name).toBeUndefined();
          }
        }
    for (let seed = 1; seed <= 100; seed++)
      actOneBound += stock(ALWAYS, 'act1', seed).value.filter((e) => e.item._boundSkill).length;
    expect(legendarySeen).toBeGreaterThan(0);
    expect(actOneBound).toBeGreaterThan(0);
  });
});

describe('events', () => {
  const grant = (tierOffset) => [{ type: 'item', pool: { kind: 'accessory', tierOffset } }];

  /** Play one accessory grant at `act` (0-based) on a run seeded `seed`. */
  function play(seed, { act = 0, tierOffset = 1, source = data } = {}) {
    const run = runWithEvents([soloEvent(grant(tierOffset))], { seed });
    run.gameData = { ...run.gameData, lootTables: source.lootTables };
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

  it('for a fixed seed an event grants the accessory it always did, apart from the skill', () => {
    let skilled = 0;
    for (const [act, tierOffset] of [
      [0, 1],
      [1, 1],
      [2, 1],
      [0, 0],
    ])
      for (let seed = 1; seed <= 60; seed++) {
        const a = play(seed, { act, tierOffset, source: ALWAYS });
        const b = play(seed, { act, tierOffset, source: PLAIN });
        const got = a.run.accessories[0];
        const was = b.run.accessories[0];
        expect(got.name, `act${act + 1}+${tierOffset} seed ${seed}`).toBe(was.name);
        const strip = (item) => ({ ...item, uid: undefined });
        const base = data.accessories.find((x) => x.name === was.name);
        if (base.legendary) expect(strip(got)).toEqual(strip(was));
        else {
          skilled += 1;
          expect(boundSkillOf(got)).toBeTruthy();
          expect(strip(plainOf(got, basePrices))).toEqual(strip(was));
        }
        expect(a.result.results[0].name).toBe(b.result.results[0].name);
      }
    expect(skilled).toBeGreaterThan(100);
  });

  it('the skill is seeded (one seed, one skill) and comes from the pool the grant reads', () => {
    // act1 + 1 tier reads Act II's table (and pool); act3 + 1 reads Act IV's.
    for (const [options, pool] of [
      [{ act: 0, tierOffset: 1 }, POOLS.act2],
      [{ act: 2, tierOffset: 1 }, POOLS.act4],
      [{ act: 0, tierOffset: 0 }, POOLS.act1],
    ])
      for (let seed = 1; seed <= 40; seed++) {
        const first = play(seed, { ...options, source: ALWAYS }).run.accessories[0];
        const again = play(seed, { ...options, source: ALWAYS }).run.accessories[0];
        expect(again._boundSkill).toBe(first._boundSkill);
        if (first.legendary) continue;
        expect(pool, JSON.stringify(options)).toContain(first._boundSkill);
        expect(first.price).toBe(Math.round(basePrices.get(first.name) * 1.5));
      }
  });

  it('the roll is not Math.random’s: the same seed gives the same skill whatever it holds', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const at = (r) => {
        vi.spyOn(Math, 'random').mockReturnValue(r);
        const item = play(seed, { act: 2, tierOffset: 1, source: ALWAYS }).run.accessories[0];
        vi.restoreAllMocks();
        return [item.name, item._boundSkill];
      };
      expect(at(0.05)).toEqual(at(0.95));
    }
  });

  it('the result line shows the display name and keeps the identity name', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { run, result } = play(seed, { source: ALWAYS });
      const item = run.accessories[0];
      if (!item._boundSkill) continue;
      const record = result.results[0];
      expect(record.name).toBe(item.name);
      expect(record.display).toBe(
        `${item.name} · ${skills.find((s) => s.id === item._boundSkill).name}`,
      );
      return;
    }
    throw new Error('no seed gave a skilled accessory');
  });

  it('a plain grant has no display name', () => {
    const { result } = play(3, { source: PLAIN });
    expect(result.results[0].display).toBeUndefined();
  });
});

describe('sources that never roll', () => {
  it('a commander’s starting accessory and a recruit’s starting accessory never carry a skill', () => {
    const always = alwaysData();
    // Meta effect: the commander starts with the tier-2 accessory.
    const run = new RunManager({ ...always }, { startingAccessoryTier: 2 });
    run.startRun({ runSeed: 5, difficultyId: 'normal', applyBlessingsAtStart: false });
    const worn = run.roster.map((u) => u.accessory).filter(Boolean);
    expect(worn.length).toBeGreaterThan(0);
    for (const item of worn) {
      expect(boundSkillOf(item), item.name).toBeNull();
      expect(item.price).toBe(basePrices.get(item.name));
    }
    // Meta effect: a recruit joins with a starting accessory.
    const recruit = unit({ name: 'Recruit' });
    expect(grantRecruitStartingAccessory(recruit, always.accessories, 1)).toBe(true);
    expect(boundSkillOf(recruit.accessory)).toBeNull();
    expect(recruit.accessory.price).toBe(basePrices.get(recruit.accessory.name));
  });

  it('only loot, shops and event grants call the binder', () => {
    const callers = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(path);
        else if (path.endsWith('.js') && /bindAccessorySkill\(/.test(readFileSync(path, 'utf8')))
          callers.push(path);
      }
    };
    walk('src');
    expect(callers.sort()).toEqual([
      'src/engine/AccessorySkills.js',
      'src/engine/EventEffects.js',
      'src/engine/LootSystem.js',
    ]);
  });
});

// ── In battle ───────────────────────────────────────────────────────────

describe('a bound skill applies on the battle paths while the accessory is worn', () => {
  it('combat start: Death Blow adds 6 attack when initiating, Wrath adds 30 crit below half HP', () => {
    const u = wearing(accessoryLending('death_blow'));
    const f = foe();
    expect(getSkillCombatMods(u, f, [u], [f], skills, null, true).atkBonus).toBe(6);
    expect(getSkillCombatMods(u, f, [u], [f], skills, null, false).atkBonus).toBe(0);
    const hurt = wearing(accessoryLending('wrath', 'Speed Ring'), { currentHP: 5 });
    expect(getSkillCombatMods(hurt, f, [hurt], [f], skills, null, false).critBonus).toBe(30);
  });

  it('on-attack and on-defend: Sol heals on a strike, Pavise halves a blow, Astra triggers', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const f = foe();
    expect(rollStrikeSkills(wearing(accessoryLending('sol')), 9, f, skills).heal).toBe(9);
    expect(
      rollDefenseSkills(wearing(accessoryLending('pavise')), 10, true, skills).modifiedDamage,
    ).toBe(5);
    expect(checkAstra(wearing(accessoryLending('astra')), skills).triggered).toBe(true);
  });

  it('aura: an accessory that lends an aura reaches an ally within 2 tiles (hand-bound; no pool skill is one)', () => {
    const leader = wearing({ ...accessoryLending('sol'), _boundSkill: 'charisma' });
    const near = unit({ col: 5 });
    const f = foe({ col: 6, row: 5 });
    expect(getSkillCombatMods(near, f, [leader, near], [f], skills).hitBonus).toBe(10);
  });

  it('turn start: Renewal heals 10% of max HP (3 of 30)', () => {
    const u = wearing(accessoryLending('renewal'), {
      currentHP: 10,
      stats: { ...unit().stats, HP: 30 },
    });
    expect(getTurnStartEffects([u], skills)).toEqual([
      expect.objectContaining({ type: 'heal', target: u, amount: 3 }),
    ]);
  });

  it('range: Foresight adds 1 to a tome; terrain: Pathfinder cuts cost by 1', () => {
    const mage = wearing(accessoryLending('foresight'), { weapon: { ...tome } });
    expect(getWeaponRangeBonus(mage, mage.weapon, skills)).toBe(1);
    expect(getTerrainCostReduction(wearing(accessoryLending('pathfinder')), skills)).toBe(1);
  });

  it('action ability: an accessory-only Blink is listed; Canto is a rule', () => {
    expect(getActionAbilities(wearing(accessoryLending('blink')), skills).map((s) => s.id)).toEqual(
      ['blink'],
    );
    expect(cantoRuleFor(wearing(accessoryLending('canto')), skills)).toBe('any');
  });

  it('every pool skill is effective for the wearer, and for no one else', () => {
    for (const id of new Set(Object.values(POOLS).flat())) {
      expect(effectiveSkills(wearing(accessoryLending(id))), id).toEqual([id]);
      expect(effectiveSkills(unit()), id).toEqual([]);
    }
  });

  it('stops when the accessory is taken off', () => {
    const u = wearing(accessoryLending('renewal'), {
      stats: { ...unit().stats, HP: 30 },
      currentHP: 10,
    });
    expect(getTurnStartEffects([u], skills)).toHaveLength(1);
    const taken = unequipAccessory(u);
    expect(boundSkillOf(taken)).toBe('renewal');
    expect(u.accessory).toBe(null);
    expect(getTurnStartEffects([u], skills)).toEqual([]);
    expect(effectiveSkills(u)).toEqual([]);
  });

  it('moves with the accessory when it is traded: the giver loses it, the receiver gains it', () => {
    const giver = wearing(accessoryLending('wrath'), { name: 'Giver', currentHP: 5 });
    const taker = unit({ name: 'Taker', currentHP: 5 });
    const f = foe();
    const crit = (u) => getSkillCombatMods(u, f, [u], [f], skills, null, false).critBonus;
    expect(crit(giver)).toBe(30);
    expect(crit(taker)).toBe(0);
    const item = giver.accessory;
    const ctx = { context: 'roster', run: { roster: [giver, taker] } };
    const result = applyTrade(
      ctx,
      { holder: unitHolder(giver), bag: 'accessory', item },
      { holder: unitHolder(taker), bag: 'accessory', item: null },
    );
    expect(result.ok, result.reason).toBe(true);
    expect(taker.accessory).toBe(item);
    expect(giver.accessory).toBe(null);
    expect(crit(giver)).toBe(0);
    expect(crit(taker)).toBe(30);
  });

  it('swapping two accessories between units swaps the skills', () => {
    const a = wearing(accessoryLending('sol'), { name: 'A' });
    const b = wearing(accessoryLending('luna', 'Speed Ring'), { name: 'B' });
    const ctx = { context: 'roster', run: { roster: [a, b] } };
    const result = applyTrade(
      ctx,
      { holder: unitHolder(a), bag: 'accessory', item: a.accessory },
      { holder: unitHolder(b), bag: 'accessory', item: b.accessory },
    );
    expect(result.ok, result.reason).toBe(true);
    expect(effectiveSkills(a)).toEqual(['luna']);
    expect(effectiveSkills(b)).toEqual(['sol']);
  });
});

describe('a per-battle limit belongs to the user, not the accessory', () => {
  const blinkOf = (u) => getActionAbilities(u, skills).find((s) => s.id === 'blink');

  it('Blink (one use a battle) stays spent when the accessory comes off and goes back on', () => {
    const accessory = accessoryLending('blink');
    const u = wearing(accessory);
    expect(canUseAbility(u, blinkOf(u))).toEqual({ ok: true, reason: null });
    markUsed(u, 'blink');
    expect(u._battleAbilityUsage.map.blink).toBe(1);
    expect(canUseAbility(u, blinkOf(u))).toEqual({ ok: false, reason: 'per_map_limit' });
    unequipAccessory(u);
    expect(blinkOf(u)).toBeUndefined();
    equipAccessory(u, accessory);
    expect(u._battleAbilityUsage.map.blink).toBe(1);
    expect(canUseAbility(u, blinkOf(u))).toEqual({ ok: false, reason: 'per_map_limit' });
  });

  it('a second unit that receives it has its own count; the trade back changes neither', () => {
    const accessory = accessoryLending('blink');
    const first = wearing(accessory, { name: 'First' });
    const second = unit({ name: 'Second' });
    markUsed(first, 'blink');
    const third = unit({ name: 'Third' });
    const ctx = { context: 'roster', run: { roster: [first, second, third] } };
    const give = (from, to) =>
      applyTrade(
        ctx,
        { holder: unitHolder(from), bag: 'accessory', item: accessory },
        { holder: unitHolder(to), bag: 'accessory', item: null },
      );
    expect(give(first, second).ok).toBe(true);
    // The second unit has not used Blink: its own count is 0 and it may.
    expect(second._battleAbilityUsage).toBeUndefined();
    expect(canUseAbility(second, blinkOf(second)).ok).toBe(true);
    markUsed(second, 'blink');
    expect(canUseAbility(second, blinkOf(second)).reason).toBe('per_map_limit');
    // Back to the first unit: still spent there (its count never moved), and the second's
    // count stays on the second.
    expect(give(second, first).ok).toBe(true);
    expect(first._battleAbilityUsage.map.blink).toBe(1);
    expect(second._battleAbilityUsage.map.blink).toBe(1);
    expect(canUseAbility(first, blinkOf(first)).reason).toBe('per_map_limit');
    // A third unit that never used it is unaffected by either.
    expect(give(first, third).ok).toBe(true);
    expect(canUseAbility(third, blinkOf(third)).ok).toBe(true);
    expect(first._battleAbilityUsage.map.blink).toBe(1);
  });
});

describe('a lent skill is lent, not learned', () => {
  it('never counts toward MAX_SKILLS, is never known and never joins the list', () => {
    const full = Array.from({ length: MAX_SKILLS }, (_, i) => `skill_${i}`);
    const u = wearing(accessoryLending('vantage'), { skills: [...full] });
    expect(u.skills).toEqual(full);
    expect(u.skills).toHaveLength(MAX_SKILLS);
    expect(effectiveSkills(u)).toEqual([...full, 'vantage']);
    expect(knowsSkill(u, 'vantage')).toBe(false);
    expect(u.benchedSkills).toBeUndefined();
  });

  it('a scroll can still teach the skill an accessory lends', () => {
    const u = wearing(accessoryLending('vantage'));
    expect(knowsSkill(u, 'vantage')).toBe(false);
    u.skills.push('vantage');
    expect(knowsSkill(u, 'vantage')).toBe(true);
    expect(effectiveSkills(u)).toEqual(['vantage']);
  });

  it('a unit has one accessory slot: a second accessory replaces the first, so no skill stacks', () => {
    const first = accessoryLending('sol');
    const second = accessoryLending('luna', 'Speed Ring');
    const u = wearing(first);
    expect(equipAccessory(u, second)).toBe(first);
    expect(effectiveSkills(u)).toEqual(['luna']);
  });

  it('an accessory and a legendary weapon lending the same skill count it once', () => {
    const u = wearing(accessoryLending('wrath'), {
      currentHP: 5,
      weapon: { ...sword, _grantedSkill: 'wrath' },
    });
    expect(effectiveSkills(u)).toEqual(['wrath']);
    const f = foe();
    expect(getSkillCombatMods(u, f, [u], [f], skills, null, false).critBonus).toBe(30);
  });

  it('a skill the unit already has equipped counts once: the accessory adds nothing', () => {
    const u = wearing(accessoryLending('wrath'), { skills: ['wrath'], currentHP: 5 });
    expect(effectiveSkills(u)).toEqual(['wrath']);
    expect(accessorySkillAlreadyKnown(u)).toBe(true);
    const f = foe();
    expect(getSkillCombatMods(u, f, [u], [f], skills, null, false).critBonus).toBe(30);
    expect(accessorySkillAlreadyKnown(unit({ accessory: u.accessory }))).toBe(false);
    // A benched copy is not equipped, so the accessory still lends it.
    const benched = wearing(accessoryLending('wrath'), { benchedSkills: ['wrath'] });
    expect(accessorySkillAlreadyKnown(benched)).toBe(false);
    expect(effectiveSkills(benched)).toEqual(['wrath']);
  });

  it('lentSkillLine names the skill apart from the equipped list, and says when it is known', () => {
    const u = wearing(accessoryLending('vantage'), { skills: ['wrath'] });
    expect(lentSkillLine(u, skills)).toEqual({
      id: 'vantage',
      name: 'Vantage',
      text: skills.find((s) => s.id === 'vantage').description,
      known: false,
      label: 'Lent by accessory',
    });
    const dup = wearing(accessoryLending('vantage'), { skills: ['vantage'] });
    expect(lentSkillLine(dup, skills)).toMatchObject({ known: true, label: 'Already known' });
    expect(lentSkillLine(unit(), skills)).toBe(null);
    expect(lentSkillLine(unit({ accessory: catalog('Power Ring') }), skills)).toBe(null);
  });
});

// ── Saves ───────────────────────────────────────────────────────────────

describe('saving', () => {
  const reload = (run) =>
    RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), run.gameData);

  it('keeps the skill, the price and the uid: worn, in the pool, and on a fallen unit', () => {
    const run = newRun({ seed: 41 });
    const worn = { ...accessoryLending('luna'), uid: 'acc-worn' };
    const pooled = { ...accessoryLending('astra', 'Speed Ring'), uid: 'acc-pool' };
    const lost = { ...accessoryLending('defiant', 'Skill Ring'), uid: 'acc-lost' };
    equipAccessory(run.roster[0], worn);
    run.accessories.push(pooled);
    const fallen = { ...structuredClone(run.roster[1]), name: 'Fallen', unitUid: 'fallen-1' };
    fallen.accessory = lost;
    run.fallenUnits.push(fallen);

    const back = reload(run);
    expect(back.roster[0].accessory).toMatchObject({
      name: 'Power Ring',
      _boundSkill: 'luna',
      price: 2250,
      uid: 'acc-worn',
    });
    expect(effectiveSkills(back.roster[0])).toContain('luna');
    expect(back.accessories).toEqual([
      expect.objectContaining({
        name: 'Speed Ring',
        _boundSkill: 'astra',
        price: 3000,
        uid: 'acc-pool',
      }),
    ]);
    expect(back.fallenUnits.find((u) => u.name === 'Fallen').accessory).toMatchObject({
      _boundSkill: 'defiant',
      price: 2250,
    });
  });

  it('a second save and load changes nothing, and the catalog is not changed by it', () => {
    const run = newRun({ seed: 42 });
    equipAccessory(run.roster[0], accessoryLending('pathfinder'));
    const once = reload(run);
    const twice = reload(once);
    expect(twice.roster[0].accessory).toEqual(once.roster[0].accessory);
    expect(getTerrainCostReduction(twice.roster[0], skills)).toBe(1);
    expect(twice.gameData.accessories.find((a) => a.name === 'Power Ring')._boundSkill).toBe(
      undefined,
    );
  });
});

// ── Names ───────────────────────────────────────────────────────────────

describe('names and text', () => {
  it('shows "Power Ring · Vantage" and keeps the identity name', () => {
    const item = accessoryLending('vantage');
    expect(item.name).toBe('Power Ring');
    expect(accessoryDisplayName(item, skills)).toBe('Power Ring · Vantage');
    expect(itemDisplayName(item, skills)).toBe('Power Ring · Vantage');
    expect(itemDisplayName(accessoryLending('death_blow', 'Boots'), skills)).toBe(
      'Boots · Death Blow',
    );
    expect(itemDisplayName(accessoryLending('lifetaker', 'Magic Ring'), skills)).toBe(
      'Magic Ring · Lifetaker',
    );
  });

  it('without the skill catalog the id is set in words', () => {
    expect(itemDisplayName(accessoryLending('uncanny_blow'))).toBe('Power Ring · Uncanny Blow');
  });

  it('a plain accessory, a weapon and nothing show their own name', () => {
    expect(itemDisplayName(catalog('Power Ring'), skills)).toBe('Power Ring');
    expect(itemDisplayName({ name: 'Iron Sword +2', type: 'Sword' }, skills)).toBe('Iron Sword +2');
    // Only an accessory's bound skill decorates: a weapon's grant is not an accessory skill.
    expect(itemDisplayName({ name: 'Sunblade', type: 'Sword', _grantedSkill: 'sol' }, skills)).toBe(
      'Sunblade',
    );
    expect(itemDisplayName(null)).toBe('');
  });

  it('the display name is never an identity: icons and lookups read the base name', () => {
    const item = accessoryLending('wrath');
    const has = (id) => id in iconManifest.icons;
    expect(resolveItemIconId(item, has)).toBe(resolveItemIconId(catalog('Power Ring'), has));
    expect(resolveItemIconId(item, has)).toBe('power-ring');
    expect(stripItemNameSuffix(item.name)).toBe('Power Ring');
    expect(item.name).toBe(catalog('Power Ring').name);
  });

  it('the card text says what it lends and what that does; a plain accessory says nothing of it', () => {
    const item = accessoryLending('vantage');
    const description = skills.find((s) => s.id === 'vantage').description;
    expect(accessorySkillText(item, skills)).toBe(`Lends Vantage: ${description}`);
    expect(formatAccessoryDetail(item, { skills })).toBe(`+2 STR | Lends Vantage: ${description}`);
    expect(formatAccessoryDetail(item)).toBe('+2 STR | Lends Vantage');
    expect(formatAccessoryDetail(catalog('Power Ring'), { skills })).toBe('+2 STR');
    expect(accessorySkillText(catalog('Power Ring'), skills)).toBe('');
  });
});
