// The chance a recruit node or an act boss's recruit draft holds a lord: one rule for both
// rolls (RecruitNodeSystem.planRecruitNodeSpawn, BossRecruitSystem.generateBossRecruitCandidates).
//
// Odds v2 (docs/specs/lord-recruit-odds.md): the chance falls as the army's lords grow, so a
// fourth or fifth lord is a strong run, a sixth exceptional and a seventh rare. A run started
// before v2 carries no `lordRecruitOdds` record and keeps the flat chance it began with, so an
// update never takes away a lord a route card already shows. Pure.

import { BOSS_RECRUIT_LORD_CHANCE, RECRUIT_NODE_LORD_CHANCE } from '../utils/constants.js';

export const LORD_RECRUIT_ODDS_VERSION = 2;

const BASE_CHANCE = Object.freeze({
  node: RECRUIT_NODE_LORD_CHANCE,
  boss: BOSS_RECRUIT_LORD_CHANCE,
});

/** The share of the chance left at each lord count (2-3 lords keep it all). */
export const LORD_COUNT_MULTIPLIERS = Object.freeze({ 4: 0.5, 5: 0.25, 6: 0.1 });

/** The multiplier for an army of `lordCount` lords (7 or more: every lord is in). */
export function lordCountMultiplier(lordCount) {
  const n = Math.trunc(Number(lordCount) || 0);
  if (n <= 3) return 1;
  if (n >= 7) return 0;
  return LORD_COUNT_MULTIPLIERS[n];
}

/**
 * @param {{ source: 'node'|'boss', bonus?: number, odds?: { v: number, lordCount: number }|null }} args
 *   `bonus`: Hero's Call (metaEffects.lordRecruitChanceBonus). `odds`: the run's v2 record with the
 *   lord count the roll reads; null (a run from before v2) is the flat chance.
 * @returns {number} 0..1
 */
export function lordRecruitChance({ source, bonus = 0, odds = null } = {}) {
  const base = BASE_CHANCE[source];
  if (base === undefined) return 0;
  const flat = Math.min(1, Math.max(0, base + (Number(bonus) || 0)));
  if (!odds || odds.v !== LORD_RECRUIT_ODDS_VERSION) return flat;
  return flat * lordCountMultiplier(odds.lordCount);
}

/**
 * The lords this run has had: those in the army and those fallen or laid to rest, each name
 * once. A fallen lord still counts, so a death never makes the next lord likelier.
 */
export function countRunLords(roster = [], fallenUnits = []) {
  const names = new Set();
  for (const unit of [...(roster || []), ...(fallenUnits || [])]) {
    if (unit?.isLord && typeof unit.name === 'string') names.add(unit.name);
  }
  return names.size;
}

/** A saved record, or null for anything that is not a whole v2 record (an old save). */
export function sanitizeLordRecruitOdds(saved) {
  if (!saved || typeof saved !== 'object' || saved.v !== LORD_RECRUIT_ODDS_VERSION) return null;
  const lordsAtActStart = Math.trunc(Number(saved.lordsAtActStart));
  if (!Number.isFinite(lordsAtActStart) || lordsAtActStart < 0) return null;
  return { v: LORD_RECRUIT_ODDS_VERSION, lordsAtActStart };
}
