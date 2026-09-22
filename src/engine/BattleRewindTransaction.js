import { persistWithTimelineFallback } from './BattleTimelinePersistence.js';
import { validateBattleState } from './BattleStateSnapshot.js';
import { isBattleRngState } from './BattleRng.js';

// Pure candidate builder. The caller writes once, then publishes this exact
// checkpoint; never capture/reseed again as part of the transaction.
export function prepareBattleRewind(
  run,
  target,
  { history = null, expectedBattle, expectedRevision } = {},
) {
  if (!run?.battleInProgress || run.status !== 'active')
    return { ok: false, reason: 'battle_closed' };
  const flag = run.battleInProgress;
  if (expectedBattle != null && flag.startedAt !== expectedBattle)
    return { ok: false, reason: 'stale_battle' };
  if (expectedRevision != null && (flag.rewindRevision || 0) !== expectedRevision)
    return { ok: false, reason: 'stale_branch' };
  if (!Number.isInteger(run.visionChargesRemaining) || run.visionChargesRemaining <= 0)
    return { ok: false, reason: 'no_charges' };
  if (
    !validateBattleState(target) ||
    target.recoveryKind === 'fatal_pending' ||
    target.phase !== 'player' ||
    target.pendingActionCompletion
  )
    return { ok: false, reason: 'invalid_target' };
  const policy = flag.rewindPolicy || 'legacy-v1';
  if (target.rewindPolicy !== policy) return { ok: false, reason: 'incompatible_policy' };
  if (policy === 'fixed-v1' && !isBattleRngState(target.rngState))
    return { ok: false, reason: 'invalid_rng' };
  const candidate = structuredClone(run);
  candidate.visionChargesRemaining -= 1;
  candidate.visionCount = Math.max(0, (run.visionCount || 0) + 1);
  candidate.rngSeed = target.rngSeed;
  const domain = target.runBattleState;
  if (domain) {
    candidate.convoy = structuredClone(domain.convoy);
    candidate.accessories = structuredClone(domain.accessories);
    candidate.gold = domain.gold;
  }
  candidate.battleInProgress.rewindRevision = (flag.rewindRevision || 0) + 1;
  candidate.battleInProgress.checkpoint = {
    ...structuredClone(target),
    recoveryKind: 'playable',
    visionSnapshot: structuredClone(target),
    pendingVisionSnapshot: null,
  };
  candidate.battleInProgress.timeline = structuredClone(history);
  const rewindMarker = history?.entries?.at(-1);
  candidate.battleInProgress.timelineCurrentEntryId =
    rewindMarker?.kind === 'rewind' ? (rewindMarker.facts?.[0]?.targetId ?? null) : null;
  return { ok: true, candidate };
}

export function persistBattleRewind(prepared, write) {
  if (!prepared?.ok) return prepared;
  try {
    const result = persistWithTimelineFallback(prepared.candidate, write);
    return result.ok
      ? { ...prepared, candidate: result.candidate }
      : { ok: false, reason: result.reason || 'write_error' };
  } catch {
    return { ok: false, reason: 'write_error' };
  }
}
