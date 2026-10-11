// SeatedBoss.js - who holds a battle's boss seat, at what level and with how many Revival
// Stones (docs/specs/act-v-descent.md §9.2). Pure, no Phaser. One rule for the template path's
// seize pick (MapGenerator.generateEnemies) and a set piece's `boss: true` slot
// (SetPieces.buildSetPieceBattle via MapGenerator.generateSetPieceLayout), so the two can never
// seat a boss differently.
//
// The pick takes exactly one draw from `random` whenever there is anyone to pick from (none
// when the list is empty), whatever else is asked:
// * the candidates are the act's bosses (enemies.json `bosses.<act>`), or on an elite node that is
//   not a boss node the act's elite captains (`eliteCaptains`), less a class the opening rules
//   hold back (EarlyEnemyRules); then the rung's `difficultyFilter` narrows them when it leaves
//   anyone;
// * `params.bossName` seats that boss by name from `bosses.<act>`, past both filters, and still
//   spends the draw, so a config that names the boss the draw would have picked is byte-identical
//   to one that does not. A name the act does not have falls back to the draw's pick.
// Level: the definition's level plus the rung's `bossLevelBonus` (an elite captain's level is
// already scaled to the node and takes none). Stones: RevivalStones' kind for the seat (the
// Entity never carries one).

import { captainLevelFor } from './SetPieces.js';
import { earlyEnemyAllowed } from './EarlyEnemyRules.js';
import { revivalStoneKind, revivalStonesFor } from './RevivalStones.js';

// Elite seize battles hold a captain, not the act's boss (playtest 2026-09-28: a
// mid-act elite fielded Act III's Blade Lord at L17, and the same boss could wait at
// the act's end). Captains come from enemies.elites.<act> and are scaled to the node:
// the top of its enemy level range plus two (Act I: plus none), a promoted class
// that many levels past promotion. They still hold the throne as the map's boss
// (isBoss: boss bonus, bar, AI), with no boss card or lines (those need scene.isBoss).
export function eliteCaptains(enemies, act, levelRange, classes = []) {
  const list = enemies?.elites?.[act];
  if (!Array.isArray(list) || !list.length) return enemies?.bosses?.[act] || [];
  return list.map((entry) => {
    const promoted = classes.find((c) => c.name === entry.className)?.tier === 'promoted';
    const level = captainLevelFor(act, levelRange?.[1], promoted);
    return { className: entry.className, name: entry.name, level };
  });
}

/** Whether a battle's seat holds an elite captain (an elite node that is not a boss node). */
export function seatsEliteCaptain(params) {
  return params?.isElite === true && !params?.isBoss;
}

/**
 * The boss definitions the seat's draw picks from, before the rung's filter (see the header).
 * @param {object} params battle params ({ act, isElite, isBoss, excludeOpeningCavaliers })
 * @param {{ enemies: object, classes?: object[], levelRange?: number[] }} deps
 */
export function seatedBossCandidates(params, { enemies, classes = [], levelRange } = {}) {
  const act = params?.act || 'act1';
  const list = seatsEliteCaptain(params)
    ? eliteCaptains(enemies, act, levelRange, classes)
    : enemies?.bosses?.[act] || [];
  return list.filter((boss) => earlyEnemyAllowed(boss.className, params));
}

/** The candidates the rung's `difficultyFilter` leaves (all of them when it would leave none). */
function rungCandidates(candidates, difficultyId) {
  if (!difficultyId) return candidates;
  const filtered = candidates.filter(
    (b) => !b.difficultyFilter || b.difficultyFilter.includes(difficultyId),
  );
  return filtered.length > 0 ? filtered : candidates;
}

/** The boss `params.bossName` names in `bosses.<act>` (past both filters), or null. */
function namedBoss(params, enemies) {
  if (typeof params?.bossName !== 'string' || !params.bossName) return null;
  const act = params.act || 'act1';
  return (enemies?.bosses?.[act] || []).find((b) => b?.name === params.bossName) || null;
}

/**
 * Every definition the seat may hold for these params, whatever the draw: the boss `bossName`
 * names, or (no name, or one the act does not have) every candidate the rung's filter leaves.
 * What a validator reads to ask who could sit (SetPieces.validateSetPieceAt: never the Entity on
 * one tile); resolveSeatedBoss picks from the same list.
 * @param {object} params battle params ({ act, difficultyId, bossName?, isElite?, isBoss?,
 *   excludeOpeningCavaliers? })
 * @param {{ enemies: object, classes?: object[], levelRange?: number[] }} deps
 * @returns {object[]}
 */
export function possibleSeats(params = {}, deps = {}) {
  const named = namedBoss(params, deps.enemies);
  if (named) return [named];
  return rungCandidates(seatedBossCandidates(params, deps), params.difficultyId || null);
}

/**
 * Pick the boss a battle seats.
 * @param {object} params battle params: { act, difficultyId, bossName?, bossLevelBonus?,
 *   revivalStones?, isElite?, isBoss?, excludeOpeningCavaliers? }
 * @param {{ enemies: object, classes?: object[], levelRange?: number[], random?: () => number,
 *   candidates?: object[] }} deps `candidates` overrides seatedBossCandidates (the template path
 *   hands in the list it already built)
 * @returns {{ bossDef: object, className: string, name: string, level: number, stones: number,
 *   isEntity: boolean, isEliteCaptain: boolean }|null} null (and no draw) when nobody can sit
 */
export function resolveSeatedBoss(params = {}, deps = {}) {
  const act = params.act || 'act1';
  const random = typeof deps.random === 'function' ? deps.random : Math.random;
  let candidates = Array.isArray(deps.candidates)
    ? deps.candidates
    : seatedBossCandidates(params, deps);
  if (!candidates.length) return null;
  candidates = rungCandidates(candidates, params.difficultyId || null);
  let bossDef = candidates[Math.floor(random() * candidates.length)];
  const isEliteCaptain = seatsEliteCaptain(params);
  if (typeof params.bossName === 'string' && params.bossName) {
    const named = namedBoss(params, deps.enemies);
    if (named) bossDef = named;
    else console.warn(`[SeatedBoss] no boss "${params.bossName}" in ${act}; seating the draw's`);
  }
  // The rung's boss level bonus (difficulty.json `bossLevelBonus`): boss levels are
  // otherwise fixed by their definitions and ignore `enemyLevelBonus`. Elite captains
  // already scale with the act's (rung-adjusted) level range.
  const bossLevelBonus = isEliteCaptain
    ? 0
    : Math.max(0, Math.trunc(Number(params.bossLevelBonus) || 0));
  const stones = revivalStonesFor(
    params.revivalStones,
    revivalStoneKind({ bossDef, act, isEliteCaptain }),
  );
  return {
    bossDef,
    className: bossDef.className,
    name: bossDef.name,
    level: bossDef.level + bossLevelBonus,
    stones,
    isEntity: bossDef.isEntity === true,
    isEliteCaptain,
  };
}
