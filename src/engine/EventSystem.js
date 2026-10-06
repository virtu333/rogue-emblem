// EventSystem.js — the catalog, eligibility, the pick and outcome selection of the story
// Events on the route map (docs/specs/event-nodes.md §2-§4). Pure: no Phaser, no DOM, and
// never Math.random: every draw comes from createSeededRng(eclipseHash(key)) keyed off the
// run seed and the node, so a refresh, a save/load or a revert rebuilds the same event,
// the same outcome and the same sub-picks, and no other stream (node map, battle, Eclipse)
// moves.
//
// Seeds (all `${runSeed}` = the run seed, `${nodeId}` = the event node):
//   event-pick:${runSeed}:${nodeId}:${eventId}      one weighted key per eligible event
//   event-fallen:${runSeed}:${nodeId}               which fallen ally the Echo names
//   event:${runSeed}:${nodeId}:${choiceId}          the outcome (weights or a check)
//   event:${runSeed}:${nodeId}:${choiceId}:${n}:..  each effect's own sub-picks (EventEffects)
//
// Vocabulary shared with EventEffects, EventCommands and EventValidation:
//   amount      a number, or { base, perAct } (act1 = base + perAct x 1 ... act4 = x 4)
//   byRung      a table keyed by difficulty id; the value of the highest rung at or below
//               the run's wins ("Nightfall 45" also holds on Black Sun unless Black Sun has
//               its own entry). costScale is the exception: every rung is listed.
//   requires    event- or choice-level gates (see evaluateRequires)
//   filter      the per-unit target filter (see targetFilterBlock)

import { createSeededRng } from './BlessingEngine.js';
import { eclipseHash, eclipsePhase, isEclipseActive } from './EclipseSystem.js';
import { DIFFICULTY_IDS, isDifficultyAtLeast, difficultyRank } from './DifficultyEngine.js';
import { isPrologueRun } from './ScriptedBattle.js';
import { knowsSkill, benchedSkillsOf, ENEMY_ONLY_CLASS_NAMES } from './UnitManager.js';
import { unitUidOf } from './UnitIdentity.js';
import { NODE_TYPES } from '../utils/constants.js';

export const EVENT_ACTS = Object.freeze(['act1', 'act2', 'act3', 'act4']);
export const FALLBACK_EVENT_ID = 'quiet_road';

/** The `requires` keys the engine knows (plus the free-text `reason`). */
export const REQUIRES_KEYS = Object.freeze([
  'acts',
  'minRow',
  'maxRow',
  'difficultyAtLeast',
  'difficultyAtMost',
  'phaseAtLeast',
  'phaseAtMost',
  'goldAtLeast',
  'roster',
  'fallen',
  'consumable',
  'flag',
  'notFlag',
  'notBurden',
  'blessingTier',
]);

/** The per-unit target filter keys. */
export const FILTER_KEYS = Object.freeze([
  'weaponTypes',
  'magic',
  'staff',
  'notLord',
  'minLevel',
  'notFullHp',
  'living',
  'learnsFromFallen',
]);

/** Keys of a `requires.roster` block. */
export const ROSTER_REQUIRES_KEYS = Object.freeze(['weaponTypes', 'magic', 'staff', 'minUnits']);

// ── Catalog ─────────────────────────────────────────────────────────────

/**
 * The events catalog for a run: `catalog` (an events.json object) or the run's own
 * gameData.events. Returns null when there is none.
 */
export function eventCatalogOf(run, catalog = null) {
  const data = catalog || run?.gameData?.events || null;
  return data && Array.isArray(data.events) ? data : null;
}

/** One event definition by id, or null. */
export function findEvent(catalog, eventId) {
  return (catalog?.events || []).find((event) => event?.id === eventId) || null;
}

/** One choice of an event by id, or null. */
export function findChoice(event, choiceId) {
  return (event?.choices || []).find((choice) => choice?.id === choiceId) || null;
}

/** The fallback event (never picked by weight): the entry marked `fallback`, else quiet_road. */
export function fallbackEvent(catalog) {
  return (
    (catalog?.events || []).find((event) => event?.fallback === true) ||
    findEvent(catalog, FALLBACK_EVENT_ID)
  );
}

