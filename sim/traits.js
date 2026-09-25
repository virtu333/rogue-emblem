// Trait Value Simulator — what each recruit trait is worth on each recruitable class.
//
// Usage: node sim/traits.js [--trials N] [--seed S] [--csv] [--scenario act2|act3|all]
//                           [--traits path/to/traits.json] [--only id,id]
//
// Method (common random numbers): for every (class, trial) the unit, its enemies
// and every combat roll come from the same seeds with and without the trait, so
// the reported delta is the trait's own effect rather than roll noise.
//
// * The unit is created at level 1, the trait's creation mods are baked in, then it
//   levels to the scenario level (so growth mods count), and gets its tier weapon.
// * Three measures against enemies sampled from the act pool:
//   - win:  attrition duel — the unit initiates, then the enemy, up to 5 rounds;
//   - kill: one player-phase exchange the unit initiates, from full HP;
//   - surv: one enemy phase in which two fresh enemies attack the unit.
//   Staff-only classes cannot initiate, so they only have `surv`.
// * HP conditions (above 75%, half HP) play out naturally as HP drops. Positional
//   conditions (cover, adjacent ally, no ally near) are switched on for both the
//   baseline and the trait run; a finisher (foe at half HP) faces a pre-wounded
//   foe in both runs. So these read as "value while active"; uptime is a design
//   judgement documented in docs/specs/traits-v2.md.
// * Mastery traits are measured on a mastered unit against the same mastered unit
//   with only its class perk.
// * Movement and XP traits have no combat effect and read as zero here.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { installSeed, restoreMathRandom } from './lib/SeededRNG.js';
import { getData, createEnemy, getTieredWeapon } from './lib/SimUnitFactory.js';
import { sampleEnemyFromAct } from './lib/EnemySampling.js';
import { printTable, toCSV, parseArgs, printHeader } from './lib/TableFormatter.js';
import { resolveCombat, parseRange, isStaff } from '../src/engine/Combat.js';
import { getSkillCombatMods, rollStrikeSkills, checkAstra } from '../src/engine/SkillSystem.js';
import {
  createUnit,
  levelUp,
  applyLevelUpGains,
  checkLevelUpSkills,
} from '../src/engine/UnitManager.js';
import * as TraitSystem from '../src/engine/TraitSystem.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const opts = parseArgs({
  trials: 300,
  seed: 7,
  csv: false,
  scenario: 'all',
  traits: null,
  only: null,
});
if (opts.help) {
  console.log(
    'Usage: node sim/traits.js [--trials N] [--seed S] [--csv] [--scenario act2|act3|all] [--traits file]',
  );
  process.exit(0);
}

const data = getData();
const traitsPath = opts.traits || join(__dirname, '..', 'data', 'traits.json');
const traitsData = JSON.parse(readFileSync(traitsPath, 'utf-8'));
const terrainByName = Object.fromEntries(data.terrain.map((t) => [t.name, t]));
const PLAIN = terrainByName.Plain || null;
const FOREST = terrainByName.Forest || null;

// Every base class a recruit, merc or boss recruit can roll traits on.
const RECRUIT_CLASSES = [
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

const SCENARIOS = {
  act2: { act: 'act2', level: 6, label: 'Act 2 — recruit L6 vs act2 pool (L3–8)' },
  act3: { act: 'act3', level: 13, label: 'Act 3 — recruit L13 vs act3 pool (L8–15)' },
};

function hashSeed(...parts) {
  let h = 2166136261 >>> 0;
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h ^ (opts.seed >>> 0)) >>> 0;
}

function conditionsOf(trait) {
  const raw = trait?.combatMods;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((m) => m.condition).filter(Boolean);
}

/** The battlefield state that switches a trait on (applied to baseline too). */
function activationState(trait) {
  const state = { terrain: PLAIN, ally: 'none', mastered: false };
  for (const c of conditionsOf(trait)) {
    if (c === 'on_forest' || c === 'on_forest_or_mountain' || c === 'in_cover')
      state.terrain = FOREST;
    if (c === 'adjacent_ally') state.ally = 'adjacent';
    // A finisher's job: the foe an ally already chipped to half HP.
    if (c === 'foe_below50') state.foeWounded = true;
  }
  if (trait?.masteryPerkOverride || trait?.masteryPerkMultiplier || trait?.masteryPerkBonus)
    state.mastered = true;
  return state;
}

