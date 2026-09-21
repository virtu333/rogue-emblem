// Symmetric continuous 2RN: use the same combat RNG stream for both draws.
// Forecast Hit stays the familiar rating; Crit and skill activations remain 1RN.
export function rollHit(hit, rng = Math.random) {
  return ((rng() + rng()) / 2) * 100 < hit;
}

export function hitProbability(hit) {
  const p = Math.max(0, Math.min(1, (Number(hit) || 0) / 100));
  return p <= 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p);
}
