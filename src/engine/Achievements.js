// Achievements — the player's lasting feats (docs/specs/achievements.md).
//
// A fixed catalog (data/achievements.json) of named feats in four tiers. They never change
// play: no currency, no item, no unlock. They belong to the player, not to a run or a slot:
// every slot's meta save carries the same grow-only state and the Records screen shows the
// union of them all.
//
// Earned only at durable points: a battle's victory commit, a route-map save, a run's end,
// the prologue's end. A Vision rewind or Continue from Map can therefore never award one and
// then take it back. Callers turn what happened into plain "facts" (engine/AchievementFacts.js,
// engine/BattleFeats.js) and MetaProgressionManager.recordAchievementFacts applies them here.
//
// Pure: no Phaser, no DOM, never the RNG.
//
// State (meta `achievements`): { v: 1,
//   earned: { <id>: { at } },              when each was first earned (ms; the earliest wins)
//   sets: { bosses, events, marks, epics, commanders, rungs, deeds },  ids met so far
//   tally: { steals: { <slot>: n } },      per slot, so a union never counts a steal twice
//   recent: [<battle key>] }               the last tallied battles (a retry adds nothing)
// An id this build does not know (a newer build's achievement) is kept as found.

import catalogData from '../../data/achievements.json' with { type: 'json' };
import { isDifficultyAtLeast } from './DifficultyEngine.js';

export const ACHIEVEMENTS_VERSION = 1;
export const ACHIEVEMENT_TIERS = Object.freeze(['bronze', 'silver', 'gold', 'blacksun']);
export const ACHIEVEMENT_SETS = Object.freeze([
  'bosses',
  'events',
  'marks',
  'epics',
  'commanders',
  'rungs',
  'deeds',
]);
export const ACHIEVEMENT_TALLIES = Object.freeze(['steals']);
/** The progress kinds an entry may show: each set, and the tallies. */
export const ACHIEVEMENT_PROGRESS = Object.freeze([...ACHIEVEMENT_SETS, ...ACHIEVEMENT_TALLIES]);

const ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_SET = 256;
const MAX_TEXT = 80;
const MAX_RECENT = 16;
const MAX_TALLY = 999_999;
// Act order for "Act III or later": the canonical sequence, whatever a rung's own list holds.
const ACT_ORDER = Object.freeze(['act1', 'act2', 'act3', 'act4', 'finalBoss']);

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const whole = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.trunc(Number(v))) : 0);
const list = (v) => (Array.isArray(v) ? v : []);

/** The catalog this build ships (data/achievements.json). */
export function achievementCatalog() {
  return catalogData;
}

/** The catalog's entries in order. */
export function achievementEntries(catalog = catalogData) {
  return list(catalog?.achievements).filter((entry) => isObject(entry) && entry.id);
}

export function actOrderOf(actId) {
  return ACT_ORDER.indexOf(actId);
}

// ── The rules ────────────────────────────────────────────────────────────
//
// One predicate per id over (facts, state). `facts` holds what a durable point knows:
//   facts.battle  — a won battle (BattleFeats.battleAchievementFacts)
//   facts.run     — the run as saved on the route map (AchievementFacts.runAchievementFacts)
//   facts.runEnd  — a finished run (AchievementFacts.runEndAchievementFacts)
//   facts.prologueComplete, facts.prologueProtectedFall — the prologue's two
//   facts.totals  — what "every" means (AchievementFacts.achievementTotals(gameData))
//   facts.known   — ids a set already proves from an older record (the retroactive pass)
//   facts.retro   — what an older save's milestones prove ({ firstBlood, firstGate, deeperRoads })
// A rule whose facts are absent is simply not met.

const won = (f) => f.runEnd?.victory === true;
// A won run whose counters were kept from its start: a "never" (no shop, no fall, never over
// par) can't be read from a run that was in progress when the counting began.
const wonCounted = (f) => won(f) && f.runEnd.fromStart === true;
const onRung = (f, rung) => f.runEnd?.difficulty === rung;
const atLeast = (f, rung) =>
  typeof f.runEnd?.difficulty === 'string' && isDifficultyAtLeast(f.runEnd.difficulty, rung);
