// PrologueRouting — where a slot goes on New Game / Continue, given the prologue
// (docs/specs/prologue-chapter.md §9 "Title, slot, routing and meta"). Pure: it reads a
// slot summary (SlotManager.getSlotSummary, or null for an empty slot) and says which
// path the scene takes. Both entry points (TitleScene.handleNewGame and SlotPicker's
// slot selection) and Home Base's Begin Run read it, so the table lives in one place.
//
//   offer      a fresh slot: ask Play the Prologue / Skip to the first run
//   resume     a run in progress (the prologue's or a real one): Continue resumes it
//   homeBase   Home Base (a completed prologue's first visit, or an ordinary save)
//   fastPath   today's first-run fast path (First Light, no blessing), skipping Home
//              Base, Difficulty and Blessing
//   standard   Begin Run's ordinary road: Difficulty, then Blessing

/**
 * A slot qualifies for the first-run fast path when it is brand new: either no meta
 * at all (getSlotSummary returns null) or a saved meta that has never started or
 * finished a run. Any active/corrupt run → not fresh. (firstRunFastPath re-exports it.)
 * @param {{ hasActiveRun?: boolean, runCorrupt?: boolean, runsStarted?: number, runsCompleted?: number } | null} summary
 */
export function isFirstRunSlot(summary) {
  if (!summary) return true; // empty slot (no meta yet)
  if (summary.hasActiveRun) return false;
  if (summary.runCorrupt) return false;
  return (summary.runsStarted || 0) === 0 && (summary.runsCompleted || 0) === 0;
}

export const PROLOGUE_ROUTES = Object.freeze({
  OFFER: 'offer',
  RESUME: 'resume',
  HOME_BASE: 'homeBase',
  FAST_PATH: 'fastPath',
  STANDARD: 'standard',
});

/** The prologue state a summary carries ('none' for an empty slot or an old save). */
export function prologueStateOfSummary(summary) {
  const state = summary?.prologue;
  return state === 'in_progress' || state === 'skipped' || state === 'complete' ? state : 'none';
}

/**
 * Where selecting a slot (or New Game into it) goes.
 * @param {object|null} summary - getSlotSummary(slot); null for an empty slot
 * @param {{ hasPrologue?: boolean }} [options] - the build ships prologue data
 */
export function routeForSlot(summary, { hasPrologue = true } = {}) {
  if (summary?.hasActiveRun && !summary.runCorrupt) return PROLOGUE_ROUTES.RESUME;
  const fresh = isFirstRunSlot(summary);
  const state = prologueStateOfSummary(summary);
  if (!fresh) return PROLOGUE_ROUTES.HOME_BASE; // a slot that started a run never gets the offer
  if (state === 'complete') return PROLOGUE_ROUTES.HOME_BASE;
  if (state === 'skipped' || !hasPrologue) return PROLOGUE_ROUTES.FAST_PATH;
  // 'none', or an 'in_progress' whose run save is gone (the prologue never began a battle).
  return PROLOGUE_ROUTES.OFFER;
}

/**
 * Where Home Base's Begin Run goes: a completed prologue's first real run takes the
 * fast path (until that run starts, which increments runsStarted); otherwise the
 * ordinary Difficulty / Blessing road.
 * @param {{ getPrologueState?: () => string, getRunsStarted?: () => number,
 *   runsStarted?: number, runsCompleted?: number }|null} meta
 */
export function routeForBeginRun(meta) {
  const state = meta?.getPrologueState?.() ?? meta?.prologue?.state ?? 'none';
  const started = Number(meta?.getRunsStarted?.() ?? meta?.runsStarted ?? 0) || 0;
  const completed = Number(meta?.getRunsCompleted?.() ?? meta?.runsCompleted ?? 0) || 0;
  if (state === 'complete' && started === 0 && completed === 0) return PROLOGUE_ROUTES.FAST_PATH;
  return PROLOGUE_ROUTES.STANDARD;
}
