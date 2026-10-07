// Pins the strike sequence of combats between units with no Revival Stones (Phase 3D).
//
// Revival Stones end an exchange early when a bar breaks. Every gate that rule touches
// (the strike loop, Adept/Aether bonus strikes, Astra, brave, Desperation, Vantage, art
// follow-ups) must leave a combat with no stones exactly as it was. This file ran green
// on the code before the stones landed; its fixture is that code's output, one digest per
// scenario and starting HP (the events, both final HPs and both death flags of every seed).
//
// Regenerate only on purpose: UPDATE_COMBAT_PIN=1 npx vitest run tests/CombatStrikeSequencePin.test.js

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveCombat } from '../src/engine/Combat.js';
import {
  checkAstra,
  getSkillCombatMods,
  rollDefenseSkills,
  rollStrikeSkills,
} from '../src/engine/SkillSystem.js';
import { getWeaponArtCombatMods } from '../src/engine/WeaponArtSystem.js';
import { loadGameData } from './testData.js';

const FIXTURE = new URL('./fixtures/combatStrikeSequencePin.json', import.meta.url);
const gameData = loadGameData();
const weapon = (name) => gameData.weapons.find((w) => w.name === name);
const art = (id) => gameData.weaponArts.arts.find((a) => a.id === id);
const SEEDS = Array.from({ length: 24 }, (_, i) => 1000 + i * 7919);
const START_HPS = [4, 11, 19, 30, 52];

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

function unit(name, faction, stats, extra = {}) {
  const full = {
    HP: 30,
    STR: 10,
    MAG: 0,
    SKL: 8,
    SPD: 8,
    DEF: 4,
    RES: 3,
    LCK: 4,
    MOV: 4,
    ...stats,
  };
  return {
    name,
    faction,
    skills: [],
    stats: full,
    currentHP: full.HP,
    col: faction === 'player' ? 0 : 1,
    row: 0,
    weaponRank: 'Prof',
    ...extra,
  };
}

function ctxFor(attacker, defender, overrides = {}) {
  const base = {
    rollStrikeSkills,
    rollDefenseSkills,
    checkAstra,
    skillsData: gameData.skills,
    affixData: gameData.affixes,
  };
  const masteryCtx = { classesData: gameData.classes, traitsData: gameData.traits || null };
  const atkMods = getSkillCombatMods(
    attacker,
    defender,
    [attacker],
    [defender],
    gameData.skills,
    null,
    true,
    gameData.affixes,
    masteryCtx,
  );
  const defMods = getSkillCombatMods(
    defender,
    attacker,
    [defender],
    [attacker],
    gameData.skills,
    null,
    false,
    gameData.affixes,
    masteryCtx,
  );
  return { ...base, atkMods, defMods, ...overrides };
}