const battle = (f) => (f.battle?.standard === true ? f.battle : null);
const slain = (f, name) => list(battle(f)?.bossesSlain).includes(name);
const inSet = (s, key, id) => list(s.sets?.[key]).includes(id);
const n = (v) => whole(v);

/** True when every id `totals[key]` lists is in the state's set (and the list is not empty). */
function setComplete(state, facts, key) {
  const want = list(facts.totals?.[key]);
  if (!want.length) return false;
  const have = new Set(list(state.sets?.[key]));
  return want.every((id) => have.has(id));
}

export const ACHIEVEMENT_RULES = Object.freeze({
  // The March
  banner_at_dawn: (f) => f.prologueComplete === true,
  first_blood: (f) => Boolean(battle(f)) || f.retro?.firstBlood === true,
  past_the_first_gate: (f) =>
    (battle(f)?.actId === 'act1' && battle(f)?.actBoss === true) || f.retro?.firstGate === true,
  deeper_roads: (f) => actOrderOf(battle(f)?.actId) >= 2 || f.retro?.deeperRoads === true,
  // A won run's rung joins the `rungs` set as the facts are applied (setGains).
  first_light: (f, s) => inSet(s, 'rungs', 'normal'),
  down_the_stair: (f) => battle(f)?.descent === true,
  into_the_dusk: (f, s) => inSet(s, 'rungs', 'dusk'),
  the_glass_breaks: (f) => battle(f)?.gateBoss === true,
  the_sleeper_falls: (f, s) => inSet(s, 'bosses', 'The Entity'),
  black_sun: (f, s) => inSet(s, 'rungs', 'lunatic'),
  every_rung: (f, s) => setComplete(s, f, 'rungs'),
  kingslayers_ledger: (f, s) => setComplete(s, f, 'bosses'),
  who_rides_again: (f) => battle(f)?.ngPlusVeteran === true,
  // The Field
  seize_the_day: (f) => battle(f)?.objective === 'seize',
  ahead_of_the_dark: (f) => {
    const b = battle(f);
    return n(b?.par) > 0 && n(b?.turn) > 0 && n(b.turn) <= n(b.par) - 3;
  },
  not_a_scratch: (f) => {
    const b = battle(f);
    return n(b?.foesDefeated) >= 6 && n(b.alliesWounded) === 0 && n(b.alliesFallen) === 0;
  },
  all_out: (f) => battle(f)?.objective === 'escape' && battle(f)?.allEscaped === true,
  heavy_hand: (f) => n(battle(f)?.maxStrike) >= 50,
  red_harvest: (f) => n(battle(f)?.maxUnitKills) >= 10,
  shatter: (f) => n(battle(f)?.shatters) > 0,
  dawn_strike: (f) => n(battle(f)?.turn) === 1,
  encore: (f) => n(battle(f)?.maxRefreshBurst) >= 3,
  light_fingers: (f) => n(battle(f)?.steals) > 0,
  cutpurse: (f, s) => tallyTotal(s, 'steals') >= 15,
  bolt_from_the_blue: (f) => n(battle(f)?.ballistaBossKills) > 0,
  rink: (f) => n(battle(f)?.maxPushTiles) >= 4,
  bone_dry: (f) => n(battle(f)?.cleanNecromancerKills) > 0,
  silent_vigil: (f) => battle(f)?.vigil === true && n(battle(f)?.vigilSummoned) === 0,
  root_and_branch: (f) =>
    slain(f, 'The Entity') && battle(f)?.limbsEnabled === true && n(battle(f)?.limbsSprouted) === 0,
  // The Company
  talked_down: (f) => n(battle(f)?.talkRecruits) > 0,
  new_colours: (f) => f.run?.playerPromotion === true,
  a_name_to_remember: (f, s) => f.run?.epithet === true || list(s.sets?.deeds).length > 0,
  sworn: (f) => f.run?.oath === true,
  spoils_of_war: (f) => n(f.run?.bossRecruits) > 0,
  marked: (f) => list(f.run?.markIds).length > 0,
  five_marks: (f, s) => setComplete(s, f, 'marks'),
  perfect_year: (f) => n(battle(f)?.perfectLevelUps) > 0,
  living_legend: (f) => n(f.run?.maxDeeds) >= 5,
  full_banner: (f) =>
    list(f.totals?.lords).length > 0 && n(f.run?.lordCount) >= list(f.totals.lords).length,
  lone_lord: (f) => battle(f)?.loneCommander === true && actOrderOf(battle(f).actId) >= 2,
  nobody_left_behind: (f) => wonCounted(f) && atLeast(f, 'hard') && n(f.runEnd.allyFalls) === 0,
  every_deed: (f, s) => setComplete(s, f, 'deeds'),
  seven_banners: (f, s) => setComplete(s, f, 'commanders'),
  // The Road
  a_vow_taken: (f) => n(f.run?.blessingVows) > 0,
  a_price_paid: (f) => n(f.run?.actBossCards) > 0,
  not_today: (f) => n(f.run?.visionUses) > 0,
  cleansed: (f) => n(f.run?.cleanses) > 0,
  paid_in_full: (f) => n(f.run?.contractsPaid) > 0,
  dark_omen: (f) => n(f.run?.darkOmens) > 0,
  old_stones: (f) => n(f.run?.sanctums) > 0,
  under_the_dark: (f) => battle(f)?.eclipsedElite === true,
  crowd_pleaser: (f) => n(f.run?.arenaGoldWins) + n(f.run?.arenaPlatinumWins) > 0,
  champion_of_the_pit: (f) => n(f.run?.arenaPlatinumWins) > 0,
  deep_pockets: (f) => n(f.run?.gold) >= 10_000,
  masterwork: (f) => n(f.run?.maxForge) >= 10,
  one_of_a_kind: (f) => list(f.run?.epicNames).length > 0,
  trophy_hunter: (f) => f.run?.trophy === true,
  every_road_a_tale: (f, s) => setComplete(s, f, 'events'),
  armory_of_legends: (f, s) => setComplete(s, f, 'epics'),
  // The Challenge
  self_reliant: (f) => wonCounted(f) && n(f.runEnd.shopBuys) === 0,
  clear_sight: (f) => won(f) && atLeast(f, 'hard') && n(f.runEnd.visionUses) === 0,
  few_and_proud: (f) => won(f) && list(f.runEnd.blessingIds).includes('the_chosen_few'),
  on_schedule: (f) =>
    wonCounted(f) && atLeast(f, 'hard') && n(f.runEnd.battlesWon) > 0 && n(f.runEnd.overPar) === 0,
  no_blessing: (f) => won(f) && onRung(f, 'lunatic') && f.runEnd.shrineSkipped === true,
  the_unbroken_thread: (f) =>
    wonCounted(f) &&
    onRung(f, 'lunatic') &&
    n(f.runEnd.allyFalls) === 0 &&
    n(f.runEnd.visionUses) === 0,
  // Secrets
  not_this_thread: (f) => f.prologueProtectedFall === true,
  third_time: (f) => n(battle(f)?.bossBeatenAfterLosses) >= 3,
  unfathomed: (f) => n(battle(f)?.entityCrits) > 0,
  the_heralds_ear: (f) => slain(f, 'The Entity') && battle(f)?.heraldHeard === true,
});

