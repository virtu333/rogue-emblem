// BattleObjectives.js - a battle's objectives model (docs/specs/large-maps/03-objectives.md §4),
// built here for its first kind, `defeat` (docs/specs/act-v-descent.md §9.4). Pure: no Phaser,
// no RNG. BattleScene.checkBattleEnd, the headless harness's _checkBattleEnd and the harness
// invariants read this one predicate when a config carries `objectives`, so the two worlds can
// never disagree about the end of a defeat map; a config without `objectives` keeps the legacy
// rules (RoutObjective, the Seize command, the escape check) exactly as before.
//
// battleConfig.objectives, written at generation and locked with the map:
//   { version: 1, primary: [{ id, kind: 'defeat', targets: [ref], need?, label? }] }
// - every primary must resolve to win (AND), in display order;
// - a ref is a spawn's `authoredId` (the unit carries it, EnemySpawnGear.applySpawnLoadout) or
//   '@boss' (every living `isBoss` enemy);
// - `need` (default: every target) is how many targets must fall;
// - `label` is the strip's name for the targets ("the Voices"); without one a single target is
//   named, several are "N targets".
// The legacy `objective` string beside it is the kind's family (`legacyObjectiveKind`: defeat is
// `rout`), so a client without this module plays the map as a rout: kill everything, winnable.
//
// A target is down when no enemy carrying its ref stands (array presence, the rout's own test).
// Its Revival Stones hold as usual: a bar a stone refills never leaves the field, so only the
// last bar counts. A target never leaves remains (the set-piece validator refuses a Zombie
// target), so a fallen one cannot rise. Victory waits for the enemy phase's end as a rout does
// (the caller's `_reinforcementsPendingThisTurn`), and the army's defeat is checked first.
//
// The large-maps PR 1 extends this module (phases, `objectiveState`, the derived legacy model,
// the other kinds); it must not fork it.

/** The model's version: the only one this build writes and reads. */
export const OBJECTIVES_VERSION = 1;

/** The ref that names every living boss on the map. */
export const BOSS_REF = '@boss';

/** The primary kinds this build plays (a model naming any other is read as legacy). */
export const OBJECTIVE_KINDS = Object.freeze(['defeat']);

/** The legacy family of every kind the large-maps model names (03 §3.3). */
const LEGACY_FAMILY = Object.freeze({
  rout: 'rout',
  defeat: 'rout',
  assassinate: 'rout',
  seize: 'seize',
  capture: 'seize',
  destroy: 'seize',
  escape: 'escape',
  escort: 'escape',
});

/** Objective ids: `[a-z0-9_]{1,24}`, unique in a config. */
const OBJECTIVE_ID = /^[a-z0-9_]{1,24}$/;
/** The strip's group name, kept short. */
const LABEL_MAX = 30;

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * The legacy `objective` string a model writes beside itself: the family of its first primary's
 * kind (defeat -> rout). Null for a model with no known first kind.
 */
export function legacyObjectiveKind(objectives) {
  const kind = objectives?.primary?.[0]?.kind;
  return LEGACY_FAMILY[kind] || null;
}

/**
 * What is wrong with a model's shape, as messages (none: a playable model). Refs are checked
 * only for form here: the caller knows which spawns exist (SetPieces' validator,
 * MapGenerator.validateBattleConfig).
 * @returns {string[]}
 */
export function objectivesShapeErrors(objectives) {
  if (!isObject(objectives)) return ['objectives must be an object'];
  const errors = [];
  if (objectives.version !== OBJECTIVES_VERSION)
    errors.push(`objectives.version must be ${OBJECTIVES_VERSION}`);
  const primary = objectives.primary;
  if (!Array.isArray(primary) || primary.length === 0) {
    errors.push('objectives.primary must be a non-empty list');
    return errors;
  }
  const ids = new Set();
  primary.forEach((objective, i) => {
    const at = `objectives.primary[${i}]`;
    if (!isObject(objective)) {
      errors.push(`${at} must be an object`);
      return;
    }
    if (typeof objective.id !== 'string' || !OBJECTIVE_ID.test(objective.id))
      errors.push(`${at}.id must match [a-z0-9_]{1,24}`);
    else if (ids.has(objective.id)) errors.push(`${at}.id "${objective.id}" is used twice`);
    else ids.add(objective.id);
    if (!OBJECTIVE_KINDS.includes(objective.kind)) {
      errors.push(`${at}.kind must be one of ${OBJECTIVE_KINDS.join(', ')}`);
      return;
    }
    const targets = objective.targets;
    if (!Array.isArray(targets) || targets.length === 0) {
      errors.push(`${at}.targets must name at least one target`);
      return;
    }
    if (targets.some((ref) => typeof ref !== 'string' || !ref))
      errors.push(`${at}.targets must be refs (an authored id or "${BOSS_REF}")`);
    if (new Set(targets).size !== targets.length) errors.push(`${at}.targets names one twice`);
    if (
      objective.need !== undefined &&
      !(Number.isInteger(objective.need) && objective.need >= 1 && objective.need <= targets.length)
    )
      errors.push(`${at}.need must be a whole number from 1 to ${targets.length}`);
    if (objective.label !== undefined) {
      if (typeof objective.label !== 'string' || !objective.label.trim())
        errors.push(`${at}.label must be a non-empty string`);
      else if (objective.label.length > LABEL_MAX)
        errors.push(`${at}.label is over ${LABEL_MAX} characters`);
    }
  });
  return errors;
}