function isCombatRelevant(trait) {
  return Boolean(
    trait.creationMods ||
    trait.combatMods ||
    trait.masteryPerkOverride ||
    trait.masteryPerkMultiplier ||
    trait.masteryPerkBonus,
  );
}

function buildUnit(className, level, trait, seed) {
  installSeed(seed);
  try {
    const classData = data.classes.find((c) => c.name === className);
    const unit = createUnit(classData, 1, data.weapons, { name: className, faction: 'player' });
    unit.skills = [];
    unit.traits = [];
    if (trait) {
      unit.traits = [trait.id];
      TraitSystem.applyTraitCreationMods(unit, trait);
    }
    for (let i = 1; i < level; i++) {
      const gains = levelUp(unit);
      if (gains) applyLevelUpGains(unit, gains);
    }
    const weapon = getTieredWeapon(className, level);
    if (weapon) {
      unit.weapon = structuredClone(weapon);
      unit.inventory = [unit.weapon];
    }
    checkLevelUpSkills(unit, data.classes);
    unit.currentHP = unit.stats.HP;
    return unit;
  } finally {
    restoreMathRandom();
  }
}

function buildEnemy(act, seed) {
  installSeed(seed);
  try {
    const spec = sampleEnemyFromAct(data.enemies, data.classes, act);
    const enemy = createEnemy(spec.className, spec.level, data.skills, act);
    enemy.currentHP = enemy.stats.HP;
    return enemy;
  } finally {
    restoreMathRandom();
  }
}

function preferredDistance(weapon) {
  if (!weapon || isStaff(weapon)) return 1;
  const { min } = parseRange(weapon.range);
  return Math.max(1, min);
}

function fight(attacker, defender, playerSide, state, seed) {
  const unit = playerSide === 'attacker' ? attacker : defender;
  const foe = playerSide === 'attacker' ? defender : attacker;
  const distance = preferredDistance(attacker.weapon);
  unit.col = 5;
  unit.row = 5;
  foe.col = 5 + distance;
  foe.row = 5;
  const ally = { ...unit, name: 'Ally', traits: [], skills: [], col: 5, row: 4, currentHP: 10 };
  const allies = state.ally === 'adjacent' ? [unit, ally] : [unit];
  const unitTerrain = state.terrain;
  const ctx = { classesData: data.classes, traitsData };
  const atkTerrain = attacker === unit ? unitTerrain : PLAIN;
  const defTerrain = defender === unit ? unitTerrain : PLAIN;
  const atkAllies = attacker === unit ? allies : [attacker];
  const defAllies = defender === unit ? allies : [defender];
  installSeed(seed);
  try {
    const atkMods = getSkillCombatMods(
      attacker,
      defender,
      atkAllies,
      defAllies,
      data.skills,
      atkTerrain,
      true,
      null,
      ctx,
    );
    const defMods = getSkillCombatMods(
      defender,
      attacker,
      defAllies,
      atkAllies,
      data.skills,
      defTerrain,
      false,
      null,
      ctx,
    );
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      distance,
      atkTerrain,
      defTerrain,
      { atkMods, defMods, rollStrikeSkills, checkAstra, skillsData: data.skills },
    );
    const unitStart = unit.currentHP;
    const foeStart = foe.currentHP;
    const unitEnd = Math.max(0, playerSide === 'attacker' ? result.attackerHP : result.defenderHP);
    const foeEnd = Math.max(0, playerSide === 'attacker' ? result.defenderHP : result.attackerHP);
    return {
      dealt: foeStart - foeEnd,
      taken: unitStart - unitEnd,
      kill: foeEnd <= 0 ? 1 : 0,
      death: unitEnd <= 0 ? 1 : 0,
    };
  } finally {
    restoreMathRandom();
  }
}

function prepare(unit, enemy, state) {
  const u = structuredClone(unit);
  const e = structuredClone(enemy);
  if (state.mastered) u.classBattles = { [u.className]: 99 };
  if (state.foeWounded) e.currentHP = Math.max(1, Math.floor(e.stats.HP / 2));
  return { u, e };
}

const MAX_ROUNDS = 5;

/**
 * Attrition duel: the unit initiates, then the enemy initiates, repeated until
 * someone falls (max 5 rounds). HP-conditional traits switch on naturally as
 * HP drops. Returns 1 win / 0.5 draw / 0 loss. Staff-only units cannot duel.
 */