// ── Catalog validation ───────────────────────────────────────────────────

/** `npm run validate:data` and the tests: every entry well formed and backed by a rule. */
export function validateAchievementsCatalog(catalog = catalogData) {
  const errors = [];
  if (!isObject(catalog)) return { valid: false, errors: ['catalog is not an object'] };
  if (catalog.version !== ACHIEVEMENTS_VERSION) errors.push('version must be 1');
  const sections = new Set(list(catalog.sections).map((s) => s?.id));
  const tiers = list(catalog.tiers).map((t) => t?.id);
  if (JSON.stringify(tiers) !== JSON.stringify(ACHIEVEMENT_TIERS))
    errors.push(`tiers must be ${ACHIEVEMENT_TIERS.join(', ')} in order`);
  const seen = new Set();
  for (const entry of list(catalog.achievements)) {
    const id = entry?.id;
    const at = `achievement ${id}`;
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      errors.push(`bad id ${JSON.stringify(id)}`);
      continue;
    }
    if (seen.has(id)) errors.push(`${at}: duplicate id`);
    seen.add(id);
    for (const key of ['name', 'rule']) {
      if (typeof entry[key] !== 'string' || !entry[key].trim())
        errors.push(`${at}: ${key} missing`);
    }
    if (typeof entry.name === 'string' && entry.name.length > 28)
      errors.push(`${at}: name over 28 characters`);
    if (typeof entry.rule === 'string' && entry.rule.length > 90)
      errors.push(`${at}: rule over 90 characters`);
    if (!ACHIEVEMENT_TIERS.includes(entry.tier)) errors.push(`${at}: unknown tier`);
    if (!sections.has(entry.section)) errors.push(`${at}: unknown section`);
    if (entry.secret !== undefined && typeof entry.secret !== 'boolean')
      errors.push(`${at}: secret must be a boolean`);
    if (entry.progress !== undefined && !ACHIEVEMENT_PROGRESS.includes(entry.progress))
      errors.push(`${at}: unknown progress kind`);
    if (ACHIEVEMENT_TALLIES.includes(entry.progress) && !(whole(entry.goal) > 0))
      errors.push(`${at}: a tally needs a goal`);
    if (typeof ACHIEVEMENT_RULES[id] !== 'function') errors.push(`${at}: no rule`);
  }
  for (const id of Object.keys(ACHIEVEMENT_RULES))
    if (!seen.has(id)) errors.push(`rule ${id} has no catalog entry`);
  return { valid: errors.length === 0, errors };
}

