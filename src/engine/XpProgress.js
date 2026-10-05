// XpProgress — what an XP gain looks like on a bar (docs/specs/exp-bars.md §2.5).
// Pure: no Phaser, no DOM, no RNG, and it never touches a unit. The battle's EXP
// gauge and the profile's EXP bar draw only what these return.
//
// The XP rules themselves live in UnitManager.gainExperience; these read them:
//   - a unit holds 0–99 XP toward its next level (XP_PER_LEVEL = 100);
//   - at the level cap it gains nothing (unless extended leveling lets a promoted
//     unit keep wrapping into 20+N);
//   - a gain that reaches the cap stops counting there: whatever XP the unit still
//     holds at the cap can never earn a level (promotion resets XP to 0), so it is
//     neither filled nor counted as gained.

import {
  BASE_CLASS_LEVEL_CAP,
  PROMOTED_CLASS_LEVEL_CAP,
  XP_PER_LEVEL,
} from '../utils/constants.js';
import { getDisplayLevel } from './UnitManager.js';

const int = (value) => Math.max(0, Math.trunc(Number(value) || 0));

/** The level a unit's tier stops at (gainExperience's cap). */
export function xpLevelCap(unit) {
  return unit?.tier === 'promoted' ? PROMOTED_CLASS_LEVEL_CAP : BASE_CLASS_LEVEL_CAP;
}

/**
 * Whether a unit can gain no more XP: at its tier's cap, and not a promoted unit
 * under extended leveling (gainExperience's rule, read the same way).
 */
export function isXpCapped(unit, { extendedLevelingEnabled = false } = {}) {
  if (!unit) return false;
  const extended = extendedLevelingEnabled === true && unit.tier === 'promoted';
  return int(unit.level) >= xpLevelCap(unit) && !extended;
}

/**
 * A unit's XP progress as plain values, safe to keep after the unit changes.
 * @returns {{ level: number, extendedLevels: number, xp: number, capped: boolean }}
 */
export function xpSnapshot(unit, { extendedLevelingEnabled = false } = {}) {
  return {
    level: int(unit?.level),
    extendedLevels: int(unit?.extendedLevels),
    xp: int(unit?.xp),
    capped: isXpCapped(unit, { extendedLevelingEnabled }),
  };
}

function segmentAt(position, from, to, extra = {}) {
  return {
    from,
    to,
    level: position.level,
    extendedLevels: position.extendedLevels,
    label: getDisplayLevel(position),
    ...extra,
  };
}

/**
 * The spans a bar fills for one gain, oldest first. Each segment is drawn at one
 * level: `from`/`to` are XP on a 0–100 bar, `label` is the level as shown ("7",
 * "20+2"). `wraps: true` ends at 100 and rolls into the next level (one per entry of
 * `levelUps`); `capped: true` marks the wrap that lands on the level cap, after which
 * the bar shows MAX and nothing more fills.
 *
 * Examples: 72 + 43 at Lv 7 →
 *   [{ from: 72, to: 100, level: 7, wraps: true }, { from: 0, to: 15, level: 8 }]
 *
 * @param {{ level, extendedLevels, xp, capped }} before  xpSnapshot before the gain
 * @param {{ level, extendedLevels, xp, capped }} after   xpSnapshot after the gain
 * @param {object[]} levelUps  gainExperience's level-ups ({ newLevel } or
 *                             { isExtended, extendedLevel }), oldest first
 */
export function xpGainSegments(before, after, levelUps = []) {
  if (!before || !after || before.capped) return [];
  const ups = Array.isArray(levelUps) ? levelUps : [];
  const position = { level: int(before.level), extendedLevels: int(before.extendedLevels) };
  const segments = [];
  let from = Math.min(int(before.xp), XP_PER_LEVEL);
  for (const up of ups) {
    segments.push(segmentAt(position, from, XP_PER_LEVEL, { wraps: true }));
    if (up?.isExtended) position.extendedLevels = int(up.extendedLevel);
    else position.level = int(up?.newLevel);
    from = 0;
  }
  if (after.capped) {
    // The gain reached the cap: it ends on the wrap into it (no fill past MAX).
    if (segments.length) segments[segments.length - 1].capped = true;
    return segments;
  }
  const to = Math.min(int(after.xp), XP_PER_LEVEL - 1);
  if (to > from) segments.push(segmentAt(position, from, to));
  return segments;
}

/** The XP a gain actually added toward levels: the length of every span it filled. */
export function xpGained(segments) {
  return (segments || []).reduce((sum, s) => sum + Math.max(0, s.to - s.from), 0);
}
