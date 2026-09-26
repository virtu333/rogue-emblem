// Combat scenarios that exercise every gameplay draw a player attack can make:
// the 2RN hit roll, the crit roll, on-attack skills (Sol, Luna, Aether, Flare,
// Lethality, Adept, Commander's Gambit, Divine Charge, Seraph Strike), Astra,
// on-defend skills (Pavise, Aegis, Miracle, Cancel, Intimidate, Dragon Scale),
// Vantage and Desperation, on-defend affixes (Shielded, Thorns, Teleporter),
// weapon-art combat mods (multi-hit, drain) and weapon imbues (Binding's status
// chance, Keen, Vampiric). Shared by the attack-RNG characterization tests.
import {
  getSkillCombatMods,
  rollStrikeSkills,
  rollDefenseSkills,
  checkAstra,
} from '../../src/engine/SkillSystem.js';
import { rollDefenseAffixes, getAttackAffixes } from '../../src/engine/AffixSystem.js';
import { getWeaponArtCombatMods } from '../../src/engine/WeaponArtSystem.js';
import { applyImbue, getImbueById } from '../../src/engine/ImbueSystem.js';
import { loadGameData } from '../testData.js';

export const data = loadGameData();
const plain = data.terrain.find((t) => t.name === 'Plain');
const forest = data.terrain.find((t) => t.name === 'Forest');
const arts = Array.isArray(data.weaponArts) ? data.weaponArts : data.weaponArts.arts;

function weapon(name, imbueId = null) {
  const found = data.weapons.find((w) => w.name === name);
  if (!found) throw new Error(`no weapon ${name}`);
  const copy = structuredClone(found);
  if (imbueId) applyImbue(copy, getImbueById(data.imbues, imbueId));
  return copy;
}

function unit(overrides = {}) {
  const base = {
    name: 'Unit',
    className: 'Myrmidon',
    tier: 'base',
    level: 5,
    faction: 'player',
    moveType: 'Infantry',
    stats: { HP: 30, STR: 10, MAG: 2, SKL: 12, SPD: 10, DEF: 6, RES: 3, LCK: 6, MOV: 5 },
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    skills: [],
    affixes: [],
    col: 4,
    row: 4,
  };
  const merged = { ...base, ...overrides, stats: { ...base.stats, ...(overrides.stats || {}) } };
  merged.currentHP = overrides.currentHP ?? merged.stats.HP;
  merged.inventory = merged.weapon ? [merged.weapon] : [];
  return merged;
}

const enemy = (overrides = {}) =>
  unit({
    name: 'Enemy',
    className: 'Fighter',
    faction: 'enemy',
    col: 5,
    row: 4,
    proficiencies: [{ type: 'Axe', rank: 'Prof' }],
    weapon: weapon('Iron Axe'),
    ...overrides,
  });

/**
 * Each scenario returns fresh units (resolution mutates flags on them) and the
 * attack's terrain, distance and optional weapon art.
 */