// ── State ────────────────────────────────────────────────────────────────

export function emptyAchievementState() {
  const sets = {};
  for (const key of ACHIEVEMENT_SETS) sets[key] = [];
  const tally = {};
  for (const key of ACHIEVEMENT_TALLIES) tally[key] = {};
  return { v: ACHIEVEMENTS_VERSION, earned: {}, sets, tally, recent: [] };
}

function cleanText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= MAX_TEXT ? text : null;
}

function cleanSet(values) {
  const out = new Set();
  for (const value of list(values)) {
    const text = cleanText(value);
    if (text) out.add(text);
  }
  return [...out].sort().slice(0, MAX_SET);
}

/** A clean copy of a saved state (anything garbled is dropped; unknown ids are kept). */
export function normalizeAchievementState(raw) {
  const out = emptyAchievementState();
  if (!isObject(raw)) return out;
  if (isObject(raw.earned)) {
    for (const id of Object.keys(raw.earned).sort()) {
      if (!ID_PATTERN.test(id)) continue;
      const at = Number(raw.earned[id]?.at);
      out.earned[id] = { at: Number.isFinite(at) && at > 0 ? Math.trunc(at) : 0 };
    }
  }
  for (const key of ACHIEVEMENT_SETS) out.sets[key] = cleanSet(raw.sets?.[key]);
  for (const key of ACHIEVEMENT_TALLIES) {
    const bySlot = raw.tally?.[key];
    if (!isObject(bySlot)) continue;
    for (const slot of Object.keys(bySlot).sort()) {
      if (!/^[a-z0-9_]{1,16}$/.test(slot)) continue;
      const count = Math.min(MAX_TALLY, whole(bySlot[slot]));
      if (count > 0) out.tally[key][slot] = count;
    }
  }
  out.recent = [...new Set(list(raw.recent).map(cleanText).filter(Boolean))].slice(-MAX_RECENT);
  return out;
}

/**
 * The union of any number of states: every achievement earned in any (at its earliest
 * date; an unknown date never hides a known one), every set's ids, each slot's largest tally.
 */
export function mergeAchievementStates(...states) {
  const out = emptyAchievementState();
  const recent = [];
  for (const raw of states) {
    const state = normalizeAchievementState(raw);
    for (const [id, { at }] of Object.entries(state.earned)) {
      const prior = out.earned[id];
      if (!prior) out.earned[id] = { at };
      else if (at > 0 && (prior.at === 0 || at < prior.at)) prior.at = at;
    }
    for (const key of ACHIEVEMENT_SETS)
      out.sets[key] = cleanSet([...out.sets[key], ...state.sets[key]]);
    for (const key of ACHIEVEMENT_TALLIES)
      for (const [slot, count] of Object.entries(state.tally[key]))
        out.tally[key][slot] = Math.max(out.tally[key][slot] || 0, count);
    recent.push(...state.recent);
  }
  return normalizeAchievementState({ ...out, recent });
}

