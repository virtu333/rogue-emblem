import { createBattleTimeline, trimBattleTimelineToCurrentTurn } from './BattleTimeline.js';

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
  const quota = (result) => !result.ok && (result.reason === 'quota' || result.isQuotaError);
  let result = firstResult || attempt(candidate);
  if (quota(result) && candidate.battleInProgress?.timeline) {
    candidate = structuredClone(candidate);
    const flag = candidate.battleInProgress;
    // Try dropping only the optional archive before losing core destinations.
    if (flag.timeline.presentation) {
      flag.timeline.presentationNextId = Math.max(
        flag.timeline.presentationNextId || 1,
        flag.timeline.presentation.nextId,
      );
      flag.timeline.presentation = null;
      flag.timeline.presentationGeneration = (flag.timeline.presentationGeneration || 0) + 1;
      result = attempt(candidate);
      if (!quota(result)) return { ...result, candidate };
    }
    // Then earlier turns, keeping this turn's "before each action" points.
    const trimmed = trimBattleTimelineToCurrentTurn(flag.timeline);
    if (trimmed.entries.length && trimmed.entries.length < flag.timeline.entries.length) {
      const current = flag.timelineCurrentEntryId;
      flag.timeline = trimmed;
      if (current != null && !trimmed.entries.some((entry) => entry.id === current))
        flag.timelineCurrentEntryId = null;
      result = attempt(candidate);
      if (!quota(result)) return { ...result, candidate };
    }
    const previous = flag.timeline;
    flag.timeline = createBattleTimeline({ policy: flag.rewindPolicy || 'legacy-v1' });
    for (const key of [
      'revision',
      'nextEntryId',
      'presentationNextId',
      'presentationGeneration',
      'currentTurn',
    ])
      flag.timeline[key] = previous[key] || flag.timeline[key];
    flag.timeline.earlierHistoryUnavailable = true;
    flag.timelineCurrentEntryId = null;
    result = attempt(candidate);
  }
  return { ...result, candidate };
}