function duel(unit, enemy, state, seedKey) {
  const { u, e } = prepare(unit, enemy, state);
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const pp = fight(u, e, 'attacker', state, hashSeed('duel-pp', seedKey, round));
    u.currentHP -= pp.taken;
    e.currentHP -= pp.dealt;
    if (e.currentHP <= 0) return 1;
    if (u.currentHP <= 0) return 0;
    const ep = fight(e, u, 'defender', state, hashSeed('duel-ep', seedKey, round));
    u.currentHP -= ep.taken;
    e.currentHP -= ep.dealt;
    if (e.currentHP <= 0) return 1;
    if (u.currentHP <= 0) return 0;
  }
  return 0.5;
}

/**
 * Staying power: two different fresh enemies attack the unit in one enemy phase
 * (the unit counters if it can). Returns 1 if it is still standing.
 */
function survive(unit, enemies, state, seedKey) {
  const { u } = prepare(unit, enemies[0], state);
  for (let i = 0; i < enemies.length; i++) {
    const e = structuredClone(enemies[i]);
    const ep = fight(e, u, 'defender', state, hashSeed('surv', seedKey, i));
    u.currentHP -= ep.taken;
    if (u.currentHP <= 0) return 0;
  }
  return 1;
}

const unitCache = new Map();
const enemyCache = new Map();
const baseCache = new Map();

function cachedEnemy(act, key) {
  const k = `${act}|${key}`;
  if (!enemyCache.has(k)) enemyCache.set(k, buildEnemy(act, hashSeed('enemy', act, key)));
  return enemyCache.get(k);
}

function cachedBaseUnit(className, scenario, t) {
  const k = `${className}|${scenario.act}|${t}`;
  if (!unitCache.has(k))
    unitCache.set(
      k,
      buildUnit(className, scenario.level, null, hashSeed('unit', className, scenario.act, t)),
    );
  return unitCache.get(k);
}

function canInitiate(className) {
  const probe = buildUnit(className, 1, null, 1);
  return Boolean(probe.weapon && !isStaff(probe.weapon));
}

/** One player-phase exchange from full HP: does the unit kill its target? */
function strike(unit, enemy, state, seedKey) {
  const { u, e } = prepare(unit, enemy, state);
  return fight(u, e, 'attacker', state, hashSeed('strike', seedKey)).kill;
}

function runTrials(className, scenario, state, trials, unitFor) {
  const initiates = canInitiate(className);
  const totals = { win: 0, kill: 0, surv: 0 };
  for (let t = 0; t < trials; t++) {
    const unit = unitFor(t);
    const key = `${className}|${scenario.act}|${t}`;
    const pair = [
      cachedEnemy(scenario.act, `surv-a-${t}`),
      cachedEnemy(scenario.act, `surv-b-${t}`),
    ];
    if (initiates) {
      totals.win += duel(unit, cachedEnemy(scenario.act, `duel-${t}`), state, key);
      totals.kill += strike(unit, cachedEnemy(scenario.act, `strike-${t}`), state, key);
    }
    totals.surv += survive(unit, pair, state, key);
  }
  const pct = (v) => (v / trials) * 100;
  return {
    win: initiates ? pct(totals.win) : null,
    kill: initiates ? pct(totals.kill) : null,
    surv: pct(totals.surv),
  };
}

const BASE_STATE_KEY = JSON.stringify({ terrain: PLAIN, ally: 'none', mastered: false });

function evaluate(className, scenario, trait, trials) {
  const state = activationState(trait);
  const baseKey = `${className}|${scenario.act}|${JSON.stringify(state)}`;
  if (!baseCache.has(baseKey))
    baseCache.set(
      baseKey,
      runTrials(className, scenario, state, trials, (t) => cachedBaseUnit(className, scenario, t)),
    );
  const base = baseCache.get(baseKey);
  const withTrait = runTrials(className, scenario, state, trials, (t) =>
    buildUnit(className, scenario.level, trait, hashSeed('unit', className, scenario.act, t)),
  );
  const delta = (m) => (withTrait[m] == null ? null : withTrait[m] - base[m]);
  return { win: delta('win'), kill: delta('kill'), surv: delta('surv') };
}