/**
 * The config's objectives model, or null for a map the legacy rules govern: one with none, or
 * one whose model this build cannot play (a newer version or kind), which then plays as its
 * legacy `objective` string says.
 */
export function objectivesOf(config) {
  const objectives = config?.objectives;
  if (objectives === undefined || objectives === null) return null;
  return objectivesShapeErrors(objectives).length === 0 ? objectives : null;
}

/**
 * The kind a battle is played as: its model's first primary kind, else the legacy string. Par
 * (TurnBonusCalculator.battleParMapParams) and the victory word read it.
 */
export function objectiveKindOf(config) {
  return objectivesOf(config)?.primary[0].kind ?? config?.objective ?? null;
}

const isStanding = (unit) => Boolean(unit);

/** The living enemies a ref names: its authored unit, or every boss for '@boss'. */
function unitsForRef(ref, enemyUnits) {
  const enemies = Array.isArray(enemyUnits) ? enemyUnits.filter(isStanding) : [];
  if (ref === BOSS_REF) return enemies.filter((u) => u.isBoss);
  return enemies.filter((u) => u.authoredId === ref);
}

/**
 * The objective's targets still standing: one entry per ref not yet down, with its living
 * units, in the objective's order.
 * @param {object} objective a primary `defeat` objective
 * @param {{ enemyUnits?: object[] }} field
 * @returns {{ ref: string, units: object[] }[]}
 */
export function remainingTargets(objective, field = {}) {
  const targets = Array.isArray(objective?.targets) ? objective.targets : [];
  return targets
    .map((ref) => ({ ref, units: unitsForRef(ref, field.enemyUnits) }))
    .filter((entry) => entry.units.length > 0);
}

/**
 * How many targets every open primary still needs felled, summed (0 for a map without a model,
 * or with every primary done): what the felled band reads.
 */
export function remainingObjectiveTargets(config, field = {}) {
  const objectives = objectivesOf(config);
  if (!objectives) return 0;
  return evaluateObjectives(objectives, field).primary.reduce(
    (sum, p) => sum + Math.max(0, p.need - p.slain),
    0,
  );
}

/** One primary's standing: targets down, how many must fall, done. */
function primaryStatus(objective, field) {
  const total = objective.targets.length;
  const need = Number.isInteger(objective.need) ? objective.need : total;
  const remaining = remainingTargets(objective, field);
  const slain = total - remaining.length;
  return {
    id: objective.id,
    kind: objective.kind,
    total,
    need,
    slain,
    done: slain >= need,
    remaining,
  };
}

/**
 * Whether the objectives are met now. The caller checks the army's defeat first and defers a
 * victory reached inside the enemy phase to the phase's end (as a rout's).
 * @param {object} objectives a model (objectivesOf)
 * @param {{ enemyUnits?: object[] }} field
 * @returns {{ outcome: 'victory'|null, primary: object[] }}
 */
export function evaluateObjectives(objectives, field = {}) {
  const primary = (objectives?.primary || []).map((objective) => primaryStatus(objective, field));
  const outcome = primary.length > 0 && primary.every((p) => p.done) ? 'victory' : null;
  return { outcome, primary };
}

/** The name a ref goes by: a living unit's, else its spawn's, else a plain word. */
function refName(ref, field) {
  const living = unitsForRef(ref, field.enemyUnits)[0];
  if (living?.name) return living.name;
  const spawns = Array.isArray(field.spawns) ? field.spawns : [];
  const spawn =
    ref === BOSS_REF ? spawns.find((s) => s?.isBoss) : spawns.find((s) => s?.authoredId === ref);
  if (spawn?.name) return spawn.name;
  if (ref === BOSS_REF && field.bossName) return field.bossName;
  return ref === BOSS_REF ? 'the boss' : 'the target';
}

