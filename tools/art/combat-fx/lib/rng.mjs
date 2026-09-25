// Seeded randomness for the generator. Each animation seeds its own stream from its
// key, so adding or reordering effects never changes another effect's pixels.
import { mulberry32 } from '../../../../src/art/terrain/noise.js';

export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}

export function rngFor(key) {
  const next = mulberry32(hashString(`combat-fx:${key}`));
  const rng = () => next();
  rng.range = (a, b) => a + (b - a) * next();
  rng.int = (a, b) => Math.floor(a + (b - a + 1) * next());
  rng.pick = (list) => list[Math.floor(next() * list.length)];
  rng.sign = () => (next() < 0.5 ? -1 : 1);
  return rng;
}