/** Whether the live roll rules could put this trait on this class. */
function rollable(trait, className) {
  if (trait.rarity === 'legendary' || trait.retired) return false;
  const probe = buildUnit(className, 1, null, 1);
  if (typeof TraitSystem.isTraitEligible === 'function') {
    return TraitSystem.isTraitEligible(trait, probe);
  }
  return (
    !trait.eligibleWeaponTypes ||
    probe.proficiencies.some((p) => trait.eligibleWeaponTypes.includes(p.type))
  );
}

const fmt = (v, digits = 1) => (v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`);
const only = typeof opts.only === 'string' ? new Set(opts.only.split(',')) : null;
const candidates = traitsData.filter(
  (t) =>
    t.rarity !== 'legendary' &&
    !t.retired &&
    isCombatRelevant(t) &&
    (!only || only.has(t.id) || only.has(t.name)),
);
const scenarioKeys = opts.scenario === 'all' ? Object.keys(SCENARIOS) : [opts.scenario];
const rollableCache = new Map();
function isRollable(trait, className) {
  const k = `${trait.id}|${className}`;
  if (!rollableCache.has(k)) rollableCache.set(k, rollable(trait, className));
  return rollableCache.get(k);
}

const METRICS = [
  ['win', 'Δ attrition-duel win % (unit initiates, then the enemy, up to 5 rounds)'],
  ['kill', 'Δ player-phase kill % (one exchange the unit initiates)'],
  ['surv', 'Δ survive-two-attackers % (one enemy phase, two fresh enemies)'],
];

for (const key of scenarioKeys) {
  const scenario = SCENARIOS[key];
  if (!scenario) throw new Error(`Unknown scenario ${key}`);
  const tables = Object.fromEntries(METRICS.map(([m]) => [m, []]));
  const summary = [];
  for (const trait of candidates) {
    const rows = Object.fromEntries(METRICS.map(([m]) => [m, { Trait: trait.name }]));
    const agg = Object.fromEntries(METRICS.map(([m]) => [m, []]));
    for (const className of RECRUIT_CLASSES) {
      const r = evaluate(className, scenario, trait, opts.trials);
      const mark = isRollable(trait, className) ? '' : '·';
      for (const [m] of METRICS) {
        rows[m][className] = r[m] == null ? 'n/a' : `${fmt(r[m])}${mark}`;
        if (!mark && r[m] != null) agg[m].push(r[m]);
      }
    }
    const sumRow = { Trait: trait.name };
    for (const [m] of METRICS) {
      const list = agg[m];
      const mean = list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
      const worst = list.length ? Math.min(...list) : null;
      rows[m].Mean = fmt(mean);
      rows[m].Worst = fmt(worst);
      tables[m].push(rows[m]);
      sumRow[`${m} mean`] = fmt(mean);
      sumRow[`${m} worst`] = fmt(worst);
    }
    summary.push(sumRow);
  }
  const columns = ['Trait', ...RECRUIT_CLASSES, 'Mean', 'Worst'];
  for (const [m, title] of METRICS) {
    printHeader(`${scenario.label} — ${title} — ${opts.trials} trials`);
    if (opts.csv) toCSV(columns, tables[m]);
    else printTable(columns, tables[m]);
  }
  printHeader(`${scenario.label} — summary over rollable classes`);
  const summaryColumns = ['Trait', ...METRICS.flatMap(([m]) => [`${m} mean`, `${m} worst`])];
  if (opts.csv) toCSV(summaryColumns, summary);
  else printTable(summaryColumns, summary);
  if (!opts.csv) {
    const baseRow = { Trait: 'baseline win / kill / surv %' };
    for (const className of RECRUIT_CLASSES) {
      const b = baseCache.get(`${className}|${scenario.act}|${BASE_STATE_KEY}`);
      const f = (v) => (v == null ? 'n/a' : v.toFixed(0));
      baseRow[className] = b ? `${f(b.win)}/${f(b.kill)}/${f(b.surv)}` : '';
    }
    printTable(['Trait', ...RECRUIT_CLASSES], [baseRow]);
    console.log(
      '  · = the live roll rules never put this trait on this class (Mean/Worst skip it).',
    );
    console.log(
      '  Terrain/ally conditions are switched on for both runs; HP conditions play out naturally;',
    );
    console.log('  mastery traits are compared on a mastered unit against its class perk alone.');
  }
}
