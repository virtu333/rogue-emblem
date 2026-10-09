// RecruitJoinLevel.js — the levels Nomad's Pact adds to a recruit after the unit exists
// (docs/specs/blessings-v3.md §4). Pure.
//
// A recruit-node unit takes the bonus as a higher starting level (RecruitNodeSystem,
// `resolveRecruitNodeLevel`), so its class, promotion and equipment follow from it. The
// boss-recruit draft and the Colosseum mercenary board pick the class first and the level
// by their own rules, so the bonus lands afterwards, as `raiseJoinLevel` level-ups on top
// of the finished unit. Equipment tier for those two sources therefore keeps reading the
// level before the bonus: the pact makes a recruit stronger, it does not upgrade the kit.

import { createSeededRng } from './BlessingEngine.js';
import { eclipseHash } from './EclipseSystem.js';
import { applyLevelUpGains, checkLevelUpSkills, levelUp } from './UnitManager.js';

/**
 * The level-up stream for one recruit: a hash of the run seed and the unit's final name,
 * never the generator's rng or Math.random, so a board or draft picks the same classes,
 * names and prices with the pact and without it (and a given seed always rolls the same
 * gains).
 */
export function joinLevelRng(runSeed, unitName) {
  return createSeededRng(eclipseHash(`join-level:${Number(runSeed) >>> 0}:${unitName}`));
}

/** What a join-level bonus is allowed to be: whole levels, never below 0. */
export function normalizeJoinLevelBonus(levels) {
  return Math.max(0, Math.trunc(Number(levels) || 0));
}

/**
 * Raise a finished recruit by up to `levels` levels: ordinary growth-roll level-ups
 * (`UnitManager.levelUp`), applied with their HP, stopping at the class's level cap, then
 * the level-up skills the new levels unlock. Mutates `unit`. Returns the levels gained.
 * @param {object} unit
 * @param {number} levels
 * @param {{ classes: Array, rng: () => number }} context
 */
export function raiseJoinLevel(unit, levels, { classes, rng }) {
  const wanted = normalizeJoinLevelBonus(levels);
  if (!unit?.stats || wanted <= 0) return 0;
  let gained = 0;
  for (let i = 0; i < wanted; i++) {
    const result = levelUp(unit, rng);
    if (!result) break; // the class cap
    applyLevelUpGains(unit, result);
    gained++;
  }
  if (gained > 0) checkLevelUpSkills(unit, classes || []);
  return gained;
}

/**
 * `raiseJoinLevel` on the recruit's own keyed stream: the call every source makes once
 * the unit's name is final.
 */
export function applyRecruitLevelBonus(unit, levels, { classes, runSeed }) {
  if (normalizeJoinLevelBonus(levels) <= 0) return 0;
  return raiseJoinLevel(unit, levels, { classes, rng: joinLevelRng(runSeed, unit?.name) });
}
