import { describe, it, expect } from 'vitest';
import {
  rollTraits,
  migrateCleverTrait,
  migrateUnitTraits,
  rollAndApplyTraits,
  rollAndApplyLordTrait,
  applyTraitCreationMods,
  getTraitNames,
  getTraitRoles,
  getTraitRollWeight,
  isTraitEligible,
  resolveAttackStat,
  getTraitAttackStat,
  getTraitCombatMods,
  isTraitConditionMet,
  reapplyTraitGrowthMods,
  TRAIT_RULES_VERSION,
  ATTACK_STAT_TOKEN,
  COVER_AVOID_THRESHOLD,
} from '../src/engine/TraitSystem.js';
import {
  createRecruitUnit,
  parseWeaponProficiencies,
  getReclassStats,
  reclassUnit,
  traitProfileForClass,
} from '../src/engine/UnitManager.js';
import { isMagical } from '../src/engine/Combat.js';
import { getSkillCombatMods } from '../src/engine/SkillSystem.js';
import {
  PERK_MOD_KEYS,
  getMasteryPerk,
  getMasteryThreshold,
  getTraitXpMultiplier,
} from '../src/engine/MasterySystem.js';
import { RunManager } from '../src/engine/RunManager.js';
import { restoreBattleWorldState } from '../src/engine/BattleSnapshotState.js';
import { MASTERY_BATTLES } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const classes = data.classes;
const traits = data.traits;
const trait = (id) => traits.find((t) => t.id === id);
const REGULAR = traits.filter((t) => !t.lordName && !t.retired);
const LEGENDARY = traits.filter((t) => t.rarity === 'legendary');
const RETIRED = traits.filter((t) => t.retired);

// Every base class a recruit, merc or boss recruit rolls traits on, plus the
// promoted classes recruits arrive as (rolled against the promoted class).
const RECRUIT_BASES = [
  'Myrmidon',
  'Mercenary',
  'Fighter',
  'Knight',
  'Cavalier',
  'Archer',
  'Thief',
  'Pegasus Knight',
  'Wyvern Rider',
  'Mage',
  'Cleric',
  'Dancer',
];
const PROMOTED_RECRUITS = classes
  .filter((c) => c.tier === 'promoted' && RECRUIT_BASES.includes(c.promotesFrom))
  .map((c) => c.name);

// Deterministic Mulberry32 for seeded rolls.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function countingRng(seed) {
  const inner = mulberry32(seed);
  const rng = () => {
    rng.calls++;
    return inner();
  };
  rng.calls = 0;
  return rng;
}

function findClass(name) {
  return classes.find((c) => c.name === name);
}

/** A unit-like profile for a class, as the roll rules see it. */
function profileFor(className, extra = {}) {
  const cls = findClass(className);
  const skills = className === 'Dancer' ? ['dance'] : [];
  return {
    name: 'Probe',
    className,
    moveType: cls.moveType,
    proficiencies: parseWeaponProficiencies(cls.weaponProficiencies),
    skills,
    ...extra,
  };
}

function newRecruit(className, level = 1, options = {}) {
  return createRecruitUnit(
    { name: 'X', className, level },
    findClass(className),
    data.weapons,
    null,
    null,
    null,
    classes,
    { skillsData: data.skills, ...options },
  );
}

/** Force a specific roll: count bucket "one" (0.4), then the given pick. */
function forcedRng(pick = 0) {
  let calls = 0;
  return () => (++calls === 1 ? 0.4 : pick);
}

