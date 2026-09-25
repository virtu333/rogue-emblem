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

/**
 * Shed optional battle history from a stored run save (another slot's), in
 * stages that free the least valuable data first:
 *   1 — frame archives (the suspended battle's and a finished run's report)
 *   2 — rewind points before the suspended battle's current turn
 *   3 — the whole rewind timeline (the checkpoint still resumes the battle)
 * Never touches the checkpoint, charges, RNG or anything gameplay reads, and
 * keeps savedAt (this is the same save, minus optional history).
 * @returns {object|null} the smaller run, or null when the stage frees nothing
 */
export function shedOptionalHistory(run, level) {
  if (!run || typeof run !== 'object') return null;
  const next = structuredClone(run);
  const flag = next.battleInProgress;
  const timeline = flag?.timeline && typeof flag.timeline === 'object' ? flag.timeline : null;
  let changed = false;
  if (level === 1) {
    if (timeline?.presentation) {
      timeline.presentationNextId = Math.max(
        timeline.presentationNextId || 1,
        timeline.presentation.nextId || 1,
      );
      timeline.presentation = null;
      timeline.presentationGeneration = (timeline.presentationGeneration || 0) + 1;
      changed = true;
    }
    if (next.lastBattleReport?.presentation) {
      next.lastBattleReport.presentation = null;
      changed = true;
    }
  } else if (level === 2 && timeline && Array.isArray(timeline.entries)) {
    let trimmed;
    try {
      trimmed = trimBattleTimelineToCurrentTurn(timeline);
    } catch {
      return null;
    }
    if (trimmed.entries.length < timeline.entries.length) {
      const current = flag.timelineCurrentEntryId;
      flag.timeline = trimmed;
      if (current != null && !trimmed.entries.some((entry) => entry.id === current))
        flag.timelineCurrentEntryId = null;
      changed = true;
    }
  } else if (level === 3 && timeline && timeline.entries?.length) {
    const empty = createBattleTimeline({ policy: flag.rewindPolicy || 'legacy-v1' });
    for (const key of [
      'revision',
      'nextEntryId',
      'presentationNextId',
      'presentationGeneration',
      'currentTurn',
    ])
      empty[key] = timeline[key] || empty[key];
    empty.earlierHistoryUnavailable = true;
    flag.timeline = empty;
    flag.timelineCurrentEntryId = null;
    changed = true;
  }
  return changed ? next : null;
}