/**
 * The name a primary's targets go by on the strip: its `label`, else the one target's name,
 * else a count ("3 targets", "2 of 3 targets" when only some must fall). '@boss' with several
 * bosses standing is "the bosses", never one of them by name.
 */
function targetsLabel(objective, status, field) {
  if (objective.label) return objective.label;
  if (status.total === 1) {
    const ref = objective.targets[0];
    if (ref === BOSS_REF && unitsForRef(ref, field.enemyUnits).length > 1) return 'the bosses';
    return refName(ref, field);
  }
  return status.need === status.total
    ? `${status.total} targets`
    : `${status.need} of ${status.total} targets`;
}

/**
 * The strip's words for each primary (03 §11): "Defeat · Varro", "Defeat · the Voices (2/4)",
 * and the goal sentence "Defeat Varro. The rest need not fall."; the broader word pass (the
 * strip, help, deploy banner, felled band, loom) reads this model.
 *
 * Fog: the view is words and counts only. A ref and a name, never a tile or a unit: a target the
 * player cannot see gives nothing the objective does not already say (its name, if the objective
 * names it; how many remain). The map's markers, when they come, take their anchors from the
 * caller's PlayerKnowledge, never from here.
 * @param {object} objectives a model (objectivesOf)
 * @param {{ enemyUnits?: object[], spawns?: object[], bossName?: string }} field `spawns`: the
 *   config's enemy spawns, which name a target that has already fallen; `bossName`: what
 *   '@boss' is called when no spawn says
 */
export function statusView(objectives, field = {}) {
  const primary = (objectives?.primary || []).map((objective) => {
    const status = primaryStatus(objective, field);
    const label = targetsLabel(objective, status, field);
    const progress = status.total > 1 ? { done: status.slain, total: status.need } : null;
    const count = progress ? ` (${Math.min(progress.done, progress.total)}/${progress.total})` : '';
    return {
      id: objective.id,
      kind: objective.kind,
      verb: 'Defeat',
      label,
      // What the group is called when a count goes before it ("2 Voices remain"): its label, or
      // "the targets" for a group the objective does not name.
      noun: objective.label || (status.total === 1 ? label : 'the targets'),
      compact: `Defeat · ${label}${count}`,
      text: `Defeat ${label}. The rest need not fall.`,
      progress,
      tone: status.done ? 'good' : 'open',
      left: Math.max(0, status.need - status.slain),
      remaining: status.remaining.map((entry) => entry.ref),
    };
  });
  return { primary };
}

/** Whether `unit` is a target of any primary (its authored id is a ref, or it is a boss for '@boss'). */
export function isObjectiveTarget(config, unit) {
  const objectives = objectivesOf(config);
  if (!objectives || !unit || unit.faction === 'player' || unit.faction === 'npc') return false;
  return objectives.primary.some((objective) =>
    objective.targets.some((ref) =>
      ref === BOSS_REF ? unit.isBoss === true : unit.authoredId === ref,
    ),
  );
}

/**
 * The living units a defeat map still needs felled: every unit of each open primary's remaining
 * targets, in display order. The agents' priority list (empty on a map with no model, or once the
 * objectives are met). Reads the field as the rule does, so it sees every foe (an agent is not
 * the player and plays no fog).
 * @returns {object[]}
 */
export function objectiveTargetUnits(config, field = {}) {
  const objectives = objectivesOf(config);
  if (!objectives) return [];
  const out = [];
  for (const objective of objectives.primary) {
    if (primaryStatus(objective, field).done) continue;
    for (const entry of remainingTargets(objective, field))
      for (const unit of entry.units) if (!out.includes(unit)) out.push(unit);
  }
  return out;
}

/** The goal sentences of a battle's config ("Defeat Varro. The rest need not fall."), or null. */
export function objectiveGoalSentences(config, field = {}) {
  const objectives = objectivesOf(config);
  return objectives ? statusView(objectives, field).primary.map((p) => p.text) : null;
}

/**
 * What the felled band reads on a defeat map: how many targets still stand and what they are
 * called ({ left, label } for the first open primary), or null when none stands or the map has
 * no model.
 */
export function felledObjectiveView(config, field = {}) {
  const objectives = objectivesOf(config);
  if (!objectives) return null;
  const open = statusView(objectives, field).primary.find((p) => p.left > 0);
  return open ? { left: open.left, label: open.noun } : null;
}
