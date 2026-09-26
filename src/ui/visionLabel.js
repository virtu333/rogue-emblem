/** Vision is the resource; Rewind is the action. Shared across HUD layouts. */
export function visionLabel(charges, { desktop = false } = {}) {
  const count = Math.max(0, Math.trunc(Number(charges) || 0));
  return `Vision · ${count} left${desktop ? ' · [R] Rewind' : ''}`;
}

/** Keep the most important shortcuts instead of hiding an overflowing hint. */
export function fitHintSegments(segments, maxWidth, measure) {
  let fitted = '';
  for (const segment of segments) {
    const candidate = fitted ? `${fitted} · ${segment}` : segment;
    if (measure(candidate) > maxWidth) break;
    fitted = candidate;
  }
  return fitted;
}
