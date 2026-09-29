import { generateThirdLordCandidates } from './BossRecruitSystem.js';
import { migrateUnitTraits } from './TraitSystem.js';
import { normalizeUnitDeeds } from './DeedSystem.js';
import { createSeededRng } from './BlessingEngine.js';

function hashStringToUint32(text) {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// The Power of Friendship arrival is rolled once, when it is first due, and lives
// on the run beside the pending battle reward until the player chooses. Rendering,
// reloading and resuming must never re-roll it, and a reroll (pick3_reroll) is
// spent the moment the new cards exist, so a reload cannot take it back.

const MODES = new Set(['random', 'pick3', 'pick3_reroll', 'pick_all']);

/** The arrival's draft, rolled on a stream of its own (run seed, battle, reroll). */
function draftRng(run) {
  if (!Number.isFinite(run.runSeed)) return Math.random;
  const stage = run.thirdLordRerolled ? 1 : 0;
  return createSeededRng(
    hashStringToUint32(`third-lord:${run.runSeed >>> 0}:${run.completedBattles}:${stage}`),
  );
}

/**
 * Roll (or return the already rolled) arrival and keep it on the run. Returns
 * null when no lord is left to arrive.
 * @returns {{ candidates: Array, mode: string }|null}
 */
export function prepareThirdLord(run, data) {
  if (run.pendingThirdLord) return run.pendingThirdLord;
  const mode = MODES.has(run.metaEffects?.thirdLordMode) ? run.metaEffects.thirdLordMode : 'random';
  const result = generateThirdLordCandidates(
    run.roster,
    data,
    run.getEffectiveMetaEffects(),
    run.fallenUnits || [],
    mode,
    draftRng(run),
  );
  if (!result) return null;
  run.assignPortraitVariants?.(result.candidates);
  run.pendingThirdLord = {
    version: 1,
    nodeId: run.currentNodeId ?? null,
    actId: run.currentAct,
    mode,
    rerolled: run.thirdLordRerolled === true,
    candidates: result.candidates, // serialized units: plain data, saved as they are
  };
  return run.pendingThirdLord;
}

/** Spend the reroll and throw the cards away; the next prepare rolls fresh ones. */
export function rerollThirdLord(run) {
  run.consumeThirdLordReroll();
  run.pendingThirdLord = null;
}

/** The choice is made (a skip passes null): clear the offer, and join the pick. */
export function resolveThirdLordArrival(run, unit) {
  run.pendingThirdLord = null;
  run.resolveThirdLord(unit);
}

/**
 * Load-time check of a saved arrival. It only stands while its reward is still
 * pending in the same act, the lord has not arrived, and every candidate is still
 * a lord the army lacks; anything else is a stale record and is dropped.
 */
export function restorePendingThirdLord(saved, { actId, hasPendingReward, joined, takenNames }) {
  if (joined || !hasPendingReward || saved?.version !== 1 || saved.actId !== actId) return null;
  if (!MODES.has(saved.mode)) return null;
  const taken = new Set(takenNames || []);
  const candidates = (Array.isArray(saved.candidates) ? saved.candidates : [])
    .filter((c) => c?.unit?.name && c.unit.stats && typeof c.unit.stats === 'object')
    .filter((c) => !taken.has(c.unit.name))
    .map((c) => {
      const copy = JSON.parse(JSON.stringify(c));
      return { ...copy, unit: normalizeUnitDeeds(migrateUnitTraits({ ...copy.unit })) };
    });
  if (!candidates.length) return null;
  return {
    version: 1,
    nodeId: typeof saved.nodeId === 'string' ? saved.nodeId : null,
    actId,
    mode: saved.mode,
    rerolled: saved.rerolled === true,
    candidates,
  };
}
