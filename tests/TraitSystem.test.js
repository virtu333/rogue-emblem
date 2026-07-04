import { describe, it, expect } from 'vitest';
import {
  rollTraits,
  rollAndApplyTraits,
  applyTraitCreationMods,
  getTraitNames,
} from '../src/engine/TraitSystem.js';
import { createRecruitUnit } from '../src/engine/UnitManager.js';
import { PERK_MOD_KEYS } from '../src/engine/MasterySystem.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const classes = data.classes;
const traits = data.traits;

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

function findClass(name) {
  return classes.find((c) => c.name === name);
}

describe('traits.json data contract', () => {
  const VALID_CONDITIONS = new Set(['below50', 'above75', 'no_ally_within_2', 'on_forest']);
  const VALID_STATS = new Set(['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK']);
  const TOP_FIELDS = new Set([
    'id',
    'name',
    'description',
    'creationMods',
    'combatMods',
    'xpMultiplier',
    'masteryBattlesDelta',
    'masteryPerkOverride',
  ]);

  it('has unique ids and required id/name/description', () => {
    const ids = new Set();
    for (const t of traits) {
      expect(typeof t.id).toBe('string');
      expect(typeof t.name).toBe('string');
      expect(typeof t.description).toBe('string');
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
    }
  });

  it('only uses whitelisted top-level fields', () => {
    for (const t of traits) {
      for (const key of Object.keys(t)) {
        expect(TOP_FIELDS.has(key)).toBe(true);
      }
    }
  });

  it('combatMods use only whitelisted mod keys + valid conditions', () => {
    for (const t of traits) {
      if (!t.combatMods) continue;
      for (const key of Object.keys(t.combatMods)) {
        if (key === 'condition') {
          expect(VALID_CONDITIONS.has(t.combatMods.condition)).toBe(true);
        } else {
          expect(PERK_MOD_KEYS.includes(key)).toBe(true);
        }
      }
    }
  });

  it('creationMods use valid stats/growths', () => {
    for (const t of traits) {
      if (!t.creationMods) continue;
      for (const stat of Object.keys(t.creationMods.stats || {})) {
        expect(VALID_STATS.has(stat) || stat === 'MOV').toBe(true);
      }
      for (const stat of Object.keys(t.creationMods.growths || {})) {
        expect(VALID_STATS.has(stat)).toBe(true);
      }
    }
  });

  it('masteryPerkOverride uses only whitelisted mod keys', () => {
    for (const t of traits) {
      if (!t.masteryPerkOverride) continue;
      for (const key of Object.keys(t.masteryPerkOverride)) {
        expect(PERK_MOD_KEYS.includes(key)).toBe(true);
      }
    }
  });

  it('includes the required cross-system traits', () => {
    const ids = new Set(traits.map((t) => t.id));
    for (const req of ['studious', 'lazy', 'reckless', 'quick_study']) {
      expect(ids.has(req)).toBe(true);
    }
  });
});

describe('classes.json masteryPerk data contract', () => {
  it('every base class has a valid masteryPerk', () => {
    const baseClasses = classes.filter((c) => (c.tier || 'base') === 'base');
    expect(baseClasses.length).toBeGreaterThan(0);
    for (const c of baseClasses) {
      expect(c.masteryPerk, `${c.name} missing masteryPerk`).toBeTruthy();
      expect(typeof c.masteryPerk.name).toBe('string');
      expect(c.masteryPerk.name.length).toBeLessThanOrEqual(16);
      expect(c.masteryPerk.mods).toBeTruthy();
      const keys = Object.keys(c.masteryPerk.mods);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect(PERK_MOD_KEYS.includes(key), `${c.name} bad perk key ${key}`).toBe(true);
        expect(Number.isFinite(c.masteryPerk.mods[key])).toBe(true);
      }
    }
  });

  it('the seven lord classes each have their own perk', () => {
    const lordClasses = [
      'Lord',
      'Tactician',
      'Ranger',
      'Light Sage',
      'Chevalier',
      'Sky Lancer',
      'Sentinel',
    ];
    for (const name of lordClasses) {
      const c = findClass(name);
      expect(c?.masteryPerk?.name).toBeTruthy();
    }
  });
});