export const SCENARIOS = {
  plain: () => ({
    attacker: unit({ name: 'Edric', weapon: weapon('Iron Sword') }),
    defender: enemy(),
  }),
  brave_double: () => ({
    attacker: unit({
      name: 'Edric',
      stats: { SPD: 18, SKL: 14 },
      weapon: weapon('Brave Sword'),
    }),
    defender: enemy({ stats: { HP: 60, SPD: 4 } }),
  }),
  offense_procs: () => ({
    attacker: unit({
      name: 'Sera',
      stats: { SKL: 40, LCK: 30, SPD: 40, HP: 40 },
      currentHP: 22,
      skills: [
        'sol',
        'luna',
        'lethality',
        'adept',
        'commanders_gambit',
        'divine_charge',
        'seraph_strike',
      ],
      weapon: weapon('Steel Sword'),
    }),
    defender: enemy({ stats: { HP: 70, DEF: 8, RES: 2, SPD: 6 } }),
  }),
  aether_flare: () => ({
    attacker: unit({
      name: 'Kira',
      stats: { SKL: 36, SPD: 22 },
      currentHP: 15,
      skills: ['aether', 'flare'],
      weapon: weapon('Iron Sword'),
    }),
    defender: enemy({ stats: { HP: 60, RES: 6 } }),
  }),
  astra: () => ({
    attacker: unit({
      name: 'Vale',
      stats: { SKL: 60, SPD: 12 },
      skills: ['astra'],
      weapon: weapon('Iron Sword'),
    }),
    defender: enemy({ stats: { HP: 60 } }),
  }),
  defense_procs: () => ({
    attacker: unit({ name: 'Edric', stats: { STR: 22, SPD: 16 }, weapon: weapon('Steel Sword') }),
    defender: enemy({
      stats: { HP: 26, SKL: 45, SPD: 14, LCK: 60 },
      skills: ['pavise', 'aegis', 'miracle', 'cancel', 'intimidate', 'dragon_scale'],
    }),
  }),
  vantage_desperation: () => ({
    attacker: unit({
      name: 'Edric',
      stats: { SPD: 20, HP: 30 },
      currentHP: 12,
      skills: ['desperation'],
      weapon: weapon('Iron Sword'),
    }),
    defender: enemy({ stats: { HP: 40, SPD: 5 }, currentHP: 18, skills: ['vantage'] }),
  }),
  desperation: () => ({
    attacker: unit({
      name: 'Edric',
      stats: { SPD: 20, HP: 30 },
      currentHP: 12,
      skills: ['desperation'],
      weapon: weapon('Iron Sword'),
    }),
    defender: enemy({ stats: { HP: 40, SPD: 5 } }),
  }),
  cancel: () => ({
    attacker: unit({ name: 'Edric', stats: { SPD: 32, SKL: 30 }, weapon: weapon('Iron Sword') }),
    defender: enemy({ stats: { HP: 45, SPD: 25, SKL: 20 }, skills: ['cancel'] }),
  }),
  quick_riposte: () => ({
    attacker: unit({ name: 'Edric', weapon: weapon('Iron Sword') }),
    defender: enemy({ stats: { HP: 40, SPD: 8 }, skills: ['quick_riposte'] }),
  }),
  affixes_shield_thorns: () => ({
    attacker: unit({ name: 'Edric', stats: { SPD: 18 }, weapon: weapon('Brave Sword') }),
    defender: enemy({ stats: { HP: 50 }, affixes: ['shielded', 'thorns'] }),
  }),
  affix_teleporter: () => ({
    attacker: unit({ name: 'Edric', stats: { SPD: 18 }, weapon: weapon('Steel Sword') }),
    defender: enemy({ stats: { HP: 50 }, affixes: ['teleporter'] }),
  }),
  art_multihit: () => ({
    attacker: unit({ name: 'Edric', stats: { SKL: 20 }, weapon: weapon('Iron Sword') }),
    defender: enemy({ stats: { HP: 50 } }),
    art: 'sword_astra_strike',
  }),
  art_drain_crit: () => ({
    attacker: unit({
      name: 'Edric',
      stats: { SKL: 24 },
      currentHP: 10,
      weapon: weapon('Killer Axe'),
      proficiencies: [{ type: 'Axe', rank: 'Prof' }],
    }),
    defender: enemy({ stats: { HP: 50, LCK: 0 }, weapon: weapon('Iron Lance') }),
    art: 'axe_wild_abandon',
  }),
  imbue_binding_keen: () => ({
    attacker: unit({ name: 'Edric', weapon: weapon('Iron Sword', 'binding') }),
    defender: enemy({ stats: { HP: 60 }, weapon: weapon('Iron Axe', 'binding') }),
  }),
  imbue_vampiric_forest: () => ({
    attacker: unit({ name: 'Edric', currentHP: 14, weapon: weapon('Steel Sword', 'vampiric') }),
    defender: enemy({ stats: { HP: 60 }, weapon: weapon('Iron Axe', 'keen') }),
    defTerrain: forest,
  }),
  ranged_no_counter: () => ({
    attacker: unit({
      name: 'Wren',
      weapon: weapon('Steel Bow'),
      proficiencies: [{ type: 'Bow', rank: 'Prof' }],
      col: 3,
    }),
    defender: enemy(),
    distance: 2,
  }),
  magic_counter: () => ({
    attacker: unit({
      name: 'Lyra',
      stats: { MAG: 12, SKL: 16 },
      weapon: weapon('Fire'),
      proficiencies: [{ type: 'Tome', rank: 'Prof' }],
      skills: ['luna'],
    }),
    defender: enemy({ stats: { RES: 1, SKL: 30 }, skills: ['aegis', 'pavise'] }),
  }),
};

/** The skill context BattleScene.buildSkillCtx gives resolveCombat (minus scene-only mods). */
export function skillCtxFor(
  attacker,
  defender,
  artId = null,
  atkTerrain = plain,
  defTerrain = plain,
) {
  const atkMods = getSkillCombatMods(
    attacker,
    defender,
    [attacker],
    [defender],
    data.skills,
    atkTerrain,
    true,
    data.affixes,
    { classesData: data.classes, traitsData: data.traits },
  );
  const defMods = getSkillCombatMods(
    defender,
    attacker,
    [defender],
    [attacker],
    data.skills,
    defTerrain,
    false,
    data.affixes,
    { classesData: data.classes, traitsData: data.traits },
  );
  const art = artId ? arts.find((a) => a.id === artId) : null;
  if (artId && !art) throw new Error(`no art ${artId}`);
  return {
    atkMods,
    defMods,
    atkWeaponArtMods: art ? getWeaponArtCombatMods(art) : null,
    rollStrikeSkills,
    rollDefenseSkills,
    rollDefenseAffixes,
    getAttackAffixes,
    checkAstra,
    affixData: data.affixes,
    skillsData: data.skills,
    imbuesData: data.imbues,
  };
}

export function buildScenario(name) {
  const s = SCENARIOS[name]();
  const atkTerrain = s.atkTerrain || plain;
  const defTerrain = s.defTerrain || plain;
  const distance = s.distance ?? 1;
  return {
    ...s,
    atkTerrain,
    defTerrain,
    distance,
    skillCtx: skillCtxFor(s.attacker, s.defender, s.art || null, atkTerrain, defTerrain),
  };
}

/** Everything a resolved combat decides, as plain data. */
export function summarizeResult(result) {
  return {
    events: result.events.map((e) =>
      e.type === 'skill'
        ? ['skill', e.name, e.unit]
        : [
            e.attackerSide,
            e.miss ? 'miss' : e.isCrit ? 'crit' : 'hit',
            e.damage,
            e.targetHPAfter,
            e.heal || 0,
            (e.skillActivations || []).map((a) => a.id).join('+'),
            e.extraStrike ? 1 : 0,
            e.adeptStrike ? 1 : 0,
            e.warpRange || 0,
            e.reflectDamage || 0,
          ],
    ),
    attackerHP: result.attackerHP,
    defenderHP: result.defenderHP,
    poison: result.poisonEffects,
    imbueStatus: result.imbueStatusEffects,
    debuffs: result.debuffEvents,
    divine: result.divineChargeHeals,
  };
}

export const SEEDS = [1, 7, 42, 1234, 99991, 0xdeadbeef];
