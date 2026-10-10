// StatefulRNG.js — the Mulberry32 stream SeededRNG installs, with its state readable and
// settable, so a sim can put Math.random back to an earlier point (a Vision rewind replays a
// battle from its start: tests/sim/ClaimingRunDriver.js).
//
// For a seed, installStatefulSeed(seed) draws exactly the numbers SeededRNG.installSeed(seed)
// draws (the same generator), so a sim that switches between the two sees the same stream.

let originalRandom = null;

/** One Mulberry32 step on `state` (an int32): returns [value in [0,1), next state]. */
function step(state) {
  const next = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(next ^ (next >>> 15), 1 | next);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/**
 * Override Math.random with a seeded Mulberry32 stream whose state can be read and put back.
 * @param {number} seed
 * @returns {{ getState: () => number, setState: (s: number) => void, restore: () => void }}
 */
export function installStatefulSeed(seed) {
  let state = seed | 0;
  if (!originalRandom) originalRandom = Math.random;
  Math.random = function statefulRandom() {
    const [value, next] = step(state);
    state = next;
    return value;
  };
  return {
    getState: () => state,
    setState: (s) => {
      state = s | 0;
    },
    restore: restoreStatefulRandom,
  };
}

/** Restore the native Math.random. */
export function restoreStatefulRandom() {
  if (originalRandom) {
    Math.random = originalRandom;
    originalRandom = null;
  }
}
