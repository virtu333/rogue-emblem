import { createBattleTimeline } from './BattleTimeline.js';

// Optional history must not crowd out the authoritative recovery record.
// Never change checkpoint, charge ledger, RNG, or chosen rewind target here.
export function persistWithTimelineFallback(candidate, write, firstResult = null) {
  const attempt = (value) => {
    try {
      return write(value) || { ok: false, reason: 'write_error' };
    } catch {
      return { ok: false, reason: 'write_error' };
    }
  };
  let result = firstResult || attempt(candidate);
  if (
    !result.ok &&
    (result.reason === 'quota' || result.isQuotaError) &&
    candidate.battleInProgress?.timeline
  ) {
    candidate = structuredClone(candidate);
    const flag = candidate.battleInProgress;
    flag.timeline = createBattleTimeline({ policy: flag.rewindPolicy || 'legacy-v1' });
    flag.timeline.earlierHistoryUnavailable = true;
    flag.timelineCurrentEntryId = null;
    result = attempt(candidate);
  }
  return { ...result, candidate };
}