/** Two states hold the same record (a write can be skipped). */
export function sameAchievementState(a, b) {
  return (
    JSON.stringify(normalizeAchievementState(a)) === JSON.stringify(normalizeAchievementState(b))
  );
}

export function tallyTotal(state, key) {
  let total = 0;
  for (const count of Object.values(state?.tally?.[key] || {})) total += whole(count);
  return total;
}

export function isEarned(state, id) {
  return Boolean(state?.earned && Object.hasOwn(state.earned, id));
}

// ── Applying facts ───────────────────────────────────────────────────────

/** The ids each set gains from these facts (names a set may hold, as given). */
function setGains(facts) {
  const b = battle(facts);
  const gains = {
    bosses: list(b?.bossesSlain),
    events: list(facts.run?.eventIds),
    marks: list(facts.run?.markIds),
    epics: list(facts.run?.epicNames),
    commanders: won(facts) ? [facts.runEnd.commander] : [],
    rungs: won(facts) ? [facts.runEnd.difficulty] : [],
    deeds: list(facts.deedIds),
  };
  for (const key of ACHIEVEMENT_SETS) gains[key] = [...gains[key], ...list(facts.known?.[key])];
  return gains;
}

/**
 * Apply what a durable point knows. Returns the next state and the catalog ids newly earned,
 * in catalog order. Pure: `state` is not changed.
 * @param {object} state  an achievement state (normalized here)
 * @param {object} facts  see ACHIEVEMENT_RULES
 * @param {{ now?: number, slot?: string|number|null, catalog?: object }} [ctx]
 */
export function applyAchievementFacts(state, facts = {}, ctx = {}) {
  const next = normalizeAchievementState(state);
  const f = isObject(facts) ? facts : {};
  const gains = setGains(f);
  for (const key of ACHIEVEMENT_SETS) next.sets[key] = cleanSet([...next.sets[key], ...gains[key]]);
  // A battle's steals count once, on the slot that won it.
  const key = cleanText(battle(f)?.key);
  const steals = whole(battle(f)?.steals);
  if (key && steals > 0 && !next.recent.includes(key)) {
    const slot = /^[a-z0-9_]{1,16}$/.test(String(ctx.slot ?? '')) ? String(ctx.slot) : 'local';
    next.tally.steals[slot] = Math.min(MAX_TALLY, (next.tally.steals[slot] || 0) + steals);
    next.recent = [...next.recent, key].slice(-MAX_RECENT);
  }
  const now = Number.isFinite(ctx.now) ? Math.trunc(ctx.now) : Date.now();
  const unlocked = [];
  for (const entry of achievementEntries(ctx.catalog || catalogData)) {
    if (isEarned(next, entry.id)) continue;
    const rule = ACHIEVEMENT_RULES[entry.id];
    let met;
    try {
      met = typeof rule === 'function' && rule(f, next) === true;
    } catch {
      met = false; // a rule never breaks the point that asked
    }
    if (!met) continue;
    next.earned[entry.id] = { at: now };
    unlocked.push(entry.id);
  }
  return { state: normalizeAchievementState(next), unlocked };
}

// ── Reading ──────────────────────────────────────────────────────────────

/**
 * Progress toward a counted entry: `{ have, goal }`, or null for an entry that counts
 * nothing (or a set whose total the game data does not give).
 */
export function achievementProgress(state, entry, totals = {}) {
  const kind = entry?.progress;
  if (!kind) return null;
  if (ACHIEVEMENT_TALLIES.includes(kind)) {
    const goal = whole(entry.goal);
    return goal > 0 ? { have: Math.min(goal, tallyTotal(state, kind)), goal } : null;
  }
  const want = list(totals?.[kind]);
  if (!want.length) return null;
  const have = new Set(list(state?.sets?.[kind]));
  return { have: want.filter((id) => have.has(id)).length, goal: want.length };
}