describe('rollTraits — determinism', () => {
  it('is deterministic for a fixed seed', () => {
    const rngA = mulberry32(12345);
    const rngB = mulberry32(12345);
    expect(rollTraits(traits, 2, rngA)).toEqual(rollTraits(traits, 2, rngB));
  });

  it('picks without replacement (distinct ids)', () => {
    const rng = mulberry32(999);
    const picked = rollTraits(traits, 2, rng);
    expect(new Set(picked).size).toBe(picked.length);
  });

  it('returns empty for count 0', () => {
    expect(rollTraits(traits, 0, mulberry32(1))).toEqual([]);
  });
});

describe('applyTraitCreationMods', () => {
  it('bakes stat and growth mods once', () => {
    const u = { stats: { DEF: 5, HP: 20 }, currentHP: 20, growths: { HP: 60 } };
    const steady = traits.find((t) => t.id === 'steady');
    applyTraitCreationMods(u, steady);
    expect(u.stats.DEF).toBe(6);
    expect(u.growths.HP).toBe(65);
  });

  it('adds HP stat to currentHP', () => {
    const u = { stats: { HP: 20 }, currentHP: 20, growths: {} };
    const hardy = traits.find((t) => t.id === 'hardy');
    applyTraitCreationMods(u, hardy);
    expect(u.stats.HP).toBe(22);
    expect(u.currentHP).toBe(22);
  });
});

describe('createRecruitUnit — trait rolling', () => {
  it('does not roll traits when traitsData is absent (deterministic legacy path)', () => {
    const u = createRecruitUnit(
      { name: 'X', className: 'Fighter', level: 3 },
      findClass('Fighter'),
      data.weapons,
      null,
      null,
      null,
      classes,
    );
    expect(u.traits).toEqual([]);
  });

  it('rolls traits deterministically with a seeded rng', () => {
    const mk = (seed) =>
      createRecruitUnit(
        { name: 'X', className: 'Fighter', level: 3 },
        findClass('Fighter'),
        data.weapons,
        null,
        null,
        null,
        classes,
        { traitsData: traits, rng: mulberry32(seed) },
      );
    const a = mk(4242);
    const b = mk(4242);
    expect(a.traits).toEqual(b.traits);
  });

  it('applies creation mods exactly once; re-serialization does not reapply', () => {
    // Force a Steady roll by using a stub trait list of one guaranteed-picked trait.
    const singleTrait = [traits.find((t) => t.id === 'steady')];
    // rng that always yields count=1 then index 0
    let calls = 0;
    const rng = () => {
      calls++;
      // first call: count roll -> land in "one" bucket (0.15..0.65)
      if (calls === 1) return 0.4;
      return 0; // index picks
    };
    const baseDef = findClass('Fighter');
    const u = createRecruitUnit(
      { name: 'X', className: 'Fighter', level: 1 },
      baseDef,
      data.weapons,
      null,
      null,
      null,
      classes,
      { traitsData: singleTrait, rng },
    );
    expect(u.traits).toEqual(['steady']);
    const defAfter = u.stats.DEF;
    // Simulate save/load: JSON round trip should NOT reapply creation mods.
    const restored = JSON.parse(JSON.stringify(u));
    expect(restored.stats.DEF).toBe(defAfter);
    expect(restored.traits).toEqual(['steady']);
  });
});

describe('getTraitNames', () => {
  it('comma-joins names', () => {
    expect(getTraitNames({ traits: ['steady', 'lucky'] }, traits)).toBe('Steady, Lucky');
  });
  it('empty string when none', () => {
    expect(getTraitNames({ traits: [] }, traits)).toBe('');
    expect(getTraitNames({}, traits)).toBe('');
  });
});
