// MarkSystem.js — Marks: a rare second roll at recruitment, next to traits
// (docs/specs/phase3.md 3C). Pure, no Phaser.
//
// A Mark is one of the five entries of data/marks.json. A unit stores its id on
// `unit.markId` (never `unit.mark`: classCrests.js / crestArt.js use `spec.mark` for class
// crest art). An id the catalog does not know is ignored on read, as getUnitTraits drops
// unknown trait ids, so an old or hand-edited save loads clean.
//
// THE ROLL happens once, in UnitManager.createRecruitUnit (every recruit source passes through
// it: recruit nodes, event joins, boss recruits, colosseum mercenaries, the Vanguard Cadre's
// extra starter). Lords, the veteran and the prologue's authored units never reach it, so
// "recruits only" holds by construction. The roll has its OWN stream, keyed by run seed and
// the unit's name (`mark:${runSeed}:${name}`), so it never draws from the caller's rng:
// a seeded recruit-node unit is the same with Marks on or off, apart from `markId`.
//
// THE EFFECTS roll on the battle's `Math.random` (the stream a suspend checkpoint restores).
// Each lives at the hook its trigger names:
//   forge  weapon-art-cost   WeaponArtSystem.applyWeaponArtCost
//   hunt   on-attack         Combat.rollStrike
//   ember  on-kill           PostCombatEffects.skillOnKill (the 3B step)
//   veil   on-defend         SkillSystem.rollDefenseSkills
//   road   on-turn-start     SkillSystem.getTurnStartEffects -> TimedWeaponArtBuffs
// Marks are not skills: Silence does not suppress them, they never enter effectiveSkills, and
// they never touch masteryPerkMultiplier, creation mods or migrateUnitTraits.

import { createSeededRng } from './BlessingEngine.js';

/** One recruit in ten bears a Mark until Marked Blood raises it (MetaProgressionManager). */
export const DEFAULT_MARK_CHANCE = 0.1;

/** A strike activation's id for a Mark (`mark_hunt`): ProcVisualTheme reads the prefix. */
export const MARK_ACTIVATION_PREFIX = 'mark_';

/** FNV-1a 32-bit, the family the run's other seeded streams use. */
export function hashStringToUint32(input) {
  const text = String(input ?? '');
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function catalog(marksData) {
  return Array.isArray(marksData) ? marksData : [];
}

/** A Mark's definition by id, or null (unknown ids are ignored). */
export function getMarkDef(markId, marksData) {
  if (typeof markId !== 'string' || !markId) return null;
  return catalog(marksData).find((mark) => mark?.id === markId) || null;
}

/** The Mark a unit bears (its catalog entry), or null: none, or an id the catalog lacks. */
export function getUnitMark(unit, marksData) {
  return getMarkDef(unit?.markId, marksData);
}

/** The Mark a unit bears when it has `trigger`'s kind, else null. */
export function getUnitMarkFor(unit, trigger, marksData) {
  const mark = getUnitMark(unit, marksData);
  return mark && mark.trigger === trigger ? mark : null;
}

/** The rate a recruit rolls a Mark at: the run's effective `markChance`, else the base 10%. */
export function markChanceFor(metaEffects) {
  const raw = metaEffects?.markChance;
  const chance = Number.isFinite(Number(raw)) && raw !== null ? Number(raw) : DEFAULT_MARK_CHANCE;
  return Math.min(1, Math.max(0, chance));
}

/** The roll's own seeded stream: the same run seed and name always give the same Mark. */
export function markRng(runSeed, name) {
  return createSeededRng(hashStringToUint32(`mark:${Number(runSeed) >>> 0}:${name}`));
}

/**
 * Roll a recruit's Mark (once, at creation). Sets `unit.markId` and returns the id, or
 * clears it and returns null. Nothing is drawn from any stream but the Mark's own, and
 * nothing is rolled without a run seed, a catalog and a name (sims and tests that build a
 * recruit without them stay exactly as they were). The name must be final: the stream is
 * keyed by it.
 * @param {object} unit
 * @param {{ runSeed?: number, metaEffects?: object|null, marksData?: Array }} [opts]
 * @returns {string|null}
 */
export function rollMark(unit, { runSeed, metaEffects = null, marksData = null } = {}) {
  if (unit) delete unit.markId;
  const marks = catalog(marksData);
  if (!unit || marks.length === 0) return null;
  if (runSeed === null || runSeed === undefined || !Number.isFinite(Number(runSeed))) return null;
  if (typeof unit.name !== 'string' || !unit.name) return null;
  const rng = markRng(runSeed, unit.name);
  // Two draws, always, so the pick never depends on whether the first one hit.
  const hit = rng() < markChanceFor(metaEffects);
  const pick = rng();
  if (!hit) return null;
  const mark = marks[Math.min(marks.length - 1, Math.floor(pick * marks.length))];
  unit.markId = mark.id;
  return mark.id;
}

/** One proc roll on the battle's Math.random (the checkpointed stream). Never at chance 0. */
export function markProcs(mark) {
  const chance = Number(mark?.chance) || 0;
  if (chance <= 0) return false;
  return Math.random() * 100 < chance;
}

/** A strike activation `{ id, name }` for the proc banner; `side: 'target'` for a defender's. */
export function markActivation(mark, side = 'striker') {
  return {
    id: `${MARK_ACTIVATION_PREFIX}${mark.id}`,
    name: mark.name,
    mark: true,
    ...(side === 'target' ? { side: 'target' } : {}),
  };
}

/** True for an activation entry a Mark made. */
export function isMarkActivation(activation) {
  return (
    Boolean(activation) &&
    (activation.mark === true ||
      (typeof activation.id === 'string' && activation.id.startsWith(MARK_ACTIVATION_PREFIX)))
  );
}

/**
 * Mark of the Road's turn buff for `unit` at the start of its player phase on `turn`: a
 * timed MOV entry for `applyTimedBuffEntry`, ending as the enemy phase of the same turn
 * begins ("this turn", the player phase only).
 */
export function roadBuffEntry(unit, mark, turn) {
  const mov = Math.max(1, Math.trunc(Number(mark?.effect?.movBonus) || 1));
  return {
    key: `mark_${mark.id}::${String(unit?.name || '')}`,
    artId: null,
    sourceName: mark.name,
    sourceFaction: unit?.faction || null,
    expiryPhase: 'enemy',
    expiryTurn: Math.max(1, Math.trunc(Number(turn) || 1)),
    stats: { MOV: mov },
  };
}
