// Local durability is independent of whether a cloud backup can be queued.
export const RETRYABLE_SAVE_REASONS = Object.freeze(['quota', 'write_error']);
export function classifySaveResult(result, { hasCandidate = false, progress = true } = {}) {
  if (result?.ok) return 'durable';
  if (RETRYABLE_SAVE_REASONS.includes(result?.reason) && hasCandidate)
    return progress ? 'retryable' : 'presentation_only';
  if (result?.reason === 'capture_error') return 'capture_error';
  return 'ignored';
}