// Each scenario builds fresh units for a starting defender HP; `ctx` returns the skill context.
const SCENARIOS = {
  plain_no_ctx: (hp) => ({
    atk: unit('Atk', 'player', { STR: 9 }, { weapon: weapon('Iron Sword') }),
    def: unit('Def', 'enemy', { HP: hp }, { weapon: weapon('Iron Sword'), currentHP: hp }),
    ctx: () => null,
  }),
  counter_and_attacker_doubles: (hp) => ({
    atk: unit('Atk', 'player', { STR: 8, SPD: 16 }, { weapon: weapon('Iron Sword') }),
    def: unit('Def', 'enemy', { HP: hp }, { weapon: weapon('Iron Sword'), currentHP: hp }),
    ctx: (a, d) => ctxFor(a, d),
  }),
  defender_doubles_and_kills_attacker: (hp) => ({
    atk: unit('Atk', 'player', { HP: 14, STR: 7, SPD: 4 }, { weapon: weapon('Iron Sword') }),
    def: unit('Def', 'enemy', { HP: hp, STR: 13, SPD: 16 }, { weapon: weapon('Iron Sword') }),
    ctx: (a, d) => ctxFor(a, d),
  }),
  brave_attacker: (hp) => ({
    atk: unit('Atk', 'player', { STR: 7, SPD: 14 }, { weapon: weapon('Twinsworn') }),
    def: unit('Def', 'enemy', { HP: hp }, { weapon: weapon('Iron Sword') }),
    ctx: (a, d) => ctxFor(a, d),
  }),
  adept_bonus_strikes: (hp) => ({
    atk: unit(
      'Atk',
      'player',
      { STR: 8, SPD: 20 },
      { weapon: weapon('Iron Sword'), skills: ['adept'] },
    ),
    def: unit('Def', 'enemy', { HP: hp }, { weapon: weapon('Iron Sword') }),
    ctx: (a, d) => ctxFor(a, d),
  }),
  aether_and_sol: (hp) => ({
    atk: unit(
      'Atk',
      'player',
      { STR: 8, SPD: 14, SKL: 30 },
      {
        weapon: weapon('Iron Sword'),
        skills: ['aether', 'sol'],
      },
    ),
    def: unit('Def', 'enemy', { HP: hp }, { weapon: weapon('Iron Sword') }),
    ctx: (a, d) => ctxFor(a, d),
  }),
  astra_multi_hit: (hp) => ({
    atk: unit(
      'Atk',
      'player',
      { STR: 12, SPD: 20, SKL: 30 },
      {
        weapon: weapon('Iron Sword'),
        skills: ['astra'],
      },
    ),
    def: unit('Def', 'enemy', { HP: hp }, { weapon: weapon('Iron Sword') }),
    ctx: (a, d) => ctxFor(a, d),
  }),
  desperation_attacker: (hp) => ({
    atk: unit('Atk', 'player', { STR: 8, SPD: 18 }, { weapon: weapon('Iron Sword') }),
    def: unit('Def', 'enemy', { HP: hp, STR: 11 }, { weapon: weapon('Iron Sword') }),
    ctx: (a, d) => {
      const c = ctxFor(a, d);
      c.atkMods = { ...c.atkMods, desperation: true };
      return c;
    },
  }),
  vantage_defender: (hp) => ({
    atk: unit('Atk', 'player', { HP: 16, STR: 9, SPD: 6 }, { weapon: weapon('Iron Sword') }),
    def: unit('Def', 'enemy', { HP: hp, STR: 12, SPD: 15 }, { weapon: weapon('Iron Sword') }),
    ctx: (a, d) => {
      const c = ctxFor(a, d);
      c.defMods = { ...c.defMods, vantage: true };
      return c;
    },
  }),
  defender_desperation: (hp) => ({
    atk: unit('Atk', 'player', { HP: 40, STR: 9, SPD: 8 }, { weapon: weapon('Iron Sword') }),
    def: unit('Def', 'enemy', { HP: hp, STR: 9, SPD: 20 }, { weapon: weapon('Iron Sword') }),
    ctx: (a, d) => {
      const c = ctxFor(a, d);
      c.defMods = { ...c.defMods, desperation: true };
      return c;
    },
  }),
  weapon_art_follow_up: (hp) => ({
    atk: unit('Atk', 'player', { STR: 7, SPD: 24 }, { weapon: weapon('Iron Sword') }),
    def: unit('Def', 'enemy', { HP: hp }, { weapon: weapon('Iron Sword') }),
    ctx: (a, d) => {
      const c = ctxFor(a, d);
      const artMods = getWeaponArtCombatMods(art('sword_wrath_strike'));
      c.atkWeaponArtMods = artMods;
      c.atkMods = { ...c.atkMods, ...artMods };
      return c;
    },
  }),
  miracle_defender: (hp) => ({
    atk: unit('Atk', 'player', { STR: 12, SPD: 16 }, { weapon: weapon('Iron Sword') }),
    def: unit(
      'Def',
      'enemy',
      { HP: hp, LCK: 40 },
      { weapon: weapon('Iron Sword'), skills: ['miracle'] },
    ),
    ctx: (a, d) => ctxFor(a, d),
  }),
  lethality_kill: (hp) => ({
    atk: unit(
      'Atk',
      'player',
      { STR: 6, SPD: 14, SKL: 40 },
      {
        weapon: weapon('Iron Sword'),
        skills: ['lethality'],
      },
    ),
    def: unit('Def', 'enemy', { HP: hp }, { weapon: weapon('Iron Sword') }),
    ctx: (a, d) => ctxFor(a, d),
  }),
};

function digestOf(scenario, hp) {
  const parts = [];
  let strikes = 0;
  for (const seed of SEEDS) {
    const rng = mulberry32(seed);
    vi.spyOn(Math, 'random').mockImplementation(rng);
    const { atk, def, ctx } = SCENARIOS[scenario](hp);
    const skillCtx = ctx(atk, def);
    const result = resolveCombat(atk, atk.weapon, def, def.weapon, 1, null, null, skillCtx);
    strikes += result.events.filter((e) => e.type === 'strike').length;
    parts.push(
      JSON.stringify({
        events: result.events,
        attackerHP: result.attackerHP,
        defenderHP: result.defenderHP,
        attackerDied: result.attackerDied,
        defenderDied: result.defenderDied,
        next: rng(), // the RNG cursor: no draw added or dropped
      }),
    );
    vi.restoreAllMocks();
  }
  return {
    strikes,
    sha: createHash('sha1').update(parts.join('\n')).digest('hex'),
  };
}

function allDigests() {
  const out = {};
  for (const scenario of Object.keys(SCENARIOS))
    for (const hp of START_HPS) out[`${scenario}@${hp}`] = digestOf(scenario, hp);
  return out;
}

afterEach(() => vi.restoreAllMocks());

describe('combat strike sequences without Revival Stones', () => {
  if (process.env.UPDATE_COMBAT_PIN === '1') {
    it('writes the fixture', () => {
      writeFileSync(FIXTURE, `${JSON.stringify(allDigests(), null, 2)}\n`);
    });
    return;
  }

  const fixture = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : {};

  it('has a fixture for every scenario and starting HP', () => {
    const keys = Object.keys(SCENARIOS).flatMap((s) => START_HPS.map((hp) => `${s}@${hp}`));
    expect(Object.keys(fixture).sort()).toEqual(keys.sort());
  });

  for (const scenario of Object.keys(SCENARIOS)) {
    for (const hp of START_HPS) {
      it(`${scenario} at ${hp} HP rolls the same strikes`, () => {
        expect(digestOf(scenario, hp)).toEqual(fixture[`${scenario}@${hp}`]);
      });
    }
  }

  it('exercises the long sequences it claims to pin', () => {
    // A pin over combats that never reach a second strike would pin nothing.
    expect(fixture['brave_attacker@52'].strikes).toBeGreaterThan(60);
    expect(fixture['astra_multi_hit@52'].strikes).toBeGreaterThan(96);
    expect(fixture['adept_bonus_strikes@52'].strikes).toBeGreaterThan(72);
  });
});
