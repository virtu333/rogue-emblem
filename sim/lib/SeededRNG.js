// SeededRNG.js — Mulberry32 PRNG with Math.random override
// Usage: installSeed(42) → all Math.random() calls become deterministic
//        restoreMathRandom() → revert to native PRNG

let _originalRandom = null;

/** Mulberry32 PRNG — 4 lines, passes BigCrush, standard for JS game seeds. */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Override Math.random with seeded PRNG. */
export function installSeed(seed) {
  _originalRandom = Math.random;
  Math.random = mulberry32(seed);
}

/** Restore native Math.random. */
export function restoreMathRandom() {
  if (_originalRandom) {
    Math.random = _originalRandom;
    _originalRandom = null;
  }
}
