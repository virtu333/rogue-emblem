import { everFallenUnits } from './LaidToRest.js';
import { generateBossRecruitCandidates } from './BossRecruitSystem.js';
import { migrateUnitTraits } from './TraitSystem.js';
import { normalizeUnitDeeds } from './DeedSystem.js';

// The boss recruit draft is rolled once, at the victory save, and lives on the
// run beside the pending battle reward until the player picks or skips.
// Rendering, reloading and resuming must never re-roll it.

/**
 * Roll (or return the already rolled) boss recruit candidates and keep them on
 * the run. Returns null when the act offers no recruit (the final boss).
 * @returns {Array|null} the candidates, `{ unit, isLord, className, displayName }`
 */
export function prepareBossRecruit(run, data) {
  if (run.pendingBossRecruit) return run.pendingBossRecruit.candidates;
  const candidates = generateBossRecruitCandidates(
    run.currentAct,
    run.roster,
    data,
    run.getEffectiveMetaEffects(),
    everFallenUnits(run),
    [...(run.getTakenUnitNames?.() || [])],
    run.runSeed,
    // Nomad's Pact reaches the boss draft too (never below 0: the Scholar's Vow's -1 price
    // keeps its recruit-node reach only).
    { recruitLevelBonus: Math.max(0, run.getRecruitLevelBonus?.() || 0) },
  );
  if (!candidates?.length) return null;
  // Each candidate shows (and keeps, once chosen) a face the army lacks.
  run.assignPortraitVariants?.(candidates);
  run.pendingBossRecruit = {
    version: 1,
    nodeId: run.currentNodeId ?? null,
    actId: run.currentAct,
    candidates, // serialized units: plain data, saved as they are
  };
  return candidates;
}

/**
 * The choice is made: clear the offer and, for a pick, put the unit in the
 * army. A skip passes null.
 */
export function resolveBossRecruit(run, unit) {
  run.pendingBossRecruit = null;
  if (!unit) return;
  run.grantRecruitBlessingConsumables?.(unit);
  run.assignUnitUid?.(unit);
  run.roster.push(unit);
}

/**
 * Load-time check of a saved offer. It only stands while its reward is still
 * pending in the same act; anything else is a stale record and is dropped.
 */
export function restorePendingBossRecruit(saved, { actId, hasPendingReward }) {
  if (!hasPendingReward || saved?.version !== 1 || saved.actId !== actId) return null;
  const candidates = (Array.isArray(saved.candidates) ? saved.candidates : [])
    .filter((c) => c?.unit?.name && c.unit.stats && typeof c.unit.stats === 'object')
    .map((c) => {
      const copy = JSON.parse(JSON.stringify(c));
      return { ...copy, unit: normalizeUnitDeeds(migrateUnitTraits({ ...copy.unit })) };
    });
  if (!candidates.length) return null;
  return {
    version: 1,
    nodeId: typeof saved.nodeId === 'string' ? saved.nodeId : null,
    actId,
    candidates,
  };
}
