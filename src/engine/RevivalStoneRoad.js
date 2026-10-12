// RevivalStoneRoad — which stone bosses a rung's road actually meets. Pure.
//
// difficulty.json gives every rung a stone count per kind (RevivalStones), but a rung only
// meets the kinds whose boss stands on its road: Nightfall and Black Sun carry a `lieutenant`
// count for the Descent's gate, yet while the Descent is dark they end at the Entity and never
// meet him. The difficulty screen lists only what the road meets (generateModifierSummary's
// `stoneKinds`), read through this one helper.
//
// * actBoss: any of Acts I-III is on the road.
// * emperor: Act IV is.
// * lieutenant: the last act is, and a Lieutenant is seated in it: the descent route the rung
//   takes (descent.json `enabled`, `routeByRung`) names him on a boss node, else the legacy
//   finale's boss pool (enemies.json `finalBoss`, `difficultyFilter`) holds him for the rung.
// * eliteCaptain: elites stand on every road.

import { REVIVAL_STONE_KINDS } from './RevivalStones.js';
import { descentRouteIdFor } from './Descent.js';
import { generateModifierSummary, resolveDifficultyMode } from './DifficultyEngine.js';

const LIEUTENANT = 'The Lieutenant';

/** Does the rung's last act seat the Lieutenant (the Descent's route when on, else the legacy pool)? */
export function roadMeetsLieutenant({ difficultyId, actsIncluded, enemies, descent } = {}) {
  if (!Array.isArray(actsIncluded) || !actsIncluded.includes('finalBoss')) return false;
  const routeId = descentRouteIdFor(descent, difficultyId);
  if (routeId) {
    const rows = descent.routes[routeId].rows || [];
    return rows.some((row) => (row?.nodes || []).some((node) => node?.boss === LIEUTENANT));
  }
  const pool = enemies?.bosses?.finalBoss;
  if (!Array.isArray(pool)) return false;
  // resolveSeatedBoss' rule: the rung's filter applies unless it would leave nobody.
  const allowed = pool.filter(
    (b) => !b.difficultyFilter || b.difficultyFilter.includes(difficultyId),
  );
  return (allowed.length > 0 ? allowed : pool).some((b) => b?.name === LIEUTENANT);
}

/** The stone kinds a boss on this rung's road can carry, in table order. */
export function stoneKindsOnRoad({ difficultyId, actsIncluded, enemies, descent } = {}) {
  const acts = Array.isArray(actsIncluded) ? actsIncluded : [];
  return REVIVAL_STONE_KINDS.filter((kind) => {
    if (kind === 'actBoss') return ['act1', 'act2', 'act3'].some((a) => acts.includes(a));
    if (kind === 'emperor') return acts.includes('act4');
    if (kind === 'lieutenant')
      return roadMeetsLieutenant({ difficultyId, actsIncluded: acts, enemies, descent });
    return true;
  });
}

/** The difficulty screen's modifier lines for a rung, its stones limited to what the road meets. */
export function rungModifierSummary(gameData, difficultyId) {
  const { modifiers } = resolveDifficultyMode(gameData?.difficulty, difficultyId);
  const mode = gameData?.difficulty?.modes?.[difficultyId] || {};
  const stoneKinds = stoneKindsOnRoad({
    difficultyId,
    actsIncluded: modifiers.actsIncluded,
    enemies: gameData?.enemies,
    descent: gameData?.descent,
  });
  return generateModifierSummary(mode, undefined, { stoneKinds });
}