describe('traits.json data contract (rules v2)', () => {
  const VALID_CONDITIONS = new Set([
    'below50',
    'above75',
    'no_ally_within_2',
    'on_forest',
    'adjacent_ally',
    'initiating_full_hp_foe',
    'moved_3_plus_initiating',
    'initiating_no_adjacent_ally',
    'defending',
    'initiating',
    'foe_below50',
    'in_cover',
  ]);
  const VALID_STATS = new Set(['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK']);
  const VALID_ROLES = new Set([
    'attacker',
    'support',
    'caster',
    'physical',
    'infantry',
    'armored',
    'cavalry',
    'flying',
    'mounted',
    'lord',
  ]);
  const TOP_FIELDS = new Set([
    'id',
    'name',
    'description',
    'rarity',
    'lordName',
    'retired',
    'roll',
    'staffSelfHeal',
    'creationMods',
    'combatMods',
    'xpMultiplier',
    'masteryBattlesDelta',
    'masteryPerkMultiplier',
  ]);

  it('has unique ids and required id/name/description', () => {
    const ids = new Set();
    for (const t of traits) {
      expect(typeof t.id).toBe('string');
      expect(typeof t.name).toBe('string');
      expect(typeof t.description).toBe('string');
      expect(ids.has(t.id), t.id).toBe(false);
      ids.add(t.id);
    }
  });

  it('only uses whitelisted top-level fields (no perk overrides)', () => {
    for (const t of traits)
      for (const key of Object.keys(t)) expect(TOP_FIELDS.has(key), `${t.id}.${key}`).toBe(true);
    expect(traits.some((t) => 'masteryPerkOverride' in t)).toBe(false);
  });

  it('keeps a similar-size regular set, seven legendaries and the retired v1 ids', () => {
    expect(REGULAR.length).toBe(15);
    expect(LEGENDARY.map((t) => t.lordName).sort()).toEqual(data.lords.map((l) => l.name).sort());
    expect(RETIRED.map((t) => t.id).sort()).toEqual(
      ['brawny', 'clever', 'keen', 'lazy', 'lucky', 'steady'].sort(),
    );
  });

  it('still defines every v1 trait id so any legacy unit loads', () => {
    const V1 = [
      'steady',
      'nimble',
      'hardy',
      'keen',
      'brawny',
      'clever',
      'lucky',
      'cornered',
      'vigorous',
      'lone_wolf',
      'woodsman',
      'studious',
      'lazy',
      'reckless',
      'quick_study',
    ];
    for (const id of V1) expect(trait(id), id).toBeTruthy();
  });

  it('combatMods (one part or several) use whitelisted keys and conditions', () => {
    for (const t of traits) {
      if (!t.combatMods) continue;
      const parts = Array.isArray(t.combatMods) ? t.combatMods : [t.combatMods];
      expect(parts.length).toBeGreaterThan(0);
      for (const part of parts)
        for (const key of Object.keys(part)) {
          if (key === 'condition') expect(VALID_CONDITIONS.has(part.condition), t.id).toBe(true);
          else {
            expect(PERK_MOD_KEYS.includes(key), `${t.id}.${key}`).toBe(true);
            expect(Number.isInteger(part[key]) && part[key] !== 0).toBe(true);
          }
        }
    }
  });

  it('creationMods use valid stats/growths; rollable traits never hard-code Str or Mag', () => {
    for (const t of traits) {
      if (!t.creationMods) continue;
      for (const stat of Object.keys(t.creationMods.stats || {}))
        expect(VALID_STATS.has(stat) || stat === 'MOV' || stat === ATTACK_STAT_TOKEN).toBe(true);
      for (const stat of Object.keys(t.creationMods.growths || {}))
        expect(VALID_STATS.has(stat) || stat === ATTACK_STAT_TOKEN).toBe(true);
      if (t.retired || t.lordName) continue;
      // An offensive stat bump must follow the class (Str on a mage is dead weight).
      for (const bucket of ['stats', 'growths'])
        for (const stat of Object.keys(t.creationMods[bucket] || {}))
          expect(['STR', 'MAG'].includes(stat), `${t.id} hard-codes ${stat}`).toBe(false);
    }
  });

  it('roll blocks reference known roles with sane weights', () => {
    for (const t of traits) {
      if (!t.roll) continue;
      const { weight, requires = [], excludes = [], roleWeights = {}, lords } = t.roll;
      if (weight !== undefined) expect(weight).toBeGreaterThan(0);
      for (const role of [...requires, ...excludes, ...Object.keys(roleWeights)])
        expect(VALID_ROLES.has(role), `${t.id}: ${role}`).toBe(true);
      for (const w of Object.values(roleWeights)) expect(w).toBeGreaterThan(0);
      if (lords !== undefined) expect(typeof lords).toBe('boolean');
    }
  });

  it('mastery fields are integral and only ever strengthen the perk', () => {
    for (const t of traits) {
      if (t.masteryBattlesDelta !== undefined)
        expect(Number.isInteger(t.masteryBattlesDelta)).toBe(true);
      if (t.masteryPerkMultiplier !== undefined) {
        expect(Number.isInteger(t.masteryPerkMultiplier)).toBe(true);
        expect(t.masteryPerkMultiplier).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('descriptions are one line within the item budget; names fit a card', () => {
    for (const t of traits) {
      expect(t.description.length, t.id).toBeLessThanOrEqual(85);
      expect(t.description.includes('\n')).toBe(false);
      expect(t.name.length, t.id).toBeLessThanOrEqual(18);
    }
  });
});

describe('unit profile and attack stat', () => {
  it('mirrors Combat.js magic weapon types', () => {
    for (const type of ['Sword', 'Lance', 'Axe', 'Bow', 'Tome', 'Light', 'Breath']) {
      const stat = resolveAttackStat({ proficiencies: [{ type }] });
      expect(stat === 'MAG', type).toBe(isMagical({ type }));
    }
  });

  it.each([
    ['Mage', 'MAG'],
    ['Cleric', 'MAG'],
    ['Fighter', 'STR'],
    ['Dancer', 'STR'],
    ['Archer', 'STR'],
    ['Bishop', 'MAG'],
    ['Sage', 'MAG'],
    ['Battle Monk', 'STR'],
    ['Dark Knight', 'STR'],
    ['Trickster', 'STR'],
  ])('%s fights with %s', (className, stat) => {
    expect(resolveAttackStat(profileFor(className))).toBe(stat);
  });

  it('tags support, attacker and movement roles', () => {
    expect([...getTraitRoles(profileFor('Cleric'))]).toEqual(
      expect.arrayContaining(['support', 'caster', 'infantry']),
    );
    expect(getTraitRoles(profileFor('Cleric')).has('attacker')).toBe(false);
    expect([...getTraitRoles(profileFor('Dancer'))]).toEqual(
      expect.arrayContaining(['support', 'attacker', 'physical']),
    );
    expect([...getTraitRoles(profileFor('Knight'))]).toEqual(
      expect.arrayContaining(['armored', 'attacker']),
    );
    expect([...getTraitRoles(profileFor('Pegasus Knight'))]).toEqual(
      expect.arrayContaining(['flying', 'mounted']),
    );
    expect(getTraitRoles({ ...profileFor('Fighter'), isLord: true }).has('lord')).toBe(true);
  });

  it('a recorded attack stat wins over the current class (promotion never retargets)', () => {
    expect(getTraitAttackStat({ ...profileFor('Battle Monk'), traitAttackStat: 'MAG' })).toBe(
      'MAG',
    );
  });
});

describe('class-aware eligibility', () => {
  const eligibleIds = (unit, options) =>
    REGULAR.filter((t) => isTraitEligible(t, unit, options)).map((t) => t.id);

  it('every recruit class keeps a broad pool', () => {
    for (const name of [...RECRUIT_BASES, ...PROMOTED_RECRUITS])
      expect(eligibleIds(profileFor(name)).length, name).toBeGreaterThanOrEqual(10);
  });

  it('a staff-only healer never rolls an attacking trait', () => {
    const pool = eligibleIds(profileFor('Cleric'));
    for (const id of ['vigorous', 'cornered', 'bloodhound', 'reckless', 'lone_wolf'])
      expect(pool, id).not.toContain(id);
    for (const id of ['hardy', 'gifted', 'stalwart', 'shieldmate', 'quick_study'])
      expect(pool, id).toContain(id);
  });

  it('support units never roll Reckless or Lone Wolf (they live beside allies)', () => {
    for (const name of ['Cleric', 'Dancer']) {
      expect(eligibleIds(profileFor(name))).not.toContain('reckless');
      expect(eligibleIds(profileFor(name))).not.toContain('lone_wolf');
    }
  });

  it('every combat trait a class can roll has a condition that class can meet', () => {
    for (const name of [...RECRUIT_BASES, ...PROMOTED_RECRUITS]) {
      const unit = profileFor(name);
      const attacker = getTraitRoles(unit).has('attacker');
      for (const t of REGULAR.filter((x) => isTraitEligible(x, unit))) {
        const parts = [].concat(t.combatMods || []);
        const offensive = parts.some(
          (p) => p.atkBonus > 0 || p.critBonus > 0 || p.condition === 'initiating',
        );
        const defensiveToo = parts.some((p) => p.defBonus > 0 || p.avoidBonus > 0);
        if (offensive && !defensiveToo) expect(attacker, `${t.id} on ${name}`).toBe(true);
      }
    }
  });

  it('retired traits and other lords’ legendaries never roll', () => {
    for (const t of RETIRED) expect(isTraitEligible(t, profileFor('Fighter'))).toBe(false);
    const edric = { ...profileFor('Lord'), name: 'Edric', isLord: true };
    expect(isTraitEligible(trait('standard_bearer'), edric)).toBe(true);
    expect(isTraitEligible(trait('overflowing_grace'), edric)).toBe(false);
    expect(isTraitEligible(trait('standard_bearer'), profileFor('Fighter'))).toBe(false);
  });

  it('the lord pool drops Reckless, Lone Wolf and Slow Oath', () => {
    // No lone-lord juggernaut rolls, and a doubled lord perk stays legendary-only territory.
    const edric = { ...profileFor('Lord'), name: 'Edric', isLord: true };
    const pool = eligibleIds(edric, { lord: true });
    for (const id of ['reckless', 'lone_wolf', 'slow_oath']) expect(pool).not.toContain(id);
    expect(pool).toContain('studious');
    expect(pool).toContain('gifted');
    // The same unit outside the lord pool (a recruit) could still roll them.
    expect(eligibleIds({ ...edric, isLord: false })).toContain('slow_oath');
  });

  it('weights follow the roll block', () => {
    expect(getTraitRollWeight(trait('hardy'), profileFor('Fighter'))).toBe(10);
    expect(getTraitRollWeight(trait('fleet'), profileFor('Fighter'))).toBe(5);
    expect(getTraitRollWeight(trait('fleet'), profileFor('Cavalier'))).toBe(2.5);
    expect(getTraitRollWeight(trait('nimble'), profileFor('Knight'))).toBe(5);
    expect(getTraitRollWeight(trait('quick_study'), profileFor('Cleric'))).toBe(20);
    expect(getTraitRollWeight(trait('vigorous'), profileFor('Dancer'))).toBe(5);
  });
});

describe('rollTraits — determinism and RNG budget', () => {
  it('is deterministic for a fixed seed', () => {
    const unit = profileFor('Fighter');
    expect(rollTraits(traits, 2, mulberry32(12345), unit)).toEqual(
      rollTraits(traits, 2, mulberry32(12345), unit),
    );
  });

  it('picks without replacement (distinct ids)', () => {
    for (let seed = 0; seed < 200; seed++) {
      const picked = rollTraits(traits, 2, mulberry32(seed), profileFor('Mage'));
      expect(new Set(picked).size).toBe(picked.length);
    }
  });

  it('returns empty for count 0 and costs no draws', () => {
    const rng = countingRng(1);
    expect(rollTraits(traits, 0, rng, profileFor('Fighter'))).toEqual([]);
    expect(rng.calls).toBe(0);
  });

  it('costs exactly one draw per pick, like rules v1', () => {
    for (const name of RECRUIT_BASES)
      for (let seed = 0; seed < 50; seed++) {
        const rng = countingRng(seed);
        const unit = { ...profileFor(name), stats: { HP: 20 }, growths: {}, currentHP: 20 };
        rollAndApplyTraits(unit, traits, rng);
        expect(rng.calls, `${name} seed ${seed}`).toBe(1 + unit.traits.length);
      }
  });

  it('equal weights pick exactly like the v1 uniform index', () => {
    const pool = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    for (const r of [0, 0.249, 0.25, 0.5, 0.74, 0.75, 0.999])
      expect(rollTraits(pool, 1, () => r)).toEqual([pool[Math.floor(r * 4)].id]);
  });

  it('respects weights over many rolls (Long Stride at half weight)', () => {
    const unit = profileFor('Fighter');
    const counts = {};
    const rng = mulberry32(99);
    for (let i = 0; i < 20000; i++) {
      const [id] = rollTraits(traits, 1, rng, unit);
      counts[id] = (counts[id] || 0) + 1;
    }
    expect(counts.fleet / counts.hardy).toBeGreaterThan(0.4);
    expect(counts.fleet / counts.hardy).toBeLessThan(0.6);
    for (const t of RETIRED) expect(counts[t.id] || 0).toBe(0);
  });
});

describe('creation mods', () => {
  it('Hard to Kill: +3 HP (and current HP) and +10% HP growth', () => {
    const u = { stats: { HP: 20 }, currentHP: 20, growths: { HP: 60 } };
    applyTraitCreationMods(u, trait('hardy'));
    expect(u.stats.HP).toBe(23);
    expect(u.currentHP).toBe(23);
    expect(u.growths.HP).toBe(70);
    expect(u.traitRulesVersion).toBe(TRAIT_RULES_VERSION);
  });

  it('Quicksilver: +1 Spd and +10% Spd growth', () => {
    const u = { stats: { SPD: 5 }, growths: { SPD: 40 } };
    applyTraitCreationMods(u, trait('nimble'));
    expect(u.stats.SPD).toBe(6);
    expect(u.growths.SPD).toBe(50);
  });

  it.each([
    ['Mage', 'MAG'],
    ['Cleric', 'MAG'],
    ['Fighter', 'STR'],
    ['Pegasus Knight', 'STR'],
  ])('Kindled on a %s raises %s and records it', (className, stat) => {
    const u = {
      ...profileFor(className),
      stats: { STR: 3, MAG: 3 },
      growths: { STR: 30, MAG: 30 },
    };
    applyTraitCreationMods(u, trait('gifted'));
    const other = stat === 'STR' ? 'MAG' : 'STR';
    expect(u.stats[stat]).toBe(4);
    expect(u.stats[other]).toBe(3);
    expect(u.growths[stat]).toBe(40);
    expect(u.growths[other]).toBe(30);
    expect(u.traitAttackStat).toBe(stat);
    expect(u.stats.ATTACK).toBeUndefined();
  });

  it('Long Stride: +1 Move keeps unit.mov in sync', () => {
    const u = { stats: { MOV: 4 }, mov: 4, growths: {} };
    applyTraitCreationMods(u, trait('fleet'));
    expect(u.stats.MOV).toBe(5);
    expect(u.mov).toBe(5);
  });

  it('a promoted recruit rolls and bakes against the class it becomes', () => {
    // Cleric → Bishop: the Bishop attacks with Light, so attacker traits are fair game.
    const base = newRecruit('Cleric', 5);
    const profile = traitProfileForClass(base, findClass('Bishop'));
    expect(getTraitRoles(profile).has('attacker')).toBe(true);
    expect(isTraitEligible(trait('vigorous'), profile)).toBe(true);
    expect(isTraitEligible(trait('vigorous'), base)).toBe(false);
    const u = createRecruitUnit(
      { name: 'B', className: 'Cleric', level: 5 },
      findClass('Cleric'),
      data.weapons,
      null,
      null,
      null,
      classes,
      {
        traitsData: [trait('gifted')],
        skillsData: data.skills,
        rng: forcedRng(0),
        traitClassData: findClass('Bishop'),
      },
    );
    expect(u.traits).toEqual(['gifted']);
    expect(u.traitAttackStat).toBe('MAG');
  });

  it('bakes once; JSON round trips do not reapply', () => {
    const u = createRecruitUnit(
      { name: 'X', className: 'Fighter', level: 1 },
      findClass('Fighter'),
      data.weapons,
      null,
      null,
      null,
      classes,
      { traitsData: [trait('hardy')], rng: forcedRng(0) },
    );
    expect(u.traits).toEqual(['hardy']);
    const restored = JSON.parse(JSON.stringify(u));
    expect(restored.stats.HP).toBe(u.stats.HP);
    migrateUnitTraits(restored);
    expect(restored.stats.HP).toBe(u.stats.HP);
  });

  it('does not roll traits when traitsData is absent (deterministic legacy path)', () => {
    expect(newRecruit('Fighter', 3).traits).toEqual([]);
  });

  it('rolls traits deterministically with a seeded rng', () => {
    const a = newRecruit('Fighter', 3, { traitsData: traits, rng: mulberry32(4242) });
    const b = newRecruit('Fighter', 3, { traitsData: traits, rng: mulberry32(4242) });
    expect(a.traits).toEqual(b.traits);
  });
});

describe('combat mods — every regular trait does what its line says', () => {
  const PLAIN = data.terrain.find((t) => t.name === 'Plain');
  const terrainNamed = (name) => data.terrain.find((t) => t.name === name);
  function unit(overrides = {}) {
    return {
      name: 'U',
      className: 'Fighter',
      faction: 'player',
      col: 1,
      row: 1,
      currentHP: 20,
      stats: { HP: 20, STR: 6, MAG: 1, SKL: 5, SPD: 5, DEF: 4, RES: 1, LCK: 3 },
      skills: [],
      inventory: [],
      ...overrides,
    };
  }
  function mods(id, { initiating = true, hp = 20, foeHP = 20, ally = null, terrain = PLAIN } = {}) {
    const u = unit({ traits: [id], currentHP: hp });
    const foe = unit({ name: 'Foe', col: 1, row: 2, currentHP: foeHP });
    const allies = ally ? [u, { ...unit({ name: 'Ally' }), ...ally }] : [u];
    return getSkillCombatMods(u, foe, allies, [foe], [], terrain, initiating, null, {
      traitsData: traits,
    });
  }
  const pick = (m) => ({
    atk: m.atkBonus,
    def: m.defBonus,
    res: m.resBonus,
    hit: m.hitBonus,
    avo: m.avoidBonus,
    crit: m.critBonus,
  });
  const zero = { atk: 0, def: 0, res: 0, hit: 0, avo: 0, crit: 0 };

  it('Unscarred: +2 Atk only above 75% HP', () => {
    expect(pick(mods('vigorous', { hp: 20 }))).toEqual({ ...zero, atk: 2 });
    expect(pick(mods('vigorous', { hp: 15 }))).toEqual(zero);
  });

  it('Last Ember: +2 Atk and +15 Crit at half HP or less', () => {
    expect(pick(mods('cornered', { hp: 10 }))).toEqual({ ...zero, atk: 2, crit: 15 });
    expect(pick(mods('cornered', { hp: 11 }))).toEqual(zero);
  });

  it('Scent of Blood: +2 Atk and +10 Hit against a foe at half HP or less', () => {
    expect(pick(mods('bloodhound', { foeHP: 10 }))).toEqual({ ...zero, atk: 2, hit: 10 });
    expect(pick(mods('bloodhound', { foeHP: 11 }))).toEqual(zero);
    expect(pick(mods('bloodhound', { foeHP: 10, initiating: false }))).toEqual({
      ...zero,
      atk: 2,
      hit: 10,
    });
  });

  it('Reckless: +3 Atk when initiating, -2 Def when an enemy initiates', () => {
    expect(pick(mods('reckless', { initiating: true }))).toEqual({ ...zero, atk: 3 });
    expect(pick(mods('reckless', { initiating: false }))).toEqual({ ...zero, def: -2 });
    const active = mods('reckless', { initiating: false }).activated;
    expect(active).toEqual([{ id: 'trait_reckless', name: 'Reckless' }]);
  });

  it('Stalwart: +2 Def only when an enemy initiates', () => {
    expect(pick(mods('stalwart', { initiating: false }))).toEqual({ ...zero, def: 2 });
    expect(pick(mods('stalwart', { initiating: true }))).toEqual(zero);
  });

  it('Lone Wolf: +10 Avo with no living ally within 2 tiles', () => {
    expect(pick(mods('lone_wolf'))).toEqual({ ...zero, avo: 10 });
    expect(pick(mods('lone_wolf', { ally: { col: 3, row: 1 } }))).toEqual(zero);
    expect(pick(mods('lone_wolf', { ally: { col: 4, row: 1 } }))).toEqual({ ...zero, avo: 10 });
  });

  it('Shieldmate: +10 Avo beside a living ally', () => {
    expect(pick(mods('shieldmate', { ally: { col: 2, row: 1 } }))).toEqual({ ...zero, avo: 10 });
    expect(pick(mods('shieldmate', { ally: { col: 2, row: 1, currentHP: 0 } }))).toEqual(zero);
    expect(pick(mods('shieldmate'))).toEqual(zero);
  });

  it.each(['Forest', 'Mountain', 'Fort', 'Pillar'])('Old Campaigner: +2 Def in %s', (name) => {
    expect(pick(mods('woodsman', { terrain: terrainNamed(name) }))).toEqual({ ...zero, def: 2 });
  });

  it.each(['Plain', 'Village', 'Throne', 'Sand', 'Floor', 'Water'])(
    'Old Campaigner: nothing on %s',
    (name) => {
      expect(pick(mods('woodsman', { terrain: terrainNamed(name) }))).toEqual(zero);
    },
  );

  it('cover is terrain granting 20+ avoid', () => {
    expect(COVER_AVOID_THRESHOLD).toBe(20);
    const cover = data.terrain
      .filter((t) => isTraitConditionMet('in_cover', { terrain: t }))
      .map((t) => t.name)
      .sort();
    expect(cover).toEqual(['Forest', 'Fort', 'Mountain', 'Pillar']);
  });

  it('non-combat traits add no combat mods', () => {
    for (const id of ['hardy', 'nimble', 'gifted', 'fleet', 'studious', 'slow_oath', 'quick_study'])
      expect(pick(mods(id))).toEqual(zero);
  });

  it('unknown conditions never fire without a delegate', () => {
    expect(isTraitConditionMet('mystery', {})).toBe(false);
    const u = unit({ traits: ['vigorous'] });
    expect(getTraitCombatMods(u, unit(), { traitsData: traits }).mods).toEqual({});
  });
});

describe('mastery and XP traits', () => {
  it('Studious masters in 6, Slow Oath in 10, together in 8', () => {
    expect(getMasteryThreshold({ traits: ['studious'] }, traits)).toBe(MASTERY_BATTLES - 2);
    expect(getMasteryThreshold({ traits: ['slow_oath'] }, traits)).toBe(MASTERY_BATTLES + 2);
    expect(getMasteryThreshold({ traits: ['studious', 'slow_oath'] }, traits)).toBe(
      MASTERY_BATTLES,
    );
  });

  it('Slow Oath doubles every class perk and never replaces one', () => {
    for (const cls of classes.filter((c) => c.masteryPerk)) {
      const perk = getMasteryPerk({ className: cls.name, traits: ['slow_oath'] }, classes, traits);
      for (const [key, value] of Object.entries(cls.masteryPerk.mods))
        expect(perk.mods[key], `${cls.name}.${key}`).toBe(value * 2);
      expect(perk.name).toBe(`${cls.masteryPerk.name} ×2`);
    }
  });

  it('Hungry earns 20% more battle XP', () => {
    expect(getTraitXpMultiplier({ traits: ['quick_study'] }, traits)).toBeCloseTo(1.2);
  });
});

describe('legacy migration (rules v1 → v2)', () => {
  const legacy = (traitIds, extra = {}) => ({
    name: 'Old',
    className: 'Fighter',
    proficiencies: [{ type: 'Axe', rank: 'Prof' }],
    traits: traitIds,
    stats: { HP: 22, STR: 7, MAG: 0, SKL: 4, SPD: 5, DEF: 5, RES: 1, LCK: 2, MOV: 5 },
    currentHP: 22,
    growths: { HP: 80, STR: 55, MAG: 5, SKL: 30, SPD: 35, DEF: 30, RES: 10, LCK: 20 },
    ...extra,
  });

  it('tops Hard to Kill up to +3 HP (current HP too), once', () => {
    const u = migrateUnitTraits(legacy(['hardy']));
    expect(u.stats.HP).toBe(23);
    expect(u.currentHP).toBe(23);
    expect(u.traitRulesVersion).toBe(TRAIT_RULES_VERSION);
    migrateUnitTraits(u);
    expect(u.stats.HP).toBe(23);
  });

  it('tops Quicksilver up to +10% Spd growth', () => {
    expect(migrateUnitTraits(legacy(['nimble'])).growths.SPD).toBe(40);
  });

  it('turns a physical Brawny into Kindled (Str) and refunds the Spd growth', () => {
    const u = migrateUnitTraits(legacy(['brawny']));
    expect(u.traits).toEqual(['gifted']);
    expect(u.traitAttackStat).toBe('STR');
    expect(u.stats.STR).toBe(7);
    expect(u.growths.STR).toBe(65);
    expect(u.growths.SPD).toBe(40);
  });

  it('turns a tome mage’s downside-only Brawny into Kindled (Mag), keeping the stray Str', () => {
    const mage = legacy(['brawny'], {
      className: 'Mage',
      proficiencies: [{ type: 'Tome', rank: 'Prof' }],
      stats: { HP: 16, STR: 2, MAG: 7, SPD: 5, DEF: 2, RES: 5 },
      growths: { STR: 10, MAG: 55, SPD: 35 },
    });
    const u = migrateUnitTraits(mage);
    expect(u.traits).toEqual(['gifted']);
    expect(u.traitAttackStat).toBe('MAG');
    expect(u.stats).toMatchObject({ STR: 2, MAG: 8 });
    expect(u.growths).toMatchObject({ STR: 10, MAG: 65, SPD: 40 });
  });

  it('repairs a pre-fix Clever, then turns it into Kindled (Mag)', () => {
    const u = migrateUnitTraits(
      legacy(['clever'], {
        className: 'Mage',
        proficiencies: [{ type: 'Tome', rank: 'Prof' }],
        stats: { DEF: 1, MAG: 8 },
        growths: { MAG: 55 },
      }),
    );
    expect(u.traits).toEqual(['gifted']);
    expect(u.stats).toMatchObject({ DEF: 2, MAG: 8 });
    expect(u.growths.MAG).toBe(65);
    expect(u.traitAttackStat).toBe('MAG');
    expect(u.cleverRulesVersion).toBe(2);
  });

  it('keeps the Clever repair idempotent on its own', () => {
    const old = { traits: ['clever'], stats: { DEF: 4, MAG: 3 }, growths: { MAG: 20 } };
    migrateCleverTrait(old);
    migrateCleverTrait(old);
    expect(old.stats).toEqual({ DEF: 5, MAG: 3 });
    expect(old.growths.MAG).toBe(25);
  });

  it('turns Lazy into Slow Oath at the same threshold, keeping its baked stats', () => {
    const before = legacy(['lazy']);
    const thresholdBefore = getMasteryThreshold(before, traits);
    const u = migrateUnitTraits(structuredClone(before));
    expect(u.traits).toEqual(['slow_oath']);
    expect(u.stats).toEqual(before.stats);
    expect(getMasteryThreshold(u, traits)).toBe(thresholdBefore);
  });

  it('never un-masters a unit', () => {
    for (const id of traits.filter((t) => !t.lordName).map((t) => t.id)) {
      const before = legacy([id], {
        classBattles: { Fighter: 8 + (trait(id).masteryBattlesDelta || 0) },
      });
      const after = migrateUnitTraits(structuredClone(before));
      expect(getMasteryThreshold(after, traits), id).toBeLessThanOrEqual(
        getMasteryThreshold(before, traits),
      );
    }
  });

  it('keeps Reckless (now a phase trade, no longer a perk override) and retired traits', () => {
    const u = migrateUnitTraits(legacy(['reckless', 'steady']));
    expect(u.traits).toEqual(['reckless', 'steady']);
    expect(u.stats).toEqual(legacy([]).stats);
    const perk = getMasteryPerk({ ...u, className: 'Knight' }, classes, traits);
    expect(perk.mods).toEqual({ defBonus: 2 });
  });

  it('never tops up the same v2 trait twice', () => {
    const u = migrateUnitTraits(legacy(['brawny', 'clever']));
    expect(u.traits).toEqual(['gifted']);
    expect(u.growths.STR).toBe(65);
    // Only the v1 Clever repair (+5) touches Mag; the Kindled top-up is not applied twice.
    expect(u.growths.MAG).toBe(10);
  });

  it('never lowers any stat or growth', () => {
    for (const id of traits.filter((t) => !t.lordName).map((t) => t.id)) {
      const before = legacy([id]);
      const after = migrateUnitTraits(structuredClone(before));
      for (const [stat, value] of Object.entries(before.stats))
        expect(after.stats[stat], `${id} ${stat}`).toBeGreaterThanOrEqual(value);
      for (const [stat, value] of Object.entries(before.growths))
        expect(after.growths[stat], `${id} ${stat}`).toBeGreaterThanOrEqual(value);
    }
  });

  it('leaves trait-less units and v2 units untouched', () => {
    const none = legacy([]);
    migrateUnitTraits(none);
    expect(none.traitRulesVersion).toBeUndefined();
    const fresh = {
      ...profileFor('Fighter'),
      stats: { HP: 20 },
      currentHP: 20,
      growths: { HP: 60 },
    };
    applyTraitCreationMods(fresh, trait('hardy'));
    fresh.traits = ['hardy'];
    const snapshot = structuredClone(fresh);
    migrateUnitTraits(fresh);
    expect(fresh).toEqual(snapshot);
  });

  it('every legacy id resolves to a defined trait after migration', () => {
    for (const id of traits.filter((t) => !t.lordName).map((t) => t.id)) {
      const u = migrateUnitTraits(legacy([id]));
      for (const next of u.traits) expect(trait(next), `${id} → ${next}`).toBeTruthy();
    }
  });

  it('RunManager.fromJSON migrates rosters once and stays idempotent', () => {
    const run = new RunManager(data);
    run.startRun({ runSeed: 5, applyBlessingsAtStart: false });
    const saved = JSON.parse(JSON.stringify(run.toJSON()));
    const oldUnit = { ...saved.roster[0], name: 'Oldtimer', isLord: false };
    oldUnit.traits = ['hardy', 'brawny'];
    delete oldUnit.traitRulesVersion;
    delete oldUnit.traitAttackStat;
    saved.roster.push(oldUnit);
    const once = RunManager.fromJSON(structuredClone(saved), data);
    const migrated = once.roster.find((u) => u.name === 'Oldtimer');
    expect(migrated.traits).toEqual(['hardy', 'gifted']);
    expect(migrated.stats.HP).toBe(oldUnit.stats.HP + 1);
    const twice = RunManager.fromJSON(JSON.parse(JSON.stringify(once.toJSON())), data);
    expect(twice.roster.find((u) => u.name === 'Oldtimer')).toEqual(migrated);
  });

  it('battle snapshot restore migrates battle units', () => {
    const scene = { playerUnits: [legacy(['nimble'])], enemyUnits: [], npcUnits: [] };
    restoreBattleWorldState(scene, {});
    expect(scene.playerUnits[0].growths.SPD).toBe(40);
    expect(scene.playerUnits[0].traitRulesVersion).toBe(TRAIT_RULES_VERSION);
  });
});

describe('reclass keeps traits honest', () => {
  function withSeed(seed, fn) {
    const prev = Math.random;
    Math.random = mulberry32(seed);
    try {
      return fn();
    } finally {
      Math.random = prev;
    }
  }

  it('re-bakes trait growth mods after the growth re-roll', () => {
    const base = newRecruit('Fighter', 5);
    const plain = structuredClone(base);
    const hardy = structuredClone(base);
    hardy.traits = ['hardy'];
    withSeed(7, () =>
      reclassUnit(plain, findClass('Knight'), findClass('Fighter'), classes, data.skills, traits),
    );
    withSeed(7, () =>
      reclassUnit(hardy, findClass('Knight'), findClass('Fighter'), classes, data.skills, traits),
    );
    expect(hardy.growths.HP).toBe(plain.growths.HP + 10);
  });

  it('moves Kindled from Str to Mag when a fighter becomes a mage; preview matches', () => {
    const u = newRecruit('Fighter', 5);
    applyTraitCreationMods(u, trait('gifted'));
    u.traits = ['gifted'];
    const preview = getReclassStats(u, findClass('Mage'), findClass('Fighter'), classes, traits);
    const plainPreview = getReclassStats(u, findClass('Mage'), findClass('Fighter'), classes);
    expect(preview.MAG).toBe(plainPreview.MAG + 1);
    expect(preview.STR).toBe(Math.max(1, plainPreview.STR - 1));
    const probe = structuredClone(u);
    probe.traits = [];
    withSeed(3, () =>
      reclassUnit(u, findClass('Mage'), findClass('Fighter'), classes, data.skills, traits),
    );
    withSeed(3, () =>
      reclassUnit(probe, findClass('Mage'), findClass('Fighter'), classes, data.skills, traits),
    );
    expect(u.stats).toEqual(expect.objectContaining({ MAG: preview.MAG, STR: preview.STR }));
    expect(u.traitAttackStat).toBe('MAG');
    expect(u.growths.MAG).toBe(probe.growths.MAG + 10);
    expect(u.growths.STR).toBe(probe.growths.STR);
  });

  it('without traitsData reclass keeps its legacy behaviour', () => {
    const u = newRecruit('Fighter', 5);
    u.traits = ['hardy'];
    const probe = structuredClone(u);
    probe.traits = [];
    withSeed(9, () =>
      reclassUnit(u, findClass('Knight'), findClass('Fighter'), classes, data.skills),
    );
    withSeed(9, () =>
      reclassUnit(probe, findClass('Knight'), findClass('Fighter'), classes, data.skills, traits),
    );
    expect(u.growths).toEqual(probe.growths);
    expect(u.stats).toEqual(probe.stats);
    const noTraits = { traits: [], growths: { HP: 50 } };
    expect(reapplyTraitGrowthMods(noTraits, traits).growths).toEqual({ HP: 50 });
  });
});

describe('lord traits', () => {
  function lord(name = 'Edric', className = 'Lord') {
    return {
      ...profileFor(className),
      name,
      isLord: true,
      stats: { HP: 20, STR: 5, MAG: 2, DEF: 3, SPD: 5, MOV: 5 },
      currentHP: 20,
      growths: { HP: 50, STR: 40, MAG: 20, SPD: 30 },
    };
  }

  it('rolls exactly one eligible, non-retired trait for every lord', () => {
    for (const l of data.lords)
      for (let seed = 0; seed < 60; seed++) {
        const u = lord(l.name, l.class);
        rollAndApplyLordTrait(u, traits, mulberry32(seed), 0);
        expect(u.traits).toHaveLength(1);
        const t = trait(u.traits[0]);
        expect(t.retired).toBeFalsy();
        expect(['reckless', 'lone_wolf', 'slow_oath']).not.toContain(t.id);
      }
  });

  it('Kindled on Sera raises Mag', () => {
    const sera = lord('Sera', 'Light Sage');
    rollAndApplyLordTrait(sera, [trait('gifted')], () => 0.99, 0);
    expect(sera.traits).toEqual(['gifted']);
    expect(sera.stats.MAG).toBe(3);
    expect(sera.traitAttackStat).toBe('MAG');
  });
});

describe('getTraitNames', () => {
  it('comma-joins names', () => {
    expect(getTraitNames({ traits: ['hardy', 'reckless'] }, traits)).toBe('Hard to Kill, Reckless');
  });
  it('empty string when none', () => {
    expect(getTraitNames({ traits: [] }, traits)).toBe('');
    expect(getTraitNames({}, traits)).toBe('');
  });
});