// ── Small helpers ───────────────────────────────────────────────────────

function int(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** The run seed as the events use it (a finite number, else 0). */
export function runSeedOf(run) {
  const seed = Number(run?.runSeed);
  return Number.isFinite(seed) ? seed : 0;
}

/** A seeded stream for `key` (createSeededRng over the shared FNV-1a hash). */
export function eventRng(key) {
  return createSeededRng(eclipseHash(key));
}

/** act1 -> 1 ... act4 -> 4 (anything else: 1). */
export function actNumber(actId) {
  const match = /^act(\d+)$/.exec(String(actId || ''));
  return match ? Math.max(1, Number(match[1])) : 1;
}

/** An amount ({ base, perAct } or a number) for an act, as a whole number. */
export function resolveAmount(value, actId) {
  if (typeof value === 'number') return Math.trunc(value);
  if (value && typeof value === 'object')
    return (
      Math.trunc(Number(value.base) || 0) + Math.trunc(Number(value.perAct) || 0) * actNumber(actId)
    );
  return 0;
}

/** A byRung table's value for the run's rung (the highest rung at or below it), or fallback. */
export function byRungValue(table, difficultyId, fallback = undefined) {
  if (!table || typeof table !== 'object') return fallback;
  let found = fallback;
  for (const id of DIFFICULTY_IDS) {
    if (Object.hasOwn(table, id) && isDifficultyAtLeast(difficultyId, id)) found = table[id];
  }
  return found;
}

/** data/events.json costScale for a rung (1 when unlisted). */
export function costScaleFor(catalog, difficultyId) {
  const scale = Number(catalog?.costScale?.[difficultyId]);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/**
 * A gold cost (amount) as the run pays it: the act's amount x costScale for the rung,
 * rounded to the nearest 10.
 */
export function scaledCost(value, run, catalog) {
  const base = resolveAmount(value, run?.currentAct);
  if (base <= 0) return 0;
  return Math.max(0, Math.round((base * costScaleFor(catalog, run?.difficultyId)) / 10) * 10);
}

/** The gold a choice charges (0 when it is free). */
export function choiceCost(run, choice, catalog) {
  return choice?.cost?.gold ? scaledCost(choice.cost.gold, run, catalog) : 0;
}

/** Fill {fallen} in event text from the recorded fallen ally. */
export function fillText(text, state) {
  const name = state?.fallen?.name;
  return String(text ?? '').replaceAll('{fallen}', name || 'Someone');
}

// ── Units ───────────────────────────────────────────────────────────────

const profTypes = (unit) => (unit?.proficiencies || []).map((p) => p?.type);

/** True when the unit has proficiency in any of the weapon types. */
export function unitWields(unit, types) {
  const have = profTypes(unit);
  return (Array.isArray(types) ? types : [types]).some((type) => have.includes(type));
}

/** A caster of Tomes or Light. */
export function unitIsMagic(unit) {
  return unitWields(unit, ['Tome', 'Light']);
}

/** A unit that can use a staff. */
export function unitHasStaff(unit) {
  return unitWields(unit, ['Staff']);
}

/** The roster's living units (a roster unit always stands). */
export function livingUnits(run) {
  return (run?.roster || []).filter((unit) => unit && unit.stats && Number(unit.currentHP) > 0);
}

/** Find a roster unit by uid, name (when unique) or reference. */
export function findRosterUnit(run, ref) {
  const roster = run?.roster || [];
  if (ref && typeof ref === 'object') return roster.includes(ref) ? ref : null;
  if (typeof ref !== 'string' || !ref) return null;
  const byUid = roster.find((unit) => unitUidOf(unit) === ref);
  if (byUid) return byUid;
  const byName = roster.filter((unit) => unit?.name === ref);
  return byName.length === 1 ? byName[0] : null;
}

/** The unit's weapon type that suits it best among `types`: Mastery, then what it wields. */
export function bestWeaponType(unit, types) {
  let best = null;
  let bestScore = -1;
  for (const type of types) {
    const prof = (unit?.proficiencies || []).find((p) => p?.type === type);
    if (!prof) continue;
    const score = (prof.rank === 'Mast' ? 2 : 1) + (unit.weapon?.type === type ? 0.5 : 0);
    if (score > bestScore) {
      best = type;
      bestScore = score;
    }
  }
  return best;
}

// ── Skills a unit may be taught ─────────────────────────────────────────

/**
 * A skill an event may teach: it exists, is not a lord's personal skill and is not an
 * enemy-only class's innate (undead, dragons).
 */
export function isTeachableSkill(skill) {
  if (!skill || typeof skill.id !== 'string') return false;
  if (skill.personal === true) return false;
  const innate = skill.classInnate;
  const classes = Array.isArray(innate) ? innate : innate ? [innate] : [];
  if (classes.length > 0 && classes.every((name) => ENEMY_ONLY_CLASS_NAMES.has(name))) return false;
  return true;
}

function skillIndex(run) {
  return new Map((run?.gameData?.skills || []).map((skill) => [skill.id, skill]));
}

/** The skills of a fallen unit (equipped and benched) that `unit` could be taught. */
export function learnableFromFallen(run, fallen, unit) {
  if (!fallen || !unit) return [];
  const index = skillIndex(run);
  const own = [...(fallen.skills || []), ...benchedSkillsOf(fallen)];
  return [...new Set(own)].filter((id) => isTeachableSkill(index.get(id)) && !knowsSkill(unit, id));
}

/** The fallen ally an Echo state names, found in the run's fallen units (or null). */
export function fallenOfState(run, state) {
  const uid = state?.fallen?.unitUid;
  const list = run?.fallenUnits || [];
  if (uid) return list.find((unit) => unitUidOf(unit) === uid) || null;
  const name = state?.fallen?.name;
  return name ? list.find((unit) => unit?.name === name) || null : null;
}

// ── Requirements ────────────────────────────────────────────────────────

function sortedPhaseIds(config) {
  return (Array.isArray(config?.phases) ? config.phases : [])
    .filter((p) => p && typeof p.id === 'string')
    .sort((a, b) => int(a.min) - int(b.min))
    .map((p) => p.id);
}

function phaseIndexNow(run) {
  const config = run?.getEclipseConfig?.() ?? run?.gameData?.eclipse ?? null;
  if (!config || !isEclipseActive(run?.eclipse, config)) return 0;
  return eclipsePhase(run.eclipse.shadow, config).index;
}

/** How many uses are left on a consumable (an item without `uses` counts as one). */
export function usesLeft(item) {
  const uses = Number(item?.uses);
  return Number.isFinite(uses) ? Math.max(0, Math.trunc(uses)) : 1;
}

/** Every bag and the convoy: { item, holder: unit|null } for a named consumable with uses left. */
export function consumableHolders(run, name) {
  const out = [];
  for (const unit of run?.roster || [])
    for (const item of unit?.consumables || [])
      if (item?.name === name && usesLeft(item) > 0) out.push({ item, holder: unit });
  for (const item of run?.convoy?.consumables || [])
    if (item?.name === name && usesLeft(item) > 0) out.push({ item, holder: null });
  return out;
}

/**
 * The blessing boon types that make sense when taken mid-run, at an altar on the road.
 * An event only ever hands out a blessing whose boons are ALL on this list. Left out on
 * purpose: everything that is a run-start grant (starting_*), skip_first_shop,
 * deploy_cap_delta (the deploy screen's cap), act-scoped stat/hit deltas (act_stat_delta_all_units,
 * act_hit_bonus: a dud outside their act), gold_delta (gold is the events' own currency),
 * and every price type (disable_personal_skills_until_act, enemy_level_delta,
 * eclipse_shadow_delta, weapon_art_hp_cost_delta). data validation (EventValidation) checks
 * that every blessing tier an event asks for still has at least one safe blessing.
 */
export const SAFE_BLESSING_BOON_TYPES = Object.freeze([
  'all_act_hit_bonus',
  'run_start_max_hp_bonus',
  'lord_stat_bonus',
  'all_units_stat_delta',
  'all_growths_delta',
  'targeted_growths_delta',
  'xp_multiplier_delta',
  'forge_cost_multiplier',
  'forge_cost_discount',
  'forge_limit_delta',
  'shop_item_count_delta',
  'shop_price_discount',
  'battle_gold_multiplier_delta',
  'recruit_level_bonus',
  'terrain_combat_bonus',
  'healing_effectiveness_delta',
  'extra_consumable',
  'starting_consumable_all',
]);

/**
 * True when every boon of the blessing is on the mid-run-safe list and it carries no fixed
 * pact (an event hands out boons only, so a blessing whose price is a pact would be free).
 */
export function isSafeEventBlessing(blessing) {
  const boons = Array.isArray(blessing?.boons) ? blessing.boons : [];
  return (
    !blessing?.pact &&
    boons.length > 0 &&
    boons.every((boon) => SAFE_BLESSING_BOON_TYPES.includes(boon?.type))
  );
}

/** The blessings of `tier` an event may hand out that the run does not hold. */
export function availableEventBlessings(run, tier) {
  const held = new Set(run?.getActiveBlessingIds?.() || []);
  return (run?.gameData?.blessings?.blessings || []).filter(
    (blessing) =>
      blessing?.tier === tier && !held.has(blessing.id) && isSafeEventBlessing(blessing),
  );
}

const rosterBlock = (run, need) => {
  const units = run?.roster || [];
  if (need.weaponTypes && !units.some((unit) => unitWields(unit, need.weaponTypes)))
    return `No one here can wield a ${need.weaponTypes.join(', ').toLowerCase()}.`;
  if (need.magic && !units.some(unitIsMagic)) return 'No one here can cast.';
  if (need.staff && !units.some(unitHasStaff)) return 'No one here can use a staff.';
  if (Number.isFinite(need.minUnits) && units.length < need.minUnits)
    return 'The army is too small for this.';
  return '';
};

/**
 * Why a `requires` block is not met ('' when it is). `ctx`: { catalog, node? }.
 * `requires.reason` replaces the default line. Unknown keys fail closed (the validator
 * makes them unreachable).
 */
export function evaluateRequires(run, requires, ctx = {}) {
  if (!requires || typeof requires !== 'object') return '';
  const custom = typeof requires.reason === 'string' && requires.reason ? requires.reason : '';
  const fail = (line) => custom || line;
  const act = run?.currentAct;
  for (const key of Object.keys(requires)) {
    const need = requires[key];
    if (key === 'reason') continue;
    if (key === 'acts') {
      if (!Array.isArray(need) || !need.includes(act)) return fail('Not on this road.');
    } else if (key === 'minRow') {
      if (!(Number(ctx.node?.row) >= need)) return fail('Too early on the road.');
    } else if (key === 'maxRow') {
      if (!(Number(ctx.node?.row) <= need)) return fail('Too late on the road.');
    } else if (key === 'difficultyAtLeast') {
      if (!isDifficultyAtLeast(run?.difficultyId, need)) return fail('Not at this difficulty.');
    } else if (key === 'difficultyAtMost') {
      if (difficultyRank(run?.difficultyId) > difficultyRank(need))
        return fail('Not at this difficulty.');
    } else if (key === 'phaseAtLeast' || key === 'phaseAtMost') {
      const config = run?.getEclipseConfig?.() ?? run?.gameData?.eclipse ?? null;
      const wanted = sortedPhaseIds(config).indexOf(need);
      const now = phaseIndexNow(run);
      if (wanted < 0) return fail('Unavailable.');
      if (key === 'phaseAtLeast' ? now < wanted : now > wanted)
        return fail('The sun is in the wrong phase.');
    } else if (key === 'goldAtLeast') {
      if (!(Number(run?.gold) >= scaledCost(need, run, ctx.catalog)))
        return fail('Not enough gold.');
    } else if (key === 'roster') {
      const line = rosterBlock(run, need || {});
      if (line) return fail(line);
    } else if (key === 'fallen') {
      const any = (run?.fallenUnits || []).length > 0;
      if (need === true ? !any : any) return fail('No one has fallen.');
    } else if (key === 'consumable') {
      if (consumableHolders(run, need).length === 0) return fail(`You have no ${need} to spare.`);
    } else if (key === 'flag') {
      if (!run?.storyFlags?.[need]) return fail('Not something you have done.');
    } else if (key === 'notFlag') {
      if (run?.storyFlags?.[need]) return fail('You have already done this.');
    } else if (key === 'notBurden') {
      if ((run?.burdens || []).some((b) => b?.id === need))
        return fail('Something already weighs on you.');
    } else if (key === 'blessingTier') {
      if (availableEventBlessings(run, need).length === 0)
        return fail('There is nothing left to give you.');
    } else {
      return fail('Unavailable.');
    }
  }
  return '';
}

// ── The target filter ───────────────────────────────────────────────────

/** Default one-line reason a unit fails a filter. */
function unitFilterReason(unit, filter, ctx) {
  if (filter.living && !(Number(unit?.currentHP) > 0)) return 'Cannot act.';
  if (filter.notLord && unit?.isLord) return 'A lord cannot.';
  if (filter.weaponTypes && !unitWields(unit, filter.weaponTypes))
    return `Cannot use ${filter.weaponTypes.map((t) => t.toLowerCase()).join(', ')}.`;
  if (filter.magic && !unitIsMagic(unit)) return 'Not a spellcaster.';
  if (filter.staff && !unitHasStaff(unit)) return 'Cannot use a staff.';
  if (Number.isFinite(filter.minLevel) && !(Number(unit?.level) >= filter.minLevel))
    return `Below level ${filter.minLevel}.`;
  if (filter.notFullHp && !(Number(unit?.currentHP) < Number(unit?.stats?.HP)))
    return 'Already at full health.';
  if (filter.learnsFromFallen && learnableFromFallen(ctx.run, ctx.fallen, unit).length === 0)
    return 'Nothing to learn from them.';
  return '';
}

/** Why `unit` does not match `filter` ('' when it does). */
export function targetFilterBlock(run, unit, filter, ctx = {}) {
  if (!unit || !run?.roster?.includes(unit)) return 'Not in the army.';
  return unitFilterReason(unit, filter || {}, { run, ...ctx });
}

/** Every roster unit with whether the choice's filter accepts it: [{ unit, uid, ok, reason }]. */
export function targetCandidates(run, filter, ctx = {}) {
  return (run?.roster || []).map((unit) => {
    const reason = targetFilterBlock(run, unit, filter, ctx);
    return { unit, uid: unitUidOf(unit), name: unit.name, ok: !reason, reason };
  });
}

// ── Item room ───────────────────────────────────────────────────────────

/** True when any outcome (or fallback, or afterVictory) of the choice can grant an item. */
export function choiceMayGrantItem(choice) {
  const grants = (effects) =>
    (effects || []).some(
      (effect) =>
        effect?.type === 'item' || (effect?.type === 'battle' && grants(effect.afterVictory)),
    );
  if (grants(choice?.effects)) return true;
  return (choice?.outcomes || []).some(
    (outcome) => grants(outcome.effects) || grants(outcome.fallback),
  );
}

// ── Eligibility and the pick ────────────────────────────────────────────

/** Event ids this run has already met (the log and the acts' recorded states). */
export function seenEventIds(run) {
  const ids = new Set();
  for (const entry of run?.eventLog || [])
    if (typeof entry?.eventId === 'string') ids.add(entry.eventId);
  for (const state of Object.values(run?.eventStateByNodeId || {}))
    if (typeof state?.eventId === 'string') ids.add(state.eventId);
  return ids;
}

/**
 * Whether an event may be picked now: acts, `requires`, not seen before when once-per-run,
 * positive weight. The fallback is never eligible by weight.
 */
export function eventBlock(run, event, node, catalog, seen = seenEventIds(run)) {
  if (!event || event.fallback === true) return 'fallback';
  if (!(Number(event.weight) > 0)) return 'weight';
  const acts = Array.isArray(event.acts) && event.acts.length ? event.acts : EVENT_ACTS;
  if (!acts.includes(run?.currentAct)) return 'act';
  if (event.oncePerRun !== false && seen.has(event.id)) return 'seen';
  return evaluateRequires(run, event.requires, { catalog, node }) ? 'requires' : '';
}

/** Every event the run could meet at this node right now (catalog order). */
export function eligibleEvents(run, node, catalog) {
  if (!catalog || isPrologueRun(run)) return [];
  const seen = seenEventIds(run);
  return catalog.events.filter((event) => eventBlock(run, event, node, catalog, seen) === '');
}

/**
 * The seeded pick: each eligible event draws u from its own `event-pick:` stream and is
 * keyed -ln(u) / weight (a weighted random order, independent of catalog order); the
 * smallest key wins. Falls back to the fallback event when nothing is eligible.
 * @returns {object|null} the event definition
 */
export function pickEvent(run, node, catalog) {
  const eligible = eligibleEvents(run, node, catalog);
  if (eligible.length === 0) return fallbackEvent(catalog);
  const seed = runSeedOf(run);
  let best = null;
  let bestKey = Infinity;
  for (const event of eligible) {
    const u = eventRng(`event-pick:${seed}:${node.id}:${event.id}`)();
    const key = -Math.log(Math.max(u, 1e-12)) / Number(event.weight);
    if (key < bestKey || (key === bestKey && best && event.id < best.id)) {
      best = event;
      bestKey = key;
    }
  }
  return best;
}

/**
 * The fallen ally the Echo names, recorded on arrival. Lords first: when a lord has
 * fallen the pick is among the fallen lords, else among all the fallen. Seeded.
 * @returns {{ unitUid: string|null, name: string }|null}
 */
export function pickFallenAlly(run, nodeId) {
  const fallen = (run?.fallenUnits || []).filter((unit) => unit && !unit.isCaravan);
  if (fallen.length === 0) return null;
  const lords = fallen.filter((unit) => unit.isLord === true);
  const pool = lords.length ? lords : fallen;
  const ordered = [...pool].sort((a, b) =>
    String(unitUidOf(a) || a.name).localeCompare(String(unitUidOf(b) || b.name), 'en', {
      numeric: true,
    }),
  );
  const pick =
    ordered[Math.floor(eventRng(`event-fallen:${runSeedOf(run)}:${nodeId}`)() * ordered.length)];
  return { unitUid: unitUidOf(pick), name: pick.name };
}

// ── Outcomes ────────────────────────────────────────────────────────────

/** The sum of a unit's stats for a check (missing stats count 0). */
export function statSum(unit, stats) {
  return (stats || []).reduce((sum, stat) => sum + (Number(unit?.stats?.[stat]) || 0), 0);
}

/**
 * The chance a check passes: clamp(base + (sum - against) x perPoint + rung delta, min, max).
 * `of: 'target'` reads the chosen unit; `of: 'bestInArmy'` the army's best sum.
 */
export function checkChance(run, check, target) {
  if (!check) return 0;
  const sum =
    check.of === 'bestInArmy'
      ? Math.max(0, ...(run?.roster || []).map((unit) => statSum(unit, check.stats)))
      : statSum(target, check.stats);
  const delta = Number(byRungValue(check.byRung, run?.difficultyId, 0)) || 0;
  const raw =
    (Number(check.base) || 0) +
    (sum - (Number(check.against) || 0)) * (Number(check.perPoint) || 0) +
    delta;
  const min = Number.isFinite(check.min) ? check.min : 0.05;
  const max = Number.isFinite(check.max) ? check.max : 0.95;
  return Math.max(min, Math.min(max, raw));
}

/** An outcome's weight on this rung. */
export function outcomeWeight(run, outcome) {
  const base = Number(outcome?.weight);
  const w = Number(byRungValue(outcome?.weightByRung, run?.difficultyId, base));
  return Number.isFinite(w) && w > 0 ? w : 0;
}

/**
 * Select the outcome of a choice with the seeded stream `event:${seed}:${nodeId}:${choiceId}`
 * (one draw whatever the kind). A check reads the target's (or the army's) stats now.
 * @returns {{ outcome: object, chance: number|null }}
 */
export function selectOutcome(run, nodeId, choice, { target = null } = {}) {
  const roll = eventRng(`event:${runSeedOf(run)}:${nodeId}:${choice.id}`)();
  const outcomes = choice.outcomes || [];
  if (choice.check) {
    const chance = checkChance(run, choice.check, target);
    const wanted = roll < chance ? 'pass' : 'fail';
    return {
      outcome: outcomes.find((o) => o.id === wanted) || outcomes[0],
      chance,
    };
  }
  const weights = outcomes.map((outcome) => outcomeWeight(run, outcome));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return { outcome: outcomes[0], chance: null };
  let cursor = roll * total;
  for (let i = 0; i < outcomes.length; i++) {
    cursor -= weights[i];
    if (cursor < 0) return { outcome: outcomes[i], chance: null };
  }
  return { outcome: outcomes.at(-1), chance: null };
}

/** True for a node that holds an event the run has not left yet. */
export function isEventNode(node) {
  return node?.type === NODE_TYPES.EVENT;
}

/**
 * Whether a won event battle's spoils are still owed at this node: the node is complete
 * (the fight was won) and its event state still says `battle: 'pending'`. Read from the
 * durable event state alone, never from `pendingEventNodeId`, which is only a hint: owed
 * spoils survive a failed attempt, a reload and a lost marker. Taking them (or giving them
 * up) moves the state on to 'won', so nothing is owed twice.
 */
export function eventSpoilsOwedAt(run, node) {
  if (!isEventNode(node) || node.completed !== true) return false;
  return run?.eventStateByNodeId?.[node.id]?.battle === 'pending';
}

// ── Saved state: sanitizers ─────────────────────────────────────────────

const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function plainJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

const cleanResults = (raw) =>
  (Array.isArray(raw) ? raw : [])
    .filter((entry) => isPlain(entry) && typeof entry.kind === 'string' && entry.kind)
    .map(plainJson)
    .filter(Boolean);

/**
 * Per-node event states from a save: string node ids, an event id string, plain
 * result records. Unknown event ids are kept (a later build can still show the record).
 */
export function sanitizeEventStates(raw) {
  const out = {};
  if (!isPlain(raw)) return out;
  for (const [nodeId, entry] of Object.entries(raw)) {
    if (!nodeId || !isPlain(entry) || typeof entry.eventId !== 'string' || !entry.eventId) continue;
    const state = { eventId: entry.eventId };
    if (typeof entry.arrivedAct === 'string') state.arrivedAct = entry.arrivedAct;
    if (isPlain(entry.fallen) && typeof entry.fallen.name === 'string')
      state.fallen = {
        unitUid: typeof entry.fallen.unitUid === 'string' ? entry.fallen.unitUid : null,
        name: entry.fallen.name,
      };
    for (const key of ['choiceId', 'outcomeId', 'targetUid', 'targetName', 'text', 'victoryText'])
      if (typeof entry[key] === 'string') state[key] = entry[key];
    state.results = cleanResults(entry.results);
    state.victoryResults = cleanResults(entry.victoryResults);
    if (entry.battle === 'pending' || entry.battle === 'won') state.battle = entry.battle;
    else state.battle = null;
    state.afterVictory = (Array.isArray(entry.afterVictory) ? entry.afterVictory : [])
      .filter((effect) => isPlain(effect) && typeof effect.type === 'string')
      .map(plainJson)
      .filter(Boolean);
    if (entry.left === true) state.left = true;
    if (entry.spoilsForfeited === true) state.spoilsForfeited = true;
    out[nodeId] = state;
  }
  return out;
}

/** The run-long event log: [{ eventId, choiceId, outcomeId, act }]. */
export function sanitizeEventLog(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter(
      (entry) =>
        isPlain(entry) &&
        typeof entry.eventId === 'string' &&
        entry.eventId &&
        typeof entry.choiceId === 'string' &&
        typeof entry.outcomeId === 'string',
    )
    .map((entry) => ({
      eventId: entry.eventId,
      choiceId: entry.choiceId,
      outcomeId: entry.outcomeId,
      act: typeof entry.act === 'string' ? entry.act : null,
    }));
}

/** Story flags: string keys with string, number or boolean values. */
export function sanitizeStoryFlags(raw) {
  const out = {};
  if (!isPlain(raw)) return out;
  for (const [key, value] of Object.entries(raw))
    if (key && ['string', 'number', 'boolean'].includes(typeof value)) out[key] = value;
  return out;
}

/** The units laid to rest: valid serialized units. */
export function sanitizeLaidToRest(raw) {
  return (Array.isArray(raw) ? raw : []).filter(
    (unit) => isPlain(unit) && typeof unit.name === 'string' && unit.name && isPlain(unit.stats),
  );
}
